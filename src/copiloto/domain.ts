import type { BaseUnit, Role } from "./contract/index";

export type Dimension = "mass" | "volume" | "count";

export interface Location {
  id: string;
  name: string;
  timezone: string;
  dayCutoff: string;
}

export interface Area {
  id: string;
  locationId: string;
  name: string;
  /** almacen: se guarda (de aquí salen las salidas); servicio: se usa (barra, cocina). Migración 0022. */
  kind?: "almacen" | "servicio";
}

export interface Pack {
  id: string;
  name: string;
  qtyBase: string;
  isCountDefault: boolean;
  isPurchaseDefault: boolean;
  /** Copa, chupito, caña…: solo se usa si se nombra («2 copas»), nunca como lectura por defecto. */
  isServing?: boolean;
}

export interface Product {
  id: string;
  name: string;
  dimension: Dimension;
  baseUnit: BaseUnit;
  category: string | null;
  /** Marca, tipo («Ginebra»), formato y nombre en carta: ayudan a encontrar el producto. */
  notes?: string | null;
  packs: Pack[];
}

/** Proveedor o categoría del catálogo (id + nombre). */
export interface NamedRef {
  id: string;
  name: string;
}

/** Escandallo: un plato (rinde raciones) o una elaboración (rinde g, ml o ud y se usa dentro de otros). */
export interface RecipeRef {
  id: string;
  name: string;
  kind: "plato" | "elaboracion";
  yieldUnit: "racion" | "g" | "ml" | "ud";
}

/** Contexto del usuario, cacheado por sesión. Todo lo que contiene ya ha pasado por RLS. */
export interface SessionContext {
  userId: string;
  orgId: string;
  role: Role;
  /** Ve costes e importes (propiedad, administración, encargados o personal con el permiso). */
  seesCosts: boolean;
  locations: Location[];
  areas: Area[];
  products: Product[];
  /** Proveedores activos y categorías: para precios y altas de producto desde el chat. */
  suppliers: NamedRef[];
  categories: NamedRef[];
  /** Productos archivados: solo nombre, para detectar duplicados al dar de alta. */
  archivedProducts: NamedRef[];
  /** Huella del catálogo para invalidar embeddings y cachés. */
  catalogHash: string;
  /** Modo pruebas (memberships.assistant_test): lo que se confirme en el asistente no se guarda. */
  testMode?: boolean;
  /** Escandallos activos que ve (nombre, tipo y unidad de rendimiento): para editarlos desde el chat. */
  recipes?: RecipeRef[];
  /** Cuentas de análisis a las que está limitado (Comida, Bebida…), por nombre. Sin el campo: todas. */
  cuentas?: string[];
  /** Palabras del catálogo que no ve, con su cuenta (0059): para decir «eso es de Bebida» (especialistas/cuentas.ts). */
  palabrasOcultas?: Record<string, { cuenta: string; compartida: boolean }>;
}

export function baseUnitOf(dimension: Dimension): BaseUnit {
  return dimension === "mass" ? "g" : dimension === "volume" ? "ml" : "ud";
}

const ROLE_RANK: Record<Role, number> = { staff: 0, manager: 1, admin: 2, owner: 3 };

export function hasRole(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export function areaLabel(area: Area, locations: Location[]): string {
  const location = locations.find((l) => l.id === area.locationId);
  return `${location?.name ?? "?"} · ${area.name}`;
}
