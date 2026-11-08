// Plantilla de catálogo (alta de clientes y cambios masivos): qué columnas tiene, cómo se leen y cómo se
// exporta lo que ya hay. La base de datos (import_catalog) une, valida contra lo existente y aplica.
//
// Reglas de lectura (pensadas para ficheros hechos a mano en Excel):
//   · Las columnas se reconocen por su título (sin importar mayúsculas, acentos ni el orden).
//   · Una celda vacía no cambia nada de lo que ya hay; para un producto nuevo, lo obligatorio es nombre,
//     familia y medida.
//   · Números con coma o punto («1.234,5», «72,60 €»); contenidos con su unidad («70 cl», «5 kg»); días
//     de pedido como «L, J», «lunes y jueves» o «L-V»; horas «12:00».

export type Dimension = "count" | "volume" | "mass";
export type SheetKey = "suppliers" | "products" | "assortment";

export type SupplierRow = {
  code?: string; name?: string; tax_id?: string; email?: string; phone?: string; contact_name?: string;
  order_days?: number[]; order_cutoff?: string; lead_time_hours?: number; min_order?: number; payment_terms?: string;
  locations?: string[];
};
export type ProductRow = {
  sku?: string; name?: string; family?: string; subfamily?: string; dimension?: Dimension; vat_rate?: number;
  count_pack?: { name: string; qty: number }; purchase_pack?: { name: string; qty: number };
  supplier?: string; price?: number; supplier_ref?: string; full_weight_g?: number; empty_weight_g?: number;
};
export type AssortmentRow = { location?: string; product?: string; min?: number; max?: number; zone?: string };
export type ImportPayload = { suppliers: SupplierRow[]; products: ProductRow[]; assortment: AssortmentRow[] };
export type RowIssue = { sheet: SheetKey; row: number; label: string; message: string };

export const SHEET_LABEL: Record<SheetKey, string> = { suppliers: "Proveedores", products: "Productos", assortment: "Surtido" };

type Column = { key: string; title: string; aliases?: string[]; width: number; help: string };

