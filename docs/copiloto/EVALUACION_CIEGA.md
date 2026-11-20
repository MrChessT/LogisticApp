# Evaluación ciega del asistente

La batería (`scripts/ops/bateria-asistente.json`) comprueba que lo que ya funcionaba sigue funcionando: da 86/86 y
no dice nada de cómo responde a lo que la gente escribe de verdad. Esto sí: frases nuevas, escritas como las diría un
encargado, calificadas con una rúbrica fija. Es la medida del plan de mejora
([PROMPT_MEJORA_ASISTENTE.md](PROMPT_MEJORA_ASISTENTE.md)), junto con los indicadores de uso real (pantalla
Opiniones, migración 0062) y la batería de decisiones de reposición (`src/copiloto/__tests__/bateria-decisiones.test.ts`).

## Conjuntos

| Fichero | Qué es | Cuándo se mira |
|---|---|---|
| `scripts/ops/bateria-ciega.json` | 24 conversaciones, 78 turnos | En cada fase, antes y después |
| `scripts/ops/bateria-ciega-calificada.json` | La calificación manual del 18/11 (64 turnos con contenido): la referencia para calibrar el juez | Al calibrar |
| `scripts/ops/bateria-reserva.json` | 18 conversaciones, 40 turnos que no se usan para diseñar nada | Solo al cerrar cada fase |

Reglas:

- **No se ajusta el sistema a una frase del conjunto.** Si un turno sale mal, se arregla la causa, y el caso arreglado
  (con otras palabras) va a la batería normal.
- **Cada mes, un conjunto nuevo** de al menos 40 turnos, escrito por alguien que no haya visto el sistema ese mes;
  el anterior pasa a ser parte de la batería.
- Los ficheros no llevan datos del negocio: ni las respuestas (con cifras) ni nombres de personas reales.

## Cómo se pasa

```bash
# 1. Respuestas (cuenta en modo pruebas; no se confirma nada)
BATERIA_SALIDA=/tmp/ciega.json node scripts/ops/bateria-asistente.mjs scripts/ops/bateria-ciega.json

# 2. Notas con el juez (AI Gateway: AI_GATEWAY_API_KEY o VERCEL_OIDC_TOKEN; modelo en JUEZ_MODELO)
node scripts/ops/juez-ciega.mjs /tmp/ciega.json > /tmp/notas.json
node scripts/ops/juez-ciega.mjs --resumen /tmp/notas.json

# 3. Calibración del juez contra la calificación manual (objetivo: 80 % de coincidencia)
node scripts/ops/juez-ciega.mjs --calibrar /tmp/notas.json scripts/ops/bateria-ciega-calificada.json
```

Sin credencial del gateway, las notas se ponen con el mismo formato (`conversacion`, `usuario`, `nota`, `causa`,
`motivo`) y se resumen con `--resumen`. Así se hizo la línea base.

## Rúbrica

| Nota | Cuándo |
|---|---|
| **bien** | Responde exactamente lo pedido, con los filtros que la frase pide (proveedor, fechas, local, persona, número), sin preguntas innecesarias. Si propone una operación, el borrador es el que se pidió. Si algo no se puede hacer, lo dice y dice dónde se hace |
| **a medias** | Útil pero incompleto: falta un filtro o una parte, pregunta una vez algo que ya estaba claro, o lo correcto va enterrado en información que no se pidió |
| **mal** | No responde lo pedido, responde otra cosa, pregunta en genérico o repite la pregunta, ignora lo que se acaba de escribir, da cifras imposibles sin avisar o se inventa algo |

Causas (una por turno): `filtro_ignorado`, `segunda_parte_ignorada`, `aclaracion_innecesaria`, `aclaracion_generica`,
`bucle`, `ignora_lo_escrito`, `falta_funcion`, `datos_en_vez_de_explicacion`, `cifra_imposible`, `responde_otra_cosa`,
`proveedor_equivocado`, `otra`.

## Resultados

| Fecha | Versión | Bien | A medias | Mal | Juez |
|---|---|---|---|---|---|
| 18/11/2026 | Antes del plan de mejora | 24 (38 %) | 16 (25 %) | 24 (38 %) | A mano |
| 19/11/2026 | Fase 4 (reposición) y limpieza de datos | 25 (39 %) | 16 (25 %) | 23 (36 %) | A mano: solo se recalifican las respuestas que cambian |
| 20/11/2026 | Fases 1 y 2 (diálogo y filtros), en producción | 49 (77 %) | 7 (11 %) | 8 (12 %) | A mano: solo se recalifican las respuestas que cambian |

Causas en la línea base, de más a menos: filtro ignorado (8), responde otra cosa (7), falta la función (4), ignora lo
escrito (4), aclaración innecesaria (3), cifra imposible (3), aclaración genérica (3), otras (3), datos en vez de
explicación (2), proveedor equivocado (1), segunda parte ignorada (1), bucle (1).

El 19/11 solo cambian dos respuestas. El valor del stock de La Oliva deja de salir negativo tras limpiar los datos y
pasa de «mal» a «bien». El pedido «de makro» aplica la decisión de reposición, pero sigue sin decir que Makro no es un
proveedor dado de alta, así que sigue «a medias». La fase 4 apenas toca este conjunto: lo que más falla es el diálogo
(fase 1) y los filtros (fase 2), y es ahí donde se espera el salto.

El 20/11, con las fases 1 y 2 desplegadas, se acaban los bucles y lo escrito ignorado: la merma y el traspaso por
pasos llegan al borrador, «mejor que sean 4» corrige el borrador, «coca cola» no se pregunta y los filtros de
facturas, albaranes, equipo, gasto y comparativas se respetan (o se dice que el proveedor no existe). Lo que queda
mal es sobre todo funciones que faltan (desarchivar, quién creó un producto, alta de proveedor), explicaciones de
«cómo se hace» que salen con datos y dos aclaraciones genéricas.

Ese mismo día se pasó la **reserva** (40 turnos que no se usan para diseñar): 14 bien, 10 a medias y 16 mal. Esa
diferencia con la ciega es la que avisa de no ajustarse a un conjunto. De sus fallos salieron arreglos de causa, no
de frase: «olvídalo» con un borrador pendiente lo descarta (antes quedaba pendiente y lo siguiente se leía como
respuesta a él); cancelar con coletilla («déjalo, ya lo hago yo»); «apúntalo como rotura» corrige el motivo;
«¿está pagada la factura…?» es una pregunta, no la orden de pagarla; «prepara un pedido de…» es un pedido y «da de
alta…» un alta, aunque Jev dude; el gasto con un proveedor (o uno que no existe); quién no ha entrado nunca; los
platos de menos margen, y un dato suelto que no está en el catálogo («lo demás todo bien») ya no se toma por
producto. Cada uno tiene su caso, con otras palabras, en la batería normal. La reserva se vuelve a pasar al cerrar la
fase siguiente.

El juez con modelo no se ha podido pasar fuera de Vercel: la clave del AI Gateway de la sesión de desarrollo no
autoriza llamadas a modelos. La primera vez que se pase con credencial, se calibra contra
`bateria-ciega-calificada.json` antes de usar sus notas.
