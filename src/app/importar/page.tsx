"use client";

import { civilToday } from "@/lib/business-day";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseWorkbook, SHEET_LABEL, templateSheets, type ParsedImport, type RowIssue, type SheetKey } from "@/lib/catalog-import";
import { readXlsx, writeXlsx } from "@/lib/xlsx";
import { ImportDetect } from "@/components/importar/import-detect";
import { onPendingFile, takePending } from "@/lib/pending-file";
import "../productos/productos.css";
import "../productos/product-editor.css";
import { RecipeImportPanel } from "./recipe-import-panel";
import "./importar.css";

// Importar catálogo: plantilla de Excel → vista previa exacta (la base de datos hace la importación y la
// deshace) → aplicar en una sola transacción. Solo administración.

type Counts = { created: number; updated: number; unchanged: number };
type ServerResult = {
  stats: Record<string, Counts>;
  changes: Array<{ sheet: string; row: number; action: "created" | "updated"; label: string }>;
  errors: Array<{ sheet: SheetKey; row: number; label: string; message: string }>;
  applied: boolean;
};
type Stage =
  | { kind: "idle" }
  | { kind: "checking"; file: string }
  | { kind: "preview"; file: string; parsed: ParsedImport; result: ServerResult }
  | { kind: "applying"; file: string; parsed: ParsedImport; result: ServerResult }
  | { kind: "done"; file: string; result: ServerResult };

const SHEETS: SheetKey[] = ["suppliers", "products", "assortment"];
const EXTRA_LABEL: Record<string, string> = { packs: "Formatos", categories: "Familias", zones: "Zonas" };
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_TYPE }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => civilToday();

