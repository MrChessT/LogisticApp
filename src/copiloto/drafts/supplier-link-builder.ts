// Proveedor asociado a un producto desde el chat («el proveedor de la tónica es Makro», «asocia Makro a la coca»).
// Es una fila de precios de proveedor para el formato de compra, todavía sin precio: el precio entra con la
// primera factura o el primer pedido, como al añadirlo en la ficha del producto. Solo encargados; decide la base.
import type { DocumentDraft } from "../contract/index";
import { hasRole, type Product, type SessionContext } from "../domain";
import { mentionedSupplier } from "../entities/catalog-parser";
import { tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { productsNamed } from "../agent/product-facts";
import { draftBase, type BuildResult } from "./builder";
import { validateDraft } from "./schemas";

/** Palabras que rodean al proveedor y al producto en la frase («el proveedor de la tónica es…»): no son el producto. */
const NOT_PRODUCT = new Set(
  "el la los las lo de del al a en y que pon ponlo asocia asociar asocialo anade anadir agrega agregar como para proveedor proveedores suministra trae traen nos es son un una sea sera ahora".split(" "),
);

interface LinkInput {
  message: string;
  ctx: SessionContext;
  overrides: Record<string, string>;
  now: Date;
  retriever: Retriever | undefined;
}

function purchasePack(product: Product, chosen: string | undefined) {
  if (chosen?.startsWith("pack:")) return product.packs.find((k) => k.id === chosen.slice(5));
  return product.packs.find((k) => k.isPurchaseDefault) ?? (product.packs.length === 1 ? product.packs[0] : undefined);
}

export async function supplierLink({ message, ctx, overrides, now, retriever }: LinkInput): Promise<BuildResult> {
  if (!retriever) return { kind: "error", message: "El catálogo no está disponible ahora mismo." };
  if (!hasRole(ctx.role, "manager")) return { kind: "error", message: "Los proveedores de un producto los asignan los encargados y la administración." };
  const supplier = overrides.documento?.startsWith("proveedor:")
    ? ctx.suppliers.find((s) => s.id === overrides.documento!.slice(10))
    : mentionedSupplier(message, ctx.suppliers);
  if (!supplier) return { kind: "error", message: "No sé qué proveedor es: dímelo como sale en Proveedores." };

  const supplierWords = new Set(tokenize(supplier.name));
  const phrase = tokenize(message).filter((w) => !NOT_PRODUCT.has(w) && !supplierWords.has(w)).join(" ");
  if (!phrase) return { kind: "error", message: `¿A qué producto asocio ${supplier.name}? Dime su nombre como sale en Productos.` };
  const picked = overrides.documento?.startsWith("producto:") ? ctx.products.find((p) => p.id === overrides.documento!.slice(9)) : undefined;
  // Un nombre dicho entero es ese producto, aunque otro se le parezca («Ron Barceló…» frente a «Ron Brugal…»).
  const exact = ctx.products.filter((p) => tokenize(p.name).join(" ") === phrase);
  const products = picked ? [picked] : exact.length > 0 ? exact : await productsNamed(phrase, ctx, retriever, 6);
  if (products.length === 0) return { kind: "error", message: `No encuentro «${phrase}» en el catálogo. Dímelo como sale en Productos.` };
  if (products.length > 1) {
    return {
      kind: "clarify",
      plan: {
        type: "clarify",
        field: "documento",
        question: `¿A cuál de estos productos asocio ${supplier.name}?`,
        options: products.slice(0, 6).map((p) => ({ id: `producto:${p.id}`, label: p.name, probability: null })),
      },
    };
  }
  const product = products[0]!;
  if (product.packs.length === 0) return { kind: "error", message: `${product.name} no tiene formatos de compra: añade uno en su ficha y vuelve a pedírmelo.` };
  const pack = purchasePack(product, overrides.formato);
  if (!pack) {
    return {
      kind: "clarify",
      plan: {
        type: "clarify",
        field: "formato",
        question: `¿En qué formato le compramos ${product.name} a ${supplier.name}?`,
        options: product.packs.slice(0, 4).map((k) => ({ id: `pack:${k.id}`, label: k.name, probability: null })),
      },
    };
  }

  const base = draftBase("documento", `Asociar ${supplier.name} a ${product.name}`, ctx, [], now);
  const draft: DocumentDraft = {
    ...base,
    requiredRole: "manager",
    canConfirm: hasRole(ctx.role, "manager"),
    kind: "documento",
    operation: "asociar_proveedor",
    documentId: product.id,
    locationId: ctx.locations[0]!.id,
    summary: `${product.name} · formato ${pack.name}`,
    lines: [{ label: product.name, qty: `proveedor ${supplier.name} · ${pack.name}` }],
    supplier: { supplierId: supplier.id, packId: pack.id, supplierName: supplier.name, productName: product.name },
  };
  return {
    kind: "draft",
    draft: validateDraft(draft),
    summary: { operation: "link a supplier to a product as its purchase source", document: draft.summary, lines: `${supplier.name} → ${product.name}` },
  };
}
