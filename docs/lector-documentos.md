# Lector de albaranes y facturas

Cómo se leen los documentos de compra y qué comprueba cada lectura. Hay dos caminos:

| Camino | Entrada | Módulo | Estado |
|---|---|---|---|
| **Foto** (Nueva recepción) | Imagen → OCR en el navegador → cajas de texto | `src/lib/albaran-reader.ts` (geometría) | En producción |
| **PDF** (Nueva factura, Nueva recepción y el asistente) | PDF → texto con pdf.js en el navegador, en renglones; si es un escaneado, cada página pasa por el OCR | `src/lib/pdf-texto.ts` → `documento-texto.ts`; `albaran-pdf.ts` lo pasa a la forma de la foto | En producción |
| **Texto** (texto copiado, OCR ya ordenado en filas) | Texto por líneas | `src/lib/documento-texto.ts` | Lo usan el PDF y la factura desde foto |
| **Factura desde foto** (Nueva factura) | Imagen → OCR → renglones → texto | `src/lib/documento-foto.ts`, `documento-filas.ts` | En Nueva factura; se guarda al registrar |

Un documento leído nunca se guarda sin que la persona lo confirme. Si algo no cuadra, la lectura sale como
**revisar** con el motivo, no se corrige en silencio.

## Qué se lee

- **Cabecera:** tipo (albarán o factura), número y fecha. El número va justo después de la palabra
  («Factura ES-001», «Albarán 2024/117»); la fecha, después de «Fecha» o la primera que aparezca.
- **Líneas de producto:** cantidad, unidad (si la hay), descripción, referencia (si la hay), precio, descuento
  de la línea (si lo hay), IVA de la línea (si la tabla lo trae) e importe.
- **Cabecera:** número y fecha del documento. Una línea con «Vencimiento», «Vence el» o «Vto.» no da la fecha
  del documento; la fecha de vencimiento no se lee.
- **Totales:** subtotal (con descuento de cabecera, si lo hay), base imponible, cuotas de IVA por tipo,
  recargo de equivalencia y total.

## Formatos de número

| Escrito | Valor |
|---|---|
| `1.234,56` | 1234.56 |
| `1,234.56` | 1234.56 |
| `100.00` | 100.00 |
| `7 900,00 €` | 7900.00 (el espacio es separador de miles) |
| `-420,00 €` | -420.00 |
| `15,0%` | 15.0 (porcentaje) |
| `1.250` (sin coma) | 1.25 (en un albarán, el decimal) |

Un espacio solo se toma como separador de miles si va entre 1–3 cifras y 3 cifras, y lo que sigue es un decimal
con **coma** o el símbolo €. Así «100.00 100.00» no se une en «100.00100.00», y «5 285.00» (punto decimal) son dos
números: el 5 y el 285,00.

Un código al principio de la línea («000113», «77») es la **referencia** si le sigue una palabra (la descripción):
se quita antes de leer la línea, así no se toma por un importe.

Si el albarán trae una **cabecera de referencia** («Ref.», «Referencia», «Cód. artículo»…) en la misma fila que las
columnas de la tabla, la referencia de cada línea es lo que cae bajo esa cabecera, aunque no tenga forma de código
(`refColumn` en `albaran-reader.ts`). La columna va desde la cabecera hasta la mitad entre ella y «Descripción». Una
línea sin nada bajo la cabecera queda sin referencia. Sin cabecera, se usa la regla de arriba. Si el OCR ha leído el
albarán en renglones mezclados (foto torcida), manda la lectura por texto, que ya los ordena.

## Reglas de línea

Una línea de producto cumple siempre **cantidad × precio = importe**. Formas admitidas:

1. `cantidad precio importe` — por ejemplo `1 Talla pequeña… 100.00 100.00`.
2. `cantidad precio importe %IVA total` — por ejemplo `100 6,00 € 600,00 € 10,00% 660,00 €`.
   Se comprueba también que `importe × (1 + IVA) = total`. El `%` no se toma por descuento.