export default function ImportarPage() {
  const [org, setOrg] = useState<{ id: string; name: string; admin: boolean } | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Excel que llega desde el asistente: el catálogo va a su vista previa; los escandallos, a su panel.
  const [incoming, setIncoming] = useState<{ file: File; kind: string } | null>(null);
  const [recipeFile, setRecipeFile] = useState<File | null>(null);
  useEffect(() => {
    const take = () => {
      const entry = takePending<string>("importar");
      if (entry) setIncoming({ file: entry.file, kind: entry.read ?? "catalogo" });
    };
    void Promise.resolve().then(take);
    return onPendingFile("importar", take);
  }, []);
  useEffect(() => {
    if (!incoming || !org?.admin) return;
    const { file, kind } = incoming;
    void Promise.resolve().then(() => {
      setIncoming(null);
      if (kind === "escandallos") setRecipeFile(file);
      else void onFile(file);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez por archivo
  }, [incoming, org]);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data } = (await supabase?.from("memberships").select("org_id, role, organizations(name)").limit(1).maybeSingle()) ?? { data: null };
      const row = data as { org_id: string; role: string; organizations: { name: string } | null } | null;
      setOrg(row ? { id: row.org_id, name: row.organizations?.name ?? "", admin: row.role === "owner" || row.role === "admin" } : { id: "", name: "", admin: false });
    })();
  }, []);

  async function runImport(parsed: ParsedImport, apply: boolean): Promise<ServerResult> {
    const supabase = createClient();
    if (!supabase || !org) throw new Error("Sin conexión.");
    const { data, error: err } = await supabase.rpc("import_catalog", { p_org: org.id, p_payload: parsed.payload, p_apply: apply });
    if (err) throw new Error(err.message.includes("too_many_rows") ? "El fichero tiene más de 20.000 filas: divídelo." : "No se pudo comprobar el fichero.");
    const result = data as unknown as ServerResult;
    // Las filas del servidor son posiciones dentro de cada hoja: se traducen a la fila de Excel.
    result.errors = result.errors.map((e) => ({ ...e, row: parsed.rowNumbers[e.sheet]?.[e.row - 1] ?? e.row }));
    // Formatos y familias salen de la fila de su producto; las zonas, de la del surtido.
    const source: Record<string, SheetKey> = { suppliers: "suppliers", products: "products", packs: "products", categories: "products", assortment: "assortment", zones: "assortment" };
    result.changes = result.changes.map((c) => ({ ...c, row: parsed.rowNumbers[source[c.sheet] ?? "products"]?.[c.row - 1] ?? c.row }));
    return result;
  }

  async function onFile(file: File) {
    setError("");
    if (!/\.xlsx$/i.test(file.name)) return setError("Sube un fichero de Excel (.xlsx). Si lo tienes en .xls o .csv, ábrelo en Excel y guárdalo como .xlsx.");
    if (file.size > 15 * 1024 * 1024) return setError("El fichero ocupa más de 15 MB.");
    setStage({ kind: "checking", file: file.name });
    try {
      const parsed = parseWorkbook(await readXlsx(await file.arrayBuffer()));
      if (parsed.missingSheets.length === SHEETS.length) {
        setStage({ kind: "idle" });
        return setError("No encuentro las hojas «Proveedores», «Productos» ni «Surtido». Usa la plantilla (puedes cambiar el orden de las columnas, no los nombres de las hojas).");
      }
      const result = await runImport(parsed, false);
      setStage({ kind: "preview", file: file.name, parsed, result });
    } catch (err) {
      setStage({ kind: "idle" });
      setError(err instanceof Error && err.message !== "not_a_zip" ? err.message : "No se pudo leer el fichero. ¿Es un .xlsx de Excel?");
    }
  }

  async function apply() {
    if (stage.kind !== "preview") return;
    setStage({ ...stage, kind: "applying" });
    try {
      const result = await runImport(stage.parsed, true);
      if (!result.applied) {
        setStage({ kind: "preview", file: stage.file, parsed: stage.parsed, result });
        return setError("Algo cambió mientras revisabas: mira los errores y vuelve a intentarlo.");
      }
      setStage({ kind: "done", file: stage.file, result });
    } catch (err) {
      setStage({ ...stage, kind: "preview" });
      setError(err instanceof Error ? err.message : "No se pudo aplicar la importación.");
    }
  }

  async function exportCatalog() {
    if (!org) return;
    setExporting(true);
    setError("");
    const { data, error: err } = (await createClient()?.rpc("export_catalog", { p_org: org.id })) ?? { data: null, error: null };
    setExporting(false);
    if (err || !data) return setError("No se pudo exportar el catálogo.");
    download(writeXlsx(templateSheets(data as Parameters<typeof templateSheets>[0])), `catalogo-${today()}.xlsx`);
  }

  function reset() {
    setStage({ kind: "idle" });
    setError("");
    if (input.current) input.current.value = "";
  }

  const preview = stage.kind === "preview" || stage.kind === "applying" ? stage : null;
  const issues: RowIssue[] = preview ? [...preview.parsed.issues, ...preview.result.errors] : [];
  const pendingChanges = preview
    ? Object.values(preview.result.stats).reduce((n, s) => n + (s.created ?? 0) + (s.updated ?? 0), 0)
    : 0;

  return (
    <main className="catalog-page">
      <div className="catalog-content import-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Gestión · Alta de datos</p>
            <h1>Importar catálogo</h1>
            <p className="catalog-subtitle">Proveedores, productos con sus formatos y precios, y mínimos por local, desde Excel. Antes de guardar ves exactamente qué cambia.</p>
          </div>
        </div>

        {org && !org.admin && (
          <section className="import-card import-blocked"><AlertTriangle size={18} /> Solo la propiedad o la administración pueden importar el catálogo.</section>
        )}

        {org?.admin && (
          <>
            <ImportDetect />
            <section className="import-steps">
              <div className="import-card">
                <span className="import-step">1</span>
                <h2>Prepara el Excel</h2>
                <p>Empieza por la plantilla con ejemplos o, para cambiar muchos datos a la vez, exporta tu catálogo, edítalo y vuelve a subirlo.</p>
                <div className="import-actions">
                  <button className="ghost-button" onClick={() => download(writeXlsx(templateSheets()), "plantilla-catalogo.xlsx")}><Download size={15} /> Plantilla vacía</button>
                  <button className="ghost-button" onClick={() => void exportCatalog()} disabled={exporting}>
                    {exporting ? <Loader2 size={15} className="spin" /> : <FileSpreadsheet size={15} />} Exportar catálogo actual
                  </button>
                </div>
              </div>
              <label className={`import-card import-drop ${stage.kind === "checking" ? "busy" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}>
                <span className="import-step">2</span>
                <h2>Sube el fichero</h2>
                <p>{stage.kind === "checking" ? `Comprobando ${stage.file}…` : "Arrastra aquí el .xlsx o pulsa para elegirlo. Todavía no se guarda nada."}</p>
                <span className="catalog-primary">{stage.kind === "checking" ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} Elegir fichero</span>
                <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
              </label>
            </section>

            {error && <p className="import-error" role="alert">{error}</p>}

            {preview && (
              <section className="catalog-panel import-panel">
                <div className="import-panel-head">
                  <div>
                    <h2>Vista previa · {preview.file}</h2>
                    <p>{issues.length ? `${issues.length} ${issues.length === 1 ? "fila tiene" : "filas tienen"} errores: corrígelas en el Excel y vuelve a subirlo. No se guarda nada mientras haya errores.` : pendingChanges ? "Todo correcto. Revisa los cambios y aplica." : "El fichero no cambia nada de lo que ya tienes."}</p>
                  </div>
                  <div className="import-actions">
                    <button className="ghost-button" onClick={reset}><RotateCcw size={15} /> Otro fichero</button>
                    <button className="catalog-primary" disabled={issues.length > 0 || pendingChanges === 0 || stage.kind === "applying"} onClick={() => void apply()}>
                      {stage.kind === "applying" ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} Aplicar {plural(pendingChanges, "cambio", "cambios")}
                    </button>
                  </div>
                </div>
                <Stats result={preview.result} parsed={preview.parsed} />
                {issues.length > 0 && (
                  <div className="import-list">
                    <h3><AlertTriangle size={15} /> Errores</h3>
                    <table>
                      <thead><tr><th>Hoja</th><th>Fila</th><th>Dato</th><th>Qué pasa</th></tr></thead>
                      <tbody>
                        {issues.slice(0, 300).map((i, n) => (
                          <tr key={n}><td>{SHEET_LABEL[i.sheet]}</td><td>{i.row}</td><td>{i.label}</td><td>{i.message}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {issues.length > 300 && <p className="import-more">… y {issues.length - 300} más.</p>}
                  </div>
                )}
                {preview.result.changes.length > 0 && (
                  <div className="import-list">
                    <h3>Cambios</h3>
                    <table>
                      <thead><tr><th>Hoja</th><th>Fila</th><th>Dato</th><th></th></tr></thead>
                      <tbody>
                        {preview.result.changes.map((c, n) => (
                          <tr key={n}>
                            <td>{SHEET_LABEL[c.sheet as SheetKey] ?? EXTRA_LABEL[c.sheet] ?? c.sheet}</td>
                            <td>{c.row}</td>
                            <td>{c.label}</td>
                            <td><span className={`import-tag ${c.action}`}>{c.action === "created" ? "Nuevo" : "Cambia"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.result.changes.length >= 500 && <p className="import-more">Se muestran los 500 primeros.</p>}
                  </div>
                )}
              </section>
            )}

            {stage.kind === "done" && (
              <section className="catalog-panel import-panel import-done">
                <CheckCircle2 size={28} />
                <h2>Importación aplicada</h2>
                <p>{stage.file} · {describe(stage.result)}</p>
                <div className="import-actions">
                  <Link className="ghost-button" href="/productos">Ver productos</Link>
                  <Link className="ghost-button" href="/proveedores">Ver proveedores</Link>
                  <Link className="ghost-button" href="/stock">Ver mínimos en Stock</Link>
                  <button className="ghost-button" onClick={reset}><Upload size={15} /> Importar otro</button>
                </div>
              </section>
            )}

            <RecipeImportPanel orgId={org.id} incoming={recipeFile} />
          </>
        )}
      </div>
    </main>
  );
}

function Stats({ result, parsed }: { result: ServerResult; parsed: ParsedImport }) {
  return (
    <div className="import-stats">
      {SHEETS.map((key) => {
        const s = result.stats[key] ?? { created: 0, updated: 0, unchanged: 0 };
        const missing = parsed.missingSheets.includes(key);
        return (
          <div key={key} className={missing ? "missing" : undefined}>
            <span>{SHEET_LABEL[key]}</span>
            {missing ? (
              <small>No está en el fichero</small>
            ) : (
              <>
                <strong>{s.created} {s.created === 1 ? "nuevo" : "nuevos"} · {s.updated} {s.updated === 1 ? "cambia" : "cambian"}</strong>
                <small>{s.unchanged} sin cambios</small>
              </>
            )}
          </div>
        );
      })}
      <div>
        <span>Además</span>
        <strong>{plural((result.stats.packs?.created ?? 0) + (result.stats.packs?.updated ?? 0), "formato", "formatos")}</strong>
        <small>{plural(result.stats.categories?.created ?? 0, "familia nueva", "familias nuevas")} · {plural(result.stats.zones?.created ?? 0, "zona nueva", "zonas nuevas")}</small>
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function describe(result: ServerResult) {
  const parts = SHEETS.map((k) => {
    const s = result.stats[k];
    return s && s.created + s.updated > 0 ? `${SHEET_LABEL[k].toLowerCase()}: ${plural(s.created, "nuevo", "nuevos")} y ${plural(s.updated, "actualizado", "actualizados")}` : null;
  }).filter(Boolean);
  return parts.length ? parts.join(" · ") : "sin cambios";
}
