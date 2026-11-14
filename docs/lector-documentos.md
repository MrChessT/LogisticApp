# Lector de albaranes y facturas

Cómo se leen los documentos de compra y qué comprueba cada lectura. Hay dos caminos:

| Camino | Entrada | Módulo | Estado |
|---|---|---|---|
| **Foto** (Nueva recepción) | Imagen → OCR en el navegador → cajas de texto | `src/lib/albaran-reader.ts` (geometría) | En producción |
| **Texto** (PDF, texto copiado, OCR ya ordenado en filas) | Texto por líneas | `src/lib/documento-texto.ts` | Fase 1: módulo y pruebas; sin integrar |

Un documento leído nunca se guarda sin que la persona lo confirme. Si algo no cuadra, la lectura sale como
**revisar** con el motivo, no se corrige en silencio.

## Qué se lee

- **Cabecera:** tipo (albarán o factura), número y fecha. El número va justo después de la palabra
  («Factura ES-001», «Albarán 2024/117»); la fecha, después de «Fecha» o la primera que aparezca.
- **Líneas de producto:** cantidad, unidad (si la hay), descripción, referencia (si la hay), precio, descuento
  de la línea (si lo hay), IVA de la línea (si la tabla lo trae) e importe.
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
o el símbolo €. Así «100.00 100.00» no se une en «100.00100.00».

## Reglas de línea

Una línea de producto cumple siempre **cantidad × precio = importe**. Formas admitidas:

1. `cantidad precio importe` — por ejemplo `1 Talla pequeña… 100.00 100.00`.
2. `cantidad precio importe %IVA total` — por ejemplo `100 6,00 € 600,00 € 10,00% 660,00 €`.
   Se comprueba también que `importe × (1 + IVA) = total`. El `%` no se toma por descuento.
3. `cantidad precio importe %descuento neto` — por ejemplo `2 10,00 € 20,00 € 10% 18,00 €`.
   Se comprueba que `cantidad × precio × (1 − descuento) = neto`.

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
- **Factura con la tabla rota** (los importes de cada fila llegan separados): sale como **sin líneas**, sin inventar.

No se copian al repositorio documentos reales de ningún proveedor ni de ningún negocio. Para añadir un caso,
se escribe un documento inventado con la misma maquetación y se fija lo que debe salir.

## Límites conocidos

- Una tabla cuyas filas no llegan como renglones (solo como trozos sueltos) no se puede leer como texto: hay
  que leerla por geometría (foto con OCR) o revisarla a mano. Es el caso de la factura de «images.png».
- El reparto del IVA por tipo sin importe base se comprueba solo cuando hay un único tipo.
- Las fechas se aceptan con año de dos o cuatro cifras; no se comprueba que sean recientes.

## Pendiente (fases siguientes)

1. Integrar el lector de texto en la lectura de PDF y de texto copiado.
2. Usar el mismo lector para facturas desde foto, con el número y el vencimiento, y comprobarlas contra los
   albaranes asociados.
3. Guardar la cabecera y las líneas leídas para que el asistente responda qué albaranes hay, con qué productos y
   cuánto.
4. Mostrar en el chat la foto del albarán o de la factura guardada.
