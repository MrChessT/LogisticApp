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
// «sinAclarar»: la respuesta no puede ser una pregunta de aclaración).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.BATERIA_URL ?? "https://nexo-inventario-three.vercel.app";
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

async function ask(sessionId, message) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/copiloto/chat`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ sessionId, message, page: "/" }) });
  const raw = await res.text();
  let text = "";
  let clarify = null;
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
      else if (event === "clarify") clarify = data.question;
      else if (event === "error") text = `ERROR: ${data.message}`;
    }
  }
  return { status: res.status, ms: Date.now() - started, text: clarify ?? text, clarified: clarify !== null };
}

const cases = JSON.parse(readFileSync(process.argv[2] ?? new URL("./bateria-asistente.json", import.meta.url), "utf8"));
let total = 0;
const failures = [];
for (const conversation of cases) {
  console.log(`\n▸ ${conversation.nombre}`);
  const sessionId = randomUUID();
  for (const turn of conversation.turnos) {
    const r = await ask(sessionId, turn.usuario);
    total += 1;
    const why = [];
    if (r.status !== 200) why.push(`HTTP ${r.status}`);
    if (turn.espera && !new RegExp(turn.espera, "is").test(r.text)) why.push(`falta /${turn.espera}/`);
    if (turn.no && new RegExp(turn.no, "is").test(r.text)) why.push(`sobra /${turn.no}/`);
    if (turn.sinAclarar && r.clarified) why.push("pidió aclaración");
    console.log(`  ${why.length ? "✗" : "✓"} [${r.ms} ms] ${turn.usuario}\n      → ${r.text.replace(/\s+/g, " ").slice(0, 170)}${why.length ? `\n      ✗ ${why.join(" · ")}` : ""}`);
    if (why.length) failures.push(`${conversation.nombre} · «${turn.usuario}»: ${why.join(" · ")}`);
    // El chat admite 20 mensajes por minuto.
    await new Promise((resolve) => setTimeout(resolve, 3200));
  }
}
console.log(`\n${total - failures.length}/${total} respuestas correctas.`);
if (failures.length) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
