# Qué hace el asistente, pantalla por pantalla

El objetivo: todo lo que se hace en la app se puede consultar o hacer desde el asistente, con la misma
seguridad (borrador → confirmación; permisos de la base de datos). Esta tabla dice dónde estamos. Al
añadir algo al asistente o a una pantalla, se actualiza aquí en el mismo PR.

Leyenda: **sí** = desde el chat · **enlace** = lo explica y abre la pantalla · **no** = todavía no.

| Pantalla | Consultar desde el chat | Hacer desde el chat | Ejemplo |
| --- | --- | --- | --- |
| Panel | sí (cómo va el mes, avisos con `/avisos`) | — | «¿cómo voy este mes?» |
| Stock | sí (por local, zona, familia, bajo mínimo, valor) | mínimos y objetivos | «¿cuánta coca queda en el Vivero?» |
| Pedidos | sí (abiertos, retrasados, cuándo se pidió algo) | preparar, enviar, recibir, cancelar | «¿cuándo pedimos tónica por última vez?» |
| Recepciones | sí (qué ha llegado) | registrar; foto o PDF del albarán (botón, arrastrar o pegar): lo lee, lo resume y lo deja preparado en Nueva recepción | «han llegado 3 cajas de tónica al Parador» |
| Traspasos | sí (pendientes de recibir) | preparar y enviar, recibir, cancelar | «pasa 2 cajas de coca del Parador al Vivero» |
| Almacén | sí (salidas sin validar) | apuntar una salida o devolución; validar las de un local | «saca 2 cajas de coca a la barra 1» |
| Inventarios | sí (abiertos, último por local, desvíos) | abrir, apuntar lo contado, cerrar | «empieza el inventario del Vivero» |
| Mermas | sí (por local, periodo, producto) | registrar | «se han roto 2 botellas de Larios en barra» |
| Productos | sí (ficha, categoría, formatos, proveedores, precios) | alta, precio de compra, archivar, categoría, alérgenos, formatos y proveedor de compra (sin precio) | «pon el pacharán en Licores», «la tónica lleva sulfitos» |
| Proveedores | sí (condiciones, qué nos trae cada uno) | condiciones (mínimo, días, hora límite, plazo, pago) | «el pedido mínimo de Makro es 200 €» |
| Escandallos | sí (coste, food cost, margen, alérgenos) | crear un plato o una elaboración con sus ingredientes; cambiar los de uno que ya existe (añadir un producto o una elaboración, quitar, cambiar la cantidad); PVP de un plato | «crea el escandallo de croquetas con PVP 9,50» · «añade 20 g de queso a las croquetas» · «quita el ajo del gazpacho» |
| Ventas | sí (vendido, lo más vendido, food cost de lo vendido, sin enlazar) | enlazar un artículo del TPV a un plato o a un producto (con lo que gasta cada venta), o ignorarlo; la exportación del TPV arrastrada al chat abre su vista previa | «enlaza el artículo CROQ CASERA del TPV con las croquetas» · «la COPA DE LA CASA son 150 ml de vino tinto» |
| Facturas | sí (pendientes, vencidas, sin cuadrar, albaranes sin factura) | marcar pagada; la factura en PDF (con texto o escaneada) o en foto arrastrada al chat: proveedor, número, fecha, base, IVA, total y líneas, y abre Nueva factura rellena | «marca como pagada la factura de Makro» |
| Informes | sí (las mismas cifras, resumidas) | abre la vista pedida | «llévame a los informes de mermas de este mes» |
| Equipo | sí (quién, puesto, locales) | no: invitar y cambiar permisos solo en la pantalla, a propósito | «dame los nombres del personal» |
| Zonas | sí (zonas de cada local, qué hay en cada una) | crear una zona (almacén o servicio) | «crea la zona Terraza en el Vivero» |
| Importar | — | un Excel o CSV arrastrado al chat: dice qué trae cada hoja (catálogo, escandallos o ventas) y abre su vista previa en Importar | — |
| Opiniones del asistente | — | no (pantalla de administración) | — |

## Archivos

Lo que se arrastra, se pega o se elige en el chat se lee en el navegador, sin subirlo (`components/copiloto/documents.ts`).
El asistente lo resume y deja el archivo, ya leído, en la pantalla donde se revisa y guarda. Nada se guarda desde el
resumen.

| Archivo | Qué lee | Dónde se guarda |
| --- | --- | --- |
| Foto de albarán | proveedor, fecha, líneas y totales; avisa si hay un pedido pendiente de ese proveedor | Nueva recepción |
| PDF de albarán | lo mismo y el número de albarán | Nueva recepción |
| PDF o foto de factura | proveedor, número, fecha, base, IVA, total y líneas; si cuadra | Nueva factura |
| Excel de ventas del TPV | día, local, artículos e importe | Ventas (vista previa) |
| Excel o CSV de catálogo o escandallos | qué hoja es qué y cuántas filas | Importar (vista previa) |

## Pendiente

Nada del mapa está sin hacer desde el chat. Lo que no se hará desde el chat: invitar personas o cambiar
permisos (riesgo alto por un malentendido). En escandallos, la merma de cada línea, el rendimiento, la categoría
y las instrucciones se cambian en la pantalla: desde el chat, ingredientes, cantidades y PVP.
