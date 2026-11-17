// Equipo: roles, qué puede hacer cada uno y mensajes de error de las reglas de la base de datos
// (migración 0021). La base de datos decide; aquí solo se explica.

export type Role = "owner" | "admin" | "manager" | "staff" | "kiosk";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Encargado",
  staff: "Personal",
  kiosk: "Pantalla de almacén",
};

export const ROLE_HELP: Record<Role, string> = {
  owner: "Todo, incluidos otros administradores y propietarios.",
  admin: "Todos los locales y sus cifras. Gestiona encargados y personal.",
  manager: "Solo sus locales y sus cifras. Gestiona al personal de sus locales.",
  staff: "Solo sus locales: recepciones, traspasos, mermas, inventarios y salidas.",
  kiosk: "Una tablet fija en el almacén de un local: solo apunta salidas, sin ver precios ni nada más.",
};

/** Roles que puede dar quien tiene `actor` (mismo criterio que team_can_manage en la base de datos). */
export function assignableRoles(actor: Role | null | undefined): Role[] {
  if (actor === "owner") return ["owner", "admin", "manager", "staff"];
  if (actor === "admin") return ["manager", "staff"];
  if (actor === "manager") return ["staff"];
  return [];
}

/** ¿Puede dar de alta pantallas de almacén? La gestión, en los locales que lleva. */
export const managesScreens = (actor: Role | null | undefined) => actor === "owner" || actor === "admin" || actor === "manager";

/** ¿Ve y gestiona el equipo? El personal no. */
export const managesTeam = (role: Role | null | undefined) => role === "owner" || role === "admin" || role === "manager";

/** ¿Ve todos los locales? Propietarios y administradores (RLS: my_location_ids). */
export const seesAllLocations = (role: Role | null | undefined) => role === "owner" || role === "admin";

const MESSAGES: Record<string, string> = {
  forbidden: "No tienes permiso para hacer este cambio.",
  self: "No puedes cambiar tu propio acceso. Pídeselo a otro administrador.",
  no_locations: "Elige al menos un local.",
  location_forbidden: "Solo puedes dar acceso a los locales que llevas tú.",
  other_org: "Esa persona ya pertenece a otra organización.",
  last_owner: "La organización necesita al menos un propietario.",
  not_found: "Esa persona ya no está en el equipo.",
  kiosk_one_location: "Una pantalla va en un único local.",
  kiosk_fixed: "Una pantalla no puede pasar a ser una persona (ni al revés): crea una nueva.",
  accounts_admin: "La administración ve todas las cuentas: no se le limita.",
  accounts_invalid: "Esa cuenta ya no existe en el catálogo.",
  accounts_forbidden: "Solo puedes repartir las cuentas que llevas tú, y la persona tiene que quedar con al menos una.",
};

/** Mensaje para el usuario a partir del error de una función de equipo. */
export function teamErrorMessage(error: { message?: string } | null | undefined, fallback = "No se pudo guardar el cambio."): string {
  // Palabra exacta: «location_forbidden» no debe leerse como «forbidden».
  const code = Object.keys(MESSAGES).find((k) => new RegExp(`(^|[^a-z_])${k}($|[^a-z_])`).test(error?.message ?? ""));
  return code ? MESSAGES[code]! : fallback;
}

/** "/ruta" interna a la que volver; cualquier otra cosa (otro dominio, "//x", "/\\x") → "/". */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?![\\/])/.test(next) && !next.includes("\\") ? next : "/";
}
