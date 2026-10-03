#!/usr/bin/env python3
"""Importa a Nexo un inventario exportado de otro sistema (informes «Inventario» y «Almacén detallado» en .xlsx).

Uso:
    pip install openpyxl
    python3 scripts/importar_inventario.py <carpeta_xlsx> <correcciones.json> <salida.sql> [revision.csv]

Genera un script SQL (una transacción, repetible) que:
  · crea o reutiliza los productos con nombre limpio, familia → tipo, unidad de medida y formatos
    (botella, caja, kg…) coherentes con las convenciones de Nexo;
  · crea los espacios de almacén de cada local (Bebidas, Comida, Sala…);
  · carga el stock contado como APERTURA (movimiento inmutable) por local y espacio, valorado al coste
    unitario del inventario cuando lo hay;
  · deja cada producto en el surtido de los locales donde aparece.
y un CSV de revisión con cada producto, qué se ha decidido y por qué (para comprobarlo antes de aplicar).

Los datos del negocio (los .xlsx, las correcciones y el SQL generado) NO van al repositorio: contienen
costes y stock reales. Solo este conversor, que no lleva datos.

Reglas generales (las correcciones del JSON mandan sobre ellas):
  · Nombres: sin sufijos de local («Burrata O.»), sin códigos EAN ni lotes, sin mayúsculas sostenidas.
  · Bebidas con alcohol (destilados, licores, vermut, vino, champán): se miden en ml y se cuentan en
    botellas; la cantidad del export se lee como botellas aunque venga en «L», «Kg» o «cl» (el sistema de
    origen mezclaba unidades). Tamaño de botella del nombre («75cl», «Magnum») o 70 cl / 75 cl.
  · Refrescos, aguas, zumos, cervezas en botella o lata: por unidades, con caja de 24 (12 si es de 1 L,
    6 si es PET grande) como formato de compra supuesto. Barriles: en litros, con barril de 30 L.
  · Comida: kg y g → gramos con formato «Kg»; L → ml con formato «Litro»; el resto por unidades con el
    nombre de su envase (bolsa, bote, lata…). Sala y menaje: por unidades.
  · Cantidad: la del «Almacén detallado» si existe ese almacén; si no, la suma de las ubicaciones del
    «Inventario». Coste: «Coste real unitario» del inventario (por la unidad del export).
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import sys
import unicodedata
import warnings
from collections import Counter, defaultdict

warnings.filterwarnings("ignore")

# Familias de Nexo (mismo orden que el catálogo y la hoja de inventario).
FAMILIES = [
    "Destilados", "Champán", "Vinos", "Cervezas", "Refrescos y mixers", "Energéticas", "Aguas",
    "Zumos y siropes", "Café e infusiones", "Hielo", "Fruta y guarnición", "Snacks y picoteo", "Comida",
    "Sala y menaje", "Consumibles",
]

ALCOHOL_FAMILIES = {"Destilados", "Champán", "Vinos"}

# Familia del sistema de origen → (familia, tipo) de Nexo. El tipo de destilados sale del nombre.
SOURCE_FAMILY = {
    "licores": ("Destilados", None),
    "vinos tintos": ("Vinos", "Tinto"),
    "vinos blancos": ("Vinos", "Blanco"),
    "vinos rosados": ("Vinos", "Rosado"),
    "vinos espumosos": ("Vinos", "Espumoso"),
    "vino jerez": ("Vinos", "Generoso"),
    "vinos dulces": ("Vinos", "Dulce"),
    "tinto de verano": ("Refrescos y mixers", "Refrescos"),
    "cervezas": ("Cervezas", None),
    "refrescos": ("Refrescos y mixers", None),
    "aguas": ("Aguas", None),
    "zumos": ("Zumos y siropes", "Zumos"),
    "coctelería": ("Zumos y siropes", "Purés y siropes"),
    "cócteleria": ("Zumos y siropes", "Purés y siropes"),
    "bebidas": ("Refrescos y mixers", "Bebidas vegetales y batidos"),
    "infusiones y tes": ("Café e infusiones", "Infusiones"),
    "leches": ("Café e infusiones", "Leche"),
    "endulzantes": ("Café e infusiones", "Azúcar y endulzantes"),
    "carnes": ("Comida", "Carnes"),
    "carne roja": ("Comida", "Carnes"),
    "cerdo": ("Comida", "Carnes"),
    "aves": ("Comida", "Carnes"),
    "embutidos": ("Comida", "Carnes"),
    "pescado": ("Comida", "Pescado y marisco"),
    "pescado azul": ("Comida", "Pescado y marisco"),
    "marisco": ("Comida", "Pescado y marisco"),
    "verduras y hortalizas": ("Comida", "Verduras y hortalizas"),
    "vegetales": ("Comida", "Verduras y hortalizas"),
    "hierbas aromáticas": ("Comida", "Verduras y hortalizas"),
    "lácteos": ("Comida", "Lácteos, quesos y huevos"),
    "quesos": ("Comida", "Lácteos, quesos y huevos"),
    "huevos": ("Comida", "Lácteos, quesos y huevos"),
    "congelados": ("Comida", "Congelados y helados"),
    "helados": ("Comida", "Congelados y helados"),
    "productos secos": ("Comida", "Despensa"),
    "productos josa": ("Comida", "Repostería y texturizantes"),
    "especias": ("Comida", "Especias"),
    "salsas": ("Comida", "Salsas"),
    "aceites": ("Comida", "Aceites y vinagres"),
    "aceitunas": ("Comida", "Aceitunas y encurtidos"),
    "panes": ("Comida", "Pan"),
    "frutos secos": ("Snacks y picoteo", "Frutos secos"),
    "snacks": ("Snacks y picoteo", "Salados"),
    "cristaleria": ("Sala y menaje", "Cristalería"),
    "utensilios": ("Sala y menaje", "Cubertería y utensilios"),
    "menaje y vajilla": ("Sala y menaje", "Vajilla y menaje"),
    "herramientas cocteleria": ("Sala y menaje", "Cubertería y utensilios"),
    "cartas": ("Sala y menaje", "Cartas"),
    "consumibles": ("Consumibles", None),
}

SPIRIT_TYPES = [
    (r"\bginebra\b|\bgin\b", "Ginebra"), (r"\bron\b", "Ron"), (r"\bwhisk|\bbourbon\b", "Whisky"),
    (r"\bvodka\b", "Vodka"), (r"\btequila\b|\bmezcal\b", "Tequila"), (r"\bbrandy\b|\bcognac\b", "Brandy"),
    (r"\bvermu|\bvermut\b|\bmartini\b|\bcarpano\b", "Vermut"),
]

# Almacén del sistema de origen → espacio del local en Nexo.
AREAS = [("BEBIDAS", "Bebidas"), ("COMIDA", "Comida"), ("SALA", "Sala"), ("CRISTALERIA", "Menaje")]

MINOR_WORDS = {"de", "del", "la", "las", "el", "los", "y", "con", "sin", "al", "a", "en", "da", "do"}
KEEP_UPPER = {"IPA", "DO", "PX", "VDF", "XO", "DYC", "JB", "PET", "VSOP"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if unicodedata.category(c) != "Mn"))


def smart_title(name: str) -> str:
    """«VINO SAURA COGEVIENTOS» → «Vino Saura Cogevientos»; respeta lo ya escrito en minúsculas y las siglas."""
    out = []
    for i, w in enumerate(name.split()):
        core = re.sub(r"[^\w]", "", w)
        if not (len(core) >= 2 and core.isalpha() and core.isupper()) or core in KEEP_UPPER:
            out.append(w)
            continue
        low = w.lower()
        out.append(low if i > 0 and low in MINOR_WORDS else low[:1].upper() + low[1:])
    return " ".join(out)


def clean_name(raw: str) -> str:
    n = raw.strip()
    n = re.sub(r"\s[OP]\.$", "", n)                       # sufijo del local de origen
    n = re.sub(r"\s+LOTES?:.*$", "", n, flags=re.I)        # «LOTES: LOTE ALB.60108 (01/01/2050) U: 12»
    n = re.sub(r"\s\d{12,14}\b", "", n)                    # EAN
    n = re.sub(r"\sL\d{4,}-\d+\b", "", n)                  # lote «L25244-21»
    n = re.sub(r"\s\d{2,4}°", "", n)                       # graduación «14,5°»
    n = n.replace("´", "'").replace("’", "'")
    n = re.sub(r"\s{2,}", " ", n).strip(" .")
    return smart_title(n)


def bottle_ml(name: str, family: str) -> tuple[int, bool]:
    """Tamaño de botella en ml y si se ha supuesto."""
    t = name.lower().replace(",", ".")
    if "jeroboam" in t:
        return 3000, False
    if "magnum" in t:
        return 1500, False
    m = re.search(r"(\d+(?:\.\d+)?)\s?(cl|ml|l|lt|litros?)\b", t)
    if m:
        v, u = float(m.group(1)), m.group(2)
        ml = v * 10 if u == "cl" else v if u == "ml" else v * 1000
        if 100 <= ml <= 5000:
            return int(round(ml)), False
    m = re.search(r"\b0\.75\b|75\s?cl", t)
    if m:
        return 750, False
    return (700 if family == "Destilados" else 750), True


def spirit_type(name: str) -> str:
    t = name.lower()
    for pattern, kind in SPIRIT_TYPES:
        if re.search(pattern, t):
            return kind
    return "Licores"


def drink_type(name: str, family: str) -> str | None:
    t = name.lower()
    if family == "Refrescos y mixers":
        if "tónica" in t or "tonica" in t or "tonic" in t or "schweppes" in t or "ginger" in t:
            return "Tónicas"
        if "aquarius" in t:
            return "Isotónicas"
        if "nestea" in t or "fuze" in t:
            return "Té frío"
        return "Refrescos"
    if family == "Aguas":
        return "Con gas" if re.search(r"gas|perrier|pellegrino|vichy", t) else "Sin gas"
    if family == "Cervezas":
        return "Barril" if "barril" in t else "Botellín y tercio"
    return None


def area_for(almacen: str) -> str:
    for key, area in AREAS:
        if almacen.upper().startswith(key):
            return area
    return "Almacén"


def read_rows(folder: str) -> list[dict]:
    import openpyxl

    rows = []
    for path in sorted(glob.glob(os.path.join(folder, "*.xlsx"))):
        if "copia" in os.path.basename(path).lower():
            continue
        for ws in openpyxl.load_workbook(path, data_only=True).worksheets:
            values = [list(r) for r in ws.iter_rows(values_only=True)]
            meta, header = {}, None
            for i, r in enumerate(values):
                if len(r) > 2 and r[1] in ("Familia", "Producto") and r[2] in ("Producto", "Código"):
                    header = i
                    break
                if len(r) > 2 and r[1] and r[2] is not None:
                    meta[str(r[1])] = r[2]
            if header is None:
                continue
            hdr = [str(c).strip() if c else "" for c in values[header]]
            kind = "inventario" if hdr[1] == "Familia" else "almacen"
            for r in values[header + 1:]:
                rec = {hdr[j]: r[j] for j in range(len(hdr)) if hdr[j]}
                if not rec.get("Producto"):
                    continue
                rows.append({
                    "kind": kind,
                    "centro": str(meta.get("Centro de coste") or ""),
                    "almacen": str(meta.get("Almacén") or ""),
                    "familia": str(rec.get("Familia") or "").split("\n")[0].strip(),
                    "producto": str(rec["Producto"]).strip(),
                    "unidad": str(rec.get("Unidad") or "").strip(),
                    "qty": float((rec.get("Cant. real") if kind == "inventario" else rec.get("Total")) or 0),
                    "coste": float(rec["Coste real unitario"]) if kind == "inventario" and rec.get("Coste real unitario") else None,
                })
    return rows


def sql(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(round(v, 6)) if isinstance(v, float) else str(v)
    return "'" + str(v).replace("'", "''") + "'"


def build(folder: str, fixes: dict) -> tuple[list[dict], list[dict]]:
    rows = read_rows(folder)
    venues: dict[str, str] = fixes.get("locales", {})
    key_of = lambda text: norm(clean_name(text))
    merges = {key_of(k): v for k, v in fixes.get("fusionar", {}).items()}
    renames = {key_of(k): v for k, v in fixes.get("renombrar", {}).items()}
    existing = {key_of(k): v for k, v in fixes.get("existentes", {}).items()}
    family_fix = {key_of(k): v for k, v in fixes.get("familia", {}).items()}
    unit_fix = {key_of(k): v for k, v in fixes.get("medida", {}).items()}
    taken = {norm(n) for n in fixes.get("nombres_ocupados", [])}

    groups: dict[str, list[dict]] = defaultdict(list)
    canonical: dict[str, str] = {}
    for r in rows:
        name = clean_name(r["producto"])
        key = norm(name)
        for _ in range(5):  # «A → B → C»
            if key not in merges:
                break
            name = clean_name(merges[key])
            key = norm(name)
        if key in renames:
            name = renames[key]
        groups[key].append(r)
        canonical.setdefault(key, name)

    products, stock = [], []
    for key, rs in groups.items():
        name = canonical[key]
        src_family = Counter(r["familia"].lower() for r in rs if r["familia"]).most_common(1)
        family, kind = SOURCE_FAMILY.get(src_family[0][0], ("Comida", None)) if src_family else ("Comida", None)
        # Las correcciones se buscan por el nombre de origen y por el definitivo (tras renombrar).
        fix = lambda table: table.get(key) or table.get(norm(name))
        if fix(family_fix):
            ff = fix(family_fix)
            family, kind = ff[0], ff[1] if len(ff) > 1 else None
        if family == "Vinos" and re.match(r"(champagne|champán)\b", name.lower()):
            family, kind = "Champán", None
        if family == "Refrescos y mixers" and re.search(r"red bull", name.lower()):
            family, kind = "Energéticas", None
        if family == "Destilados":
            kind = spirit_type(name)
        kind = kind or drink_type(name, family)

        units = Counter(r["unidad"] for r in rs)
        unit = fix(unit_fix) or units.most_common(1)[0][0]
        notes, assumed = [], []
        packs: list[dict] = []
        # Cómo se mide y cómo se lee la cantidad del export: (dimensión, base por unidad del export).
        if family in ALCOHOL_FAMILIES:
            ml, guess = bottle_ml(name, family)
            dimension, read = "volume", "bottle"
            packs.append({"name": f"Botella {ml // 10 if ml % 10 == 0 else ml / 10:g} cl" if ml < 1000 else f"Botella {ml / 1000:g} L", "qty": ml, "count": True, "purchase": ml >= 1500})
            if ml < 1500:
                packs.append({"name": "Caja 6", "qty": ml * 6, "count": False, "purchase": True})
                assumed.append("caja de 6")
            if guess:
                assumed.append(f"botella de {ml // 10} cl")
            if unit not in ("Botella",):
                notes.append(f"en el origen venía en «{unit}»: se ha leído como botellas")
        elif family in ("Refrescos y mixers", "Energéticas", "Aguas", "Zumos y siropes", "Cervezas") and not re.search(r"barril", name.lower()) and not (family == "Zumos y siropes" and unit == "L" and "sirope" in name.lower()):
            dimension, read = "count", "unit"
            size, _ = bottle_ml(name, "Vinos")
            word = "Lata" if "lata" in name.lower() or unit == "Lata" else "Brik" if family == "Refrescos y mixers" and unit == "L" else "Botella"
            packs.append({"name": word, "qty": 1, "count": True, "purchase": False})
            if kind != "Purés y siropes" and kind != "Bebidas vegetales y batidos":
                box = 12 if 900 <= size < 1400 else 6 if size >= 1400 else 24
                packs.append({"name": f"{'Pack' if box == 6 else 'Caja'} {box}", "qty": box, "count": False, "purchase": True})
                assumed.append(f"{'pack' if box == 6 else 'caja'} de {box}")
            else:
                packs[0]["purchase"] = True
            if unit not in ("Botella", "Lata", "Uni"):
                notes.append(f"en el origen venía en «{unit}»: se ha leído como unidades")
        elif re.search(r"barril", name.lower()):
            dimension, read = "volume", "litre"
            packs.append({"name": "Barril 30 L", "qty": 30000, "count": True, "purchase": True})
            assumed.append("barril de 30 L")
        elif unit in ("Kg", "g"):
            dimension, read = "mass", "kg" if unit == "Kg" else "g"
            packs.append({"name": "Kg", "qty": 1000, "count": True, "purchase": True})
        elif unit in ("L", "cl", "ml"):
            dimension, read = "volume", {"L": "litre", "cl": "cl", "ml": "ml"}[unit]
            packs.append({"name": "Litro", "qty": 1000, "count": True, "purchase": True})
        else:
            dimension, read = "count", "unit"
            label = {"Uni": "Unidad", "Bote": "Bote", "Bolsa": "Bolsa", "Lata": "Lata", "Caja": "Caja", "Bandeja": "Bandeja", "Cubo": "Cubo", "Paquete": "Paquete", "Botella": "Botella"}.get(unit, "Unidad")
            packs.append({"name": label, "qty": 1, "count": True, "purchase": True})

        # Productos que ya están en Nexo: se reutilizan (no se duplica ni se cambia su unidad).
        existing_name = fix(existing)
        if not existing_name and norm(name) in taken:
            name = f"{name} ({'kg' if dimension == 'mass' else 'L' if dimension == 'volume' else 'ud'})"
        vat = 4 if kind == "Verduras y hortalizas" else 10 if family in ("Aguas", "Zumos y siropes", "Comida", "Café e infusiones") or (family == "Snacks y picoteo") else 21
        if family == "Café e infusiones" and kind == "Azúcar y endulzantes":
            vat = 10
        products.append({
            "key": key, "name": name, "existing": existing_name, "family": family, "type": kind,
            "dimension": dimension, "read": read, "packs": packs, "vat": vat,
            "sources": sorted({r["producto"] for r in rs}), "units": dict(units),
            "assumed": assumed, "notes": notes,
        })

        # Stock por local: el almacén detallado manda; si no hay, el inventario por ubicaciones.
        per_venue: dict[tuple[str, str], dict] = {}
        for r in rs:
            venue = venues.get(r["centro"])
            if not venue:
                continue
            k = (venue, area_for(r["almacen"]))
            e = per_venue.setdefault(k, {"alm": None, "inv": 0.0, "cost": None, "unit": r["unidad"]})
            if r["kind"] == "almacen":
                e["alm"] = (e["alm"] or 0.0) + r["qty"]
                e["alm_unit"] = r["unidad"]  # la cantidad del almacén va en SU unidad (kg o g)
            else:
                e["inv"] += r["qty"]
                if r["coste"] and not e["cost"]:
                    e["cost"] = r["coste"]
        for (venue, area), e in per_venue.items():
            qty = e["alm"] if e["alm"] is not None else e["inv"]
            unit = e.get("alm_unit", e["unit"]) if e["alm"] is not None else e["unit"]
            stock.append({"key": key, "venue": venue, "area": area, "qty": qty, "cost": e["cost"], "unit": unit})
    return products, stock


def to_base(p: dict, qty: float, unit: str) -> tuple[float, float]:
    """(cantidad en unidad base, factor) para un producto NUEVO; las botellas se resuelven en SQL."""
    read = p["read"]
    if read == "kg" and unit == "g":
        read = "g"
    if read == "g" and unit == "Kg":
        read = "kg"
    factor = {"kg": 1000, "g": 1, "litre": 1000, "cl": 10, "ml": 1, "unit": 1, "bottle": 0}[read]
    return qty * factor if factor else qty, factor


def render(products: list[dict], stock: list[dict], fixes: dict) -> str:
    org = fixes.get("organizacion", "Parador Eventos")
    reason = fixes.get("motivo", "Inventario inicial importado")
    at = fixes.get("fecha", "2026-09-30 23:59:59+02")
    by_key = {p["key"]: p for p in products}
    out = [
        "-- Generado por scripts/importar_inventario.py. Contiene datos del negocio: NO subir al repositorio.",
        "-- Requiere las migraciones hasta la 0018. Una transacción; repetirlo no duplica nada.",
        "begin;",
        "create temp table imp_prod (key text primary key, name text, existing text, family text, type text, dimension unit_dimension, vat numeric, notes text) on commit drop;",
        "create temp table imp_pack (key text, name text, qty numeric, is_count boolean, is_purchase boolean) on commit drop;",
        "create temp table imp_stock (key text, venue text, area text, qty numeric, bottles boolean, cost numeric, cost_per_bottle boolean) on commit drop;",
    ]
    vals = []
    for p in products:
        note = "; ".join(filter(None, [
            ("Supuesto: " + ", ".join(p["assumed"])) if p["assumed"] else "",
            "; ".join(p["notes"]),
            "Origen: " + " | ".join(p["sources"]),
        ]))
        vals.append(f"({sql(p['key'])},{sql(p['name'])},{sql(p['existing'])},{sql(p['family'])},{sql(p['type'])},{sql(p['dimension'])},{p['vat']},{sql(note[:900])})")
    out.append("insert into imp_prod values\n" + ",\n".join(vals) + ";")
    vals = [f"({sql(p['key'])},{sql(k['name'])},{k['qty']},{sql(k['count'])},{sql(k['purchase'])})" for p in products for k in p["packs"]]
    out.append("insert into imp_pack values\n" + ",\n".join(vals) + ";")
    vals = []
    for s in stock:
        p = by_key[s["key"]]
        bottles = p["read"] == "bottle"
        qty, factor = to_base(p, s["qty"], s["unit"])
        cost = s["cost"]
        # Coste del export por su unidad (kg, L, botella, ud) → por unidad base (o por botella).
        cost_base = None if cost is None else (cost if bottles else cost / factor if factor else cost)
        vals.append(f"({sql(s['key'])},{sql(s['venue'])},{sql(s['area'])},{round(qty, 4)},{sql(bottles)},{sql(cost_base)},{sql(bottles)})")
    out.append("insert into imp_stock values\n" + ",\n".join(vals) + ";")
    out.append(SQL_BODY.replace("{{ORG}}", org.replace("'", "''")).replace("{{REASON}}", reason.replace("'", "''")).replace("{{AT}}", at))
    return "\n".join(out)


SQL_BODY = r"""
do $$
declare
  v_org uuid := (select id from organizations where name = '{{ORG}}');
  r record;
  v_family uuid;
  v_cat uuid;
  v_product uuid;
