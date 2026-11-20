# Qué hace el asistente, pantalla por pantalla

El objetivo: todo lo que se hace en la app se puede consultar o hacer desde el asistente, con la misma
seguridad (borrador → confirmación; permisos de la base de datos). Esta tabla dice dónde estamos. Al
añadir algo al asistente o a una pantalla, se actualiza aquí en el mismo PR.

Leyenda: **sí** = desde el chat · **enlace** = lo explica y abre la pantalla · **no** = todavía no.

| Pantalla | Consultar desde el chat | Hacer desde el chat | Ejemplo |
| --- | --- | --- | --- |
| Panel | sí (cómo va el mes, avisos con `/avisos`) | — | «¿cómo voy este mes?» |
| Stock | sí (por local, zona, familia, bajo mínimo, valor; stock parado sin salidas en 30 días; dos datos de un producto a la vez, con su ficha) | mínimos y objetivos | «¿cuánta coca queda en el Vivero?» · «¿cuánto stock tengo parado?» · «el stock de beefeater y a cuánto lo compramos» |
| Pedidos | sí (abiertos, retrasados, cuándo se pidió algo; gasto por periodo natural y familia) | preparar (traspasos primero y lo que toca pedir hoy a cada proveedor según su ficha; un proveedor que no existe se dice), enviar, recibir, cancelar | «prepárame el pedido», «/preparar», «¿cuánto he gastado este mes en bebida?» |
| Recepciones | sí (qué ha llegado) | registrar; foto o PDF del albarán (botón, arrastrar o pegar): lo lee, lo resume y lo deja preparado en Nueva recepción | «han llegado 3 cajas de tónica al Parador» |
| Traspasos | sí (pendientes de recibir) | preparar y enviar (en cualquier orden de locales; sin origen, primero el local al que le sobra), corregir hablando (cantidad, origen, destino, quitar una línea), recibir, cancelar | «pasa 2 cajas de coca del Parador al Vivero» · «mejor que sean 4» · «quita la de zero» |
| Almacén | sí (salidas sin validar) | apuntar una salida o devolución; validar las de un local | «saca 2 cajas de coca a la barra 1» |
| Inventarios | sí (abiertos, último por local, desvíos) | abrir, apuntar lo contado, cerrar | «empieza el inventario del Vivero» |
| Mermas | sí (por local, periodo, producto; en qué local se pierde más) | registrar, también por pasos tras el formulario («larios», «2 botellas», «en el vivero»); corregir hablando (cantidad, local, motivo) | «se han roto 2 botellas de Larios en barra» · «cámbialo a La Oliva» |
| Productos | sí (ficha, categoría, formatos, proveedores, precios; qué proveedor lo vende más barato; los que no tienen precio, categoría o mínimo) | alta, precio de compra, archivar, categoría, alérgenos, formatos y proveedor de compra (sin precio) | «pon el pacharán en Licores», «la tónica lleva sulfitos» |
| Proveedores | sí (condiciones, contacto, qué nos trae cada uno; uno que no existe se dice) | condiciones (mínimo, días, hora límite, plazo, pago) | «el pedido mínimo de Makro es 200 €» |
| Escandallos | sí (coste, food cost, margen, alérgenos) | crear un plato o una elaboración con sus ingredientes; cambiar los de uno que ya existe (añadir un producto o una elaboración, quitar, cambiar la cantidad); PVP de un plato | «crea el escandallo de croquetas con PVP 9,50» · «añade 20 g de queso a las croquetas» · «quita el ajo del gazpacho» |
| Ventas | sí (vendido, lo más vendido, food cost de lo vendido, sin enlazar) | cargar la exportación del TPV arrastrada al chat (borrador y confirmar); enlazar un artículo del TPV a un plato o a un producto (con lo que gasta cada venta), o ignorarlo | «enlaza el artículo CROQ CASERA del TPV con las croquetas» · «la COPA DE LA CASA son 150 ml de vino tinto» |
| Facturas | sí (pendientes, vencidas, sin cuadrar, albaranes sin factura; por número, proveedor, periodo y «vencen esta semana»; cuánto se le debe a un proveedor con lo pendiente de facturar) | marcar pagada; la factura en PDF (con texto o escaneada) o en foto arrastrada al chat: proveedor, número, fecha, base, IVA, total y líneas, y abre Nueva factura rellena | «marca como pagada la factura de Makro» |
| Informes | sí (las mismas cifras, resumidas) | abre la vista pedida | «llévame a los informes de mermas de este mes» |
| Equipo | sí (quién, puesto, locales; qué permisos tiene una persona) | no: invitar y cambiar permisos solo en la pantalla, a propósito | «dame los nombres del personal» |
| Zonas | sí (zonas de cada local, qué hay en cada una) | crear una zona (almacén o servicio) | «crea la zona Terraza en el Vivero» |
| Importar | — | un Excel o CSV arrastrado al chat: dice qué trae cada hoja (catálogo, escandallos o ventas) y abre su vista previa en Importar | — |
| Opiniones del asistente | — | no (pantalla de administración) | — |

