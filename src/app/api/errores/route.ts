import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/report-error";
import { createClient } from "@/lib/supabase/server";

// Errores del navegador (los envía ErrorReporter): se registran igual que los del servidor.
// Sin sesión también vale (un fallo en la pantalla de acceso es un fallo); la base de datos limita el volumen.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  message: z.string().min(1).max(600),
  path: z.string().max(300).optional(),
  digest: z.string().max(80).optional(),
  stack: z.array(z.string().max(300)).max(6).optional(),
  agent: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const { message, path, digest, stack, agent } = parsed.data;
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  await reportError("client", message, { path, digest, token: data.session?.access_token, detail: { ...(stack ? { stack } : {}), ...(agent ? { agent } : {}) } });
  return NextResponse.json({ ok: true });
}