3. `cantidad precio importe %descuento neto` — por ejemplo `2 10,00 € 20,00 € 10% 18,00 €`.
   Se comprueba que `cantidad × precio × (1 − descuento) = neto`.

Cuando la columna «Dto» trae solo el número (`5` en vez de `5%`), se acepta si es entero entre 1 y 99 y la
línea cuadra con él.

4. `cantidad descripción-con-números precio importe` — por ejemplo `6 Tónica botella 20 cl 0,80 4,80`. Si las formas
   de arriba no encajan y la línea empieza por un número, ese es la cantidad, y precio e importe son los dos últimos:
   lo de en medio («20 cl», «10 kg») es parte de la descripción. La unidad solo se toma si va justo detrás de la
   cantidad («2 cajas Hielo…»).

Un renglón que no cumple ninguna forma no es línea. Las tolerancias son de un céntimo más un 0,05 %.

## Reglas de totales

- **Subtotal** = suma de las líneas. Si el documento trae subtotal, debe coincidir con ella. Si no lo trae, la base
  imponible debe coincidir con la suma de las líneas (menos el descuento de cabecera): así una línea que no se ha
  leído no deja el documento como «cuadra».
- **Base imponible** = subtotal − descuento de cabecera (si la base no viene escrita, se calcula).
- **IVA:** cada tipo da una cuota = base × tipo. Con varios tipos, se suman las cuotas de la tabla.
- **Total** = base + IVA + recargo de equivalencia.

Cada incumplimiento se apunta en `issues` con su motivo; la lectura entonces es **revisar**.

## Estados

- **cuadra:** hay líneas y todo encaja.
- **revisar:** hay líneas, pero algo no encaja (ver `issues`). Se muestra la lectura y el motivo.
- **sin_lineas:** no se reconoce ninguna línea de producto. No se inventa nada.

## Ejemplos y pruebas

Las pruebas (`src/lib/documento-texto.test.ts`) usan documentos inventados con la maquetación de los ejemplos
del Drive «FACTURAS EJEMPLO»:

- **Factura sencilla** (modelo con IVA 21 %): lectura completa y cuadre; también la cuota de IVA en la línea
  siguiente a su etiqueta.
- **Albarán con descuento de cabecera** (15 %) y tabla de IVA (4 %, 10 %, 21 %): lectura completa y cuadre.
- **Albarán de gestión** (columnas Cod., Ud., Precio, Dto, Importe; IVA con el porcentaje entre paréntesis):
  el descuento va como número en «Dto», y el bloque «B. Imponible · IVA · Total Albarán» pone sus valores en la
  línea de debajo, con el total en la línea siguiente a su etiqueta. «B / 1 12.05.2024» es el número y la fecha
  del albarán, no la base.
- **Factura con la tabla rota** (los importes de cada fila llegan separados): sale como **sin líneas**, sin inventar.

No se copian al repositorio documentos reales de ningún proveedor ni de ningún negocio. Para añadir un caso,
se escribe un documento inventado con la misma maquetación y se fija lo que debe salir.

## Espacios entre palabras

El reconocedor casi nunca emite el carácter «espacio» y la librería pegaba las palabras («COSTILLADECERDO»). Al
compilar el worker (`scripts/build-ocr.mjs`) se aplica `scripts/ocr/espacios.mjs`: mete un espacio donde la
probabilidad de espacio del modelo pasa de 0,10, sin partir números. El umbral se midió con los albaranes de
ejemplo: recupera las separaciones reales y no parte palabras. Si la librería cambia, el build falla en vez de salir
sin el parche.

## Albarán desde foto: casos que resuelve el lector por geometría

Medido con el OCR real sobre los albaranes de ejemplo del Drive y fotos de prueba (`albaran-reader.ts`):