const COLUMNS: Record<SheetKey, Column[]> = {
  suppliers: [
    { key: "code", title: "Código", aliases: ["codigo proveedor", "cod"], width: 10, help: "Corto y único (BAH, NOR…). Si lo pones, se une por él." },
    { key: "name", title: "Nombre", aliases: ["proveedor", "razon social"], width: 30, help: "Obligatorio si es nuevo." },
    { key: "tax_id", title: "CIF", aliases: ["nif", "cif/nif"], width: 12, help: "" },
    { key: "email", title: "Email", aliases: ["correo", "email pedidos"], width: 28, help: "Donde se envían los pedidos." },
    { key: "phone", title: "Teléfono", aliases: ["telefono", "movil", "whatsapp"], width: 16, help: "Con prefijo para WhatsApp (+34…)." },
    { key: "contact_name", title: "Contacto", aliases: ["persona de contacto", "comercial"], width: 16, help: "" },
    { key: "order_days", title: "Días de pedido", aliases: ["dias", "dias de pedido", "reparto"], width: 16, help: "L, M, X, J, V, S, D (o «L-V», «lunes y jueves»)." },
    { key: "order_cutoff", title: "Hora límite", aliases: ["hora limite", "hora de corte"], width: 11, help: "Hasta qué hora se acepta el pedido (12:00)." },
    { key: "lead_time_hours", title: "Plazo (horas)", aliases: ["plazo", "plazo de entrega", "plazo horas"], width: 12, help: "Horas desde el pedido hasta la entrega." },
    { key: "min_order", title: "Pedido mínimo (€)", aliases: ["pedido minimo", "minimo pedido"], width: 15, help: "Sin IVA." },
    { key: "payment_terms", title: "Forma de pago", aliases: ["pago", "condiciones de pago"], width: 22, help: "" },
    { key: "locations", title: "Locales", aliases: ["locales servidos", "sirve a"], width: 26, help: "Separados por comas; «Todos» o vacío si sirve a todos." },
  ],
  products: [
    { key: "sku", title: "Código", aliases: ["codigo producto", "sku", "referencia interna", "ref"], width: 12, help: "Único. Si lo pones, se une por él; si no, por el nombre." },
    { key: "name", title: "Nombre", aliases: ["producto", "articulo", "descripcion"], width: 34, help: "Obligatorio si es nuevo." },
    { key: "family", title: "Familia", aliases: ["categoria", "grupo"], width: 16, help: "Obligatoria si es nuevo (Bebidas, Cocina…)." },
    { key: "subfamily", title: "Subfamilia", aliases: ["subcategoria", "tipo"], width: 18, help: "Destilados, Vinos, Carnes…" },
    { key: "dimension", title: "Medida", aliases: ["unidad de medida", "se mide en"], width: 11, help: "Unidades, Volumen o Peso. Obligatoria si es nuevo." },
    { key: "vat_rate", title: "IVA %", aliases: ["iva", "tipo iva"], width: 7, help: "21, 10, 4 o 0." },
    { key: "count_name", title: "Formato de conteo", aliases: ["formato conteo", "se cuenta en"], width: 18, help: "Botella 70 cl, Kilo… En productos por unidades, vacío = unidades." },
    { key: "count_qty", title: "Contenido conteo", aliases: ["contenido del formato de conteo"], width: 12, help: "70 cl, 1 kg, 1 ud…" },
    { key: "purchase_name", title: "Formato de compra", aliases: ["formato compra", "se compra en"], width: 18, help: "Caja 6 botellas, Caja 24, Saco 25 kg…" },
    { key: "purchase_qty", title: "Contenido compra", aliases: ["contenido del formato de compra"], width: 12, help: "4,2 l, 24 ud, 25 kg…" },
    { key: "unit", title: "Unidad del contenido", aliases: ["unidad contenido", "unidad"], width: 10, help: "ud, ml, cl, l, g o kg (si no va en el contenido)." },
    { key: "supplier", title: "Proveedor", aliases: ["proveedor habitual"], width: 22, help: "Código o nombre de la hoja Proveedores." },
    { key: "price", title: "Precio compra (€)", aliases: ["precio", "precio compra", "coste", "precio sin iva"], width: 14, help: "Del formato de compra, sin IVA." },
    { key: "supplier_ref", title: "Ref. proveedor", aliases: ["referencia proveedor", "codigo proveedor articulo"], width: 14, help: "" },
    { key: "full_weight_g", title: "Peso llena (g)", aliases: ["peso lleno", "peso botella llena"], width: 12, help: "Para pesar botellas abiertas." },
    { key: "empty_weight_g", title: "Peso vacía (g)", aliases: ["peso vacio", "peso botella vacia", "tara"], width: 12, help: "" },
  ],
  assortment: [
    { key: "location", title: "Local", aliases: ["establecimiento", "centro"], width: 20, help: "Nombre del local (como en la app)." },
    { key: "product", title: "Producto", aliases: ["codigo", "codigo producto", "nombre"], width: 34, help: "Código o nombre del producto." },
    { key: "min", title: "Mínimo", aliases: ["minimo", "stock minimo"], width: 9, help: "En la unidad de conteo (botellas, kg, ud)." },
    { key: "max", title: "Máximo", aliases: ["maximo", "stock maximo", "par"], width: 9, help: "Hasta dónde se repone." },
    { key: "zone", title: "Zona", aliases: ["almacen", "ubicacion", "espacio"], width: 18, help: "Dónde se guarda (se crea si no existe)." },
  ],
};

const SHEET_ALIASES: Record<SheetKey, string[]> = {
  suppliers: ["proveedores", "proveedor", "suppliers"],
  products: ["productos", "articulos", "catalogo", "products"],
  assortment: ["surtido", "minimos", "stock minimo", "locales", "assortment"],
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[*().%€/]/g, " ").replace(/\s+/g, " ").trim();

// ---------- valores ----------