begin
  if v_org is null then raise exception 'No existe la organización {{ORG}}'; end if;
  if to_regprocedure('catalog_health(uuid)') is null then raise exception 'Aplica antes la migración 0018'; end if;

  -- Locales y espacios.
  if exists (select 1 from imp_stock s where not exists (select 1 from locations l where l.org_id = v_org and l.name = s.venue)) then
    raise exception 'Hay locales del inventario que no existen en Nexo: %',
      (select string_agg(distinct venue, ', ') from imp_stock s where not exists (select 1 from locations l where l.org_id = v_org and l.name = s.venue));
  end if;
  insert into storage_areas (location_id, name, sort_order)
  select distinct l.id, s.area, 10 from imp_stock s join locations l on l.org_id = v_org and l.name = s.venue
  on conflict (location_id, name) do nothing;

  -- Familias y tipos.
  for r in select distinct family, type from imp_prod loop
    insert into categories (org_id, parent_id, name, sort_order)
    values (v_org, null, r.family, coalesce(array_position(array['Destilados','Champán','Vinos','Cervezas','Refrescos y mixers','Energéticas','Aguas','Zumos y siropes','Café e infusiones','Hielo','Fruta y guarnición','Snacks y picoteo','Comida','Sala y menaje','Consumibles'], r.family), 99))
    on conflict (org_id, parent_id, name) do update set sort_order = excluded.sort_order
    returning id into v_family;
    if r.type is not null then
      insert into categories (org_id, parent_id, name) values (v_org, v_family, r.type)
      on conflict (org_id, parent_id, name) do nothing;
    end if;
  end loop;

  -- Productos: los que ya existen se reutilizan; los nuevos se crean con sus formatos.
  for r in select * from imp_prod loop
    if r.existing is not null then
      select id into v_product from products where org_id = v_org and name = r.existing;
      if v_product is null then raise exception 'No existe el producto «%» (correcciones: existentes)', r.existing; end if;
      update products set active = true where id = v_product;
      continue;
    end if;
    select c.id into v_cat from categories c join categories f on f.id = c.parent_id
    where c.org_id = v_org and f.name = r.family and c.name = r.type;
    if v_cat is null then select id into v_cat from categories where org_id = v_org and parent_id is null and name = r.family; end if;
    insert into products (org_id, category_id, name, dimension, notes, vat_rate)
    values (v_org, v_cat, r.name, r.dimension, r.notes, r.vat)
    on conflict (org_id, name) do update set category_id = excluded.category_id, notes = excluded.notes, active = true
    returning id into v_product;
    insert into product_packs (product_id, name, qty_base, is_count_default, is_purchase_default)
    select v_product, k.name, k.qty, k.is_count, k.is_purchase from imp_pack k where k.key = r.key
    on conflict (product_id, name) do nothing;
  end loop;

  -- Apertura por local y espacio (las botellas se pasan a ml con el formato de conteo del producto).
  insert into stock_movements (org_id, location_id, product_id, area_id, type, qty, unit_cost, reason, occurred_at)
  select v_org, l.id, p.id, a.id, 'opening',
         case when s.bottles and p.dimension <> 'count' then s.qty * cu.qty_base else s.qty end,
         case when s.cost is null then null
              when s.bottles and p.dimension <> 'count' then s.cost / cu.qty_base
              else s.cost end,
         '{{REASON}}', '{{AT}}'::timestamptz
  from imp_stock s
  join imp_prod ip on ip.key = s.key
  join products p on p.org_id = v_org and p.name = coalesce(ip.existing, ip.name)
  join locations l on l.org_id = v_org and l.name = s.venue
  join storage_areas a on a.location_id = l.id and a.name = s.area
  left join lateral (
    select k.qty_base from product_packs k where k.product_id = p.id and k.active and k.is_count_default limit 1
  ) cu on true
  where s.qty > 0
    and (not s.bottles or p.dimension = 'count' or cu.qty_base is not null)
    and not exists (
      select 1 from stock_movements m
      where m.product_id = p.id and m.location_id = l.id and m.type = 'opening' and m.reason = '{{REASON}}'
    );

  -- Surtido: lo que aparece en el inventario de un local (aunque esté a cero) se cuenta allí.
  insert into location_products (location_id, product_id)
  select distinct l.id, p.id
  from imp_stock s
  join imp_prod ip on ip.key = s.key
  join products p on p.org_id = v_org and p.name = coalesce(ip.existing, ip.name)
  join locations l on l.org_id = v_org and l.name = s.venue
  on conflict (location_id, product_id) do update set active = true;

  raise notice 'Importados % productos (% nuevos), % aperturas con stock.',
    (select count(*) from imp_prod), (select count(*) from imp_prod where existing is null),
    (select count(*) from imp_stock where qty > 0);
end $$;

commit;
"""


def main() -> None:
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    folder, fixes_path, out_path = sys.argv[1:4]
    fixes = json.load(open(fixes_path, encoding="utf-8"))
    products, stock = build(folder, fixes)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(render(products, stock, fixes))
    if len(sys.argv) > 4:
        with open(sys.argv[4], "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["Producto en Nexo", "Ya existía", "Familia", "Tipo", "Se mide en", "Formatos", "Supuesto", "Notas", "Nombres en el origen"])
            for p in sorted(products, key=lambda x: (FAMILIES.index(x["family"]) if x["family"] in FAMILIES else 99, x["type"] or "", x["name"])):
                w.writerow([
                    p["existing"] or p["name"], "sí" if p["existing"] else "", p["family"], p["type"] or "",
                    {"volume": "ml", "mass": "g", "count": "ud"}[p["dimension"]],
                    " · ".join(f"{k['name']}" for k in p["packs"]), ", ".join(p["assumed"]), "; ".join(p["notes"]),
                    " | ".join(p["sources"]),
                ])
    print(f"{len(products)} productos · {sum(1 for s in stock if s['qty'] > 0)} existencias con cantidad → {out_path}")


if __name__ == "__main__":
    main()
