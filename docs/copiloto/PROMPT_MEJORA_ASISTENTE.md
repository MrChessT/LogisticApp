# Prompt de mejora del asistente, por fases

Encargo para ejecutar la mejora del asistente de LogisticApp en fases, con criterios de aceptación medibles. Parte del
diagnóstico de [INFORME_ASISTENTE_2026-11.md](INFORME_ASISTENTE_2026-11.md); léelo antes de empezar. Este documento
sustituye al encargo anterior de [PROYECTO_ASISTENTE.md](PROYECTO_ASISTENTE.md), cuyo objetivo de «70/70» en la batería
y las fases de roles ya no aplican.

---

## 0. Cómo trabajar (válido para todas las fases)

1. Lee [docs/ARQUITECTURA.md](../ARQUITECTURA.md), [docs/copiloto/JEV.md](JEV.md), [ESPECIALISTAS.md](ESPECIALISTAS.md),
   [CONVERSACIONES.md](CONVERSACIONES.md) y [EVALUACION.md](EVALUACION.md) antes de tocar nada. Y las normas de
   [CLAUDE.md](../../CLAUDE.md).
2. Una fase = una rama y un PR. No empieces la siguiente sin que la anterior esté fusionada y su línea base medida.
3. Antes de dar una fase por terminada, pasan **todas** estas comprobaciones:
   - `npm run check` (lint, tipos, knip, tamaño de ficheros, tests y build).
   - La batería `scripts/ops/bateria-asistente.json` (regresiones), antes y después. Cada fallo que arregles añade un caso.
   - La prueba ciega `scripts/ops/bateria-ciega.json` (conjunto de evaluación; **no se ajusta** a partir de sus resultados
     para subir la nota: si un caso falla, se arregla el sistema, no el caso, y se añade un caso nuevo a la batería).
   - Si cambias la base de datos: migración numerada, test pgTAP y `database.types.ts`.
4. Mide con los mismos números que el informe (sección 2). No se declara mejora sin comparar contra la línea base de la
   fase 0 con la misma métrica.
5. Nada en el asistente se guarda sin confirmación del usuario. El asistente nunca escribe datos de negocio directamente.
6. Sin datos del negocio en el repositorio: ni costes, ni stock real, ni proveedores reales, ni personas. Los casos de
   prueba usan nombres genéricos. Ninguna clave con `NEXT_PUBLIC_`.
7. Producción: solo lectura y con la cuenta en modo pruebas. Las migraciones se aplican solo con
   `scripts/ops/aplicar-migracion.sh`.
8. Documentación en el mismo PR que el código. Los planes ejecutados van a `docs/historico`.
9. Respuestas en español. Comentarios en español, explicando el porqué o la regla del negocio.

---

## Fase 0. Medición honesta

**Problema.** La batería da 86/86 y la experiencia real es de un 38 % bien. La auditoría no guarda la respuesta, la vía
usada ni la latencia, y no se puede medir la calidad.

**Qué hacer.**

- **Auditoría completa.** Cada turno registra en `copilot_audit`: texto de la respuesta (recortado), vía que la produjo
  (`preroute`, `fast-path`, `office`, `jev`, `rescate`, etc.), especialista, latencia, si fue aclaración, y si la
  conversación siguió con una corrección o un «olvídalo». Añade migración numerada, pgTAP y tipos.
- **Panel de indicadores** (solo para administración, en Equipo o en una pantalla de diagnóstico). Calculado sobre la
  auditoría: porcentaje de respuestas que son aclaración; conversaciones con bucle (3 o más aclaraciones seguidas);
  conversaciones que acaban en aclaración sin resolver; borradores preparados y confirmados; p50 y p90 de latencia.
- **Conjunto de evaluación.** `scripts/ops/bateria-ciega.json` (24 conversaciones, 78 turnos) queda como conjunto de
  evaluación: se ejecuta con el mismo runner que la batería, pero **sin** expectativas automáticas. Se añade un juez
  (el propio modelo con una rúbrica fija: bien / a medias / mal, con la rúbrica en `docs/copiloto/EVALUACION.md`) y se
  calibra contra una muestra corregida a mano (al menos 30 turnos).
- **Conjunto de reserva.** Se escriben 40 turnos nuevos que no se usan para diseñar nada, guardados aparte, y solo se
  miran al cerrar cada fase.
- **Línea base publicada** en `docs/copiloto/EVALUACION.md`: métricas del uso real y de la prueba ciega, con fecha y
  versión del catálogo.

