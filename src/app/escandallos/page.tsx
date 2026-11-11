"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChefHat, CirclePlus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros, normalizeText } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { ALLERGENS, foodCostTone, type YieldUnit } from "@/lib/recipes";
import { RecipeEditor, type RecipeSummary } from "./recipe-editor";
import "../productos/productos.css";
import "../productos/product-editor.css";
import "./escandallos.css";
import { LoadingRows } from "@/components/ui/loading-rows";
import { TpvPricesBanner, TpvPricesDialog, useTpvPrices } from "./tpv-prices";

// Escandallos: platos y elaboraciones con su coste, food cost, margen y alérgenos. El coste sale del
// último precio de compra (la base de datos lo calcula: recipe_costs). Los importes, solo con «ve costes».

type Row = RecipeSummary & {
  portionCost: number | null;
  foodCostPct: number | null;
  margin: number | null;
  recommended: number | null;
  missing: number;
  change: number | null;
};

const SHORT = Object.fromEntries(ALLERGENS.map((a) => [a.id, a])) as Record<string, (typeof ALLERGENS)[number]>;
const pct = (n: number | null) => (n === null ? "—" : `${String(n).replace(".", ",")} %`);

export default function RecipesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"plato" | "elaboracion">("plato");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<string | "new" | null>(null);
  const perms = usePermissions();
  const seesCosts = perms?.seesCosts ?? false;
  const canEdit = perms ? ["owner", "admin", "manager"].includes(perms.role) : false;
  const tpv = useTpvPrices(orgId, seesCosts && canEdit);
  const [tpvOpen, setTpvOpen] = useState(false);

  async function reload() {
    const supabase = createClient();
    if (!supabase) return setError("Configura las variables de Supabase.");
    const { data: m } = await supabase.from("memberships").select("org_id").limit(1).maybeSingle();
    const org = m?.org_id ?? "";
    setOrgId(org);
    if (!org) return setRows([]);
    const [{ data: recipes, error: err }, { data: costs, error: costErr }] = await Promise.all([
      supabase.from("recipes").select("*").eq("org_id", org).order("name"),
      supabase.rpc("recipe_costs", { p_org: org }),
    ]);
    if (err || costErr) return setError("No se pudieron cargar los escandallos.");
    const byId = new Map((costs ?? []).map((c) => [c.recipe_id, c]));
    const n = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));
    setRows(
      (recipes ?? []).map((r) => {
        const c = byId.get(r.id);
        return {
          id: r.id,
          name: r.name,
          kind: r.kind,
          category: r.category ?? "",
          yieldQty: Number(r.yield_qty),
          yieldUnit: r.yield_unit as YieldUnit,
          salePrice: n(r.sale_price),
          vatRate: Number(r.vat_rate),
          target: Number(r.target_food_cost),
          active: r.active,
          reviewedAt: r.reviewed_at,
          unitCost: n(c?.unit_cost),
          allergens: c?.allergens ?? [],
          portionCost: n(c?.portion_cost),
          foodCostPct: n(c?.food_cost_pct),
          margin: n(c?.margin),
          recommended: n(c?.recommended_price),
          missing: c?.missing_prices ?? 0,
          change: n(c?.cost_change_pct),
        };
      }),
    );
    setError("");
  }

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      await reload();
    }
    void start();
  }, []);

  const all = rows ?? [];
  const visible = all
    .filter((r) => r.kind === kind && (showArchived ? !r.active : r.active))
    .filter((r) => !query || normalizeText(`${r.name} ${r.category}`).includes(normalizeText(query)));
  const counts = { plato: all.filter((r) => r.kind === "plato" && r.active).length, elaboracion: all.filter((r) => r.kind === "elaboracion" && r.active).length };
  const platos = all.filter((r) => r.kind === "plato" && r.active);
  const priced = platos.filter((r) => r.foodCostPct !== null);
  const avgFoodCost = priced.length ? priced.reduce((s, r) => s + r.foodCostPct!, 0) / priced.length : null;
  const overTarget = priced.filter((r) => r.foodCostPct! > r.target).length;
  const changed = all.filter((r) => r.active && r.change !== null && Math.abs(r.change) >= 5).length;
  const incomplete = all.filter((r) => r.active && r.missing > 0).length;

  const costCell = (r: Row) => {
    if (!seesCosts) return "—";
    if (r.kind === "plato" || r.yieldUnit === "racion") return r.portionCost === null ? "—" : `${euros(r.portionCost)} / ración`;
    const per = r.yieldUnit === "g" ? "kg" : r.yieldUnit === "ml" ? "l" : "ud";
    return r.unitCost === null ? "—" : `${euros(r.yieldUnit === "ud" ? r.unitCost : r.unitCost * 1000)} / ${per}`;
  };

  return (
    <main className="catalog-page">
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Gestión · Cocina y barra</p>
            <h1>Escandallos</h1>
            <p className="catalog-subtitle">Qué cuesta cada plato con los precios de compra de hoy, su food cost, su margen y sus alérgenos.</p>
          </div>
          {canEdit && <button className="catalog-primary" onClick={() => setOpen("new")}><CirclePlus size={17} /> Nueva receta</button>}
        </div>

        {seesCosts && (
          <div className="recipe-kpis">
            <div><span>Food cost medio</span><strong>{avgFoodCost === null ? "—" : pct(Math.round(avgFoodCost * 10) / 10)}</strong><small>{priced.length} platos con PVP</small></div>
            <div className={overTarget ? "warn" : ""}><span>Por encima del objetivo</span><strong>{overTarget}</strong><small>platos</small></div>
            <div className={changed ? "warn" : ""}><span>Coste cambiado</span><strong>{changed}</strong><small>±5 % o más desde su revisión</small></div>
            <div className={incomplete ? "warn" : ""}><span>Sin todos los precios</span><strong>{incomplete}</strong><small>recetas con coste parcial</small></div>
          </div>
        )}

        {seesCosts && canEdit && <TpvPricesBanner prices={tpv.prices} onOpen={() => setTpvOpen(true)} />}

        <div className="catalog-tabs">
          <button className={kind === "plato" ? "active" : undefined} onClick={() => setKind("plato")}>Platos <b>{counts.plato}</b></button>
          <button className={kind === "elaboracion" ? "active" : undefined} onClick={() => setKind("elaboracion")}>Elaboraciones <b>{counts.elaboracion}</b></button>
        </div>
        <section className="catalog-panel">
          <div className="catalog-toolbar">
            <div className="catalog-search">
              <Search size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o categoría" aria-label="Buscar receta" />
            </div>
            <button className="filter-button" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Ver activas" : "Ver archivadas"}</button>
          </div>
          <div className="recipe-table">
            <div className="recipe-row recipe-head">
              <span>Receta</span><span>Coste</span><span>{kind === "plato" ? "PVP" : "Rinde"}</span><span>{kind === "plato" ? "Food cost" : ""}</span><span>{kind === "plato" ? "Margen" : ""}</span><span>Alérgenos</span>
            </div>
            {error && <div className="catalog-empty"><strong>{error}</strong></div>}
            {!rows && !error && <LoadingRows label="Cargando escandallos" />}
            {rows && visible.map((r) => {
              const tone = foodCostTone(r.foodCostPct, r.target);
              return (
                <button key={r.id} className="recipe-row" onClick={() => setOpen(r.id)}>
                  <span className="recipe-name">
                    <span className="catalog-product-icon"><ChefHat size={15} /></span>
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.category || (r.kind === "plato" ? "Plato" : "Elaboración")}
                        {seesCosts && r.missing > 0 ? <em className="recipe-flag"> · {r.missing} sin precio</em> : null}
                        {seesCosts && r.change !== null && Math.abs(r.change) >= 5 ? <em className="recipe-flag"> · coste {r.change > 0 ? "+" : ""}{String(r.change).replace(".", ",")} %</em> : null}
                      </small>
                    </span>
                  </span>
                  <span>{costCell(r)}</span>
                  <span>{r.kind === "plato" ? (r.salePrice === null ? "—" : euros(r.salePrice)) : `${String(r.yieldQty).replace(".", ",")} ${r.yieldUnit === "racion" ? "rac." : r.yieldUnit}`}</span>
                  <span>{r.kind === "plato" && seesCosts ? <b className={`fc-pill ${tone}`}>{pct(r.foodCostPct)}</b> : ""}</span>
                  <span>{r.kind === "plato" && seesCosts && r.margin !== null ? euros(r.margin) : ""}</span>
                  <span className="recipe-allergen-row">
                    {r.allergens.length ? r.allergens.map((a) => <abbr key={a} title={SHORT[a]?.label ?? a} className="allergen-dot">{SHORT[a]?.short ?? a}</abbr>) : <small>—</small>}
                  </span>
                </button>
              );
            })}
            {rows && visible.length === 0 && (
              <div className="catalog-empty">
                <strong>{all.length === 0 ? "Aún no hay recetas" : "No hay recetas que coincidan"}</strong>
                <span>{all.length === 0 ? "Empieza por las elaboraciones base (salsas, fondos, masas) y después los platos que las usan." : "Prueba otra búsqueda o la otra pestaña."}</span>
              </div>
            )}
          </div>
        </section>
        {seesCosts && overTarget > 0 && (
          <p className="recipe-footnote"><AlertTriangle size={13} /> El PVP recomendado de cada plato (en su ficha) es el que deja su food cost en el objetivo.</p>
        )}
      </div>
      {tpvOpen && (
        <TpvPricesDialog
          prices={tpv.prices}
          onClose={() => setTpvOpen(false)}
          onApplied={() => { setTpvOpen(false); tpv.refresh(); void reload(); }}
        />
      )}
      {open && (
        <RecipeEditor
          recipeId={open === "new" ? null : open}
          orgId={orgId}
          recipes={all}
          seesCosts={seesCosts}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onChanged={() => void reload()}
        />
      )}
    </main>
  );
}
