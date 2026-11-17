# Roles y permisos

Qué puede hacer cada persona en LogisticApp, cómo se guarda y en qué orden se aplica. La base de datos decide
(RLS); la pantalla y el asistente solo muestran lo que la base permite.

## 1. Modelo actual (migraciones 0003, 0019, 0030, 0032, 0055)

| Dato | Dónde | Qué decide |
|------|-------|-----------|
| Rol | `memberships.role`: `owner`, `admin`, `manager`, `staff` | Nivel general: `owner`/`admin` administran; `manager` gestiona el día a día; `staff` opera. |
| Todos los locales | `memberships.all_locations` | Si `false`, solo ve los locales de `membership_locations`. |
| Locales | `membership_locations` | Qué locales ve y en cuáles actúa. |
| Ver costes | `memberships.can_see_costs` (y `owner`, `admin`, `manager`) | Costes, importes, precios de compra, informes en euros. |
| Validar | `memberships.can_validate` | Puede validar movimientos de personal. |
| Cuentas de análisis | `membership_accounts` (0055, **solo preparada**) | Sin filas, sin restricción (hoy). Con filas, solo esas cuentas. |
| Kiosco | cuenta de pantalla del almacén (código: `identity.kiosk`) | Solo la pantalla de almacén; sin asistente. |

Reglas que ya se cumplen: el stock solo cambia con funciones de la base; los importes se leen con
`sees_costs(org)`; el asistente trabaja con el JWT de la persona, así que ve y puede lo mismo que ella.

## 2. Roles propuestos (v1)

Siete perfiles. Cada uno es una combinación de los datos de la sección 1; no hay roles «especiales» en el código.

| Perfil | Rol base | Locales | Cuentas | Ve costes | Qué hace |
|--------|----------|---------|---------|-----------|----------|
| **Propietario** | `owner` | todos | todas | sí | Todo, incluido el equipo, las cuentas y el borrado. |
| **Gerencia** | `admin` | todos | todas | sí | Lectura de todo y supervisión; administra el equipo. Informes completos. |
| **Administración** | `manager` | todos | Oficina, Suministros y facturas | sí | Facturas, recepciones, informes y compras de todos los locales. |
| **Encargado de local** | `manager` | los suyos | Bebida, Menaje, Mantenimiento, Packing y limpieza | sí, de su local | Recepciones, inventario, mermas y pedidos de sus cuentas. |
| **Cocina** | `staff` + `can_see_costs` | los suyos | Comida | sí, de su local | Escandallos, elaboraciones y platos de Comida. |
| **Personal** | `staff` | los suyos | según puesto | no | Operaciones básicas: recepción, traspasos, almacén. |
| **Kiosco** | (cuenta de pantalla) | un local | — | no | Solo la pantalla de almacén. |

Decisiones que tomo en esta versión (puedes cambiarlas; cada una es un dato, no código):
- **Encargados ven costes de su local.** Sin costes no pueden revisar pedidos ni mermas.
- **Cocina ve costes de Comida en su local.** Los escandallos son costes; se pueden esconder con un flag.
- **Administración no edita el catálogo de Bebida.** Ve sus cuentas; el catálogo lo lleva quien lleva la cuenta.
- **Sin filas en `membership_accounts` = todas las cuentas.** Así nadie pierde acceso al desplegar.

## 3. Matriz de permisos (objetivo)

| Acción | Propietario | Gerencia | Administración | Encargado | Cocina | Personal | Kiosco |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver stock de sus cuentas | ✔ | ✔ | ✔ | ✔ | ✔ (Comida) | ✔ | ✔ (almacén) |
| Registrar recepción | ✔ | ✔ | ✔ | ✔ | — | ✔ | ✔ |
| Ver precios y costes | ✔ | ✔ | ✔ | ✔ (su local) | ✔ (Comida, su local) | — | — |
| Editar catálogo | ✔ | ✔ | Oficina y Suministros | — | solo ingredientes de Comida | — | — |
| Escandallos y PVP | ✔ | ✔ | — | — | ✔ (Comida) | — | — |
| Facturas | ✔ | ✔ | ✔ | — | — | — | — |
| Informes en euros | ✔ | ✔ | ✔ | su local | Comida, su local | — | — |
| Equipo y permisos | ✔ | ✔ (no owner) | — | — | — | — | — |
| Asistente | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |

El asistente solo ofrece las herramientas que el perfil puede usar (ver `docs/copiloto/ESPECIALISTAS.md`).

## 4. Plan de aplicación

1. **Fase 1 — hecha (0055):** tabla `membership_accounts`, funciones `account_of` y `account_allowed`, pruebas
   pgTAP. Sin cambio de comportamiento: sin filas, todo igual.
2. **Fase 2 — catálogo y stock:** políticas de `products`, `categories`, `stock_balances` y `stock_movements`
   usando `account_allowed`. Prueba de que quien no tiene la cuenta no ve sus productos ni su stock.
3. **Fase 3 — costes por local:** `sees_costs(org)` pasa a aceptar local y cuenta. Afecta a escandallos,
   informes y el asistente.
4. **Fase 4 — pantalla de equipo:** asignar perfil y cuentas desde Equipo (solo `owner`/`admin`), con la
   plantilla de perfil como punto de partida.
5. **Fase 5 — asistente:** `tools` filtradas por perfil y por cuenta (ver `ESPECIALISTAS.md`).

Cada fase tiene su migración numerada, su prueba pgTAP y su entrada en el README. Antes de la fase 2 hay que
confirmar la matriz de la sección 3 con quien administra el negocio, porque cambia lo que la gente ve.

## 5. Qué no cambia

- El rol `owner` no se puede quitar desde la pantalla (siempre queda un propietario).
- Los permisos los decide la base de datos, no la pantalla ni el asistente.
- Ninguna fase borra datos.
