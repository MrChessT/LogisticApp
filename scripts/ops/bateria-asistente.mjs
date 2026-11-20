// Batería del asistente contra un entorno real (por defecto, producción): conversaciones de varios turnos
// con lo que debe (y no debe) aparecer en cada respuesta. Solo pregunta: no confirma ningún borrador.
//
//   BATERIA_EMAIL=… BATERIA_PASSWORD=… NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… \
//     node scripts/ops/bateria-asistente.mjs [fichero.json]
//
// · BATERIA_URL: la app a probar (por defecto https://nexo-inventario-three.vercel.app).
// · La cuenta debe ser de pruebas (modo pruebas del asistente): nunca la de un usuario real.
// · Sale con código 1 si alguna respuesta no cumple: sirve antes y después de cambiar el asistente.
// Los casos están en scripts/ops/bateria-asistente.json («espera» y «no» son expresiones regulares;
// «sinAclarar»: la respuesta no puede ser una pregunta de aclaración; «borrador»: expresión que debe cumplir el título
// del borrador que salga (si no sale ninguno, falla); «especialista»: quién debe atenderlo, según
// src/copiloto/especialistas/registro.ts. Al final se resume el acierto del enrutado por especialista).
// scripts/ops/bateria-alcance.json se pasa con una cuenta de pruebas limitada a la cuenta Comida (Equipo → Cuentas de
// análisis): comprueba que lo de otras cuentas se avisa en vez de responder sin filtro.
// «documento» en una conversación: lo leído de un archivo (ChatRequest.document), que viaja con cada mensaje como
// lo manda el panel tras soltar un archivo en el chat.
// BATERIA_SALIDA=fichero.json guarda cada turno (lo dicho, la respuesta entera, aclaración, borrador, tiempo) para
// calificarlo después con scripts/ops/juez-ciega.mjs. Así se pasa también la prueba ciega (bateria-ciega.json), que
// no lleva «espera»: se juzga, no se compara con expresiones.
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.BATERIA_URL ?? "https://nexo-inventario-three.vercel.app";
/** Cuánto de cada respuesta se enseña (BATERIA_ANCHO=2000 para leerlas enteras). */
const WIDTH = Number(process.env.BATERIA_ANCHO ?? 170);
const { BATERIA_EMAIL: email, BATERIA_PASSWORD: password, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } = process.env;
if (!email || !password || !url || !key) {
  console.error("Faltan BATERIA_EMAIL, BATERIA_PASSWORD, NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}

// Misma sesión por cookies que usa la app (@supabase/ssr).
const jar = new Map();
const supabase = createServerClient(url, key, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach((c) => jar.set(c.name, c.value)) },
});
const { error } = await supabase.auth.signInWithPassword({ email, password });
if (error) {
  console.error(`No se pudo iniciar sesión: ${error.message}`);
  process.exit(2);
}
const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

// Como el panel del chat: si el turno anterior fue una aclaración, la respuesta escrita viaja con su identificador
// (opción «otra» + texto libre). Sin esto, la batería probaba un camino que la app no usa al escribir.
async function ask(sessionId, message, pending, document) {
  const started = Date.now();
  const clarification = pending ? { clarifyId: pending.clarifyId, optionId: "otra", freeText: message, field: pending.field } : undefined;
  const res = await fetch(`${BASE}/api/copiloto/chat`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ sessionId, message, page: "/", origen: "bateria", ...(clarification ? { clarification } : {}), ...(document ? { document } : {}) }) });
  const raw = await res.text();
  let text = "";
  let clarify = null;
  let especialista = null;
  let draft = null;
  let table = null;
  let event = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      let data;
      try {
        data = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (event === "text") text = data.reset ? data.delta : text + data.delta;
      else if (event === "clarify") clarify = data;
      else if (event === "decision") especialista = data.especialista ?? null;
      else if (event === "draft") draft = { kind: data.kind, title: data.title };
      else if (event === "table") table = { columns: (data.columns ?? []).map((c) => c.label), rows: (data.rows ?? []).length };
      else if (event === "error") text = `ERROR: ${data.message}`;
    }
  }
  return { status: res.status, ms: Date.now() - started, text: clarify?.question ?? text, clarified: clarify !== null, clarify, especialista, draft, table };
}

const cases = JSON.parse(readFileSync(process.argv[2] ?? new URL("./bateria-asistente.json", import.meta.url), "utf8"));
let total = 0;
const failures = [];
/** Cada turno, para el juez (BATERIA_SALIDA). */
const transcript = [];
/** Enrutado por especialista esperado: aciertos y total. */
const routing = new Map();
for (const conversation of cases) {
  console.log(`\n▸ ${conversation.nombre}`);
  const sessionId = randomUUID();
  let pending = null;
  for (const turn of conversation.turnos) {
    const r = await ask(sessionId, turn.usuario, pending, conversation.documento);
    pending = r.clarify ?? null;
    total += 1;
    transcript.push({ conversacion: conversation.nombre, usuario: turn.usuario, respuesta: r.text, aclaracion: r.clarify ? { pregunta: r.clarify.question, opciones: r.clarify.options.map((o) => o.label) } : null, borrador: r.draft, tabla: r.table, especialista: r.especialista, ms: r.ms, http: r.status });
    const why = [];
    if (r.status !== 200) why.push(`HTTP ${r.status}`);
    if (turn.espera && !new RegExp(turn.espera, "is").test(r.text)) why.push(`falta /${turn.espera}/`);
    if (turn.no && new RegExp(turn.no, "is").test(r.text)) why.push(`sobra /${turn.no}/`);
    if (turn.sinAclarar && r.clarified) why.push("pidió aclaración");
    if (turn.borrador && !(r.draft && new RegExp(turn.borrador, "is").test(r.draft.title))) why.push(r.draft ? `borrador «${r.draft.title}» no cumple /${turn.borrador}/` : "no preparó borrador");
    if (turn.especialista) {
      const tally = routing.get(turn.especialista) ?? { ok: 0, total: 0 };
      tally.total += 1;
      if (r.especialista === turn.especialista) tally.ok += 1;
      else why.push(`especialista ${r.especialista ?? "ninguno"} en vez de ${turn.especialista}`);
      routing.set(turn.especialista, tally);
    }
    console.log(`  ${why.length ? "✗" : "✓"} [${r.ms} ms] ${turn.usuario}\n      → ${r.text.replace(/\s+/g, " ").slice(0, WIDTH)}${why.length ? `\n      ✗ ${why.join(" · ")}` : ""}`);
    if (why.length) failures.push(`${conversation.nombre} · «${turn.usuario}»: ${why.join(" · ")}`);
    // El chat admite 20 mensajes por minuto.
    await new Promise((resolve) => setTimeout(resolve, 3200));
  }
}
if (process.env.BATERIA_SALIDA) writeFileSync(process.env.BATERIA_SALIDA, `${JSON.stringify(transcript, null, 1)}\n`);
console.log(`\n${total - failures.length}/${total} respuestas correctas.`);
if (routing.size) {
  const ok = [...routing.values()].reduce((s, t) => s + t.ok, 0);
  const all = [...routing.values()].reduce((s, t) => s + t.total, 0);
  console.log(`Enrutado: ${ok}/${all} al especialista esperado · ${[...routing].map(([id, t]) => `${id} ${t.ok}/${t.total}`).join(" · ")}`);
}
if (failures.length) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
