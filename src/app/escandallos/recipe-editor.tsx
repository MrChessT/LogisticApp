"use client";

import { useEffect, useMemo, useState } from "react";
import Decimal from "decimal.js";
import { Archive, ArchiveRestore, BadgeCheck, CirclePlus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros } from "@/lib/format";
import type { LookupProduct } from "@/lib/product-lookup";
import { ProductPicker } from "@/components/product-picker/product-picker";
import type { UnitDimension } from "@/lib/units";
import { LoadingRows } from "@/components/ui/loading-rows";
import {
  ALLERGEN_LABEL, bestUnit, economics, foodCostTone, lineCost, lineQtyBase, productUnits, subRecipeUnits, wastePct, YIELD_UNITS,
  type LineUnit, type YieldUnit,
} from "@/lib/recipes";

// Editor de una receta: datos, ingredientes (productos o elaboraciones) y su escandallo en vivo.
// Al guardar, la base de datos recalcula y valida (sin ciclos, misma organización).

export type RecipeSummary = {
  id: string;
  name: string;
  kind: "plato" | "elaboracion";
  category: string;
  yieldQty: number;
  yieldUnit: YieldUnit;
  salePrice: number | null;
  vatRate: number;
  target: number;
  active: boolean;
  reviewedAt: string | null;
  unitCost: number | null;
  allergens: string[];
};

type LineDraft = {
  key: string;
  product: { id: string; name: string; dimension: UnitDimension } | null;
  subId: string;
  amount: string;
  unitId: string;
  waste: string;
};

