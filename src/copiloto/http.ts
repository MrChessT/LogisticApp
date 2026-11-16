// Endpoints del asistente como funciones de la app (sin servidor aparte). Cada petición trabaja con el
// JWT del usuario: RLS activo, sin service role. El contrato está en docs/copiloto/CONTRACT.md.
import { civilToday } from "@/lib/business-day";
import { reportError } from "../lib/report-error";
import { formatStock } from "./entities/units";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Analytics } from "./analytics/analytics";
import { buildReportPdf, type ReportView } from "./reports/pdf-report";
import { departmentsOf } from "./analytics/categories";
import { SessionStore } from "./agent/session";
import { CompositeAuditSink, ConsoleAuditSink } from "./audit/audit";
import { ANALYTICS_VIEWS, CATALOG_KINDS, ChatRequest, CONTRACT_VERSION, type ErrorEvent, type HealthResponse } from "./contract/index";
import type { SessionContext } from "./domain";
import { ConfirmRequest } from "./drafts/confirm";
import { markTest, writerFor } from "./drafts/test-mode";
import { DraftStore } from "./drafts/store";
import { runtime } from "./runtime";
import { AuthError, type AuthUser } from "./security/auth";
import type { RateLimiter } from "./security/rate-limit";
import { SupabaseAuditSink } from "./supabase/audit-sink";
import { DataError, pingSupabase, userClient } from "./supabase/client";
import { SupabaseContext } from "./supabase/context";
import { SupabaseDataSource } from "./supabase/data-source";
import { SupabaseInfoSource } from "./supabase/info-source";
import { memoizeSource } from "./supabase/memo-source";
import { cachedSource, invalidateBusinessCache } from "./supabase/business-cache";
import { SupabaseDraftPersistence, SupabaseHabitsPersistence, SupabaseSessionPersistence } from "./supabase/state";
import { HabitsStore } from "./agent/habits";
import { computeReorder, InventoryTools } from "./tools/tools";

export interface RequestUser extends AuthUser {
  orgId: string;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "X-LogisticApp-Contract": CONTRACT_VERSION, ...headers } });

const fail = (status: number, error: ErrorEvent, headers: Record<string, string> = {}) => json(error, status, headers);

function limited(limiter: RateLimiter, key: string): Response | null {
  const wait = limiter.take(key);
  return wait > 0 ? fail(429, { code: "rate_limited", message: `Demasiadas peticiones. Espera ${wait} s.`, retryable: true }, { "Retry-After": String(wait) }) : null;
}

/** Recursos de la petición, todos con el JWT del usuario. */
function scopeFor(user: RequestUser) {
  const rt = runtime();
  const db = userClient(rt.supabase, user.token);
  return {
    db,
    // Dentro de la petición, cada lectura una vez; entre mensajes, los históricos durante un minuto.
    tools: new InventoryTools(memoizeSource(cachedSource(new SupabaseDataSource(db), user))),
    audit: new CompositeAuditSink([new ConsoleAuditSink(), new SupabaseAuditSink(db)]),
    sessions: new SessionStore(new SupabaseSessionPersistence(db)),
    drafts: new DraftStore(new SupabaseDraftPersistence(db)),
    habits: new HabitsStore(new SupabaseHabitsPersistence(db)),
    info: new SupabaseInfoSource(db),
  };
}

async function loadContext(user: RequestUser, fresh = false): Promise<SessionContext> {
  const rt = runtime();
  const key = `${user.userId}:${user.orgId}`;
  if (!fresh) {
    const cached = rt.contexts.get(key);
    if (cached) {
      rt.metrics.contextCacheHits += 1;
      return cached;
    }
  }
  const ctx = await new SupabaseContext(rt.supabase).load(user, user.orgId);
  rt.contexts.set(key, ctx);
  return ctx;
}

