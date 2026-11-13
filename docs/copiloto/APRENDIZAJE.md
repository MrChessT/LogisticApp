# Aprendizaje del asistente: atajos, glosario y coste por acción

Estado: **propuesta de diseño**, sin implementar. Las referencias a código son de la rama actual.
Ámbito: cómo el asistente resuelve cada vez más peticiones sin usar un modelo de lenguaje, y cómo se
mide que lo hace bien y barato. Complementa a [JEV.md](JEV.md) (el asistente hoy) y a
[capacidades.md](capacidades.md) (qué se puede hacer desde el chat).

## 1. Objetivo y principios

**Objetivo.** Que el coste por acción confirmada baje con el uso de cada organización, sin bajar la
fiabilidad ni subir las aclaraciones.

**Principios** (no negociables; cualquier cambio se contrasta con ellos):

1. **Nada se ejecuta sin confirmación.** Un atajo propone un borrador; quien confirma es una persona.
   Ningún aprendizaje relaja esta regla.
2. **Los atajos guardan referencias, no valores.** Un atajo recuerda «producto X», nunca «precio 1,20 €».
   Los precios, el stock y las condiciones se leen en cada ejecución.
3. **El código calcula, el modelo solo interpreta.** Un atajo no introduce cifras nuevas: las cifras
   salen de la base de datos y de `decimal.js`.
4. **Aprender dentro de la organización.** Los glosarios, atajos y firmas de una organización no se
   usan en otra. Ningún dato de negocio sale del tenant ni entra a un modelo compartido.
5. **Medir antes de optimizar.** Cada fase tiene un criterio de salida medido; sin medida, no se avanza.

## 2. Estado actual (lo que ya existe)

Verificado en el código de esta rama:

| Pieza | Dónde | Qué hace hoy | Limitación para aprender |
| --- | --- | --- | --- |
| Comandos `/…` | `agent/shortcuts.ts` | Atajos fijos (`/stock`, `/informes`…) | Fijos en código; no se aprenden. |
| Respuestas fijas | `agent/fixed-replies.ts` | Contestan temas sin LLM | Fijas en código. |
| Órdenes de oficina | `agent/office-actions.ts` | Reglas para pagar, validar, PVP, zonas, escandallos… | Reglas escritas a mano, una por operación. |
| Preruta | `agent/preroute.ts` | Orden de los atajos antes de Jev | Sin registro de qué atajo se usa. |
| Hábitos | `agent/habits.ts` | Contadores de locales y productos usados | Solo ordena aclaraciones; nunca decide. Sin firma de operación. |
| Auditoría | `copilot_audit` (migración 0005) e `supabase/audit-sink.ts` | Mensaje, intención, borrador, confirmación, bloqueo | Ver punto 2.1. |
| Interpretación LLM | `interpret/`, `agent/comprehension.ts`, rescate validado por Jev | Lee el lenguaje cuando lo anterior no basta | Sin caché ni medida de coste por caso. |

### 2.1 Hueco crítico: la auditoría no permite detectar repeticiones

- El evento `borrador` guarda `message_id`, `draft_id`, `outcome` (tipo de borrador) y `coherence`.
  **No guarda la operación** (`operation`: pagar_factura, crear_escandallo…) **ni las entidades** elegidas.
- El evento `mensaje` guarda el texto (hasta 500 caracteres) y la intención, pero no el plan.
- El evento `confirmacion` guarda `draft_id`, `ok` y el tipo, pero no la operación.

Sin la operación y las entidades no se puede decir si dos peticiones son «la misma». Se corrige en la
fase F0 (sección 9), con una migración numerada, su test pgTAP y los tipos de `database.types.ts`.

### 2.2 Privacidad del registro actual

El texto de cada mensaje se guarda en `copilot_audit.detail.message`. Eso ya es un dato sensible (puede
mencionar costes o proveedores). Las nuevas estructuras de aprendizaje **no copian texto de mensajes**:
guardan firmas y referencias por identificador. Para el texto ya existente se propone una retención de
90 días, decidida en la sección 12.