let seq = 0;
const newKey = () => `l${++seq}`;
const emptyLine = (): LineDraft => ({ key: newKey(), product: null, subId: "", amount: "", unitId: "", waste: "" });
const dec = (s: string) => {
  const t = s.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(t) ? new Decimal(t) : null;
};
const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export function RecipeEditor({ recipeId, orgId, recipes, seesCosts, canEdit, onClose, onChanged }: {
  recipeId: string | null; orgId: string; recipes: RecipeSummary[]; seesCosts: boolean; canEdit: boolean;
  onClose: () => void; onChanged: () => void;
}) {
  const existing = recipes.find((r) => r.id === recipeId) ?? null;
  const [name, setName] = useState(existing?.name ?? "");
  const [kind, setKind] = useState<"plato" | "elaboracion">(existing?.kind ?? "plato");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [yieldQty, setYieldQty] = useState(text(existing?.yieldQty ?? 1));
  const [yieldUnit, setYieldUnit] = useState<YieldUnit>(existing?.yieldUnit ?? "racion");
  const [salePrice, setSalePrice] = useState(text(existing?.salePrice));
  const [vatRate, setVatRate] = useState(text(existing?.vatRate ?? 10));
  const [target, setTarget] = useState(text(existing?.target ?? 30));
  const [instructions, setInstructions] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [unitCosts, setUnitCosts] = useState<Map<string, number | null>>(new Map());
  const [productAllergens, setProductAllergens] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(!!recipeId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Subrecetas posibles: elaboraciones y platos activos, menos esta misma.
  const subOptions = recipes.filter((r) => r.id !== recipeId && r.active);
  const subById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  useEffect(() => {
    if (!recipeId) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      if (!supabase) return;
      const [{ data: r }, { data: ls, error: err }] = await Promise.all([
        supabase.from("recipes").select("instructions").eq("id", recipeId).single(),
        supabase.from("recipe_lines").select("id, product_id, sub_recipe_id, qty, waste_pct, sort_order, products(name, dimension)").eq("recipe_id", recipeId).order("sort_order"),
      ]);
      if (cancelled) return;
      if (err) {
        setError("No se pudo cargar la receta.");
        setLoading(false);
        return;
      }
      setInstructions(r?.instructions ?? "");
      setLines(
        (ls ?? []).map((l) => {
          const p = l.products as unknown as { name: string; dimension: UnitDimension } | null;
          const sub = l.sub_recipe_id ? subById.get(l.sub_recipe_id) : undefined;
          const units = p ? productUnits(p.dimension) : subRecipeUnits(sub?.yieldUnit ?? "racion");
          const unit = bestUnit(units, Number(l.qty));
          return {
            key: newKey(),
            product: l.product_id && p ? { id: l.product_id, name: p.name, dimension: p.dimension } : null,
            subId: l.sub_recipe_id ?? "",
            amount: text(new Decimal(l.qty).div(unit.factor).toDecimalPlaces(4).toNumber()),
            unitId: unit.id,
            waste: Number(l.waste_pct) ? text(Number(l.waste_pct)) : "",
          };
        }),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId, subById]);

  // Coste por unidad base y alérgenos de los productos de las líneas.
  const productIds = useMemo(() => [...new Set(lines.map((l) => l.product?.id).filter(Boolean) as string[])].sort(), [lines]);
  const productKey = productIds.join(",");
  useEffect(() => {
    if (productIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      if (!supabase) return;
      const [costs, allergens] = await Promise.all([
        seesCosts ? supabase.rpc("product_unit_costs", { p_products: productIds }) : Promise.resolve({ data: [] as Array<{ product_id: string; unit_cost: number | null }> }),
        supabase.from("product_allergens").select("product_id, allergen").in("product_id", productIds),
      ]);
      if (cancelled) return;
      setUnitCosts(new Map((costs.data ?? []).map((c) => [c.product_id, c.unit_cost === null ? null : Number(c.unit_cost)])));
      const byProduct = new Map<string, string[]>();
      for (const a of allergens.data ?? []) byProduct.set(a.product_id, [...(byProduct.get(a.product_id) ?? []), a.allergen]);
      setProductAllergens(byProduct);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey, seesCosts]);

  function unitsOf(l: LineDraft): LineUnit[] {
    if (l.product) return productUnits(l.product.dimension);
    const sub = subById.get(l.subId);
    return subRecipeUnits(sub?.yieldUnit ?? "racion");
  }
  const unitOf = (l: LineDraft) => unitsOf(l).find((u) => u.id === l.unitId) ?? unitsOf(l)[0]!;
  const patch = (key: string, p: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  // Escandallo en vivo.
  const computed = lines.map((l) => {
    const qty = lineQtyBase(l.amount, unitOf(l));
    const waste = wastePct(l.waste);
    const unitCost = l.product ? unitCosts.get(l.product.id) : subById.get(l.subId)?.unitCost;
    const cost = qty && waste ? lineCost(qty, waste, unitCost === null || unitCost === undefined ? null : new Decimal(unitCost)) : null;
    const filled = !!(l.product || l.subId);
    return { line: l, qty, waste, cost, filled, missingPrice: filled && qty !== null && cost === null };
  });
  const total = computed.reduce((sum, c) => (c.cost ? sum.plus(c.cost) : sum), new Decimal(0));
  const yq = dec(yieldQty);
  const eco = yq && yq.gt(0)
    ? economics({ total, yieldQty: yq, yieldUnit, salePrice: dec(salePrice), vatRate: dec(vatRate) ?? new Decimal(10), targetPct: dec(target) ?? new Decimal(30) })
    : null;
  const allergens = [...new Set(lines.flatMap((l) => (l.product ? productAllergens.get(l.product.id) ?? [] : subById.get(l.subId)?.allergens ?? [])))].sort();
  const missing = computed.filter((c) => c.missingPrice).length;
  const tone = foodCostTone(eco?.foodCostPct ? eco.foodCostPct.toNumber() : null, Number(dec(target) ?? 30));

  function validate(): string {
    if (!name.trim()) return "Ponle un nombre a la receta.";
    if (!yq || yq.lte(0)) return "Indica cuánto rinde (mayor que 0).";
    if (salePrice.trim() && !dec(salePrice)) return "El PVP no es un número válido.";
    if (!dec(vatRate) || dec(vatRate)!.gt(30)) return "El IVA va de 0 a 30.";
    if (!dec(target) || dec(target)!.lte(0) || dec(target)!.gte(100)) return "El food cost objetivo va de 1 a 99 %.";
    for (const c of computed) {
      if (!c.filled && !c.line.amount.trim()) continue;
      if (!c.filled) return "Hay una línea sin ingrediente: elige un producto o una elaboración, o bórrala.";
      if (!c.qty) return "Revisa las cantidades: tienen que ser números mayores que 0.";
      if (!c.waste) return "La merma va de 0 a 94 %.";
    }
    return "";
  }

  async function save() {
    const problem = validate();
    if (problem) return setError(problem);
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    const row = {
      org_id: orgId,
      name: name.trim(),
      kind,
      category: category.trim() || null,
      yield_qty: yq!.toNumber(),
      yield_unit: yieldUnit,
      sale_price: dec(salePrice)?.toNumber() ?? null,
      vat_rate: dec(vatRate)!.toNumber(),
      target_food_cost: dec(target)!.toNumber(),
      instructions: instructions.trim() || null,
    };
    let id = recipeId;
    if (id) {
      const { error: err } = await supabase.from("recipes").update(row).eq("id", id);
      if (err) return fail(err);
    } else {
      const { data, error: err } = await supabase.from("recipes").insert(row).select("id").single();
      if (err || !data) return fail(err);
      id = data.id;
    }
    // Las líneas se guardan de nuevo enteras: es una receta, no un historial.
    const { error: delErr } = await supabase.from("recipe_lines").delete().eq("recipe_id", id!);
    if (delErr) return fail(delErr);
    const rows = computed
      .filter((c) => c.filled && c.qty)
      .map((c, i) => ({
        recipe_id: id!,
        product_id: c.line.product?.id ?? null,
        sub_recipe_id: c.line.product ? null : c.line.subId,
        qty: c.qty!.toNumber(),
        waste_pct: c.waste!.toNumber(),
        sort_order: i + 1,
      }));
    if (rows.length) {
      const { error: insErr } = await supabase.from("recipe_lines").insert(rows);
      if (insErr) return fail(insErr);
    }
    setSaving(false);
    onChanged();
    onClose();
  }

  function fail(err: { code?: string; message?: string } | null) {
    setSaving(false);
    if (err?.code === "23505") return setError("Ya hay una receta con ese nombre.");
    if (err?.message?.includes("recipe_cycle")) return setError("Una de las elaboraciones ya usa esta receta: no puede ser ingrediente suyo.");
    if (err?.code === "42501") return setError("No tienes permiso para cambiar recetas.");
    setError("No se pudo guardar la receta.");
  }

  async function markReviewed() {
    if (!recipeId) return;
    const { error: err } = (await createClient()?.rpc("mark_recipe_reviewed", { p_recipe: recipeId })) ?? { error: null };
    if (err) return setError("No se pudo marcar como revisada.");
    setNotice("Revisada: si sube algún precio, la receta avisará de cuánto cambia su coste.");
    onChanged();
  }

  async function toggleActive() {
    if (!existing) return;
    const { error: err } = (await createClient()?.from("recipes").update({ active: !existing.active }).eq("id", existing.id)) ?? { error: null };
    if (err) return setError("No se pudo cambiar.");
    onChanged();
    onClose();
  }

  async function remove() {
    if (!existing) return;
    const { error: err } = (await createClient()?.from("recipes").delete().eq("id", existing.id)) ?? { error: null };
    if (err) {
      setConfirmDelete(false);
      return setError(err.code === "23503" ? "Esta elaboración se usa en otras recetas: quítala de ellas o archívala." : "No se pudo eliminar.");
    }
    onChanged();
    onClose();
  }

  const money = (v: Decimal | null | undefined, digits = 2) => (v ? euros(v.toDecimalPlaces(digits).toNumber()) : "—");
  const perUnitLabel = yieldUnit === "racion" ? "ración" : yieldUnit === "g" ? "kg" : yieldUnit === "ml" ? "litro" : "ud";
  const perUnitValue = eco ? (yieldUnit === "g" || yieldUnit === "ml" ? eco.perYieldUnit.mul(1000) : eco.perYieldUnit) : null;

  return (
    <div className="modal-layer editor-layer" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <section className="product-editor recipe-editor" role="dialog" aria-modal="true" aria-label={existing ? `Receta ${existing.name}` : "Nueva receta"}>
        <header className="editor-header">
          <div>
            <p className="eyebrow">{existing ? (existing.kind === "plato" ? "Plato" : "Elaboración") : "Nueva receta"}{existing && !existing.active ? " · archivada" : ""}</p>
            <h2>{name.trim() || "Receta sin nombre"}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>

        <div className="editor-body recipe-body">
          {loading ? (
            <LoadingRows label="Cargando receta" />
          ) : (
            <>
              <div className="editor-grid recipe-fields">
                <label className="span-2">Nombre<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={!canEdit} placeholder="Ej. Croquetas de jamón" /></label>
                <label>Tipo
                  <select value={kind} disabled={!canEdit} onChange={(e) => { const k = e.target.value as "plato" | "elaboracion"; setKind(k); if (k === "plato") setYieldUnit("racion"); }}>
                    <option value="plato">Plato (se vende)</option>
                    <option value="elaboracion">Elaboración (se usa en otras)</option>
                  </select>
                </label>
                <label>Categoría<input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} disabled={!canEdit} placeholder="Entrantes, Salsas, Postres…" /></label>
                <label>Rinde
                  <span className="recipe-inline">
                    <input value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} inputMode="decimal" disabled={!canEdit} aria-label="Cantidad que rinde" />
                    <select value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value as YieldUnit)} disabled={!canEdit || kind === "plato"} aria-label="Unidad que rinde">
                      {YIELD_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </select>
                  </span>
                </label>
                {kind === "plato" && (
                  <>
                    <label>PVP (con IVA)<input value={salePrice} onChange={(e) => setSalePrice(e.target.value)} inputMode="decimal" disabled={!canEdit} placeholder="12,50" /></label>
                    <label>IVA %<input value={vatRate} onChange={(e) => setVatRate(e.target.value)} inputMode="decimal" disabled={!canEdit} /></label>
                    <label>Food cost objetivo %<input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" disabled={!canEdit} /></label>
                  </>
                )}
              </div>

              <div className="editor-section">
                <p className="facet-title">Ingredientes</p>
                <div className="recipe-lines">
                  <div className="recipe-line recipe-line-head" aria-hidden="true">
                    <span>Ingrediente</span><span>Cantidad</span><span>Merma %</span><span>{seesCosts ? "Coste" : ""}</span><span />
                  </div>
                  {computed.map(({ line: l, cost, missingPrice }) => (
                    <div key={l.key} className="recipe-line">
                      <div className="recipe-line-what">
                        {l.product || l.subId ? (
                          <span className="recipe-chosen">
                            <b>{l.product?.name ?? subById.get(l.subId)?.name ?? "?"}</b>
                            <small>{l.product ? "Producto" : "Elaboración"}{missingPrice && seesCosts ? " · sin precio de compra" : ""}</small>
                          </span>
                        ) : canEdit ? (
                          <span className="recipe-choose">
                            <ProductPicker
                              value={null}
                              ariaLabel="Buscar producto"
                              placeholder="Buscar producto"
                              onChange={(p: LookupProduct | null) => p && patch(l.key, { product: { id: p.id, name: p.name, dimension: p.dimension }, subId: "", unitId: productUnits(p.dimension)[0]!.id })}
                            />
                            {subOptions.length > 0 && (
                              <select value="" onChange={(e) => { const sub = subById.get(e.target.value); if (sub) patch(l.key, { subId: sub.id, product: null, unitId: subRecipeUnits(sub.yieldUnit)[0]!.id }); }} aria-label="O elegir una elaboración">
                                <option value="">o una elaboración…</option>
                                {subOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                              </select>
                            )}
                          </span>
                        ) : null}
                      </div>
                      <span className="recipe-inline">
                        <input value={l.amount} onChange={(e) => patch(l.key, { amount: e.target.value })} inputMode="decimal" disabled={!canEdit} aria-label="Cantidad" />
                        <select value={unitOf(l).id} onChange={(e) => patch(l.key, { unitId: e.target.value })} disabled={!canEdit} aria-label="Unidad">
                          {unitsOf(l).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                        </select>
                      </span>
                      <input value={l.waste} onChange={(e) => patch(l.key, { waste: e.target.value })} inputMode="decimal" placeholder="0" disabled={!canEdit} aria-label="Merma de limpieza %" />
                      <span className="recipe-line-cost">{seesCosts ? (cost ? money(cost, 3) : missingPrice ? "sin precio" : "—") : ""}</span>
                      {canEdit ? (
                        <button className="icon-button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Quitar ingrediente"><Trash2 size={14} /></button>
                      ) : <span />}
                    </div>
                  ))}
                  {lines.length === 0 && <p className="section-hint">Sin ingredientes todavía.</p>}
                </div>
                {canEdit && <button className="ghost-button recipe-add" onClick={() => setLines((ls) => [...ls, emptyLine()])}><CirclePlus size={14} /> Añadir ingrediente</button>}
                <p className="section-hint">Cantidades limpias (lo que va al plato). La merma es lo que se pierde al limpiar o cocinar: un 20 % encarece ese ingrediente un 25 %.</p>
              </div>

              {seesCosts && eco && (
                <div className="recipe-economics">
                  <div><span>Coste total</span><strong>{money(eco.total)}</strong><small>{missing ? `${missing} sin precio: el coste es parcial` : "todo con precio"}</small></div>
                  <div><span>Coste por {perUnitLabel}</span><strong>{money(perUnitValue, yieldUnit === "racion" ? 2 : 3)}</strong><small>{text(yq?.toNumber())} {YIELD_UNITS.find((u) => u.id === yieldUnit)?.label}</small></div>
                  {kind === "plato" && (
                    <>
                      <div className={`fc ${tone}`}><span>Food cost</span><strong>{eco.foodCostPct ? `${eco.foodCostPct.toDecimalPlaces(1).toString().replace(".", ",")} %` : "—"}</strong><small>objetivo {target || "30"} %</small></div>
                      <div><span>Margen por ración</span><strong>{money(eco.margin)}</strong><small>sobre {money(eco.net)} sin IVA</small></div>
                      <div><span>PVP recomendado</span><strong>{money(eco.recommended)}</strong><small>para el {target || "30"} % con IVA</small></div>
                    </>
                  )}
                </div>
              )}

              <div className="editor-section">
                <p className="facet-title">Alérgenos</p>
                {allergens.length ? (
                  <div className="recipe-allergens">{allergens.map((a) => <span key={a} className="allergen-chip">{ALLERGEN_LABEL[a] ?? a}</span>)}</div>
                ) : (
                  <p className="section-hint">Ninguno declarado en sus ingredientes. Los alérgenos se marcan en la ficha de cada producto (pestaña «Alérgenos»).</p>
                )}
              </div>

              <div className="editor-section">
                <p className="facet-title">Elaboración</p>
                <textarea className="recipe-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={8000} disabled={!canEdit} placeholder="Pasos, emplatado, conservación…" rows={5} />
              </div>
            </>
          )}
        </div>

        {error && <p className="editor-message error">{error}</p>}
        {notice && <p className="editor-message">{notice}</p>}
        {canEdit && (
          <footer className="editor-footer">
            {existing ? (
              confirmDelete ? (
                <div className="delete-confirm">
                  <span>¿Eliminar «{existing.name}»?</span>
                  <button className="danger-button" onClick={() => void remove()}>Sí, eliminar</button>
                  <button className="ghost-button" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                </div>
              ) : (
                <div className="footer-left">
                  <button className="ghost-button danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Eliminar</button>
                  <button className="ghost-button" onClick={() => void toggleActive()}>{existing.active ? <><Archive size={14} /> Archivar</> : <><ArchiveRestore size={14} /> Restaurar</>}</button>
                  {seesCosts && <button className="ghost-button" onClick={() => void markReviewed()} title="Guarda el coste de hoy para avisar si cambia"><BadgeCheck size={14} /> Marcar revisada</button>}
                </div>
              )
            ) : <span />}
            <div className="footer-right">
              <button className="catalog-primary" disabled={saving || loading} onClick={() => void save()}>{saving ? "Guardando..." : existing ? "Guardar cambios" : "Crear receta"}</button>
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
