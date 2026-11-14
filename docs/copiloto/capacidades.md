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
| Recepciones | sí (qué ha llegado) | registrar; foto del albarán (botón, arrastrar o pegar) | «han llegado 3 cajas de tónica al Parador» |
| Traspasos | sí (pendientes de recibir) | preparar y enviar, recibir, cancelar | «pasa 2 cajas de coca del Parador al Vivero» |
| Almacén | sí (salidas sin validar) | apuntar una salida o devolución; validar las de un local | «saca 2 cajas de coca a la barra 1» |
| Inventarios | sí (abiertos, último por local, desvíos) | abrir, apuntar lo contado, cerrar | «empieza el inventario del Vivero» |
| Mermas | sí (por local, periodo, producto) | registrar | «se han roto 2 botellas de Larios en barra» |
| Productos | sí (ficha, categoría, formatos, proveedores, precios) | alta, precio de compra, archivar, categoría, alérgenos, formatos y proveedor de compra (sin precio) | «pon el pacharán en Licores», «la tónica lleva sulfitos» |
| Proveedores | sí (condiciones, qué nos trae cada uno) | condiciones (mínimo, días, hora límite, plazo, pago) | «el pedido mínimo de Makro es 200 €» |
| Escandallos | sí (coste, food cost, margen, alérgenos) | crear un plato o una elaboración con sus ingredientes; PVP de un plato | «crea el escandallo de croquetas con PVP 9,50» · «pon el PVP de las croquetas a 10 €» |
| Ventas | sí (vendido, lo más vendido, food cost de lo vendido, sin enlazar) | — | «¿cuánto vendimos este mes?» |
| Facturas | sí (pendientes, vencidas, sin cuadrar, albaranes sin factura) | marcar pagada; registrar una factura desde su PDF arrastrado (abre Nueva factura con el PDF) | «marca como pagada la factura de Makro» |
| Informes | sí (las mismas cifras, resumidas) | abre la vista pedida | «llévame a los informes de mermas de este mes» |
| Equipo | sí (quién, puesto, locales) | no: invitar y cambiar permisos solo en la pantalla, a propósito | «dame los nombres del personal» |
| Zonas | sí (zonas de cada local, qué hay en cada una) | crear una zona (almacén o servicio) | «crea la zona Terraza en el Vivero» |
| Importar | — | enlace (arrastrar un Excel o CSV al chat dice dónde va) | — |
| Opiniones del asistente | — | no (pantalla de administración) | — |

## Pendiente

Nada del mapa está sin hacer desde el chat. Lo que no se hará desde el chat: invitar personas o cambiar
permisos (riesgo alto por un malentendido). En escandallos, desde el chat no se editan las líneas de un
escandallo existente ni se usan elaboraciones como ingrediente: eso se hace en la pantalla de Escandallos.