**Criterios de aceptación.**

- La auditoría tiene todos los campos nuevos en el 100 % de los turnos nuevos.
- Los indicadores salen en el panel con los datos de los últimos 30 días.
- La línea base queda documentada y se puede repetir con el mismo runner (dos ejecuciones seguidas no varían más de
  dos puntos porcentuales en el juez).

---

## Fase 1. Diálogo que avanza

**Problema.** Un formulario de «me faltan datos» ignora lo que la persona escribe después. Las respuestas libres a una
aclaración no casan con las opciones y se acumulan en una frase cada vez más larga. Un borrador no se puede corregir
(«mejor que sean 4»). Se pregunta por nombres exactos que sí existen. Aparecen 378 aclaraciones que las pide el propio
asistente, sin duda de Jev.

**Qué hacer.**

- **Estado de tarea en curso.** La conversación guarda una tarea (tipo, campos ya rellenos, campos que faltan, origen).
  Lo que se escribe después rellena el primer campo que falta y no vuelve a empezar la frase. Se evita concatenar el
  texto anterior.
- **Respuesta libre a una aclaración.** Si la respuesta no casa con ninguna opción, se intenta casar con el campo que
  falta antes de volver a preguntar. Si no casa, se pregunta **una vez** con las opciones tal cual, y después se
  resuelve con lo que haya.
- **Una aclaración por dato como máximo.** Tras una aclaración sin resolver, no se vuelve a preguntar lo mismo: se
  ofrece lo que sí se entiende y se pide la corrección en una frase.
- **Corregir el borrador activo.** Frases como «mejor que sean 4», «cámbialo a Parador», «sin la de zero» modifican el
  borrador pendiente y lo vuelven a mostrar. Nunca crean uno nuevo. Requiere un campo de edición por tipo de borrador
  (las operaciones de `DocumentDraft` ya tienen su editor en `drafts/`).
- **Nombres exactos.** Si la frase contiene un producto del catálogo tal cual (incluido «coca cola», «Boj 570
  Albariño»), no se aclara el producto.
- **Ignorar el ruido del diálogo.** «olvídalo», «cancela», «no» y «nada» cierran la tarea en curso sin aclaración.
- **Pedidos y traspasos con frases completas.** «quiero pedir 3 cocacolas y 3 larios» sin locales no pregunta origen y
  destino como si fuera un traspaso: pregunta el local una vez, o decide por el local activo si lo hay.

**Criterios de aceptación.**

- Batería ciega: 0 conversaciones con bucle (3 o más aclaraciones seguidas).
- Uso real (indicadores de la fase 0): aclaraciones ≤ 20 % de las respuestas; conversaciones que acaban sin resolver
  ≤ 8 %.
- Corrección de borrador: los 10 casos de la batería de corrección pasan (se añaden a `bateria-asistente.json`).
- Ningún nombre exacto de catálogo provoca una aclaración de producto (se mide con `sinAclarar`).

---

## Fase 2. Consultas que respetan los filtros

**Problema.** Casi todas las consultas (`src/copiloto/tools/info.ts` y el resto de `tools/`) devuelven el listado general
cuando la pregunta trae un proveedor, una persona, un número, una semana o un local. En la prueba ciega esto explica
6 de los fallos. Las preguntas de dos partes se responden solo en la primera.

**Qué hacer.**

- **Extracción de filtros por consulta.** Cada herramienta de consulta declara sus filtros admitidos (proveedor,
  persona, número, desde/hasta, local, zona, categoría, estado) con sus tipos. El extractor rellena los que aparezcan
  en la frase, con las mismas reglas de fechas de `entities/` (semana, mes, «la semana pasada»).
- **Filtro que no existe, dicho.** Si la frase pide un filtro que la herramienta no admite, la respuesta lo dice
  («no puedo filtrar por zona en facturas; las veo por proveedor o por fecha»), en vez de devolver todo.
- **Número de albarán o factura.** «el albarán A-4356» busca ese número o responde que no existe.
- **Preguntas de dos partes.** «¿cuánto le debo a X y qué vence esta semana?» responde las dos. Si una no se puede
  responder, se dice cuál.
- **Persona.** «qué permisos tiene Luis» devuelve solo esa persona. Se reconoce por nombre de Equipo sin pedir más datos.
- **Pruebas.** Un test por herramienta y filtro (en `src/copiloto/__tests__/` o junto a la herramienta), con datos de
  prueba, y un caso de batería por cada filtro.