async function chat(request: Request, user: RequestUser): Promise<Response> {
  const rt = runtime();
  const blocked = limited(rt.limiters.chat, `chat:${user.userId}`);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = ChatRequest.safeParse({ ...(body ?? {}), orgId: user.orgId });
  if (!parsed.success) return fail(400, { code: "invalid_request", message: "Petición no válida", retryable: false });
  const ctx = await loadContext(user);
  const scope = scopeFor(user);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Si el usuario cierra el panel a mitad de respuesta, el stream ya no acepta datos: no es un error.
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };
      try {
        await rt.agent.handle(
          parsed.data,
          ctx,
          (event) => {
            send(event.event, event.data);
          },
          {
            tools: scope.tools,
            audit: scope.audit,
            sessions: scope.sessions,
            drafts: scope.drafts,
            habits: scope.habits,
            info: scope.info,
            // «Sí, adelante»: mismo servicio que el botón, con el rol comprobado sobre datos frescos.
            confirmDraft: async (draftId) => {
              const fresh = await loadContext(user, true);
              const result = markTest(
                await rt.confirm.confirm({ orgId: user.orgId, draftId, idempotencyKey: randomUUID() }, fresh, writerFor(fresh, scope.db), scope.audit, scope.drafts),
                fresh,
              );
              if (fresh.testMode) return result;
              if (result.ok) invalidateBusinessCache(user.orgId);
              if (result.ok && (CATALOG_KINDS as readonly string[]).includes(result.kind)) rt.contexts.delete(`${user.userId}:${user.orgId}`);
              return result;
            },
          },
        );
      } catch (err) {
        // Lo que falla antes del bucle del agente (sesión, hábitos…) también llega al usuario como error.
        console.error("copiloto chat", err);
        if (!(err instanceof DataError)) void reportError("assistant", err, { path: "/api/copiloto/chat", token: user.token });
        const error: ErrorEvent =
          err instanceof DataError
            ? { code: "data_unavailable", message: "No he podido leer los datos del inventario. Inténtalo de nuevo en un momento.", retryable: true }
            : { code: "internal", message: "Algo ha fallado al procesar tu mensaje. Inténtalo de nuevo.", retryable: true };
        send("error", error);
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-LogisticApp-Contract": CONTRACT_VERSION,
    },
  });
}

async function confirm(request: Request, user: RequestUser): Promise<Response> {
  const rt = runtime();
  const blocked = limited(rt.limiters.confirm, `confirm:${user.userId}`);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = ConfirmRequest.safeParse({ ...(body ?? {}), orgId: user.orgId });
  if (!parsed.success) return fail(400, { code: "invalid_request", message: "Petición no válida", retryable: false });
  // Sin caché: el rol se comprueba con datos frescos antes de escribir.
  const ctx = await loadContext(user, true);
  const scope = scopeFor(user);
  const result = markTest(await rt.confirm.confirm(parsed.data, ctx, writerFor(ctx, scope.db), scope.audit, scope.drafts), ctx);
  // Lo escrito debe verse en la siguiente consulta: fuera la caché del negocio de la organización.
  if (result.ok && !ctx.testMode) invalidateBusinessCache(user.orgId);
  // El catálogo ha cambiado (producto nuevo, archivado…): el siguiente mensaje debe verlo.
  if (result.ok && !ctx.testMode && (CATALOG_KINDS as readonly string[]).includes(result.kind)) rt.contexts.delete(`${user.userId}:${user.orgId}`);
  const status = result.ok ? 200 : result.code === "forbidden" ? 403 : result.code === "draft_not_found" || result.code === "draft_expired" ? 404 : 422;
  return json(result, status);
}

