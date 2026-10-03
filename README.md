# Nexo Copiloto

Inventario multilocal para hostelería con un asistente que decide con **Jev** (TypeSafe AI).
Cliente de referencia: Parador Eventos (Parador, Pickels, Vivero y La Oliva).

**Principio:** Jev decide → el código calcula con `decimal.js` y escribe solo mediante RPC → el usuario confirma. Una LLM opcional solo redacta; sin ella responden plantillas.

## Qué hace

| Área | Pantalla | Asistente |
| --- | --- | --- |
| Resumen | `/`: valor del stock, consumo, rotación, alertas; filtro por local | «¿Qué debería revisar hoy?» |
| Stock | `/stock`: existencias, bajo mínimo, exportar CSV | «¿Cuánto ron queda en Parador?» |
| Catálogo | `/productos`: ficha con formatos, precios por proveedor y mínimos | Cambiar precio, dar de alta (con detección de duplicados), mínimos, archivar |
| Proveedores | `/proveedores` | — |
| Pedidos | `/pedidos`: sugerir, enviar (email/WhatsApp) y recibir contra el pedido | «Prepara el pedido de la semana para Parador» |
| Recepciones, traspasos, mermas | `/recepciones`, `/traspasos`, `/mermas` | Borradores que se confirman con un clic |
| Inventarios | `/inventarios`: conteo en formatos, revisión y cierre como consumo | «Cierra el inventario del Vivero» |
| Informes | `/informes`: consumo, mermas, stock, precios, reposición, desvíos | Gráficas en el chat |

## Estructura

```
src/
  app/                 Pantallas (App Router) y la ruta /api/copiloto
  components/          Asistente (panel), gráficas y operaciones compartidas
  copiloto/            El agente, solo servidor: Jev, herramientas, borradores, analítica
  lib/                 Supabase (clientes y tipos), formato es-ES, unidades, preferencias
  proxy.ts             Sesión en cada navegación (Next 16: sustituye a middleware)
supabase/
  migrations/          Esquema, RLS y RPC, numerados (fuente de verdad)
  tests/               Tests pgTAP de permisos y RPC (los ejecuta el CI)
  seed/                Datos de ejemplo de Parador Eventos, en orden 01 → 04
  scripts/             Herramientas puntuales (restablecer contraseña; aplicar.sql generado)
  config.toml          Supabase local (Postgres 17, igual que producción)
scripts/               Utilidades del repositorio (unir migraciones)
docs/
  copiloto/            Contrato de la API, arquitectura, catálogo de Jev y evaluación
  parador-eventos-cobertura.md   Alcance frente al negocio
```

## Desarrollo

```bash
npm install
npm run dev
```

