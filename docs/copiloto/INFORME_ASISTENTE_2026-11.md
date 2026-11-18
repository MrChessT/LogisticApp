# Informe del asistente · 18 de noviembre de 2026

Auditoría completa del asistente de LogisticApp (`src/copiloto` y el panel `src/components/copiloto`): cómo se usa de
verdad, cómo responde a preguntas nuevas, cuánto tarda, cómo está construido y por qué falla. Termina con la
arquitectura objetivo y el plan por fases. El encargo para ejecutarlo está en
[PROMPT_MEJORA_ASISTENTE.md](PROMPT_MEJORA_ASISTENTE.md).

Sin datos del negocio: las cifras de la base de datos se dan como proporciones o descritas, no los importes.

---

## 1. Resumen

- **En uso real, la mitad de las respuestas son preguntas.** En 104 conversaciones de personas (561 mensajes), el
  50 % de las respuestas son aclaraciones. El 18 % de las conversaciones tiene bucles (3 o más aclaraciones
  seguidas; la peor, 20) y el 16 % acaba con una aclaración sin resolver: la persona se rinde.
- **Ante preguntas nuevas acierta 4 de cada 10.** En una prueba ciega de 64 mensajes realistas, escritos sin mirar
  la batería: 38 % bien, 25 % a medias, 38 % mal. La batería oficial da 86/86 sobre el mismo producto: está
  ajustada a lo que ya funciona y no mide la experiencia real.
- **Los fallos tienen pocas causas, y son de diseño:**
  - la comprensión se hace con reglas de texto encadenadas y un clasificador de catálogo cerrado;
  - las consultas no recogen filtros («de Makro», «esta semana», «de Luis», «el albarán A-4356»);
  - el diálogo no sabe completar ni corregir: un formulario ignora lo que escribes y un borrador no se puede
    cambiar («mejor que sean 4»);
  - en producción no hay búsqueda semántica ni redacción, solo letras parecidas y plantillas.
- **La velocidad no es el problema:** mediana de 0,5 s y el 90 % por debajo de 1,7 s.
- **Los datos de producción tienen cifras imposibles que el asistente repite sin avisar:** stock valorado en
  negativo, food cost del 3 %, cientos de productos «a reponer» y productos de prueba.
- **Lo que pide la gente:** «que haga lo que le pido sin preguntarme lo que ya sé», «que entienda el producto»,
  «que responda a lo que pido, no información a mansalva». En las opiniones de los usuarios hay 5 reportes de
  bucle y uno dice literalmente que la IA entiende lo que quieres, pero Jev se interpone.

Recomendación: corregir primero el diálogo y la medición (fases 0 a 2, sin cambiar la arquitectura). Después,
pasar a un agente con herramientas, en el que un modelo de lenguaje elige qué leer o qué proponer con
herramientas tipadas, y el código sigue calculando, validando y pidiendo confirmación (fase 3). Ese paso cambia la
regla actual «Jev decide»: es una decisión tuya (sección 7).

---

## 2. Cómo se ha medido

| Fuente | Qué es | Qué mide |
|---|---|---|
| Auditoría de producción (`copilot_audit`) | 6.322 registros desde el 23/09: tipo de mensaje, resultado y decisiones de Jev | Uso real: aclaraciones, bucles, abandonos |
| Opiniones (`copilot_feedback`) | 20 reportes de personas desde el panel | Qué molesta |
| Borradores (`copilot_drafts`) | 315 borradores; 14 confirmados | Si las operaciones llegan a buen puerto |
| Prueba ciega | 24 conversaciones y 78 turnos nuevos, escritos como los escribiría un encargado, sin mirar la batería. Se pasó en producción, sin confirmar nada. El conjunto está en `scripts/ops/bateria-ciega.json`. La calificación de la sección 3.2 (64 mensajes con contenido) se hizo a mano sobre esas respuestas; el juez automático aún no existe (fase 0) | Calidad ante lo desconocido |
| Batería oficial | 86 casos de `scripts/ops/bateria-asistente.json` en producción | Regresiones conocidas y latencia |
| Código | Tamaño por módulo, reglas de texto, vías de entrada, modelos configurados | Estructura |
| Panel | Capturas del panel en producción (bienvenida, formulario, borrador, respuestas) | Uso y claridad |

