"use client";

// Subir varios archivos de una vez: se reconoce qué contiene cada hoja o CSV (catálogo, escandallos, ventas) y
// se enseña antes de tocar nada. Aún no se guarda nada: es el primer paso del flujo de importación.
import { useState } from "react";
import { FileSpreadsheet, Loader2, TriangleAlert } from "lucide-react";
import { classifyCsv, classifySheets, type ClassifiedSheet, type ImportKind } from "@/lib/import-classify";
import { readXlsx } from "@/lib/xlsx";

const KIND_LABEL: Record<ImportKind, string> = { catalogo: "Catálogo", escandallos: "Escandallos", ventas: "Ventas del TPV", desconocido: "¿Qué es?" };

interface Detected {
  file: string;
  sheets: ClassifiedSheet[];
  error?: string;
}

export function ImportDetect() {
  const [items, setItems] = useState<Detected[]>([]);
  const [busy, setBusy] = useState(false);

  async function detect(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const out: Detected[] = [];
    for (const file of Array.from(files)) {
      try {
        if (/\.csv$/i.test(file.name)) {
          out.push({ file: file.name, sheets: [classifyCsv(file.name, await file.text())] });
        } else if (/\.xlsx$/i.test(file.name)) {
          out.push({ file: file.name, sheets: classifySheets(await readXlsx(await file.arrayBuffer())) });
        } else {
          out.push({ file: file.name, sheets: [], error: "Formato no admitido todavía: sube .xlsx o .csv." });
        }
      } catch {
        out.push({ file: file.name, sheets: [], error: "No se pudo leer el archivo." });
      }
    }
    setItems(out);
    setBusy(false);
  }

  return (
    <section className="import-card import-detect" aria-label="Subir varios archivos">
      <p><FileSpreadsheet size={16} aria-hidden="true" /> Sube todos los archivos de una vez (.xlsx o .csv). Se reconoce qué contiene cada uno; no se guarda nada todavía.</p>
      <label className="catalog-primary">
        {busy ? <Loader2 size={16} className="spin" /> : null} Elegir archivos
        <input type="file" multiple accept=".xlsx,.csv,text/csv" hidden onChange={(e) => void detect(e.target.files)} />
      </label>
      {items.map((item) => (
        <div key={item.file} className="import-detect-file">
          <strong>{item.file}</strong>
          {item.error && <p className="warn"><TriangleAlert size={14} aria-hidden="true" /> {item.error}</p>}
          <ul>
            {item.sheets.map((s) => (
              <li key={s.sheet}>
                <span className={`import-kind import-kind-${s.kind}`}>{KIND_LABEL[s.kind]}</span> {s.sheet}
                {s.rows > 0 && <small> · {s.rows} filas</small>} — <small>{s.reason}</small>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
