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
   pgTAP. Sin cambio de comportamiento: sin filas, todo igual. Aplicada en producción.
2. **Fase 2 — locales y cuentas en catálogo, stock y movimientos:** políticas de `products`, `categories`,
   `stock_balances`, `stock_movements` y `stock_area_balances` usando `account_allowed` y el alcance de locales.
   Prueba: quien no tiene la cuenta o el local no ve esos productos ni ese stock.
3. **Fase 3 — costes por cuenta:** `sees_costs(org)` pasa a aceptar cuenta y local. Afecta a escandallos, informes,
   pedidos y el asistente.
4. **Fase 4 — pantalla de equipo:** asignar perfil, cuentas y locales desde Equipo (solo propietario y gerencia),
   con la plantilla de perfil como punto de partida.
5. **Fase 5 — asistente:** las herramientas se filtran por perfil, cuentas y locales; el modelo nunca recibe una
   herramienta fuera de alcance.

Cada fase tiene su migración numerada, su prueba pgTAP y su entrada en el README. Antes de la fase 2, confirmar la
matriz de la sección 4 con quien administra el negocio, porque cambia lo que la gente ve.

## 6. Qué no cambia

- El rol `owner` no se puede quitar desde la pantalla (siempre queda un propietario).
- Los permisos los decide la base de datos, no la pantalla ni el asistente.
- Ninguna fase borra datos.