## 3. Arquitectura por capas

Cada petición baja por las capas en orden y se resuelve en la primera que tenga confianza suficiente.
El coste crece de arriba abajo.

```
Petición del usuario
  │
  ├─ L0  Comandos y respuestas fijas ─────────── coste 0   (hoy: shortcuts, fixed-replies)
  ├─ L1  Atajos aprendidos y aprobados ───────── coste 0   (NUEVO: plantillas con referencias)
  ├─ L2  Parser tipado + glosario propio ─────── coste 0   (hoy: reglas; NUEVO: glosario)
  ├─ L3  Jev: clasificación y campos ─────────── coste bajo (hoy: Jev, modelo pequeño)
  ├─ L4  LLM con contexto recuperado ─────────── coste medio (hoy: comprensión, rescate)
  │
  └─ Borrador tipado ──► validación (schemas, RLS) ──► confirmación humana ──► función de base de datos
```

Reglas de paso entre capas:

- **L1 no sustituye a L2 si hay ambigüedad.** Si un atajo encaja con dos productos, se pregunta, igual
  que hoy.
- **L3 y L4 solo proponen planes tipados** (`DocumentPlan`, `ClarifyPlan`, `QueryPlan`). Nunca escriben.
- **Toda salida de una capa pasa por la misma validación** (`validateDraft`). Un atajo no tiene una vía
  propia hacia la base de datos.

### 3.1 Qué añade esta propuesta

- **L1 (atajos).** Plantillas de plan con huecos. Ejemplo: «`operacion=precio_venta`,
  `plato=<referencia>`, `precio=<número de la frase>`». Se activan solo tras aprobación.
- **L2 (glosario).** Tabla de términos de la organización que se resuelven a entidades (sección 5).
- **Firma de plan.** Identificador estable de la forma de un plan, sin valores (sección 4.1).

## 4. Ciclo de aprendizaje

```
observar ──► proponer ──► revisar ──► activar ──► vigilar ──► retirar
 (auditoría)  (cuando cumple   (encargado,     (tasa de      (caducidad o
              umbrales)         con batería)    correcciones) corrección alta)
```

### 4.1 Observar: la firma de un plan

La firma es una cadena estable que describe la forma del plan, sin valores concretos:

```
firma = operacion + ":" + [tipo de entidad de cada hueco, en orden] + ":" + [forma del texto]
ejemplo: "precio_venta:plato:numero"
```

Se calcula en el servidor, a partir del plan confirmado. Se guarda en `copilot_audit.detail.signature`
(F0). Los valores (nombres de producto, cantidades) no entran en la firma.

### 4.2 Proponer: umbrales iniciales

Una firma se **propone** como atajo cuando, en los últimos 60 días, cumple las tres condiciones:

- al menos **5** planes confirmados con la misma firma;
- **0** correcciones o cancelaciones en esos planes, o menos del **5 %** de ellos;
- las entidades resueltas son **referencias vigentes** (producto, plato, proveedor que siguen activos).

Estos valores son de partida. Se calibran en F0 con datos reales y se documentan aquí al cambiarlos.

### 4.3 Revisar y activar

- Un **encargado o administrador** aprueba la propuesta. Ve la forma del atajo en lenguaje claro
  («pagar factura por nombre de proveedor»), nunca el texto de los mensajes que lo originaron.
- Antes de activarse, la plantilla pasa la **batería del asistente** (`scripts/ops/bateria-asistente.json`)
  con un caso nuevo generado a partir de la firma.
- Un atajo activo siempre produce un **borrador**. Nunca confirma.

### 4.4 Vigilar y retirar

- Cada uso registra `shortcut_id` y `shortcut_version` en la auditoría.
- Un atajo se **retira** automáticamente si:
  - pasa **60 días sin uso**, o
  - su tasa de corrección supera el **10 %** en los últimos 20 usos.
- Cambiar una regla de negocio (p. ej., cómo se validan las salidas) **sube la versión** de los atajos
  afectados y los deja en estado «revisar».

## 5. Glosario propio de la organización

