// Ingeniería de menú (método Kasavana y Smith): cada plato según lo que se vende (popularidad) y lo que
// deja por ración (margen de contribución = precio sin IVA − coste teórico).
//
//   · Popular: su parte de las raciones vendidas llega al 70 % de la media (1 / nº de platos).
//   · Margen alto: su margen por ración llega a la media ponderada de la carta.
//
//   estrella  popular y con margen alto      → mantener
//   caballo   popular y con margen bajo      → revisar coste o precio (se vende igual)
//   puzle     poco popular y con margen alto → darle visibilidad
//   perro     poco popular y con margen bajo → candidato a salir de la carta

export type MenuClass = "estrella" | "caballo" | "puzle" | "perro";

export type MenuInput = { id: string; name: string; qty: number; amount: number; cost: number | null };

export type MenuRow = MenuInput & { cost: number; unitPrice: number; unitCost: number; unitMargin: number; mix: number; cls: MenuClass };

export type MenuAnalysis = {
  rows: MenuRow[];
  /** Platos sin coste (no entran en el análisis). */
  skipped: number;
  avgMargin: number;
  popularityThreshold: number;
  totalQty: number;
};

export const MENU_CLASS: Record<MenuClass, { label: string; one: string; advice: string }> = {
  estrella: { label: "Estrellas", one: "Estrella", advice: "Se venden mucho y dejan buen margen: mantenlas y cuida su calidad." },
  caballo: { label: "Caballos de batalla", one: "Caballo de batalla", advice: "Se venden mucho pero dejan poco: revisa ración e ingredientes o sube un poco el precio." },
  puzle: { label: "Puzles", one: "Puzle", advice: "Dejan buen margen pero se venden poco: dales visibilidad en carta y en sala." },
  perro: { label: "Perros", one: "Perro", advice: "Se venden poco y dejan poco: candidatos a salir de la carta o a rehacerse." },
};

/** Clasifica los platos con coste conocido. Con menos de 2 no hay con qué comparar: rows vacío. */
export function menuEngineering(items: MenuInput[]): MenuAnalysis {
  const valid = items.filter((i) => i.cost !== null && i.qty > 0 && i.amount > 0) as Array<MenuInput & { cost: number }>;
  const skipped = items.filter((i) => i.qty > 0 && i.cost === null).length;
  const totalQty = valid.reduce((s, i) => s + i.qty, 0);
  if (valid.length < 2 || totalQty <= 0) return { rows: [], skipped, avgMargin: 0, popularityThreshold: 0, totalQty };
  const totalMargin = valid.reduce((s, i) => s + (i.amount - i.cost), 0);
  const avgMargin = totalMargin / totalQty;
  const popularityThreshold = (1 / valid.length) * 0.7;
  const rows = valid
    .map((i) => {
      const unitPrice = i.amount / i.qty;
      const unitCost = i.cost / i.qty;
      const unitMargin = unitPrice - unitCost;
      const mix = i.qty / totalQty;
      const popular = mix >= popularityThreshold;
      const high = unitMargin >= avgMargin;
      const cls: MenuClass = popular ? (high ? "estrella" : "caballo") : high ? "puzle" : "perro";
      return { ...i, unitPrice, unitCost, unitMargin, mix, cls };
    })
    .sort((a, b) => b.unitMargin * b.qty - a.unitMargin * a.qty);
  return { rows, skipped, avgMargin, popularityThreshold, totalQty };
}