- **Números partidos por el OCR** («0, 600», «14, 60»): se unen antes de leer.
- **Columna «Dto» sin leer:** si cantidad, precio e importe van seguidos y el importe es el bruto menos un % entero
  (1 a 60), la línea lleva ese descuento. Si fuera falso, los totales no cuadran y sale para revisar.
- **Códigos cortos** («77») como referencia, y **cifras dentro de la descripción** («DN50», «1/2 x 15»).
- **Descuento de cabecera:** subtotal − descuento = base, con los tres importes escritos (`headerDiscountPct`).
  El precio de cada línea de la recepción es el neto tras ese descuento.
- **Varios tipos de IVA:** la cuota y el total escritos con base + cuota = total (`vatRate` queda vacío).
- **Foto girada** (boca abajo o de lado): si no sale ninguna línea, se vuelve a leer girada 180°, 90° y 270°.

No se resuelve: una foto en espejo, o un albarán alterado (sale «no cuadra», que es lo correcto).

## De la foto a la recepción

- **Desde el asistente:** al leer la foto, queda preparada (`pending-file.ts`). Al entrar en Recepciones, por el botón
  del chat o por el menú, se abre Nueva recepción rellena y con la foto adjunta como justificante.
- **Se rellena solo:** proveedor (si su nombre está en el albarán), número (`albaranNumber`), fecha y líneas.
- **Unidades exactas:** la unidad escrita en la línea manda, con su factor: «kg» son 1000 g, «g» es 1 g, «cl» son
  10 ml (`unitMeasure`). Si el producto no tiene un formato con ese factor, no se pone ninguno y lo elige la
  persona; sin unidad no se adivina la medida. Al crear un producto, la medida se ve y se puede cambiar.
- **Registro en una sola operación:** `register_receipt` (migración 0051) guarda cabecera, líneas y stock a la vez,
  con una clave del intento: reintentar no duplica la recepción. Ninguna línea con datos se descarta en silencio.
- **Emparejar con el producto:** la referencia leída se busca primero en la memoria del proveedor (`supplier_item_codes`,
  aprendida al registrar una recepción anterior): si está, el producto y el formato salen solos. Si no, se busca por
  nombre y solo se elige si está claro (`receipt-lines.ts`). Lo que la persona elija queda aprendido al guardar.
- **Lo que no está dado de alta se crea ahí mismo** (`receipt-new-items.tsx`, reglas en `albaran-cabecera.ts`):
  el proveedor, con el nombre leído del albarán (editable), y cada producto sin emparejar, con el nombre de la
  línea y su formato de compra según la unidad (kg, litro o unidad) y el IVA del albarán si es uno solo. Los
  permisos los decide la base de datos. Nada se registra hasta pulsar «Registrar recepción».

## Señalar en la foto lo que no se detectó

En Nueva recepción, con la foto adjunta, el botón «¿Falta algo? Señálalo en la foto» abre la foto a pantalla
completa. Se dibuja un recuadro (ratón o dedo), se dice qué es y se lee solo esa zona (`ocrRecorte`, ampliada si es
pequeña). Qué se hace con lo leído (`receipt-pick.ts`, interpretación en `albaran-recorte.ts`):

| Qué se busca | Resultado |
|---|---|
| Proveedor | Si existe, se elige. Si no, se ofrece crearlo con el nombre leído (editable). |
| Nº de albarán / Fecha | Se rellena el campo. |
| Línea nueva | Cada renglón del recuadro se lee por separado; se añaden los que cuadran (cantidad × precio = importe), emparejados con el catálogo si está claro. |
| Producto de una línea | Se pone la descripción en esa línea y se busca en el catálogo; si no está, «Crear». |

Si el recuadro no se lee, se dice y se puede dibujar otro. No se guarda nada hasta «Registrar recepción».
Límite: si la foto solo se leyó al girarla (boca abajo o de lado), el recuadro se dibuja sobre la foto sin girar.