const SuggestionsQuery = z.object({
  locationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

async function suggestions(url: URL, user: RequestUser): Promise<Response> {
  const rt = runtime();
  const blocked = limited(rt.limiters.suggestions, `suggestions:${user.userId}`);
  if (blocked) return blocked;
  const parsed = SuggestionsQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(400, { code: "invalid_request", message: "Petición no válida", retryable: false });
  const ctx = await loadContext(user);
  if (parsed.data.locationId && !ctx.locations.some((l) => l.id === parsed.data.locationId)) {
    return fail(403, { code: "forbidden", message: "No tienes acceso a ese local", retryable: false });
  }
  try {
    const result = await rt.suggestions.suggest(ctx, scopeFor(user).tools, {
      limit: parsed.data.limit,
      ...(parsed.data.locationId ? { locationId: parsed.data.locationId } : {}),
    });
    return json(result);
  } catch (err) {
    if (err instanceof DataError) throw err;
    return fail(503, { code: "jev_unavailable", message: "No se pudieron calcular las sugerencias ahora", retryable: true });
  }
}

const AnalyticsQuery = z.object({
  vista: z.enum(ANALYTICS_VIEWS).default("resumen"),
  locationId: z.uuid().optional(),
  productId: z.uuid().optional(),
  /** Departamento del catálogo (cuenta de análisis), tal como sale en la respuesta. */
  departamento: z.string().trim().min(1).max(80).optional(),
  dias: z.coerce
    .number()
    .int()
    .refine((d) => [7, 30, 90].includes(d))
    .default(30),
});

async function analytics(url: URL, user: RequestUser): Promise<Response> {
  const rt = runtime();
  const blocked = limited(rt.limiters.analytics, `analytics:${user.userId}`);
  if (blocked) return blocked;
  const parsed = AnalyticsQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(400, { code: "invalid_request", message: "Petición no válida", retryable: false });
  const ctx = await loadContext(user);
  // Informes son importes: sin el permiso «ve costes» no se sirven (lo decide la pertenencia, no el navegador).
  if (!ctx.seesCosts) return fail(403, { code: "forbidden", message: "Tu usuario no tiene permiso para ver costes e importes.", retryable: false });
  if (parsed.data.locationId && !ctx.locations.some((l) => l.id === parsed.data.locationId)) {
    return fail(403, { code: "forbidden", message: "No tienes acceso a ese local", retryable: false });
  }
  const result = await new Analytics(scopeFor(user).tools.source).view(parsed.data.vista, {
    ctx,
    locationIds: parsed.data.locationId ? [parsed.data.locationId] : ctx.locations.map((l) => l.id),
    productIds: parsed.data.productId ? [parsed.data.productId] : [],
    days: parsed.data.dias,
    now: new Date(),
    ...(parsed.data.departamento ? { department: parsed.data.departamento } : {}),
  });
  return json({ ...result, locations: ctx.locations.map((l) => ({ id: l.id, name: l.name })), departments: departmentsOf(ctx.products) });
}

/** Informe en PDF: una vista, o «todas» (informe completo). Mismos permisos, filtros y límites que la pantalla. */
const PdfQuery = AnalyticsQuery.extend({ vista: z.enum([...ANALYTICS_VIEWS, "todas"]).default("resumen") });

async function analyticsPdf(url: URL, user: RequestUser): Promise<Response> {
  const rt = runtime();
  const blocked = limited(rt.limiters.analytics, `pdf:${user.userId}`);
  if (blocked) return blocked;
  const parsed = PdfQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(400, { code: "invalid_request", message: "Petición no válida", retryable: false });
  const ctx = await loadContext(user);
  if (!ctx.seesCosts) return fail(403, { code: "forbidden", message: "Tu usuario no tiene permiso para ver costes e importes.", retryable: false });
  if (parsed.data.locationId && !ctx.locations.some((l) => l.id === parsed.data.locationId)) {
    return fail(403, { code: "forbidden", message: "No tienes acceso a ese local", retryable: false });
  }
  const scope = scopeFor(user);
  const engine = new Analytics(scope.tools.source);
  const common = {
    ctx,
    locationIds: parsed.data.locationId ? [parsed.data.locationId] : ctx.locations.map((l) => l.id),
    productIds: parsed.data.productId ? [parsed.data.productId] : [],
    days: parsed.data.dias,
    now: new Date(),
    ...(parsed.data.departamento ? { department: parsed.data.departamento } : {}),
  };
  const ids = parsed.data.vista === "todas" ? [...ANALYTICS_VIEWS] : [parsed.data.vista];
  const views: ReportView[] = [];
  for (const id of ids) {
    const result = await engine.view(id, common);
    views.push({ id, title: result.title, periodLabel: result.periodLabel, locationName: result.locationName, department: parsed.data.departamento ?? null, kpis: result.kpis, charts: result.charts });
  }
  const { data: org } = await scope.db.from("organizations").select("name").eq("id", user.orgId).maybeSingle();
  const pdf = await buildReportPdf({ organization: org?.name ?? "", generatedAt: new Date(), views });
  const filename = `informe-${parsed.data.vista}-${civilToday()}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}

/** Resumen redactado del mismo informe (mismos permisos y filtros). text null: sin ayudante o sin resumen fiable. */
async function analyticsSummary(url: URL, user: RequestUser): Promise<Response> {
  const rt = runtime();
  if (!rt.assistant.enabled) return json({ text: null });
  const blocked = limited(rt.limiters.suggestions, `summary:${user.userId}`);
  if (blocked) return blocked;
  const parsed = AnalyticsQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(400, { code: "invalid_request", message: "Petición no válida", retryable: false });
  const ctx = await loadContext(user);
  if (!ctx.seesCosts) return fail(403, { code: "forbidden", message: "Tu usuario no tiene permiso para ver costes e importes.", retryable: false });
  if (parsed.data.locationId && !ctx.locations.some((l) => l.id === parsed.data.locationId)) {
    return fail(403, { code: "forbidden", message: "No tienes acceso a ese local", retryable: false });
  }
  const result = await new Analytics(scopeFor(user).tools.source).view(parsed.data.vista, {
    ctx,
    locationIds: parsed.data.locationId ? [parsed.data.locationId] : ctx.locations.map((l) => l.id),
    productIds: parsed.data.productId ? [parsed.data.productId] : [],
    days: parsed.data.dias,
    now: new Date(),
  });
  const text = await rt.assistant.summary(result);
  // reason: por qué no hay resumen (fallo del gateway o cifra no verificada), para diagnosticar.
  return json(text ? { text } : { text: null, reason: rt.assistant.lastError });
}

const ReorderQuery = z.object({
  locationId: z.uuid(),
  dias: z.coerce
    .number()
    .int()
    .refine((d) => [3, 7, 14].includes(d))
    .default(7),
});

/**
 * Sugerencia de pedido para un local: mismo cálculo que «¿qué me falta?» (consumo real, mínimos,
 * objetivo y lo que ya está en camino), convertido a formatos de compra con el último proveedor y precio.
 */
async function reorder(url: URL, user: RequestUser): Promise<Response> {
  const rt = runtime();
  const blocked = limited(rt.limiters.analytics, `reorder:${user.userId}`);
  if (blocked) return blocked;
  const parsed = ReorderQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return fail(400, { code: "invalid_request", message: "Petición no válida", retryable: false });
  const ctx = await loadContext(user);
  if (!ctx.locations.some((l) => l.id === parsed.data.locationId)) {
    return fail(403, { code: "forbidden", message: "No tienes acceso a ese local", retryable: false });
  }
  const { source } = scopeFor(user).tools;
  const days = parsed.data.dias;
  const lines = (
    await computeReorder(
      source,
      { locationIds: [parsed.data.locationId], areaId: null, productIds: [], period: null, horizonDays: days, horizonLabel: `${days} días`, now: new Date() },
      ctx,
    )
  ).filter((l) => l.suggested.gt(0));

  const packOf = (p: (typeof lines)[number]["product"]) => p.packs.find((k) => k.isPurchaseDefault) ?? (p.packs.length === 1 ? p.packs[0]! : null);
  const packIds = lines.map((l) => packOf(l.product)?.id).filter((id): id is string => !!id);
  // supplierPrices viene ordenado por fecha: el primero de cada formato es el último precio.
  const latest = new Map<string, Awaited<ReturnType<typeof source.supplierPrices>>[number]>();
  for (const price of await source.supplierPrices(packIds)) if (!latest.has(price.packId)) latest.set(price.packId, price);

  return json({
    locationId: parsed.data.locationId,
    days,
    lines: lines.map((l) => {
      const pack = packOf(l.product);
      const price = pack ? latest.get(pack.id) : undefined;
      return {
        productId: l.product.id,
        productName: l.product.name,
        baseUnit: l.product.baseUnit,
        stock: l.qty.toString(),
        // Como se cuenta en barra («2 cajas + 5 ud», «12 botellas»), para mostrar.
        stockText: formatStock(l.qty, l.product),
        pendingInText: formatStock(l.pendingIn, l.product),
        min: l.min.toString(),
        par: l.par.toString(),
        pendingIn: l.pendingIn.toString(),
        avgDaily: l.avg.toDecimalPlaces(4).toString(),
        coverageDays: l.coverage ? l.coverage.toDecimalPlaces(1).toString() : null,
        suggestedBase: l.suggested.toString(),
        pack: pack ? { id: pack.id, name: pack.name, qtyBase: pack.qtyBase } : null,
        // Siempre formatos enteros, redondeando hacia arriba.
        packs: pack ? l.suggested.div(pack.qtyBase).ceil().toString() : null,
        supplier: price ? { id: price.supplierId, name: price.supplierName } : null,
        price: price?.lastPrice ?? null,
      };
    }),
  });
}

async function health(): Promise<Response> {
  const rt = runtime();
  const [jev, writerOk, embedOk, supabaseOk] = await Promise.all([
    rt.jev.ping(),
    rt.writerProvider ? rt.writerProvider.ping() : Promise.resolve(false),
    rt.embedder ? rt.embedder.ping() : Promise.resolve(false),
    pingSupabase(rt.supabase),
  ]);
  const body: HealthResponse = {
    status: !jev.ok || !supabaseOk ? "caido" : (writerOk || !rt.writerProvider) && (embedOk || !rt.embedder) ? "ok" : "degradado",
    jev,
    assistant: { enabled: rt.assistant.enabled, model: rt.assistant.model ?? "-", lastError: rt.assistant.lastError },
    writer: { ok: writerOk, provider: rt.config.WRITER_PROVIDER, model: rt.writerProvider ? rt.config.WRITER_MODEL : "plantillas" },
    embeddings: { ok: embedOk, provider: rt.embedder ? rt.config.EMBED_PROVIDER : "lexico", model: rt.embedder ? rt.config.EMBED_MODEL : "-" },
    supabase: { ok: supabaseOk },
    contract: CONTRACT_VERSION,
  };
  return json({ ...body, via: rt.config.jev.via, oidc: rt.config.jev.oidc }, body.status === "caido" ? 503 : 200);
}

/** Punto de entrada: `route` es lo que va detrás de /api/copiloto/. */
export async function handleCopiloto(route: string, request: Request, user: RequestUser): Promise<Response> {
  try {
    const url = new URL(request.url);
    const key = `${request.method} ${route}`;
    switch (key) {
      case "POST chat":
        return await chat(request, user);
      case "POST actions/confirm":
        return await confirm(request, user);
      case "GET suggestions":
        return await suggestions(url, user);
      case "GET analytics":
        return await analytics(url, user);
      case "GET analytics/resumen":
        return await analyticsSummary(url, user);
      case "GET analytics/pdf":
        return await analyticsPdf(url, user);
      case "GET reorder":
        return await reorder(url, user);
      case "GET health":
        return await health();
      default:
        return fail(404, { code: "invalid_request", message: "Ruta no disponible", retryable: false });
    }
  } catch (err) {
    if (err instanceof AuthError) return fail(err.code === "unauthenticated" ? 401 : 403, { code: err.code, message: err.message, retryable: false });
    if (err instanceof DataError) return fail(503, { code: "data_unavailable", message: "No se pudieron leer los datos del inventario", retryable: true });
    console.error("copiloto", err);
    await reportError("assistant", err, { path: `/api/copiloto/${route}`, token: user.token });
    return fail(500, { code: "internal", message: "Error interno del asistente", retryable: true });
  }
}