Variables en `.env.local` (plantilla en `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y, para Jev, `VERCEL_OIDC_TOKEN` (`npx vercel env pull .env.local`) o `TYPESAFE_API_KEY`.

## Calidad

```bash
npm run check        # lint + tipos + tests + build (lo mismo que el CI)
```

- `npm test`: tests de la app y del asistente, con Jev y LLM simulados.
- `npm run copiloto:eval`: set de frases contra Jev real (`--desde N`, `--lote N`).
- `npm run copiloto:probe -- "frase"`: probabilidades de Jev para una frase (afinar el catálogo).
- `npm run copiloto:bateria`: frases reales contra el catálogo de Vivero 55 sin Jev (búsqueda de productos, cantidades y respuestas escritas). También corre en `npm test`.
- `npm run copiloto:conversaciones`: conversaciones de varios turnos de principio a fin (aclaraciones, borradores, confirmación por chat, desgloses). Sin opciones usa un Jev simulado (también en `npm test`); con `-- --real`, el Jev real, y escribe `docs/copiloto/CONVERSACIONES.md`.
- **CI** (GitHub Actions, cada push y PR): la app y la base de datos. La base de datos se levanta en local con todas las migraciones y pasa `supabase/tests`.

Reglas del código: el stock solo cambia mediante RPC y `stock_movements` es inmutable; las cantidades se guardan en unidad base (ml, g, ud) y nunca se calculan con `number`; todo va con el JWT del usuario y RLS, sin service role.

## Base de datos

Las migraciones se aplican en orden y se pueden repetir sin error.

| Migración | Qué añade |
| --- | --- |
| 0001–0004 | Núcleo: organizaciones, catálogo, stock, documentos, RLS, saldo por espacio |
| 0005–0006 | Asistente: auditoría, sesiones y borradores |
| 0007 | Catálogo con filtros en servidor (`catalog_search`) |
| 0008 | Rendimiento: RLS evaluada una vez por consulta, índices |
| 0009 | Resumen filtrable por local y consumo con una sola definición |
| 0010 | (retirada) |
| 0011 | Consumo real por inventario (`close_count` como consumo, `count_preview`) |
| 0012 | Pedidos a proveedor |
| 0013 | Limpieza de la 0010, por si se llegó a aplicar |
| 0014 | Permisos de tabla explícitos para usuarios autenticados (RLS sigue decidiendo las filas) |
| 0015 | Hábitos del asistente por usuario (locales y productos más usados) |
| 0016 | Catálogo en familias y tipos, bebidas por unidades |
| 0017 | Historial de precios completo (cada cambio de precio, también los manuales) y surtido de cada local al día (lo que se mueve en un local entra en su surtido) |
| 0018 | Catálogo profesional: índices en todas las claves ajenas que se consultan, IVA por producto (`vat_rate`), formatos coherentes (cajas con unidades enteras; no se cambia la unidad de un producto con movimientos ni el tamaño de un formato ya usado), `v_product_costs` (precio por caja, por unidad que se cuenta y con IVA) y `catalog_health()` (lo que da cifras falsas o impide trabajar) |
| 0019 | Rendimiento sin cambiar permisos: las políticas de escritura ya no se evalúan al leer (eran `for all` y llamaban a una función por fila; leer 734 productos pasaba de ~70 ms a ~1 ms) y las de líneas y formatos comparan contra conjuntos calculados una vez por consulta. `catalog_search` agrega formatos, proveedores y stock de una vez (~2-3× más rápida, mismos resultados) |
| 0020 | Búsquedas en el servidor: `product_lookup()` (buscador de productos de los formularios: nombre, familia o código de barras, lo del local primero, con formatos, último precio y stock), `stock_search()` (stock por páginas con los totales calculados en Postgres) y `v_supplier_summary` (productos y último precio por proveedor sin descargar sus precios) |

**Aplicar en el proyecto real:** `npm run db:bundle -- 0008` genera `supabase/scripts/aplicar.sql` con las migraciones desde la 0008, en una sola transacción. Se pega en Supabase → SQL Editor → Run.

**Local** (Docker): `npm run db:start`, `npm run db:reset`, `npm run db:test`.

**Datos de ejemplo:** `supabase/seed/01…04` en orden (organización y locales, productos, catálogo de Vivero, stock de apertura).

**Preparar el lanzamiento:** `supabase/scripts/preparar_lanzamiento.sql` (después de la 0018) borra las operaciones de prueba, conserva la apertura de referencia del Vivero y recalcula el stock, quita productos basura y de demostración, da de alta lo que el catálogo no pudo crear y restaura los precios del catálogo. Una transacción; al terminar enseña lo que queda por revisar (`catalog_health`).

**Importar un inventario de otro sistema:** `python3 scripts/importar_inventario.py <carpeta .xlsx> <correcciones.json> <salida.sql> [revision.csv]` lee los informes «Inventario» y «Almacén detallado», limpia nombres (sufijos de local, EAN, lotes, mayúsculas), une duplicados, asigna familia → tipo, unidad y formatos según las convenciones de abajo, y genera un SQL que crea o reutiliza los productos y carga el stock contado como apertura por local y espacio, más un CSV para revisar cada decisión. Las correcciones propias del negocio (fusiones, productos que ya existen, familias, unidades) van en el JSON. **Los .xlsx, el JSON y el SQL generado contienen datos del negocio: no se suben al repositorio.**

**Convenciones del catálogo:** las cantidades se guardan en unidad base (ml, g, ud). Refrescos, cervezas en botella, aguas y energéticas se cuentan por unidades y se compran en cajas («Caja 24» = 24 ud); destilados, vino y champán, en ml con su botella como formato de conteo y la caja de 6 como formato de compra; la fruta a granel, en g con el kg como formato. Los precios de proveedor van por formato y sin IVA.

## Asistente

- **Tareas** (`src/copiloto/skills/tareas.ts`, menú Funciones o `/preparar`, `/equilibrar`, `/revisar`, `/parte`): trabajo que el panel no hace solo. *Preparar pedidos* calcula lo de la semana en todos los locales por proveedor y en cajas, y deja cada pedido en borrador con un toque; *Equilibrar locales* propone traspasos de donde sobra a donde falta (en botellas o unidades enteras); *Revisar catálogo* lista lo que da cifras falsas; *Parte de ayer* resume consumo, mermas, compras y alertas por local. Sin Jev hasta el borrador.
- Cantidades compuestas: «3 cajas y 5 sueltas», «1 caja y 2 botellas», «2 cajas + 3 de red bull» son una sola cantidad (cajas + sueltas del mismo producto), en el chat y en la hoja de inventario.
- `src/copiloto/jev/catalog.ts`: todas las preguntas a Jev (cambiar un texto sube `CATALOG_VERSION`). `gates/thresholds.ts`: umbrales de confianza.
- `agent/`: interpretación y bucle; `drafts/`: borradores, comprobaciones y confirmación; `tools/` y `analytics/`: cálculos.
- `src/app/api/copiloto/[...ruta]/route.ts`: `chat` (SSE), `actions/confirm`, `suggestions`, `analytics`, `reorder` y `health`.
- Documentación: [contrato](docs/copiloto/CONTRACT.md), [arquitectura](docs/copiloto/PROPUESTA.md), [catálogo de Jev y mediciones](docs/copiloto/CATALOGO_JEV.md).

## Despliegue

Vercel (`vercel.json`), con las funciones en Dublín (`dub1`), junto a la base de datos de Supabase (`eu-west-1`): cada consulta del servidor (asistente, informes, sesión) evita cruzar el Atlántico. Si el proyecto de Supabase cambia de región, hay que cambiar también esta. Variables: las dos de Supabase y **`TYPESAFE_API_KEY`** (tipo *Sensitive*, Production y Preview). Con ella Jev va directo a TypeSafe: en la evaluación del 1-10-2026 respondió con mediana de 159 ms y p90 de 209 ms, frente a un p90 de 30 s (máximo 64 s) por Vercel AI Gateway. Sin ella, Jev usa el AI Gateway con el token OIDC del despliegue, que exige el gateway activo y con saldo en el equipo. Si Jev falla, `GET /api/copiloto/health` (con sesión iniciada) dice por qué camino va y qué revisar, y los registros de Vercel también.

La app envía cabeceras de seguridad (`next.config.ts`): CSP que solo permite la propia app y el proyecto de Supabase de `NEXT_PUBLIC_SUPABASE_URL`, sin iframes, `noindex`. Si el navegador tiene que hablar con otro dominio, hay que añadirlo ahí.

**Antes de abrir a clientes** (fuera del código):

- Supabase → Authentication → URL Configuration: *Site URL* con el dominio real y `https://<dominio>/auth/callback` en *Redirect URLs* (enlace mágico y recuperar contraseña).
- Supabase → Authentication → Sign In / Providers: desactivar *Allow new users to sign up*. Los usuarios los da de alta un administrador; el enlace mágico ya no crea cuentas.
- Supabase → Authentication → SMTP: un SMTP propio (el de Supabase solo manda unos pocos correos por hora).
- Migraciones hasta la 0020 aplicadas (`npm run db:bundle -- 0020`) y, una vez, `supabase/scripts/preparar_lanzamiento.sql`.
- Términos de uso y política de privacidad: la pantalla de acceso los menciona, pero aún no existen.
- Límite de peticiones del asistente: está en memoria de cada instancia; con mucho tráfico, moverlo a un almacén compartido.