/** «1.234,56», «72,60 €», «1234.5» → número. */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[€%\s]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(/\.(?=.*,)/g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const DIMENSIONS: Record<string, Dimension> = {
  unidades: "count", unidad: "count", ud: "count", uds: "count", u: "count", count: "count", piezas: "count",
  volumen: "volume", volume: "volume", litros: "volume", litro: "volume", l: "volume", ml: "volume", cl: "volume", liquido: "volume",
  peso: "mass", mass: "mass", kg: "mass", kilos: "mass", g: "mass", gramos: "mass",
};

export function parseDimension(raw: string): Dimension | null {
  return DIMENSIONS[norm(raw)] ?? null;
}

const UNITS: Record<string, { dimension: Dimension; factor: number }> = {
  ud: { dimension: "count", factor: 1 }, uds: { dimension: "count", factor: 1 }, u: { dimension: "count", factor: 1 },
  unidad: { dimension: "count", factor: 1 }, unidades: { dimension: "count", factor: 1 },
  ml: { dimension: "volume", factor: 1 }, cl: { dimension: "volume", factor: 10 }, l: { dimension: "volume", factor: 1000 },
  litro: { dimension: "volume", factor: 1000 }, litros: { dimension: "volume", factor: 1000 },
  g: { dimension: "mass", factor: 1 }, gr: { dimension: "mass", factor: 1 }, gramos: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1000 }, kilo: { dimension: "mass", factor: 1000 }, kilos: { dimension: "mass", factor: 1000 },
};

/** «70 cl» → 700 (ml); «5» con unidad «kg» → 5000 (g). Devuelve el contenido en la unidad base. */
export function parseContent(raw: string, unitCell: string, dimension: Dimension): { qty: number } | { error: string } {
  const m = /^\s*([\d.,]+)\s*([a-zA-Z]*)\.?\s*$/.exec(raw);
  if (!m) return { error: `No se entiende el contenido «${raw}».` };
  const value = parseNumber(m[1]!);
  if (value === null || value <= 0) return { error: `El contenido «${raw}» tiene que ser mayor que 0.` };
  const unitName = norm(m[2] || unitCell || (dimension === "count" ? "ud" : ""));
  if (!unitName) return { error: `Falta la unidad del contenido «${raw}» (ml, cl, l, g, kg o ud).` };
  const unit = UNITS[unitName];
  if (!unit) return { error: `Unidad desconocida «${m[2] || unitCell}».` };
  if (unit.dimension !== dimension) {
    return { error: `«${raw}» no encaja con un producto que se mide en ${dimension === "count" ? "unidades" : dimension === "volume" ? "volumen" : "peso"}.` };
  }
  const qty = Math.round(value * unit.factor * 10_000) / 10_000;
  if (dimension === "count" && !Number.isInteger(qty)) return { error: "En productos por unidades el contenido es un número entero." };
  return { qty };
}

const DAY_NAMES: Array<[RegExp, number]> = [
  [/^(l|lu|lun|lunes)$/, 1], [/^(m|ma|mar|martes)$/, 2], [/^(x|mi|mie|miercoles)$/, 3], [/^(j|ju|jue|jueves)$/, 4],
  [/^(v|vi|vie|viernes)$/, 5], [/^(s|sa|sab|sabado)$/, 6], [/^(d|do|dom|domingo)$/, 7],
];
const dayOf = (token: string) => DAY_NAMES.find(([re]) => re.test(token))?.[1] ?? null;

/** «L, J», «lunes y jueves», «L-V», «todos» → [1, 4] … */
export function parseDays(raw: string): number[] | null {
  const s = norm(raw);
  if (!s) return null;
  if (/^(todos|diario|todos los dias|l d)$/.test(s)) return [1, 2, 3, 4, 5, 6, 7];
  const days = new Set<number>();
  for (const part of s.split(/\s*(?:,|;|\by\b|\s)\s*/).filter(Boolean)) {
    const range = /^(\w+)-(\w+)$/.exec(part);
    if (range) {
      const a = dayOf(range[1]!);
      const b = dayOf(range[2]!);
      if (!a || !b || b < a) return null;
      for (let d = a; d <= b; d++) days.add(d);
    } else {
      const d = dayOf(part);
      if (!d) return null;
      days.add(d);
    }
  }
  return days.size ? [...days].sort((a, b) => a - b) : null;
}

