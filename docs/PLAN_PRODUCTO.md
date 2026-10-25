# Plan de producto: de LogisticApp a la plataforma del grupo

Referencia: especificaciones A (bebidas), B (personal) y C (restauración) v1 del 2026-10-03, propuesta ERP y
estudio de mercado. Este documento no contiene datos del negocio (precios, proveedores, personas): solo diseño.

## Objetivo

Ganar a la competencia (ERP pesados tipo SAP y plataformas BOH con IA) en lo que el estudio identifica como
dolor real, sin prometer nada que no funcione:

1. **Cero tecleo de albaranes**: foto → borrador → confirmar (OCR sobre el sistema de borradores de Jev).
2. **Ruta de 3 documentos en una pantalla**: pedido ↔ albarán ↔ factura con cuadre automático.
3. **Coste real**: consumo real frente a teórico con las ventas del TPV (BDP), por local y periodo.
4. **Escandallos vivos**: recetas con rendimientos reales que se recalculan y avisan cuando sube un precio.
5. **Un asistente que hace el trabajo** (Jev), siempre con confirmación humana: la IA nunca escribe sola.

## Reglas de calidad (no negociables en cada entrega)

- Una sola base de datos: A, B y C son módulos del mismo modelo (producto con familia y dimensión), nunca
  tablas paralelas. El «Centro» son vistas por local y periodo, no otra aplicación.
- Cada bloque: migración + RLS/permisos + validación de importes y cantidades + pgTAP + tests de la app antes
  de exponerlo en pantalla. CI verde (lint, typecheck, knip, test, build, db) antes de pedir fusionar.
- Movimientos inmutables; correcciones como movimientos nuevos con autor y motivo.
- Todo lo que propone la IA pasa por un borrador con comprobaciones («revisar» exige revisión explícita).
- Pantallas probadas en escritorio y móvil (sin desbordes, objetivos táctiles ≥ 40 px) y medidas en producción.
- Los datos reales (listas de precios, escandallos, ventas) se cargan con scripts locales y nunca entran en git.
- SQL a producción solo tras «listo».

## Fases y bloques

### Fase 1 — Completar A (bebidas) y cerrar el circuito de compra

| Bloque | Qué | Cómo | Depende de |
|---|---|---|---|
| 1.1 | Tipo de salida en mermas | `exit_kind` (merma, invitación, consumo del personal, degustación, evento) y motivo de lista cerrada; selector en /mermas y /almacen; Jev lo rellena; Informes separa pérdidas de acciones comerciales | — |
| 1.2 | Condiciones de proveedor | días de pedido, hora límite, plazo, pedido mínimo, condiciones de pago, código, locales servidos; «Preparar pedidos» respeta mínimo y calcula la entrega prevista | — |
| 1.3 | Recepción blindada | diferencia de precio por línea contra el pedido o el último precio, incidencia por línea, foto del albarán en Storage | 1.2 (código) |
| 1.4 | Inventario fino | conteo por pesada y fracción ¼–½–¾ con los pesos de formato; motivo del ajuste al cerrar | — |
| 1.5 | Trazabilidad | códigos legibles (proveedor, local, documentos) y registro de cambios del catálogo (valor anterior y nuevo) | — |
| 1.6 | Datos | mínimos de Parador y Pickles, stock por zonas del Vivero (carga asistida, no código) | — |

### Fase 2 — Facturas y lectura automática de albaranes

| Bloque | Qué | Cómo |
|---|---|---|
| 2.1 | Facturas | `invoices` + `invoice_receipts`; cuadre factura − albaranes; vencimientos y estado de pago; pantalla /facturas solo administración y dirección |
| 2.2 | Albarán por foto | visión → JSON → emparejar con catálogo y referencias del proveedor → borrador de recepción con comprobaciones → confirmar. Medido con 30–50 albaranes reales antes de anunciarlo |
| 2.3 | Alertas | subidas de precio sobre umbral, cobros por encima de lo pactado, mermas anómalas: aviso en Inicio y en Jev |

### Fase 3 — Ventas (BDP) y consumo teórico

| Bloque | Qué | Cómo |
|---|---|---|
| 3.1 | Importar ventas | `pos_sales` (local, día de negocio, código TPV, unidades, importe sin IVA) desde la exportación de BDP; idempotente por fichero |
| 3.2 | Vincular carta | `pos_items`: código TPV → producto + cantidad servida (copa, caña, chupito) o → receta + fracción; indicador «vendidos sin vincular» |
| 3.3 | Indicadores | consumo teórico, real − teórico, coste de bebida sobre ventas, rotación en días |

### Fase 4 — C (restauración) en la misma base

| Bloque | Qué | Cómo |
|---|---|---|
| 4.1 | Rendimientos | `yields` por producto y transformación (bruto, neto → %) |
| 4.2 | Recetas | `recipes` (versionadas) + `recipe_lines` (producto o subreceta) y vista recursiva de coste |
| 4.3 | Escandallos | coste por ración, food cost, margen, precio recomendado; «desactualizado» cuando cambia un precio usado |
| 4.4 | Alérgenos | 14 alérgenos por producto; los de la receta se calculan |
| 4.5 | Carga de precios de cocina | importador con detección de duplicados, recálculo de €/kg desde el formato y filas a revisar |
| 4.6 | Producción y lotes | órdenes de producción, lote y caducidad (fase 2 de C) |

### Fase 5 — Personal y Centro

| Bloque | Qué | Cómo |
|---|---|---|
| 5.1 | Coste laboral | importar coste mensual y horas por local desde la herramienta de fichaje o la gestoría → coste/hora real por puesto |
| 5.2 | Fichaje propio (opcional) | solo si se decide construirlo: empleados, turnos, marcas inmutables con corrección trazada; validar con la gestoría |
| 5.3 | Centro | resultado por local y periodo: compras, consumo real, mermas por tipo, valor del stock, facturas, ventas y coste laboral |

### Más adelante

Envases retornables y fianzas, ingeniería de menú, APPCC (temperaturas), avisos por correo o WhatsApp.

## Necesario del grupo

- Una exportación de ventas de BDP (un día, un local) para diseñar 3.1.
- Escandallos de Pickles y la lista de precios de cocina revisada para 4.5.
- Decidir si el fichaje se compra o se construye (5.1 o 5.2).
