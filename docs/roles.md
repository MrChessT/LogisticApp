# Roles y permisos

Qué ve y qué puede hacer cada persona en LogisticApp. La base de datos decide (RLS); la pantalla y el asistente
solo muestran lo que la base permite.

## 1. Idea central: alcance = cuenta de análisis × local

Cada producto pertenece a una **cuenta de análisis** (Bebida, Comida, Menaje, Packing y limpieza, Suministros,
Mantenimiento, Oficina). Cada persona tiene dos alcances independientes:

- **Cuentas**: qué cuentas ve y en cuáles actúa. Ejemplos: el cocinero ve solo Comida; la persona de oficina ve
  Suministros y Oficina, porque son gastos que paga la oficina.
- **Locales**: en qué locales (Vivero, La Oliva, Parador, Pickels…) ve y actúa. Puede ser todos o uno o varios.

El alcance efectivo es la intersección: se ve un dato si su cuenta está en el alcance de cuentas **y** su local está
en el alcance de locales. Lo que no entra en el alcance no aparece ni en pantalla ni en el asistente ni en un
informe, y no se puede consultar por otra vía.

Los costes y precios siguen la misma regla: cada persona ve los precios y costes **solo de sus cuentas**. Por eso
el cocinero ve precios de platos, de ingredientes y de Comida, pero no los de Bebida.

## 2. Modelo de datos

| Dato | Dónde | Qué decide |
|------|-------|-----------|
| Rol base | `memberships.role`: `owner`, `admin`, `manager`, `staff` | Nivel general de administración y de edición. |
| Todos los locales | `memberships.all_locations` | Si `false`, solo los locales de `membership_locations`. |
| Locales | `membership_locations` | Qué locales ve y en cuáles actúa. |
| Cuentas | `membership_accounts` (0055) | Sin filas = todas las cuentas (comportamiento actual). Con filas, solo esas cuentas. |
| Ver costes | `memberships.can_see_costs` | Importes, costes y precios de compra. Se aplica dentro de las cuentas del alcance. |
| Validar | `memberships.can_validate` | Puede validar movimientos de personal. |
| Kiosco | cuenta de pantalla del almacén (`identity.kiosk`) | Solo la pantalla de almacén; sin asistente. |

Reglas que ya se cumplen: el stock solo cambia con funciones de la base; los importes se leen con
`sees_costs(org)`; el asistente trabaja con el JWT de la persona, así que ve y puede lo mismo que ella.

## 3. Perfiles propuestos (v2)

Cada perfil es una combinación de cuentas, locales, rol base y costes. No hay roles especiales en el código.

| Perfil | Rol base | Locales | Cuentas | Ve costes | Actúa en |
|--------|----------|---------|---------|-----------|----------|
| **Propietario** | `owner` | todos | todas | sí | todo, incluido el equipo |
| **Gerencia** | `admin` | todos | todas | sí | supervisión y equipo (no el propietario) |
| **Oficina** | `manager` | todos | Suministros y Oficina | sí, de esas cuentas | facturas y gastos de Suministros y Oficina |
| **Encargado de local** | `manager` | el suyo | Bebida, Menaje, Mantenimiento, Packing y limpieza | sí, de esas cuentas | recepciones, inventario, mermas y pedidos de su local |
| **Cocina** | `staff` + `can_see_costs` | los suyos | Comida | sí, de Comida | escandallos, elaboraciones, platos e ingredientes |
| **Personal** | `staff` | los suyos | según puesto | no | recepción, traspasos, almacén |
| **Kiosco** | (cuenta de pantalla) | un local | — | no | solo la pantalla de almacén |

Las cuentas y los locales de cada perfil son una plantilla: al dar de alta a alguien se copia y luego se ajusta.

Decisiones que tomo en esta versión (cada una es un dato, no código, y se puede cambiar):
- **Gerencia ve todas las cuentas y todos los locales**, pero no administra el equipo como propietario.
- **Cocina no ve costes de Bebida, Menaje ni Oficina**: solo lo que usa para cocinar.
- **Encargado ve costes de las cuentas de su local que le tocan**, porque sin ellos no puede revisar pedidos ni mermas.
- **Sin filas en `membership_accounts`, todas las cuentas**: nadie pierde acceso al desplegar.

## 4. Matriz de permisos (objetivo)

| Acción | Propietario | Gerencia | Oficina | Encargado | Cocina | Personal | Kiosco |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver stock de sus cuentas y locales | ✔ | ✔ | ✔ (sus cuentas) | ✔ | ✔ (Comida) | ✔ | ✔ (almacén) |
| Registrar recepción | ✔ | ✔ | ✔ (sus cuentas) | ✔ | — | ✔ | ✔ |
| Ver precios y costes | ✔ | ✔ | ✔ (sus cuentas) | ✔ (sus cuentas) | ✔ (Comida) | — | — |
| Editar catálogo | ✔ | ✔ | Suministros y Oficina | — | ingredientes de Comida | — | — |
| Escandallos y PVP | ✔ | ✔ | — | — | ✔ (Comida) | — | — |
| Facturas | ✔ | ✔ | ✔ (sus cuentas) | — | — | — | — |
| Informes en euros | ✔ | ✔ | sus cuentas | sus cuentas, su local | Comida, su local | — | — |
| Equipo y permisos | ✔ | ✔ (no propietario) | — | — | — | — | — |
| Asistente | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |

El asistente solo ofrece las herramientas que el perfil puede usar, con el mismo alcance (ver
`docs/copiloto/ESPECIALISTAS.md`).

## 5. Plan de aplicación

1. **Fase 1 — hecha (0055):** tabla `membership_accounts`, funciones `account_of` y `account_allowed`, pruebas
   pgTAP. Sin filas, todo igual. Aplicada en producción.
2. **Fase 2 — hecha (0056): cuentas en catálogo, stock y precios.** Políticas restrictivas (una por operación) en
   `categories`, `products`, `product_packs`, `location_products`, `product_allergens`, `supplier_item_codes`,
   `supplier_prices`, `stock_balances`, `stock_area_balances`, `stock_movements` y `price_history`. Funciones sin
   argumentos de fila (`account_scope_off`, `allowed_category_ids`, `allowed_product_ids`, `allowed_pack_ids`)
   dentro de `(select …)`: Postgres las evalúa una vez por consulta (comprobado en el plan). Prueba pgTAP 0056:
   el cocinero con Comida no ve ni da de alta productos de Bebida; sin cuentas asignadas, todo igual.
   El alcance por local ya lo aplicaban las políticas existentes (`membership_locations`).
   Las funciones `security definer` que leen datos se saltan las políticas: las filtra la 0058 (fase 5).
3. **Fase 3 — costes por cuenta:** `sees_costs(org)` pasa a aceptar cuenta y local. Afecta a escandallos, informes,
   pedidos y el asistente.
4. **Fase 4 — cuentas, hecha (0057); perfiles, pendiente.** En la ficha de cada encargado o persona del personal,
   Equipo muestra «Cuentas de análisis»: se marcan las cuentas que verá, y sin ninguna marcada ve todas. Lo guarda
   `team_set_accounts`. Puede usarla quien puede editar a esa persona (como `team_set_costs`). A propietarios y
   administradores no se les limita. Quien tiene cuentas asignadas solo reparte las suyas y no puede dejar a nadie
   sin restricción. Prueba pgTAP 0057. Falta la plantilla de perfil (cocina, sala, oficina…) como punto de partida.
5. **Fase 5 — recetas, funciones y asistente, hecha (0058).**
   - **Recetas:** una receta es de las cuentas de sus ingredientes, también los de sus elaboraciones
     (`allowed_recipe_ids`). Se ve si alguno es de una cuenta permitida, o si aún no tiene ingredientes. Sus líneas
     se ocultan con ella.
   - **Funciones que se saltan las políticas y ahora filtran:** `recipe_costs`, `sales_report`, `tpv_sale_prices`,
     `area_moves_list` y `warehouse_catalog`. En ventas, una línea del TPV sin enlazar no tiene cuenta y, con cuentas
     asignadas, no se muestra. Se quedan como estaban `export_catalog` (solo administración, nunca limitada) y
     `warehouse_context` (solo cuenta las salidas pendientes).
   - **Asistente:** lee con la sesión del usuario y sus cachés van por usuario (negocio, contexto, sugerencias)
     o por catálogo visible (embeddings, Jev). Así nunca ve ni sugiere nada fuera de sus cuentas. Si se cambian las
     cuentas de alguien, el asistente lo nota en 5 minutos como mucho (caché del contexto).
   - **«Eso no lo ves» (0059):** `hidden_catalog_words` da las palabras de los productos y familias que la persona no
     ve, con su cuenta. Si una pregunta nombra algo así («ginebra», «cervezas», «Beefeater»), el asistente responde
     «es de Bebida, y tú solo ves Comida» (`especialistas/cuentas.ts`). Antes contestaba con el stock de todo lo suyo
     o con un producto parecido que no era («cervezas» → cereza). Una palabra que también sale en lo suyo («vino»,
     por el de cocinar) solo cuenta si Jev descartó sus productos. Batería: `scripts/ops/bateria-alcance.json`, con
     una cuenta de pruebas limitada a Comida.
   - **Costes:** con esto, la fase 3 queda cubierta en lo que importa: nadie ve el coste de un producto o receta de
     una cuenta que no ve. Falta que «ve costes» se pueda dar solo para algunas cuentas.

Cada fase tiene su migración numerada, su prueba pgTAP y su entrada en el README. Antes de la fase 2, confirmar la
matriz de la sección 4 con quien administra el negocio, porque cambia lo que la gente ve.

## 6. Qué no cambia

- El rol `owner` no se puede quitar desde la pantalla (siempre queda un propietario).
- Los permisos los decide la base de datos, no la pantalla ni el asistente.
- Ninguna fase borra datos.