Para separar el uso de personas del de las pruebas automáticas se quitaron los mensajes idénticos a los de las
baterías y las conversaciones de las cuentas de pruebas.

---

## 3. Resultados

### 3.1 Uso real

| Indicador | Valor |
|---|---|
| Conversaciones de personas | 104 (561 mensajes) |
| Respuestas que son una aclaración | **50 %** |
| Consultas respondidas | 18 % |
| Tareas, guías y conversación | 22 % |
| Borradores preparados | 7 % |
| Conversaciones con un bucle (3 o más aclaraciones seguidas) | **18 %** (racha máxima: 20) |
| Conversaciones que acaban en una aclaración sin resolver | **16 %** |
| Borradores confirmados | 14 de 315 (4 %) |

De dónde salen las aclaraciones (todas las cuentas):
- **378 las pide el propio asistente** sin que ninguna decisión de Jev dude: un formulario de «me faltan datos»,
  «¿qué operación quieres registrar?» o «¿de cuál de estos productos?».
- **El resto vienen de dudas de Jev:** sobre la intención (70), el producto (68), la operación (31), el local (26),
  la consulta (24), la zona (20) y la coherencia del borrador (16).

Es decir, el problema es sobre todo el diseño del diálogo, no los umbrales.

Ejemplos reales:

- «inventario» → 9 aclaraciones seguidas.
- «todos» (para confirmar todos los traspasos pendientes) → 10.
- «crear zona» → 6.
- Las respuestas a una aclaración se acumulan en una frase cada vez más larga: «sube el precio del red bull. red
  bull sugarfree. consulta precio red bull sugarfree. hola».
- «quiero pedir 3 cocacolas y 3 larios» → pregunta local de origen y de destino como si fuera un traspaso, y acaba
  en error.
- Peticiones razonables que no tienen camino: crear un proveedor, desarchivar, «quién ha creado este producto»,
  «cómo se hace el chuletón», «albarán A-4356».

### 3.2 Prueba ciega (64 mensajes con contenido)

| Resultado | Mensajes | % |
|---|---|---|
| Bien | 24 | 38 % |
| A medias (útil pero incompleto, o con una pregunta innecesaria) | 16 | 25 % |
| Mal (no responde lo pedido, se enreda o da cifras sin sentido) | 24 | 38 % |

Por tema:

| Tema | Bien | Lo que falla |
|---|---|---|
| Stock (con seguimientos y erratas) | Casi todo | Aclaración innecesaria con un nombre exacto («coca cola») |
| Registrar en una frase completa (recepción, merma, inventario, alta de producto, archivar) | Bien | — |
| Registrar por pasos («registra una merma» → «larios» → «2 botellas») | Mal | El formulario ignora lo escrito y vuelve a salir; al final pregunta otra vez |
| Corregir un borrador («mejor que sean 4») | Mal | No existe |
| Pedidos | A medias | Ignora el proveedor dicho, o elige otro |
| Facturas y albaranes | Mal | Ignora filtros: proveedor, semana, número de albarán |
| Gestión («¿qué proveedor me la vende más barata?», «¿en qué local se pierde más en mermas?», «stock parado») | Mal | Responde otra cosa o pregunta en genérico |
| Escandallos | Bien | «Peor margen» responde otra cosa; «cómo se hace» da una receta genérica y no la ficha del plato |
| Equipo | A medias | «¿Qué permisos tiene Luis?» devuelve la lista de todos |
| Cosas que no sabe hacer (proveedor nuevo, desarchivar, teléfono, quién creó) | Mal | Aclaración genérica, «fuera de ámbito» o la lista entera de capacidades, en vez de «eso no lo hago aún; hazlo en…» |
| «¿Cómo se hace…?» (registrar un albarán, añadir un producto a una zona) | Mal | Da datos en vez de explicar |
| Charla y fuera de ámbito | Bien | — |

