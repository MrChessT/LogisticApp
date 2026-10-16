# Opiniones del asistente: cómo se procesan

Quien prueba el asistente reporta desde el chat («Reportar» en una respuesta o en toda la conversación).
La administración los revisa en `/opiniones` y exporta los aceptados en Markdown («Copiar para Claude»).
Este documento es el método para trabajar cada tanda. Cualquier sesión que toque el asistente lo sigue.

## Objetivo

No parchear la respuesta concreta, sino que el asistente responda bien **a todo lo que se parezca** y lo
haga con los pasos justos. Cada arreglo queda cubierto por una prueba para que no vuelva a fallar.

## Pasos

1. **Leer la tanda entera antes de tocar nada.** Agrupar los reportes por lo que se pedía (consulta de
   stock, merma, traspaso, pedido, alta de producto…) y por síntoma. Varios reportes suelen ser un mismo
   fallo de fondo.
2. **Reproducir cada caso** con su conversación en `src/copiloto/__tests__/opiniones.test.ts` (Jev
   simulado con `FakeJev`, guion por llamada). La prueba tiene que fallar antes del arreglo y describir
   lo que se espera, no lo que hace hoy.
3. **Encontrar la capa donde nace el fallo** y arreglarlo ahí:
   - Entender la petición y seguir la conversación: `agent/loop.ts` (aclaraciones, respuestas escritas),
     `agent/free-text.ts`, `agent/routing.ts` (qué se pregunta a Jev), `agent/interpret.ts` (umbrales).
   - Productos, cantidades, locales, nombres: `entities/` (`quantity-parser.ts`, `mentions.ts`,
     `catalog-parser.ts`, `retriever.ts`).
   - Cálculos: `tools/`, `analytics/`, `skills/`.
   - Preparar y confirmar operaciones: `drafts/`.
   - Redacción: `writer/`.
   Preferir reglas generales (deterministas, en el código) a frases sueltas; usar Jev para decidir lo
   que es ambiguo, no para lo que el código puede saber.
4. **Comprobar que no se rompe nada**: `npm test` (incluye las conversaciones de prueba),
   `npm run copiloto:bateria` (frases reales, sin claves) y `npm run check`. Si hay clave de Jev,
   `npm run copiloto:conversaciones -- --real` mide las decisiones reales.
5. **Dejar el caso como prueba permanente**: la conversación en `opiniones.test.ts` y, si es una frase
   de productos o cantidades, una línea en `src/copiloto/eval/bateria.jsonl`.
6. **Eficiencia**: contar llamadas a Jev y preguntas por petición. Lo que se puede saber sin preguntar
   no se pregunta, y lo frecuente debe ir por el camino corto.
7. **Informe** en el PR: qué se pide más, qué fallaba y por qué, qué se ha cambiado, qué queda pendiente
   o necesita una decisión. Después, marcar los reportes como «Hecha» en `/opiniones`.

## Registro

| Fecha | Reportes | Causas | PR |
|---|---|---|---|
| 2026-10-16 | 1 (Luis: alta de producto en bucle) | nombre escrito tratado como mensaje nuevo; cambio de operación pegado a la anterior («registrar merma… crear producto» → «Merma»); «merma» sola leída como charla; producto delante de la cantidad perdido («Prubea Luis, 2ud»); coincidencia parcial dada por buena («Luis» → «Luis Latour»); sin salida ante la misma pregunta repetida | #22 |
| 2026-10-16 | 1 (Oskar: «crea un nuevo producto», nombre escrito y sigue en bucle) + quejas de formato | no se reproduce con #22 desplegado (probó antes del despliegue); endurecido: si la sesión de la aclaración se pierde (otra instancia, caducada), el nombre escrito se usa igual gracias al campo de la aclaración que ahora manda el panel. Formato: tablas de 4+ columnas ilegibles en móvil (ahora tarjetas), gráfica diaria por local de 4 series ilegible (ahora semanal en el chat), panel estrecho en escritorio | #23 |
| 2026-10-16 | Medición con Jev real (220 frases + 22 conversaciones), sin reportes | aviso falso «revisa los datos» tras responder a una pregunta (la comprobación no veía las respuestas) y con «tira/tírame» o «recibir traspaso» (operación mal descrita a Jev); continuación «¿y en el parador cuánto hay?» al azar (pregunta de seguimiento ambigua: 0,52–0,58 frente a umbral 0,5); «limones pochos», «barceló contadas», «votellas» preguntaban el producto (la comprobación de #22 contaba estados y erratas de unidad). Varias tónicas: preguntar cuál es lo correcto (decisión de producto) | — |
