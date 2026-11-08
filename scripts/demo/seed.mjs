#!/usr/bin/env node
// Carga la demo (supabase/demo/demo_seed.sql) en la base local o en el proyecto de pruebas.
//
//   1) Crea o actualiza las personas de la demo con la API de administración (contraseña DEMO_PASSWORD).
//   2) Ejecuta el SQL de la demo:
//        · local:    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres (usa psql)
//        · pruebas:  SUPABASE_PROJECT_REF=<ref> (API de gestión de Supabase; el token lo pone el entorno)
//
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD y una de las dos de arriba.
// Nunca se ejecuta contra producción: el script se niega si la URL o el ref son los de producción.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "yehawojsrxsjhzfivpfi";
const PEOPLE = [
  ["demo.propietaria@example.com", "Lucía Prieto (demo)"],
  ["demo.admin@example.com", "Andrés Molina (demo)"],
  ["demo.encargado@example.com", "Raúl Ortega (demo)"],
  ["demo.encargada@example.com", "Marta Gil (demo)"],
  ["demo.camarero@example.com", "Iván Ruiz (demo)"],
  ["demo.almacen@example.com", "Pantalla almacén Terraza (demo)", true],
];

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD, DATABASE_URL, SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN } = process.env;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) fail("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 10) fail("DEMO_PASSWORD debe tener al menos 10 caracteres.");
if (!DATABASE_URL && !SUPABASE_PROJECT_REF) fail("Indica DATABASE_URL (local) o SUPABASE_PROJECT_REF (pruebas).");
if (SUPABASE_URL.includes(PRODUCTION_REF) || SUPABASE_PROJECT_REF === PRODUCTION_REF) fail("Esto es producción: la demo no se carga ahí.");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const existing = new Map();
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail(`No se pudieron leer los usuarios: ${error.message}`);
  for (const u of data.users) existing.set(u.email?.toLowerCase(), u.id);
  if (data.users.length < 200) break;
}
for (const [email, fullName, kiosk] of PEOPLE) {
  const id = existing.get(email);
  // La pantalla de almacén lleva la marca que pone la app al crearla (solo puede abrir /almacen).
  const attrs = { password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: fullName }, app_metadata: { kiosk: !!kiosk } };
  const { error } = id ? await admin.auth.admin.updateUserById(id, attrs) : await admin.auth.admin.createUser({ email, ...attrs });
  if (error) fail(`${email}: ${error.message}`);
  console.log(`✓ ${id ? "actualizado" : "creado"} ${email}`);
}

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../supabase/demo/demo_seed.sql"), "utf8");
if (DATABASE_URL) {
  const out = execFileSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-At", "-f", "-"], { input: sql, encoding: "utf8" });
  console.log(out.trim());
} else {
  const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN ?? "proxy-injected"}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) fail(`El SQL de la demo falló (${res.status}): ${body.slice(0, 800)}`);
  console.log(body);
}
console.log("✓ Demo cargada.");