/** «12:00», «12», «12.30» o la fracción de día con que Excel guarda las horas (0,5 = 12:00). */
export function parseTime(raw: string): string | null {
  const s = raw.trim();
  const fraction = /^0?[.,]\d+$/.test(s) ? Number(s.replace(",", ".")) : null;
  if (fraction !== null) {
    const minutes = Math.round(fraction * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*h?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ---------- lectura de la plantilla ----------

function findSheet(sheets: Record<string, string[][]>, key: SheetKey): string[][] | null {
  const name = Object.keys(sheets).find((n) => SHEET_ALIASES[key].includes(norm(n)));
  return name ? sheets[name]! : null;
}

function headerMap(header: string[], key: SheetKey): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((title, i) => {
    const t = norm(title);
    const col = COLUMNS[key].find((c) => norm(c.title) === t || (c.aliases ?? []).some((a) => norm(a) === t));
    if (col && !map.has(col.key)) map.set(col.key, i);
  });
  return map;
}

/** Excel deja los textos con espacios de más; una celda solo con espacios cuenta como vacía. */
const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

export type ParsedImport = {
  payload: ImportPayload;
  /** Número de fila de Excel de cada elemento del payload, para traducir los errores del servidor. */
  rowNumbers: Record<SheetKey, number[]>;
  issues: RowIssue[];
  missingSheets: SheetKey[];
};

export function parseWorkbook(sheets: Record<string, string[][]>): ParsedImport {
  const payload: ImportPayload = { suppliers: [], products: [], assortment: [] };
  const rowNumbers: Record<SheetKey, number[]> = { suppliers: [], products: [], assortment: [] };
  const issues: RowIssue[] = [];
  const missingSheets: SheetKey[] = [];

  for (const key of ["suppliers", "products", "assortment"] as const) {
    const rows = findSheet(sheets, key);
    if (!rows || rows.length === 0) {
      missingSheets.push(key);
      continue;
    }
    const cols = headerMap(rows[0] ?? [], key);
    rows.slice(1).forEach((cells, i) => {
      const excelRow = i + 2;
      const get = (k: string) => clean(cols.has(k) ? cells[cols.get(k)!] : "");
      if (!cells.some((c) => clean(c))) return;
      const errors: string[] = [];
      const num = (k: string, label: string, { min = 0, max = Infinity }: { min?: number; max?: number } = {}) => {
        const raw = get(k);
        if (!raw) return undefined;
        const v = parseNumber(raw);
        if (v === null || v < min || v > max) {
          errors.push(`${label}: «${raw}» no es un número válido.`);
          return undefined;
        }
        return v;
      };
      const text = (k: string) => get(k) || undefined;
      let label = "";

      if (key === "suppliers") {
        const row: SupplierRow = { code: text("code"), name: text("name"), tax_id: text("tax_id"), email: text("email"), phone: text("phone"), contact_name: text("contact_name"), payment_terms: text("payment_terms") };
        label = row.name ?? row.code ?? "";
        if (!row.name && !row.code) errors.push("Falta el nombre o el código.");
        if (row.code && row.code.length > 20) errors.push("El código tiene como mucho 20 caracteres.");
        if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push(`Email no válido «${row.email}».`);
        if (get("order_days")) {
          const days = parseDays(get("order_days"));
          if (!days) errors.push(`Días de pedido no válidos «${get("order_days")}» (usa L, M, X, J, V, S, D).`);
          else row.order_days = days;
        }
        if (get("order_cutoff")) {
          const t = parseTime(get("order_cutoff"));
          if (!t) errors.push(`Hora límite no válida «${get("order_cutoff")}».`);
          else row.order_cutoff = t;
        }
        row.lead_time_hours = num("lead_time_hours", "Plazo", { max: 720 });
        row.min_order = num("min_order", "Pedido mínimo");
        if (get("locations")) {
          row.locations = /^todos?$/i.test(norm(get("locations"))) ? [] : get("locations").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        }
        if (!errors.length) {
          payload.suppliers.push(strip(row));
          rowNumbers.suppliers.push(excelRow);
        }
      }

      if (key === "products") {
        const row: ProductRow = { sku: text("sku"), name: text("name"), family: text("family"), subfamily: text("subfamily"), supplier: text("supplier"), supplier_ref: text("supplier_ref") };
        label = row.name ?? row.sku ?? "";
        if (!row.name && !row.sku) errors.push("Falta el nombre o el código.");
        if (get("dimension")) {
          const d = parseDimension(get("dimension"));
          if (!d) errors.push(`Medida no válida «${get("dimension")}» (Unidades, Volumen o Peso).`);
          else row.dimension = d;
        }
        const vat = num("vat_rate", "IVA", { max: 100 });
        if (vat !== undefined) row.vat_rate = vat > 0 && vat < 1 ? Math.round(vat * 100) : vat;
        if (row.vat_rate !== undefined && row.vat_rate > 30) errors.push("El IVA va de 0 a 30.");
        // Los contenidos se leen con la medida del producto (si la fila no la trae, la deducimos de la unidad).
        const dimension = row.dimension ?? inferDimension(get("count_qty"), get("purchase_qty"), get("unit"));
        for (const [nameKey, qtyKey, field, what] of [["count_name", "count_qty", "count_pack", "conteo"], ["purchase_name", "purchase_qty", "purchase_pack", "compra"]] as const) {
          const name = get(nameKey);
          const qty = get(qtyKey);
          if (!name && !qty) continue;
          if (!name) { errors.push(`Falta el nombre del formato de ${what}.`); continue; }
          if (!qty) { errors.push(`Falta el contenido del formato de ${what} «${name}».`); continue; }
          if (!dimension) { errors.push(`Indica la medida para leer el contenido «${qty}».`); continue; }
          const c = parseContent(qty, get("unit"), dimension);
          if ("error" in c) errors.push(c.error);
          else row[field] = { name, qty: c.qty };
        }
        row.price = num("price", "Precio");
        row.full_weight_g = num("full_weight_g", "Peso llena");
        row.empty_weight_g = num("empty_weight_g", "Peso vacía");
        if (row.full_weight_g !== undefined && row.empty_weight_g !== undefined && row.full_weight_g <= row.empty_weight_g) {
          errors.push("El peso de la botella llena tiene que ser mayor que el de vacía.");
        }
        if (!errors.length) {
          payload.products.push(strip(row));
          rowNumbers.products.push(excelRow);
        }
      }

      if (key === "assortment") {
        const row: AssortmentRow = { location: text("location"), product: text("product"), zone: text("zone") };
        label = `${row.product ?? "?"} · ${row.location ?? "?"}`;
        if (!row.location) errors.push("Falta el local.");
        if (!row.product) errors.push("Falta el producto.");
        row.min = num("min", "Mínimo");
        row.max = num("max", "Máximo");
        if (row.min !== undefined && row.max !== undefined && row.min > row.max) errors.push("El mínimo es mayor que el máximo.");
        if (!errors.length) {
          payload.assortment.push(strip(row));
          rowNumbers.assortment.push(excelRow);
        }
      }

      for (const message of errors) issues.push({ sheet: key, row: excelRow, label, message });
    });
  }
  return { payload, rowNumbers, issues, missingSheets };
}

function inferDimension(...cells: string[]): Dimension | null {
  for (const cell of cells) {
    const unit = /([a-zA-Z]+)\.?\s*$/.exec(cell)?.[1];
    if (unit && UNITS[norm(unit)]) return UNITS[norm(unit)]!.dimension;
  }
  return null;
}

/** Quita las claves sin valor: en la base, ausente = «no cambiar». */
function strip<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== "")) as T;
}