El glosario traduce el lenguaje de cada negocio a entidades: «la coca» → producto `Coca-Cola 20 cl`,
«la barra» → zona `Barra 1` del Parador, «los rones» → familia `Destilados`.

**Origen de los términos:**

1. **Manual.** Un encargado lo añade en Ajustes del asistente.
2. **Por corrección.** Si el usuario cambia un producto propuesto (A) por otro (B), y la frase contenía
   un término no reconocido T, se propone la entrada `T → B`. Solo se propone si T aparece en al menos
   **3** correcciones distintas hacia la misma entidad.

**Reglas:**

- Un término que apunta a dos entidades distintas **no se usa** hasta que un encargado lo resuelva.
- Las entradas guardan referencias y contadores, nunca el texto completo de la frase.
- El glosario se usa en L2 (parser), antes de Jev. Así una corrección enseñada una vez no vuelve a costar
  una aclaración.

## 6. Modelo de datos (propuesto)

Todas las tablas llevan `org_id`, RLS por pertenencia a la organización y permisos de escritura solo
para encargados o administradores. Las migraciones van numeradas, con test pgTAP y tipos regenerados.

| Tabla | Contenido | Notas |
| --- | --- | --- |
| `copilot_audit` (ampliar `detail`) | `operation`, `signature`, `entity_refs` (tipo + id), `shortcut_id`, `shortcut_version` | Inmutable (trigger ya existente). Ampliar `detail` no requiere cambiar el esquema. |
| `assistant_shortcuts` | `id`, `org_id`, `signature`, `template` (jsonb con huecos por referencia), `version`, `status` (`propuesto`, `activo`, `revisar`, `retirado`), `approved_by`, `last_used_at` | El `template` no contiene valores de negocio. |
| `assistant_glossary` | `org_id`, `term` (normalizado), `entity_kind`, `entity_id`, `source` (`manual`, `correccion`), `hits`, `corrections`, `status` | Un término puede tener varias entidades en estado `ambiguo`. |

Ninguna tabla nueva guarda texto libre de mensajes.

## 7. Optimización de costes

- **Contexto mínimo.** Por turno, el modelo recibe solo los candidatos devueltos por la búsqueda, nunca el
  catálogo completo. Las instrucciones fijas van en la caché de prompts del proveedor.
- **Modelo por nivel.** L3 usa el modelo pequeño. L4 usa el modelo grande solo si L3 no decide. Las
  reglas de cambio de modelo se documentan en [JEV.md](JEV.md) al tocarlas.
- **Presupuesto por organización.** Un tope mensual de tokens por organización, con aviso al 80 %. Al
  llegar al tope, el asistente sigue funcionando en L0–L2 y responde que la interpretación libre está
  pausada. No se corta el servicio.
- **Lotes para trabajo sin prisa.** Importaciones, lectura masiva de albaranes e informes nocturnos van
  por procesamiento por lotes, no en tiempo real.
- **Medida, no estimación.** Cada llamada registra tokens de entrada y salida y la capa que la pidió.

## 8. Métricas

| Métrica | Definición | Dirección esperada | Referencia actual |
| --- | --- | --- | --- |
| Cobertura sin modelo | Acciones resueltas en L0–L2 / total de acciones | Sube | Por medir (F0) |
| Coste por acción confirmada | Tokens × precio / borradores confirmados | Baja | Por medir (F0) |
| Tasa de aclaración | Mensajes que terminan en aclaración / mensajes que llegan a Jev | Baja | **44 %** (medición en producción, incluye baterías) |
| Tasa de confirmación | Borradores confirmados / borradores generados | Sube | Por medir (F0) |
| Tasa de corrección de atajos | Atajos usados que el usuario corrige o cancela / usos | Baja, bajo 10 % | No existe |
| Latencia p95 hasta borrador | Tiempo desde el envío hasta el borrador, por capa | Baja | Por medir (F0) |
| Batería | Casos que pasan | No empeora | 50/52 en la última ejecución de producción; ver nota en la sección 11 |

La tasa de aclaración de 44 % incluye las baterías de prueba, por lo que no es una medida limpia del uso
real. F0 la separa.

