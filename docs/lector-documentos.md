# Lector de albaranes y facturas

Cómo se leen los documentos de compra y qué comprueba cada lectura. Hay dos caminos:

| Camino | Entrada | Módulo | Estado |
|---|---|---|---|
| **Foto** (Nueva recepción) | Imagen → OCR en el navegador → cajas de texto | `src/lib/albaran-reader.ts` (geometría) | En producción |
| **Texto** (PDF, texto copiado, OCR ya ordenado en filas) | Texto por líneas | `src/lib/documento-texto.ts` | Módulo y pruebas; sin integrar |
| **Factura desde foto** (Nueva factura) | Imagen → OCR → renglones → texto | `src/lib/documento-foto.ts`, `documento-filas.ts` | En Nueva factura, sin guardar |

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

## Reglas de línea

Una línea de producto cumple siempre **cantidad × precio = importe**. Formas admitidas:

1. `cantidad precio importe` — por ejemplo `1 Talla pequeña… 100.00 100.00`.
2. `cantidad precio importe %IVA total` — por ejemplo `100 6,00 € 600,00 € 10,00% 660,00 €`.
   Se comprueba también que `importe × (1 + IVA) = total`. El `%` no se toma por descuento.
3. `cantidad precio importe %descuento neto` — por ejemplo `2 10,00 € 20,00 € 10% 18,00 €`.
   Se comprueba que `cantidad × precio × (1 − descuento) = neto`.

Cuando la columna «Dto» trae solo el número (`5` en vez de `5%`), se acepta si es entero entre 1 y 99 y la
línea cuadra con él.

Un renglón que no cumple ninguna forma no es línea. Las tolerancias son de un céntimo más un 0,05 %.

## Reglas de totales

- **Subtotal** = suma de las líneas. Si el documento trae subtotal, debe coincidir con ella.
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

## Factura desde foto (OCR)

En **Facturas → Nueva factura** hay un botón «Leer foto de la factura». Rellena número, fecha, base (subtotal),
IVA (suma de sus tipos) y total, y adjunta la foto. Si el nombre de un proveedor aparece en la factura, lo elige:
así salen sus albaranes sin facturar y el cuadre entre base y albaranes se ve al momento. No guarda nada: la persona revisa los campos y pulsa
«Registrar factura». Solo se ofrece en facturas nuevas, para no sobrescribir una factura ya registrada. El
vencimiento no se lee (no hace falta por ahora): se sigue calculando con las condiciones de pago del proveedor.
Si la lectura no cuadra o no tiene líneas, el aviso dice el motivo y el importe que falte se deja vacío.

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
2. Hecho: factura desde foto en Nueva factura, sin guardar, con proveedor sugerido y cuadre con sus albaranes.
   Falta: marcar los albaranes automáticamente cuando la suma cuadra, y guardar las líneas (fase 3).
3. Guardar la cabecera y las líneas leídas para que el asistente responda qué albaranes hay, con qué productos y
   cuánto.
4. Mostrar en el chat la foto del albarán o de la factura guardada.