// ---------- plantilla y exportación ----------

const DAY_LETTERS = ["", "L", "M", "X", "J", "V", "S", "D"];
const DIMENSION_LABEL: Record<Dimension, string> = { count: "Unidades", volume: "Volumen", mass: "Peso" };
const BASE_UNIT: Record<Dimension, string> = { count: "ud", volume: "ml", mass: "g" };

type ExportData = {
  suppliers: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  assortment: Array<Record<string, unknown>>;
};

const cell = (v: unknown): string | number | null => (v === null || v === undefined ? null : typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : String(v));

/** Hojas del Excel: instrucciones, proveedores, productos y surtido (vacías o con el catálogo actual). */
export function templateSheets(data?: ExportData) {
  const header = (key: SheetKey) => COLUMNS[key].map((c) => c.title);
  const widths = (key: SheetKey) => COLUMNS[key].map((c) => c.width);
  const example = !data;
  const suppliers = (data?.suppliers ?? (example ? [{ code: "BAH", name: "Distribuciones Ejemplo", email: "pedidos@ejemplo.com", phone: "+34 600 000 000", contact_name: "Sergio", order_days: [1, 4], order_cutoff: "12:00", lead_time_hours: 24, min_order: 150, payment_terms: "Transferencia a 30 días", locations: null }] : [])).map((s) => [
    cell(s.code), cell(s.name), cell(s.tax_id), cell(s.email), cell(s.phone), cell(s.contact_name),
    Array.isArray(s.order_days) ? (s.order_days as number[]).map((d) => DAY_LETTERS[d]).join(", ") : null,
    cell(s.order_cutoff), cell(s.lead_time_hours), cell(s.min_order), cell(s.payment_terms),
    Array.isArray(s.locations) && s.locations.length ? (s.locations as string[]).join(", ") : "Todos",
  ]);
  const products = (data?.products ?? (example ? [
    { sku: "GIN-01", name: "Ginebra London Dry 70 cl", family: "Bebidas", subfamily: "Destilados", dimension: "volume", vat_rate: 21, count_pack: { name: "Botella 70 cl", qty: 700 }, purchase_pack: { name: "Caja 6 botellas", qty: 4200 }, supplier: "BAH", price: 72.6, supplier_ref: "", full_weight_g: 1185, empty_weight_g: 520 },
    { sku: "TON-01", name: "Tónica 20 cl", family: "Bebidas", subfamily: "Refrescos", dimension: "count", vat_rate: 10, purchase_pack: { name: "Caja 24", qty: 24 }, supplier: "BAH", price: 14.4 },
    { sku: "TOM-01", name: "Tomate pera", family: "Cocina", subfamily: "Frutas y verduras", dimension: "mass", vat_rate: 4, count_pack: { name: "Kilo", qty: 1000 }, purchase_pack: { name: "Caja 10 kg", qty: 10000 }, supplier: "BAH", price: 16.5 },
  ] : [])).map((p) => {
    const dim = (p.dimension as Dimension) ?? "count";
    const cp = p.count_pack as { name: string; qty: number | string } | null;
    const pp = p.purchase_pack as { name: string; qty: number | string } | null;
    return [
      cell(p.sku), cell(p.name), cell(p.family), cell(p.subfamily), DIMENSION_LABEL[dim], cell(p.vat_rate),
      cp?.name ?? null, cp ? cell(cp.qty) : null, pp?.name ?? null, pp ? cell(pp.qty) : null, cp || pp ? BASE_UNIT[dim] : null,
      cell(p.supplier), cell(p.price), cell(p.supplier_ref), cell(p.full_weight_g), cell(p.empty_weight_g),
    ];
  });
  const assortment = (data?.assortment ?? (example ? [{ location: "Nombre de tu local", product: "GIN-01", min: 2, max: 6, zone: "Almacén" }] : [])).map((a) => [
    cell(a.location), cell(a.product), cell(a.min), cell(a.max), cell(a.zone),
  ]);
  const help = [
    ["Cómo rellenar esta plantilla"],
    [""],
    ["1. Proveedores, Productos y Surtido son independientes: puedes subir solo las hojas que necesites."],
    ["2. Una celda vacía no cambia nada de lo que ya hay. Para un producto nuevo hacen falta nombre, familia y medida."],
    ["3. Se une por el código (si lo hay) o por el nombre, sin importar mayúsculas ni acentos: subir el mismo fichero dos veces no duplica nada."],
    ["4. Medida: Unidades (refrescos, latas, piezas), Volumen (bebidas a granel, botellas que se abren) o Peso (cocina)."],
    ["5. Contenidos con su unidad: «70 cl», «4,2 l», «24 ud», «10 kg». También puedes poner el número y la unidad en «Unidad del contenido»."],
    ["6. Mínimo y máximo, en la unidad en que se cuenta: botellas, kilos o unidades."],
    ["7. Antes de guardar, la app te enseña qué se crea, qué cambia y qué filas tienen errores. Nada se aplica hasta que confirmas."],
    [""],
    ["Columnas"],
    ...(["suppliers", "products", "assortment"] as const).flatMap((k) => [
      [`${SHEET_LABEL[k]}`],
      ...COLUMNS[k].map((c) => [`   ${c.title}`, c.help]),
    ]),
  ];
  return [
    { name: "Instrucciones", rows: help, widths: [34, 90] },
    { name: SHEET_LABEL.suppliers, rows: [header("suppliers"), ...suppliers], widths: widths("suppliers") },
    { name: SHEET_LABEL.products, rows: [header("products"), ...products], widths: widths("products") },
    { name: SHEET_LABEL.assortment, rows: [header("assortment"), ...assortment], widths: widths("assortment") },
  ];
}
