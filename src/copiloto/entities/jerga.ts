// Capa de entrada del asistente: corrige la jerga y las erratas de chat más comunes antes de que el mensaje
// llegue a las vías rápidas y a Jev («kuanto ron ai en la oliva» → «cuanto ron hay en la oliva»). Así cada capa
// de abajo trabaja con español normal y no hace falta repetir la lista en cada sitio.
//
// Solo se cambian palabras sueltas y conocidas, nunca trozos de palabra: un nombre de producto no se toca.

const JERGA: Record<string, string> = {
  kuanto: "cuanto", kuanta: "cuanta", kuantos: "cuantos", kuantas: "cuantas",
  kual: "cual", kuales: "cuales", kien: "quien", kiero: "quiero", kieres: "quieres",
  // «k» no: en cocina «2 k de harina» son kilos.
  ke: "que", q: "que", xq: "porque", pq: "porque", xk: "porque",
  ai: "hay", ay: "hay",
  aki: "aqui", tb: "tambien", tmb: "tambien", dnd: "donde", cn: "con", tng: "tengo", tenems: "tenemos",
};

/** El mensaje con la jerga de chat corregida; el resto del texto queda igual (mayúsculas, signos, nombres). */
export function corregirJerga(text: string): string {
  return text.replace(/[\p{L}]+/gu, (word) => {
    const fixed = JERGA[word.toLowerCase()];
    return fixed === undefined ? word : fixed;
  });
}
