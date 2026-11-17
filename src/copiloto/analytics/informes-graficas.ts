// Gráficas que la pantalla y el PDF de Informes no muestran (lista de cambios «DRIVE WARRO»): el consumo y la
// merma por día, y la variación de precios. El asistente sigue usándolas; aquí solo se quitan de la vista de informes.

const FUERA_DE_INFORMES = new Set(["consumo-diario", "mermas-diarias", "variacion-precios"]);

export function sinGraficasFueraDeInformes<T extends { charts: Array<{ id: string }> }>(view: T): T {
  return { ...view, charts: view.charts.filter((c) => !FUERA_DE_INFORMES.has(c.id)) };
}