**Criterios de aceptación.**

- Batería ciega: 0 respuestas que ignoran un filtro que la frase pide (se marca a mano en el juez).
- Cada herramienta de consulta tiene al menos un test de filtro por campo admitido.
- Las preguntas de dos partes se responden completas en al menos el 90 % de los casos del conjunto de la fase.

---

## Fase 3. Agente con herramientas, en sombra

**Problema.** La comprensión está hecha con reglas de texto encadenadas (unas 60 expresiones regulares en al menos 27
ficheros) y un clasificador de catálogo cerrado (Jev). Cada arreglo añade otra regla y la parte larga de lo que dice la
gente no se cubre. Esta fase cambia el reparto, según la decisión 1 del informe (sección 7), que debe estar aprobada
antes de empezar.

**Qué hacer.**

- **Diseño.** Un agente con herramientas tipadas (lectura, propuesta, edición de borrador, guía, no disponible), descritas
  en `docs/copiloto/CONTRACT.md`. Un modelo de lenguaje elige la herramienta y los argumentos. El código valida los
  argumentos con zod, aplica los permisos (RLS y alcance por cuenta, que no se tocan), calcula todas las cifras con
  `decimal.js` y devuelve el resultado. Ninguna cifra la escribe el modelo.
- **Sombra.** El agente corre en paralelo al camino actual, detrás de un interruptor por entorno (`COPILOTO_AGENTE=sombra`).
  Solo registra su decisión y su respuesta en la auditoría; no responde a la persona. Se compara turno a turno con el
  camino actual.
- **Activación gradual.** Primero, las consultas de lectura (sin borradores). Después, las propuestas, siempre con
  confirmación. Cada paso se mide antes de seguir.
- **Coste y tiempo.** Presupuesto de tokens por mensaje y tope de herramientas por turno (p. ej. 4). Se registra el coste
  por turno en la auditoría.
- **Jev.** Pasa a verificador de las operaciones de riesgo (las que mueven stock o dinero), o se retira del camino de
  lectura, según lo que diga la comparación en sombra. Su catálogo se conserva como lista de intenciones conocidas.
- **Ruta de vuelta.** Si el agente falla, el camino actual responde. El interruptor se puede apagar sin desplegar.

**Criterios de aceptación.**

- En sombra, al menos 500 turnos reales (o 3 ciclos completos de la batería ciega) con la comparación publicada.
- Batería ciega con el agente activado: ≥ 85 % de respuestas «bien», ninguna respuesta con una cifra no devuelta por
  una herramienta, y 0 bucles.
- Latencia: p90 < 3 s en lectura; p90 < 6 s en propuestas.
- Ninguna operación de escritura cambia de camino sin confirmación explícita (se prueba con casos que intentan
  confirmar sin que el usuario lo diga).

---

## Fase 4. Huecos funcionales

**Problema.** Hay peticiones razonables sin camino: crear un proveedor, desarchivar, «quién ha creado este producto»,
«cómo se hace un plato», el contacto de un proveedor, días de reparto, productos sin precio, comparativas (qué proveedor
lo vende más barato, en qué local se pierde más en mermas, stock parado), instrucciones de una receta. Hoy se responde
«no sé», o peor, otra cosa.

**Qué hacer.** Por cada hueco de la lista de R5 del informe:

- Si el asistente **puede** hacerlo con confirmación: herramienta de propuesta o consulta, con su borrador, su prueba y
  su caso de batería.
- Si **no** debe hacerlo (p. ej. invitar personas, cambiar permisos): respuesta `no_disponible` que dice dónde se hace
  («se hace en Equipo › Invitar persona»). Sin lista de capacidades.
- Si es una **guía** («cómo se hace…»): respuesta con los pasos, sacados de la ayuda de la app (`docs/`, `capacidades.md`),
  no datos del negocio.
- «Dish vs product»: si el nombre coincide con un plato y con un producto, se pregunta una vez y se recuerda la elección
  en la conversación.

**Criterios de aceptación.**

- Cada hueco tiene su caso en la batería y su caso en la prueba ciega.
- Ninguna petición de la lista de R5 termina en «fuera de ámbito» o en la lista de capacidades.
- `capacidades.md` y el mapa de capacidades (`docs/copiloto/ESPECIALISTAS.md`) reflejan exactamente lo que hace el
  asistente; se comprueba con un test que compara el registro de herramientas con el documento.