## Factura desde foto (OCR)

En **Facturas → Nueva factura** hay un botón «Leer foto de la factura». Rellena número, fecha, base (subtotal),
IVA (suma de sus tipos) y total, y adjunta la foto. Si el nombre de un proveedor aparece en la factura, lo elige:
así salen sus albaranes sin facturar y el cuadre entre base y albaranes se ve al momento. No guarda nada: la persona revisa los campos y pulsa
«Registrar factura». Solo se ofrece en facturas nuevas, para no sobrescribir una factura ya registrada. El
vencimiento no se lee (no hace falta por ahora): se sigue calculando con las condiciones de pago del proveedor.
Si la lectura no cuadra o no tiene líneas, el aviso dice el motivo y el importe que falte se deja vacío.

**Líneas guardadas.** Al registrar una factura nueva, sus líneas leídas se guardan en `invoice_lines` (migración
0050), ligadas a la factura: referencia, descripción, cantidad, unidad, precio, descuento, IVA e importe. Las
escribe solo `save_invoice` (parámetro `p_lines`), en la misma transacción que la cabecera. Cada línea cumple
cantidad × precio × (1 − descuento) = importe, con la misma tolerancia que el lector; si no, la base de datos no la
guarda. Al editar una factura, sus líneas se muestran y no cambian (`p_lines` no llega). La persona las ve en la
tabla «Líneas de la factura».

Las cajas de texto que devuelve el OCR del navegador (`albaran-ocr.ts`) se agrupan en renglones con
`filasDeOcr` (`src/lib/documento-filas.ts`): dos cajas van en la misma fila si su centro vertical está a menos de
media altura de letra, y dentro de la fila van de izquierda a derecha. Ese texto pasa por `readDocumentText`, la
misma lectura que la de texto, así que las reglas de arriba se aplican igual.

Resultado con los tres ejemplos de factura del Drive «FACTURAS EJEMPLO» (medido en la lectura real del OCR):

- **Modelo de factura** (750 px): completa. Número, fecha, tres líneas, subtotal, IVA y total; cuadra.
- **Duplicada de la factura modelo** (750 px): sale **sin líneas**. El OCR no detecta las cantidades 1, 2 y 3, y
  el número «Factura ES-001» va escrito en vertical y no se lee. Es lo correcto: no se inventa nada.
- **Factura de plantilla con cabecera gráfica** (`images.png`, 465 px): el OCR lee mal la tabla. Ampliarla 3× no
  lo arregla: sale más texto, pero con menos confianza y las filas siguen rotas. No se amplía en producción.

Por eso una foto de factura sale **revisar** o **sin líneas** cuando el OCR no la lee bien, y la persona la
corrige antes de guardar nada.

## Límites conocidos

- Una factura cuyas cantidades el OCR no detecta, o con el número en vertical, no se puede leer desde la foto.
- Una tabla cuyas filas no llegan como renglones (solo como trozos sueltos) no se puede leer como texto: hay
  que leerla por geometría (foto con OCR) o revisarla a mano. Es el caso de la factura de «images.png».
- El reparto del IVA por tipo sin importe base se comprueba solo cuando hay un único tipo.
- Las fechas se aceptan con año de dos o cuatro cifras; no se comprueba que sean recientes.

## Pendiente (fases siguientes)

1. Integrar el lector de texto en la lectura de PDF y de texto copiado.
2. Hecho: factura desde foto en Nueva factura, con proveedor sugerido, cuadre con sus albaranes (sin IVA en los dos
   lados) y líneas editables. Falta: marcar los albaranes automáticamente cuando la suma cuadra.
3. Hecho: las líneas de la factura se guardan en `invoice_lines` (migración 0050) y se pueden corregir al editar.
   Falta que el asistente responda con ellas: qué albaranes hay, con qué productos y cuánto.
4. Mostrar en el chat la foto del albarán o de la factura guardada.