## Archivos

Lo que se arrastra, se pega o se elige en el chat se lee en el navegador, sin subirlo (`components/copiloto/documents.ts`).
El asistente lo resume y deja el archivo, ya leído, en la pantalla donde se revisa y guarda. Nada se guarda desde el
resumen.

| Archivo | Qué lee | Dónde se guarda |
| --- | --- | --- |
| Foto de albarán (o varias, una por página) | proveedor, fecha, líneas y totales; avisa si hay un pedido pendiente de ese proveedor | Nueva recepción (varias fotos se adjuntan unidas en una imagen) |
| PDF de albarán | lo mismo y el número de albarán | Nueva recepción |
| PDF o foto de factura | proveedor, número, fecha, base, IVA, total y líneas; si cuadra; qué albaranes sin facturar le corresponden (los que nombra o los que suman su base) | Nueva factura, con esos albaranes marcados |
| Excel de ventas del TPV | día, local, artículos e importe | Se cargan desde el chat (borrador con lo enlazado y lo que no, y confirmar) o en Ventas |
| Excel o CSV de catálogo o escandallos | qué hoja es qué y cuántas filas | Importar (vista previa) |

Después se puede preguntar por el archivo mientras dure la conversación (`agent/document-turn.ts`): «¿a cuánto
nos cobra los limones esta factura?» (con nuestro último precio de compra al lado), «¿cuánto es el IVA de este
albarán?», «¿qué trae esta factura?», «¿cuántas croquetas se vendieron en este excel?». Solo cuando la frase habla del
archivo («esta factura», «el pdf», «ahí»); el resto de preguntas siguen su camino.
- **Subidas de precio** («¿ha subido algo de precio en esta factura?», también con un botón): cada línea que es un
  producto del catálogo contra nuestro último precio de compra, por kilo, litro o unidad (`agent/document-prices.ts`).
  Si la línea no dice la unidad, se toma la lectura más cercana a nuestro precio; si ninguna encaja, no se compara.
- **Cuadrar factura y albarán** («¿cuadra la factura con el albarán?», o el botón que sale al leer el segundo): bases
  y, línea a línea, qué falta en uno u otro y qué cambia de cantidad o de precio (`agent/document-compare.ts`).
- **Varias fotos a la vez** (una factura de dos hojas): se leen como un solo documento (`readDocumentPages`). Lo leído viaja con cada mensaje
(`ChatRequest.document`); no se guarda.

## Reposición: qué pedir hoy

«/preparar», «prepárame el pedido» y «/equilibrar» dan la misma decisión (`tools/reorder-plan.ts`):

- **Lo primero, lo que se acaba antes de que llegue un pedido**, con cuándo llega lo próximo. Si otro local puede
  cederlo, el botón es el traspaso; si no, hay que llamar al proveedor o comprarlo fuera.
- **Traspasar antes que comprar:** lo que otro local puede ceder sin bajar de su objetivo no entra en el pedido.
- **Pedir hoy, a cada proveedor, lo que cubre hasta que llegue su pedido siguiente** (lunes y jueves con entrega a
  24 h: lo del lunes debe durar hasta el viernes). Sin días de pedido en la ficha, una semana, y se dice.
- **Lo del proveedor que hoy no admite pedidos espera a su día** («Bebidas del Sur el jueves»): no va en el borrador.
- **El pedido mínimo** se avisa; las fuentes de precio («Precios de escandallo», estimados) nunca reciben pedidos.

Con cantidades, un proveedor o un periodo dichos («el pedido de la semana a Makro») se pide eso, como siempre.

## Pendiente

Nada del mapa está sin hacer desde el chat. Lo que no se hará desde el chat: invitar personas o cambiar
permisos (riesgo alto por un malentendido). En escandallos, la merma de cada línea, el rendimiento, la categoría
y las instrucciones se cambian en la pantalla: desde el chat, ingredientes, cantidades y PVP.