---

## Fase 5. Sentido común de datos y búsqueda de productos

**Problema.** La base de producción tiene cifras imposibles que el asistente repite sin aviso: stock valorado en
negativo, food cost del 3 %, cientos de productos «a reponer», productos de prueba. La búsqueda de productos es por
parecido de letras (en producción la búsqueda semántica está apagada: `EMBED_PROVIDER=none`), y de ahí salen confusiones
como «zero» frente a «zero zero» y «albaranes» frente a «albariño».

**Qué hacer.**

- **Validadores de cifras.** Antes de responder, un validador comprueba rangos sensatos (stock negativo, margen fuera de
  [-100 %, 100 %], food cost fuera de lo razonable, cantidades por encima de un múltiplo del histórico). Si una cifra no
  pasa, la respuesta lo dice junto a la cifra: «revisa: stock negativo, probablemente falta una recepción».
- **Limpieza.** Se propone (no se ejecuta) un plan de limpieza de datos con cifras y listado de productos, para que lo
  apruebe el propietario. La limpieza en producción no se ejecuta desde el asistente.
- **Búsqueda de productos.** Activar la búsqueda semántica con el proveedor de embeddings que se aprueba (decisión
  del informe). Hasta entonces, búsqueda por parecido con reglas explícitas para pares conocidos (zero/zero zero,
  albaranes/albariño), y las pruebas de esos pares en la batería.
- **Respuestas de confusión.** Si el mejor candidato tiene una puntuación baja, se muestran hasta tres opciones con
  nombre completo; nunca se elige una en silencio.

**Criterios de aceptación.**

- Ninguna cifra imposible se muestra sin aviso (se prueba con un conjunto de cifras anómalas sintéticas).
- Búsqueda: producto correcto en el primer resultado en ≥ 95 % del conjunto de pares de prueba (sin datos reales).
- Ningún producto se elige en silencio cuando la puntuación es baja.

---

## Fase 6. Pulido del panel

**Problema.** La lista de capacidades es un muro de texto y sale como respuesta de reserva. El formulario de «me faltan
datos» aparece aunque los datos ya estén escritos. Se ven textos internos («Entiendo: «¿qué pedido quieres consultar?»»
y «Revisa el producto: Coca-Cola» sin motivo).

**Qué hacer.**

- **Respuesta corta primero.** Cifra o frase clave, tabla breve si procede, y «ver más» para el detalle. Máximo 1–3
  botones de acción.
- **Capacidades breves.** La lista de capacidades cabe en una tarjeta con tres opciones y un enlace a la ayuda completa.
- **Sin textos internos.** Los mensajes de sistema no salen al usuario; se prueba con una búsqueda de frases prohibidas
  en las respuestas de la batería (p. ej. «Entiendo:», «Revisa el producto:» sin motivo).
- **Corrección visible.** Botones «cambiar cantidad», «cambiar local», «cancelar» en el borrador.
- **Diseño.** Revisar el panel en teléfono (16 px de margen, sin desplazamiento horizontal), con capturas a 2× para
  la revisión.

**Criterios de aceptación.**

- Ninguna respuesta de la batería contiene frases internas prohibidas.
- Uso real (indicadores de la fase 0, tras la fase): aclaraciones < 15 %, abandono < 5 %, borradores confirmados > 50 %.
- Prueba de panel en teléfono y escritorio, con capturas revisadas.

---

## 4. Después de la fase 6: aprendizaje continuo

- Los `copilot_feedback` (opiniones) se etiquetan con la misma rúbrica del juez y alimentan la batería en un paso
  semanal, revisado a mano.
- Cada mes, un conjunto ciego nuevo de al menos 40 turnos, escrito por alguien que no ha visto el sistema en el último
  mes, sustituye al anterior.
- Si una métrica empeora dos meses seguidos, se abre una tarea antes de añadir funciones.

---

## 5. Qué no hacer

- No ajustar la batería ciega para subir la nota. Los casos fallidos se usan para arreglar el sistema.
- No añadir una regla de texto nueva sin preguntarse antes si el modelo o el filtro ya la cubre. El objetivo de la fase
  3 es reducir reglas, no sumarlas.
- No mezclar el cambio de arquitectura (fase 3) con arreglos de diálogo o de respuestas; cada uno en su PR.
- No desplegar una fase sin su línea base medida y sin `npm run check`.
