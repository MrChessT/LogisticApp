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