Causas, por frecuencia: filtros ignorados (6), lo escrito ignorado en un formulario (4), falta la función (4),
aclaración genérica (3), datos en vez de explicación (2), cifras imposibles (2), segunda pregunta ignorada (1),
proveedor equivocado (1), bucle de aclaración (1) y otras (10).

**Inestable según cómo se escriba:** en el panel, «que tal vamos este mes», justo después de un «olvídalo», devolvió
la lista de capacidades. En la prueba, «q tal vamos este mes» dio el resumen del mes.

### 3.3 Latencia

| | Mediana | p90 | Máximo |
|---|---|---|---|
| Batería oficial (86) | 0,45 s | 1,0 s | 3,3 s |
| Prueba ciega (78) | 0,52 s | 1,7 s | 3,1 s |

Va bien. Lo lento es lo que pasa por la IA de apoyo o por varios pasos (unos 1,5–3 s). Al pasar a un agente con
herramientas habrá que vigilarlo (objetivo: p90 por debajo de 3 s).

### 3.4 Lo que dicen las personas (opiniones)

| Tema | Reportes |
|---|---|
| Bucles y preguntas de más («si le he dado la acción y los datos, no tiene sentido que vuelva a preguntar») | 7 |
| No entiende el producto («puse zero y leyó zero zero») | 3 |
| Formato y exceso de información («tiene que dar respuesta a lo que se pide, no tirar información a mansalva») | 3 |
| Que pueda hacer todo lo de la app | 2 |
| «La IA detecta lo que quieres, pero se interpone Jev» | 1 |
| Traspaso con más cantidad que el stock, sin frenar | 1 |

### 3.5 El panel

Bien resuelto: la bienvenida con sugerencias por pantalla, las tarjetas de «lo que puedo hacer», el borrador con
sus avisos y la confirmación explícita, y la entrada de archivos (foto, PDF, Excel), voz y comandos `/`.

Lo que estorba:
- **La lista de capacidades** es un muro de texto y sale como respuesta de reserva a preguntas que no entiende.
- **El formulario de «me faltan datos»** aparece aunque ya se hayan escrito los datos.
- **No se puede corregir un borrador hablando.**
- **Se ven textos internos:** «Entiendo: «¿qué pedido quieres consultar?»» y avisos sin motivo («Revisa el
  producto: Coca-Cola»).

---

## 4. Cómo está construido (estado actual)

- **Tamaño:** unas 21.000 líneas en `src/copiloto` y 2.200 en el panel; 73 ficheros de pruebas.
- **Un mensaje pasa por hasta 10 vías, en orden:**
  1. corrector de jerga;
  2. archivo dado al chat;
  3. varias órdenes en una frase;
  4. comandos `/`;
  5. órdenes de oficina por reglas;
  6. respuestas fijas;
  7. temas de gestión por palabras clave;
  8. vía rápida de stock;
  9. Jev;
  10. la IA de apoyo (rescate o respuesta general).

  Cada vía decide con reglas de texto: hay unas 60 expresiones regulares en al menos 27 ficheros.
- **Jev** (TypeSafe) es un clasificador con un catálogo cerrado de preguntas, y sus «puertas» de probabilidad deciden
  si actuar, confirmar o preguntar. No entiende lo que no está en su catálogo.
- **IA de apoyo** (Haiku y otros por el AI Gateway de Vercel): solo para respuestas generales y para reescribir
  seguimientos, siempre validada por Jev.