## 9. Fases

### F0. Medir (sin cambiar comportamiento)

- Migración: ampliar `copilot_audit.detail` con `operation`, `signature` y `entity_refs` en los eventos
  de borrador. Test pgTAP y tipos.
- Separar en la auditoría el tráfico de baterías del tráfico real (marca de origen).
- Informe mensual: cobertura sin modelo, coste por acción, tasa de aclaración real, latencia.
- **Criterio de salida:** al menos 4 semanas de datos reales con firmas, y el informe publicado en el
  repositorio sin datos de negocio (solo cifras agregadas).

### F1. Glosario

- Tablas `assistant_glossary`, entrada manual en Ajustes y propuesta por corrección.
- L2 consulta el glosario antes de Jev.
- **Criterio de salida:** la tasa de aclaración baja en los términos del glosario sin subir la tasa de
  corrección global.

### F2. Atajos propuestos y aprobados

- Tabla `assistant_shortcuts`, propuesta automática, aprobación por encargado, batería antes de activar.
- L1 en `preroute.ts`, detrás de L0 y antes de Jev.
- **Criterio de salida:** cobertura sin modelo que sube, tasa de corrección de atajos bajo 10 %, y la
  batería sin casos nuevos fallando.

### F3. Vigilancia y caducidad

- Retirada automática, versiones, panel de atajos para administración.
- **Criterio de salida:** ningún atajo activo sin uso reciente o con corrección alta.

### F4. Condicional: entrenar un modelo propio

No se hace salvo que F1–F3 estén medidas y la cobertura se estanque por motivos que el glosario y los
atajos no resuelven. Cualquier entrenamiento respeta el principio 4: datos de una sola organización y
sin reutilizarlos en otras.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Un atajo aprende una mala asociación y se repite | Umbrales de la sección 4.2, aprobación humana y retirada por corrección. |
| Un atajo queda obsoleto (catálogo o reglas cambian) | Referencias vivas, versión y revisión al cambiar una regla. |
| El glosario mezcla dos significados | Estado `ambiguo` y pregunta hasta resolverlo. |
| Coste de aprendizaje mayor que el ahorro | F0 mide primero; si la cobertura no sube, no se pasa a F2. |
| Fuga de datos entre organizaciones | Tablas con `org_id` y RLS; firmas sin valores; nada agregado entre organizaciones. |
| Escritura sin confirmación por un atajo | Un atajo solo produce borradores. Test específico en la batería. |
| Arranque en frío de una organización nueva | Importación de datos y carga del glosario en el onboarding. |

## 11. Relación con la batería

- La batería (`scripts/ops/bateria-asistente.json`) es la puerta de calidad de cada fase.
- Cada atajo aprobado genera un caso de batería con su firma.
- Cada fallo que se arregle añade un caso, como exige [CLAUDE.md](../../CLAUDE.md).
- Nota: la última ejecución en producción tuvo 2 fallos, ya corregidos en la expectativa (no en el
  comportamiento) y pendientes de comprobar tras el despliegue.

## 12. Decisiones abiertas

1. **Retención del texto de mensajes** en `copilot_audit`: ¿90 días? ¿Anonimizar tras 30 días?
2. **Quién aprueba atajos:** ¿solo administración, o también encargados?
3. **Umbrales** de la sección 4.2: se fijan con datos de F0, no antes.
4. **Facturación del extra** (aprendizaje por uso): fuera de este documento; depende de F0.
5. **Caducidad de términos del glosario** sin uso: ¿cuánto tiempo?

## 13. Reglas que este diseño respeta

- Stock solo cambia por funciones de la base de datos; `stock_movements` es inmutable.
- Cantidades y dinero con `decimal.js`, en unidad base.
- Permisos decididos por la base de datos (RLS), no por la pantalla.
- Jev decide, el código calcula; la IA de apoyo solo interpreta o redacta, validada.
- Nada se guarda sin confirmación.
- Sin datos del negocio en el repositorio: este documento solo contiene diseño y cifras agregadas.
