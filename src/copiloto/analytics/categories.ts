// Departamento y familia de un producto a partir de su categoría del catálogo. El contexto entrega la
// categoría como «Padre › Hijo» («Bebidas › Destilados»): el departamento es el primer nivel y la familia la
// categoría completa. Un producto sin padre cuenta con su categoría como departamento y como familia.
export const SIN_CATEGORIA = "Sin categoría";

export function departmentOf(category: string | null): string {
  return category ? category.split(" › ")[0]!.trim() : SIN_CATEGORIA;
}

/** Último nivel de la categoría: el nombre con el que se dice («Destilados»). */
export function leafOf(category: string | null): string {
  return category ? category.split(" › ").at(-1)!.trim() : SIN_CATEGORIA;
}

/** Departamentos del catálogo, en orden alfabético (para el selector de Informes). */
export function departmentsOf(products: Array<{ category: string | null }>): string[] {
  return [...new Set(products.map((p) => departmentOf(p.category)))].sort((a, b) => a.localeCompare(b, "es"));
}

/** Productos de un departamento. Vacío si no hay ninguno con ese nombre. */
export function productIdsInDepartment(products: Array<{ id: string; category: string | null }>, department: string): string[] {
  return products.filter((p) => departmentOf(p.category) === department).map((p) => p.id);
}

/** Con departamento, deja solo sus productos (cruzados con los pedidos). null si no queda ninguno. */
export function scopeByDepartment<T extends { ctx: { products: Array<{ id: string; category: string | null }> }; productIds: string[]; department?: string }>(q: T): T | null {
  if (!q.department) return q;
  const inDepartment = productIdsInDepartment(q.ctx.products, q.department);
  const productIds = q.productIds.length > 0 ? q.productIds.filter((id) => inDepartment.includes(id)) : inDepartment;
  return productIds.length > 0 ? { ...q, productIds } : null;
}
