"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChefHat, Loader2, RotateCcw, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { harmonizeIngredients, normName, orderByDependency, parseEscandalloBook, type IngredientDimension, type ImportRecipe, type RecipeFileIssue } from "@/lib/recipe-import";
import { readXlsx } from "@/lib/xlsx";

// Importar escandallos (exportación «Escandallo» de otros programas de cocina): se pueden subir a la vez
// el libro de elaboraciones y el de platos. Vista previa y aplicar con import_recipes, por tandas: cada
// llamada a la base tiene 8 s y un recetario de 400 recetas tarda el doble. Cada tanda es atómica y volver
// a importar actualiza por nombre, así que si una tanda falla basta con repetir.

type Stats = { recipes_created: number; recipes_updated: number; lines: number; matched: number; sub_recipes: number; products_created: number; allergens_added: number };
type Result = { stats: Stats; new_products: string[] | null; errors: Array<{ row: number; label: string; message: string }>; applied: boolean; saved?: number };
type Stage =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "preview" | "applying"; files: string[]; recipes: ImportRecipe[]; notices: RecipeFileIssue[]; result: Result }
  | { kind: "done"; files: string[]; result: Result };

const BATCH = 50;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-ES")} ${n === 1 ? one : many}`;

export function RecipeImportPanel({ orgId }: { orgId: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [createMissing, setCreateMissing] = useState(true);
  const [error, setError] = useState("");
  const [showProducts, setShowProducts] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function run(recipes: ImportRecipe[], apply: boolean, create: boolean): Promise<Result> {
    const supabase = createClient();
    if (!supabase) throw new Error("Sin conexión.");
    // Cada receta después de las elaboraciones que usa: así la base las encuentra como elaboración.
    const ordered = orderByDependency(recipes);
    const total: Result = { stats: { recipes_created: 0, recipes_updated: 0, lines: 0, matched: 0, sub_recipes: 0, products_created: 0, allergens_added: 0 }, new_products: [], errors: [], applied: apply };
    for (let from = 0; from < ordered.length; from += BATCH) {
      const payload = {
        recipes: ordered.slice(from, from + BATCH).map((r) => ({
          name: r.name, kind: r.kind, category: r.category, yield_qty: r.yieldQty, yield_unit: r.yieldUnit,
          lines: r.lines.map((l) => ({ ingredient: l.ingredient, product: l.product, dimension: l.dimension, qty: l.qty, waste: l.waste, unit_price: l.unitPrice, allergens: l.allergens })),
        })),
      };
      const { data, error: err } = await supabase.rpc("import_recipes", { p_org: orgId, p_payload: payload, p_apply: apply, p_create_missing: create });
      if (err) {
        const done = apply && from > 0 ? ` Se han guardado ${plural(from, "receta", "recetas")}; vuelve a importar para terminar (las guardadas se actualizan, no se duplican).` : "";
        throw new Error((err.code === "57014" ? "La importación ha tardado demasiado." : "No se pudo comprobar el fichero.") + done);
      }
      const part = data as unknown as Result;
      for (const k of Object.keys(total.stats) as Array<keyof Stats>) total.stats[k] += part.stats[k];
      total.new_products = [...new Set([...(total.new_products ?? []), ...(part.new_products ?? [])])].sort((a, b) => a.localeCompare(b, "es"));
      total.errors.push(...part.errors.map((e) => ({ ...e, row: e.row + from })));
      total.applied = total.applied && part.applied;
      // Al aplicar, una tanda con errores no se guarda y no se sigue: se corrige y se repite.
      if (apply && !part.applied) break;
      if (apply) total.saved = from + payload.recipes.length;
    }
    return total;
  }

  /** Medida de cada producto que ya está en el catálogo: manda sobre la del escandallo. */
  async function catalogDimensions(): Promise<Map<string, IngredientDimension>> {
    const supabase = createClient();
    const dims = new Map<string, IngredientDimension>();
    if (!supabase) return dims;
    for (let from = 0; ; from += 1000) {
      const { data, error: err } = await supabase.from("products").select("name, dimension").eq("org_id", orgId).range(from, from + 999);
      if (err) throw new Error("No se pudo leer el catálogo.");
      for (const p of data ?? []) dims.set(normName(p.name), p.dimension as IngredientDimension);
      if ((data ?? []).length < 1000) return dims;
    }
  }

  async function onFiles(list: FileList | null) {
    setError("");
    const files = [...(list ?? [])];
    if (!files.length) return;
    if (files.some((f) => !/\.xlsx$/i.test(f.name))) return setError("Sube ficheros de Excel (.xlsx).");
    setStage({ kind: "checking" });
    try {
      const recipes: ImportRecipe[] = [];
      const notices: RecipeFileIssue[] = [];
      for (const f of files) {
        const sheets = await readXlsx(await f.arrayBuffer());
        const rows = Object.values(sheets).find((r) => r.length > 0) ?? [];
        // «Elaboraciones intermedias» → elaboraciones; «platos» o «finales» → platos; si no, según lo que rinden.
        const kind = /intermed|elaboraci|recetas? base|base/i.test(f.name) && !/final|plato/i.test(f.name) ? "elaboracion" : /final|plato|carta/i.test(f.name) ? "plato" : undefined;
        const parsed = parseEscandalloBook(rows, kind);
        if (!parsed.format) throw new Error(`«${f.name}» no tiene el formato de escandallo (bloques con «Descripción · Alérgenos/Comentario»).`);
        recipes.push(...parsed.recipes);
        notices.push(...parsed.issues);
      }
      const h = harmonizeIngredients(recipes, await catalogDimensions());
      notices.push(...h.dropped);
      if (h.kitchen.length) notices.push({ recipe: "", row: 0, message: `En el catálogo van de otra forma (por ejemplo, botellas del bar) y las recetas los usan por peso o volumen sin precio para convertir: se crean aparte para cocina ${h.kitchen.map((k) => `«${k}»`).join(", ")}.` });
      const result = await run(recipes, false, createMissing);
      setStage({ kind: "preview", files: files.map((f) => f.name), recipes, notices, result });
    } catch (err) {
      setStage({ kind: "idle" });
      setError(err instanceof Error && err.message !== "not_a_zip" ? err.message : "No se pudo leer el fichero.");
    }
  }

  async function recheck(create: boolean) {
    setCreateMissing(create);
    if (stage.kind !== "preview") return;
    setStage({ ...stage, kind: "applying" });
    try {
      setStage({ ...stage, kind: "preview", result: await run(stage.recipes, false, create) });
    } catch (err) {
      setStage({ ...stage, kind: "preview" });
      setError(err instanceof Error ? err.message : "No se pudo comprobar.");
    }
  }

  async function apply() {
    if (stage.kind !== "preview") return;
    setStage({ ...stage, kind: "applying" });
    try {
      const result = await run(stage.recipes, true, createMissing);
      if (!result.applied) {
        setStage({ ...stage, kind: "preview", result });
        return setError(result.saved
          ? `Se han guardado ${plural(result.saved, "receta", "recetas")}, pero otras tienen errores: corrígelos y vuelve a importar (las guardadas se actualizan, no se duplican).`
          : "Algo cambió mientras revisabas: mira los errores y vuelve a intentarlo.");
      }
      setStage({ kind: "done", files: stage.files, result });
    } catch (err) {
      setStage({ ...stage, kind: "preview" });
      setError(err instanceof Error ? err.message : "No se pudo aplicar.");
    }
  }

  function reset() {
    setStage({ kind: "idle" });
    setError("");
    setShowProducts(false);
    if (input.current) input.current.value = "";
  }

  const preview = stage.kind === "preview" || stage.kind === "applying" ? stage : null;
  const s = preview?.result.stats;

  return (
    <section className="import-recipes">
      <div className="import-section-head">
        <ChefHat size={18} />
        <div>
          <h2>Importar escandallos</h2>
          <p>Recetas y platos exportados de otro programa de cocina (libros «Escandallo»). Puedes subir a la vez el de elaboraciones y el de platos.</p>
        </div>
      </div>

      {!preview && stage.kind !== "done" && (
        <label className={`import-card import-drop ${stage.kind === "checking" ? "busy" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}>
          <h2>Sube los escandallos</h2>
          <p>{stage.kind === "checking" ? "Leyendo y comprobando…" : "Arrastra aquí los .xlsx o pulsa para elegirlos. Todavía no se guarda nada."}</p>
          <span className="catalog-primary">{stage.kind === "checking" ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} Elegir ficheros</span>
          <input ref={input} type="file" multiple accept=".xlsx" hidden onChange={(e) => void onFiles(e.target.files)} />
        </label>
      )}

      {error && <p className="import-error" role="alert">{error}</p>}

      {preview && s && (
        <section className="catalog-panel import-panel">
          <div className="import-panel-head">
            <div>
              <h2>Vista previa · {preview.files.join(" + ")}</h2>
              <p>
                {preview.result.errors.length
                  ? `${plural(preview.result.errors.length, "receta tiene", "recetas tienen")} errores: no se guarda nada mientras los haya.`
                  : `${plural(s.recipes_created, "receta nueva", "recetas nuevas")} y ${plural(s.recipes_updated, "que se actualiza", "que se actualizan")}, con ${plural(s.lines, "ingrediente", "ingredientes")}.`}
              </p>
            </div>
            <div className="import-actions">
              <button className="ghost-button" onClick={reset}><RotateCcw size={15} /> Otros ficheros</button>
              <button className="catalog-primary" disabled={preview.result.errors.length > 0 || stage.kind === "applying"} onClick={() => void apply()}>
                {stage.kind === "applying" ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} Importar {plural(s.recipes_created + s.recipes_updated, "receta", "recetas")}
              </button>
            </div>
          </div>
          <div className="import-stats">
            <div><span>Recetas</span><strong>{s.recipes_created} nuevas · {s.recipes_updated} se actualizan</strong><small>{plural(s.lines, "línea", "líneas")} de ingredientes</small></div>
            <div><span>Ingredientes del catálogo</span><strong>{plural(s.matched, "línea casada", "líneas casadas")}</strong><small>{plural(s.sub_recipes, "usa una elaboración", "usan una elaboración")}</small></div>
            <div><span>Ingredientes nuevos</span><strong>{plural(s.products_created, "producto", "productos")}</strong><small>con el precio del escandallo</small></div>
            <div><span>Alérgenos</span><strong>{plural(s.allergens_added, "se añade", "se añaden")}</strong><small>a sus productos</small></div>
          </div>
          <div className="import-list">
            <label className="check-option">
              <input type="checkbox" checked={createMissing} disabled={stage.kind === "applying"} onChange={(e) => void recheck(e.target.checked)} />
              Crear los ingredientes que no están en el catálogo, con el precio del escandallo
            </label>
            <p className="section-hint">
              Se crean en «Cocina › Ingredientes de escandallo», con su precio en el proveedor «Precios de escandallo», para que los costes salgan desde el primer día.
              El primer albarán real de cada uno pone el precio de verdad. Sin esta opción, las recetas con ingredientes desconocidos no se importan.
            </p>
            {(preview.result.new_products?.length ?? 0) > 0 && (
              <>
                <button className="filter-button" onClick={() => setShowProducts((v) => !v)}>{showProducts ? "Ocultar" : "Ver"} los {preview.result.new_products!.length} ingredientes nuevos</button>
                {showProducts && <p className="import-products">{preview.result.new_products!.join(" · ")}</p>}
              </>
            )}
          </div>
          {preview.result.errors.length > 0 && (
            <div className="import-list">
              <h3><AlertTriangle size={15} /> Errores</h3>
              <table><thead><tr><th>Receta</th><th>Qué pasa</th></tr></thead>
                <tbody>{preview.result.errors.slice(0, 200).map((e, i) => <tr key={i}><td>{e.label}</td><td>{e.message}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {preview.notices.length > 0 && (
            <div className="import-list">
              <h3>Avisos ({preview.notices.length})</h3>
              <p className="section-hint">No impiden importar: son datos del fichero original que conviene revisar después (recetas sin ingredientes, líneas sin cantidad o sin coste).</p>
              <table><thead><tr><th>Receta</th><th>Aviso</th></tr></thead>
                <tbody>{preview.notices.slice(0, 200).map((n, i) => <tr key={i}><td>{n.recipe || "—"}</td><td>{n.message}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {stage.kind === "done" && (
        <section className="catalog-panel import-panel import-done">
          <CheckCircle2 size={28} />
          <h2>Escandallos importados</h2>
          <p>
            {stage.files.join(" + ")} · {plural(stage.result.stats.recipes_created, "receta nueva", "recetas nuevas")}, {plural(stage.result.stats.recipes_updated, "actualizada", "actualizadas")}
            {stage.result.stats.products_created ? ` y ${plural(stage.result.stats.products_created, "ingrediente nuevo", "ingredientes nuevos")}` : ""}.
          </p>
          <div className="import-actions">
            <Link className="ghost-button" href="/escandallos">Ver escandallos</Link>
            <button className="ghost-button" onClick={reset}><Upload size={15} /> Importar más</button>
          </div>
        </section>
      )}
    </section>
  );
}