- **En producción, redacción y búsqueda semántica están apagadas** (`WRITER_PROVIDER` y `EMBED_PROVIDER` en `none`).
  Las respuestas son plantillas y los productos se buscan por parecido de letras. De ahí «zero» frente a «zero zero»
  y «albaranes» confundido con «albariño».
- **Las consultas** (`tools/info.ts`) eligen la herramienta por palabras clave, pero casi ninguna extrae filtros, así
  que devuelven el listado general.
- **El estado de la conversación** guarda el foco (productos, local) y la aclaración pendiente, pero no un borrador
  activo editable ni datos a medio rellenar entre mensajes de texto.
- **La auditoría no guarda la respuesta, la latencia ni la vía usada.** Sin eso no se puede medir la calidad real.
- **Lo que está bien hecho y hay que conservar:**
  - los borradores con confirmación y validación (zod);
  - los permisos en la base de datos (RLS, alcance por cuenta y local);
  - las cifras con `decimal.js`;
  - el registro de especialistas;
  - la lectura de archivos;
  - las pruebas y la batería.

### Por qué falla, en una frase

**La comprensión se construye sumando reglas.** Cada arreglo añade otra: «albaranes» frente a «albariño», «Boj 570»
partido en dos, «alabran». Cada regla tapa un caso y deja abiertos los parecidos, así que la parte larga de lo que
dice la gente nunca se cubre. La batería, que crece con los casos arreglados, da 100 % mientras la experiencia real
se queda en el 40 %.

---

## 5. Causas raíz, por impacto

| # | Causa | Síntomas | Impacto |
|---|---|---|---|
| R1 | Diálogo sin estado de «tarea en curso»: lo escrito no rellena el formulario, la respuesta libre a una aclaración no casa con las opciones, no se puede editar el borrador activo, las frases se encadenan | Bucles, abandono, «mejor que sean 4» | Muy alto |
| R2 | Comprensión por reglas y por un clasificador de catálogo cerrado | Respuestas distintas según cómo se escriba; la parte larga de lo que dice la gente no se cubre; aclaraciones genéricas | Muy alto |
| R3 | Las consultas no extraen filtros (proveedor, fechas, número, persona, categoría, local) | «¿Cuánto le debo a Makro?» da el total de todos | Alto |
| R4 | Sin búsqueda semántica ni redacción en producción | Confunde productos y da respuestas rígidas | Alto |
| R5 | Huecos funcionales: proveedor nuevo, desarchivar, quién hizo qué, contacto del proveedor, guías «cómo se hace», comparativas (más barato, mermas por local, stock parado), instrucciones de receta, pedido al proveedor indicado | «No sé», o peor: otra cosa | Medio-alto |
| R6 | Datos de producción imposibles repetidos sin sentido común | Stock en negativo, food cost del 3 %, cientos «a reponer» | Medio (destruye la confianza) |
| R7 | Medición engañosa: batería ajustada, auditoría sin respuesta ni latencia, sin indicadores de resultado | Se cree que va bien | Alto (impide mejorar) |
| R8 | Respuestas de reserva malas: lista de capacidades o «fuera de ámbito» ante lo no entendido | Sensación de que no escucha | Medio |

---

## 6. Arquitectura objetivo

```
Panel ──► Entrada (jerga, archivo leído, borrador activo, foco)
            │
            ▼
      Agente con herramientas (modelo de lenguaje, p. ej. Claude por el AI Gateway)
       · entiende la frase y el contexto (historial corto, foco, borrador activo, catálogo resumido)
       · llama herramientas TIPADAS:
           lectura ─ stock(producto?, local?, zona?), movimientos(…, desde, hasta),
                     compras(proveedor?, categoría?, desde, hasta), facturas(proveedor?, estado?, vence_antes?),
                     albaranes(proveedor?, número?, desde, hasta, sin_factura?), ventas(…), escandallo(plato, campo?),
                     equipo(persona?), catálogo(salud?, archivados?), auditoría(entidad, acción?) …
           propuesta ─ proponer_merma | traspaso | recepción | pedido | precio | proveedor | … (devuelven BORRADOR)
           edición ─ editar_borrador_activo(campo, valor)
           ayuda ─ guía(tema)  ·  no_disponible(qué, dónde hacerlo)
            │
            ▼
      Código (lo que ya existe y se conserva): permisos y alcance (RLS), cálculos con decimal.js, validadores
      (unidades, stock, coherencia), sentido común de datos, borradores con confirmación, auditoría
            │
            ▼
      Respuesta: corta y estructurada (cifra clave + tabla breve + 1–3 botones), sin muros de texto
```

