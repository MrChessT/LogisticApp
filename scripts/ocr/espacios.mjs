// El reconocedor de texto (PP-OCRv4) casi nunca emite el carácter «espacio», pero sí le da algo de probabilidad
// justo donde hay un hueco entre palabras. La librería se queda con el carácter más probable y por eso pega las
// palabras («COSTILLADECERDO»). Este parche, aplicado al compilar el worker, mete un espacio entre dos caracteres
// cuando en los pasos intermedios la probabilidad de espacio pasa de UMBRAL. Medido con albaranes reales: con 0,10
// se recuperan las separaciones y no se parten palabras; un número («7,77», «1.234,56») no se parte nunca.
//
// Depende del código de @gutenye/ocr-common 1.4.9 (versión fijada en package.json): si la librería cambia, el
// parche no encaja y el build falla en lugar de salir sin él.

const UMBRAL = 0.1;

const CAMBIOS = [
  [
    `            const predsIdx = [];
            const predsProb = [];`,
    `            const predsIdx = [];
            const predsProb = [];
            const spaceProb = [];`,
  ],
  [
    `                predsProb.push(tmpMax);
                predsIdx.push(tmpIdx);`,
    `                predsProb.push(tmpMax);
                predsIdx.push(tmpIdx);
                spaceProb.push(tmpArr[predLen - 1]);`,
  ],
  [
    `line[ml] = decode(this.#dictionary, predsIdx, predsProb, true);`,
    `line[ml] = decode(this.#dictionary, predsIdx, predsProb, true, spaceProb);`,
  ],
  [`function decode(dictionary, textIndex, textProb, isRemoveDuplicate) {`, `function decode(dictionary, textIndex, textProb, isRemoveDuplicate, spaceProb) {`],
  [
    `        charList.push(dictionary[textIndex[idx] - 1]);`,
    `        const ch = dictionary[textIndex[idx] - 1];
        const prev = charList[charList.length - 1];
        if (spaceProb && prev !== undefined && prev !== ' ' && ch !== ' ' && idx - lastIdx > 1) {
            let gap = 0;
            for (let k = lastIdx + 1; k < idx; k++) gap = Math.max(gap, spaceProb[k]);
            const insideNumber = /[0-9]/.test(ch) && (/[.,]/.test(prev) ? /[0-9]/.test(charList[charList.length - 2] ?? '') : false);
            if (gap >= ${UMBRAL} && !insideNumber) charList.push(' ');
        }
        lastIdx = idx;
        charList.push(ch);`,
  ],
  [
    `    const confList = [];
    for (let idx = 0; idx < textIndex.length; idx++) {`,
    `    const confList = [];
    let lastIdx = -1;
    for (let idx = 0; idx < textIndex.length; idx++) {`,
  ],
  [
    `            if (idx > 0 && textIndex[idx - 1] === textIndex[idx]) {
                continue;`,
    `            if (idx > 0 && textIndex[idx - 1] === textIndex[idx]) {
                lastIdx = idx;
                continue;`,
  ],
];

/** Devuelve el código del reconocedor con el parche de espacios; falla si algún trozo no está tal cual. */
export function conEspacios(source) {
  let out = source;
  for (const [antes, despues] of CAMBIOS) {
    if (out.split(antes).length !== 2) throw new Error("El parche de espacios del OCR no encaja con @gutenye/ocr-common: revisa scripts/ocr/espacios.mjs.");
    out = out.replace(antes, despues);
  }
  return out;
}