Principios:
- **Nada se guarda sin confirmar.** Se sigue igual: el agente solo propone borradores.
- **Las cifras las calcula siempre el código.** El modelo nunca escribe un número que no venga de una herramienta;
  se comprueba en la respuesta.
- **Una sola aclaración por dato.** Si falta algo, se pregunta lo justo, con opciones. Lo que se escriba después
  rellena el hueco; no vuelve a empezar.
- **Lo no soportado se dice:** «Eso no lo hago todavía; se hace en Proveedores › Nuevo».
- **Jev** pasa a ser un verificador opcional en las operaciones de riesgo, o se retira, según lo que dé la medición
  en sombra.
- **Medir siempre en ciego,** con casos nuevos en cada ronda, y en uso real con indicadores de resultado.

---

## 7. Decisiones que te tocan

1. **Cambiar la regla «Jev decide y el código calcula; la IA solo interpreta o redacta».** Propuesta: «la IA decide
   qué leer o qué proponer con herramientas; el código calcula, valida y pide confirmación». Es la causa de fondo
   del techo actual. Se puede hacer por fases, en sombra y con marcha atrás.
2. **Modelo y coste.** Un agente con herramientas usa un modelo más capaz (tipo Sonnet) para entender, y uno rápido
   (tipo Haiku) para lo simple. Hay que fijar un presupuesto por mensaje.
3. **Limpieza de datos de producción** (stock negativo, productos de prueba, artículos del TPV sin enlazar). Es
   independiente del asistente, pero sin ella las respuestas seguirán dando cifras imposibles.
4. **Qué no se hará desde el chat** (hoy: invitar personas y cambiar permisos). Confirmar la lista.

---

## 8. Plan por fases (resumen)

El detalle, con criterios de aceptación y entregables, está en [PROMPT_MEJORA_ASISTENTE.md](PROMPT_MEJORA_ASISTENTE.md).

| Fase | Qué | Criterio de salida |
|---|---|---|
| 0 | Medición honesta: la auditoría guarda respuesta, vía, latencia y resultado; indicadores de aclaraciones, bucles, abandono y borradores confirmados; batería ciega ampliada con un juez | Línea base publicada y repetible |
| 1 | Diálogo: lo escrito rellena lo pendiente, editar el borrador activo, nunca más de una aclaración por dato, «no disponible» honesto, guías «cómo se hace», sin aclarar nombres exactos | Ciega: 0 bucles, aclaraciones ≤ 20 % |
| 2 | Filtros en todas las consultas (proveedor, fechas, número, persona, local, categoría) y varias preguntas en una | Ciega: 0 filtros ignorados |
| 3 | Agente con herramientas, en sombra y detrás de un interruptor; se compara con el actual | Ciega ≥ 85 % bien; p90 < 3 s; ninguna cifra inventada |
| 4 | Huecos funcionales (sección 5, R5) | Cada hueco con su prueba y su caso ciego |
| 5 | Sentido común de datos y búsqueda semántica de productos | Ninguna cifra imposible sin aviso; producto correcto ≥ 95 % |
| 6 | Pulido del panel: respuestas cortas y «ver más», botones de corrección, capacidades breves | Uso real: aclaraciones < 15 %, abandono < 5 %, borradores confirmados > 50 % |
