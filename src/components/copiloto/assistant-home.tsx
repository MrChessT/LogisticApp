"use client";

// Inicio y comandos del asistente:
//   · Bienvenida según la pantalla: lo que tiene sentido preguntar aquí (no una lista de alertas).
//   · Comandos «/» dentro del campo de texto, con teclado (↑ ↓ Enter, Esc), como en Notion o Slack.
//   · /ayuda: qué sabe hacer y cómo pedírselo, con ejemplos que se usan con un toque.
import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  Camera,
  ClipboardList,
  FileText,
  HelpCircle,
  LayoutGrid,
  Newspaper,
  PencilLine,
  RotateCcw,
  Scale,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import type { AppRoute } from "@/copiloto/contract";

type Icon = ComponentType<{ size?: number }>;

export type LocalCommand = "ayuda" | "nueva" | "avisos" | "foto" | "funciones";

export interface Command {
  name: string;
  label: string;
  hint: string;
  icon: Icon;
  /** Lo resuelve el panel (no va al servidor). */
  local?: LocalCommand;
  /** Admite un texto detrás («/ficha tónica»): se deja escrito para completarlo en vez de enviarlo. */
  arg?: string;
}

export const COMMANDS: Command[] = [
  { name: "ayuda", label: "Ayuda", hint: "Qué sé hacer y cómo pedírmelo", icon: HelpCircle, local: "ayuda" },
  { name: "avisos", label: "Avisos", hint: "Lo que conviene revisar ahora", icon: Bell, local: "avisos" },
  { name: "foto", label: "Foto de albarán", hint: "Leer un albarán y registrar la recepción", icon: Camera, local: "foto" },
  { name: "parte", label: "Parte de ayer", hint: "Consumo, mermas y compras por local", icon: Newspaper },
  { name: "preparar", label: "Preparar pedidos", hint: "Qué pedir por proveedor, en borrador", icon: ShoppingCart, arg: "local (opcional)" },
  { name: "equilibrar", label: "Equilibrar locales", hint: "Traspasos en vez de compras", icon: ArrowLeftRight },
  { name: "revisar", label: "Revisar catálogo", hint: "Precios, formatos y stock que dan cifras falsas", icon: ShieldCheck },
  { name: "ficha", label: "Ficha de producto", hint: "Precio, proveedores, stock y consumo", icon: FileText, arg: "producto" },
  { name: "existencias", label: "Stock", hint: "Cuánto queda y cuánto vale", icon: Boxes, arg: "producto (opcional)" },
  { name: "precios", label: "Precios", hint: "Último precio y subidas", icon: Tag, arg: "producto (opcional)" },
  { name: "reponer", label: "Qué reponer", hint: "Lo que falta según el consumo", icon: ClipboardList },
  { name: "consumo", label: "Lo que más se gasta", hint: "Ranking del último mes", icon: TrendingUp },
  { name: "pedidos", label: "Pedidos abiertos", hint: "Por enviar, en camino o con retraso", icon: Truck },
  { name: "gasto", label: "Gasto en compras", hint: "Por proveedor, último mes", icon: Wallet },
  { name: "desvios", label: "Desvíos de inventario", hint: "Diferencias del último recuento", icon: Scale },
  { name: "funciones", label: "Todas las funciones", hint: "Tareas y consultas con filtros", icon: LayoutGrid, local: "funciones" },
  { name: "nueva", label: "Nueva conversación", hint: "Empezar de cero (olvida el contexto)", icon: RotateCcw, local: "nueva" },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Comandos que encajan con lo escrito tras «/» (por nombre o por lo que hacen). Sin «/», ninguno. */
export function matchCommands(input: string): Command[] {
  const m = /^\/(\S*)$/.exec(input.trimStart());
  if (!m) return [];
  const q = fold(m[1]!);
  if (!q) return COMMANDS;
  const byName = COMMANDS.filter((c) => c.name.startsWith(q));
  const byText = COMMANDS.filter((c) => !byName.includes(c) && fold(`${c.label} ${c.hint}`).includes(q));
  return [...byName, ...byText];
}

/** Comando local escrito entero («/ayuda», «/nueva»…), si lo es. */
export function localCommandOf(input: string): LocalCommand | null {
  const m = /^\/(\S+)\s*$/.exec(input.trim());
  if (!m) return null;
  return COMMANDS.find((c) => c.name === fold(m[1]!))?.local ?? null;
}

export function CommandPalette({ commands, active, onPick, onHover }: { commands: Command[]; active: number; onPick: (c: Command) => void; onHover: (i: number) => void }) {
  if (commands.length === 0) return null;
  return (
    <div className="copiloto-palette" role="listbox" aria-label="Comandos">
      {commands.map((c, i) => (
        <button
          type="button"
          role="option"
          aria-selected={i === active}
          key={c.name}
          className={i === active ? "active" : ""}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(event) => {
            // Antes del blur del campo: si no, el clic se pierde.
            event.preventDefault();
            onPick(c);
          }}
        >
          <span className="copiloto-palette-icon"><c.icon size={15} /></span>
          <span className="copiloto-palette-text">
            <b>/{c.name}</b>
            {c.arg && <em> {c.arg}</em>}
            <small>{c.hint}</small>
          </span>
        </button>
      ))}
      <p className="copiloto-palette-foot">↑ ↓ para moverte · Enter para elegir · Esc para cerrar</p>
    </div>
  );
}

/** Lo que tiene sentido preguntar en cada pantalla (tres, concretas y que se pueden enviar tal cual). */
const STARTERS: Partial<Record<AppRoute, string[]>> & { default: string[] } = {
  default: ["¿Cómo voy este mes?", "¿Qué me falta para el finde?", "/parte"],
  "/": ["¿Cómo voy este mes?", "/parte", "¿Qué facturas vencen esta semana?"],
  "/stock": ["¿Qué está bajo mínimo?", "¿Qué me falta para el finde?", "/equilibrar"],
  "/productos": ["¿Cuál es el producto más caro?", "¿Qué precios han subido?", "/revisar"],
  "/pedidos": ["Prepara el pedido de la semana", "¿Qué pedidos están en camino?", "¿Cuánto he gastado este mes?"],
  "/recepciones": ["/foto", "¿Qué pedidos están en camino?", "¿Qué albaranes no tienen factura?"],
  "/traspasos": ["¿Qué traspasos están pendientes?", "/equilibrar", "¿Qué me falta para el finde?"],
  "/inventarios": ["¿Hay algún inventario abierto?", "¿Qué desvíos hubo en el último inventario?", "¿Cuándo fue el último inventario?"],
  "/mermas": ["¿Cuántas mermas llevamos este mes?", "¿Qué es lo que más se tira?", "¿Cómo reduzco las mermas de fruta?"],
  "/informes": ["¿Cómo voy este mes?", "¿Qué precios han subido últimamente?", "¿Qué es lo que más se gasta?"],
  "/proveedores": ["¿Qué condiciones tiene cada proveedor?", "¿Cuánto he gastado por proveedor?", "¿Qué pedidos tengo pendientes?"],
  "/escandallos": ["¿Qué platos llevan gluten?", "¿Qué plato deja más margen?", "¿Qué platos tienen el food cost alto?"],
  "/ventas": ["¿Cuánto se vendió ayer?", "¿Cuál es el plato estrella?", "¿Qué platos quito de la carta?"],
  "/facturas": ["¿Qué facturas vencen esta semana?", "¿Cuánto debemos a proveedores?", "¿Qué albaranes no tienen factura?"],
  "/equipo": ["¿Quién trabaja en cada local?", "¿Qué permisos tiene cada uno?", "/ayuda"],
  "/zonas": ["¿Qué hay en cada zona?", "¿Qué zonas tiene cada local?", "/ayuda"],
};

const SCREEN: Partial<Record<AppRoute, string>> = {
  "/": "el panel", "/stock": "el stock", "/productos": "los productos", "/pedidos": "los pedidos", "/recepciones": "las recepciones",
  "/traspasos": "los traspasos", "/inventarios": "los inventarios", "/mermas": "las mermas", "/informes": "los informes",
  "/proveedores": "los proveedores", "/escandallos": "los escandallos", "/ventas": "las ventas", "/facturas": "las facturas",
  "/equipo": "el equipo", "/zonas": "las zonas",
};

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 6 ? "Buenas noches" : h < 14 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
}

const label = (starter: string) => COMMANDS.find((c) => `/${c.name}` === starter)?.label ?? starter;

interface WelcomeProps {
  route: AppRoute;
  /** Avisos pendientes (null: aún cargando). Solo se enseña cuántos: la lista, con /avisos. */
  alerts: number | null;
  onAsk: (text: string) => void;
  onFill: (text: string) => void;
}

/** Inicio del panel: saludo, tres cosas que preguntar en esta pantalla y cómo descubrir el resto. */
export function Welcome({ route, alerts, onAsk, onFill }: WelcomeProps) {
  const starters = STARTERS[route] ?? STARTERS.default;
  const where = SCREEN[route];
  return (
    <div className="copiloto-welcome">
      <div className="copiloto-welcome-head">
        <span className="copiloto-welcome-mark"><Sparkles size={18} /></span>
        <div>
          <strong>{greeting()}</strong>
          <p>Pregúntame por tus datos o pídeme una operación; te la dejo preparada para que la confirmes.</p>
        </div>
      </div>

      <p className="copiloto-section">{where ? `Para ${where}` : "Para empezar"}</p>
      <div className="copiloto-starters">
        {starters.map((s) => (
          <button type="button" key={s} onClick={() => onAsk(s)}>
            <span>{label(s)}</span>
          </button>
        ))}
      </div>

      <p className="copiloto-section">Lo que puedo hacer</p>
      <div className="copiloto-skills">
        <button type="button" onClick={() => onFill("¿Cuánto ")}>
          <Boxes size={16} />
          <span><b>Consultar</b><small>«¿Cuánta tónica queda en el Vivero?»</small></span>
        </button>
        <button type="button" onClick={() => onFill("Se han roto ")}>
          <PencilLine size={16} />
          <span><b>Registrar</b><small>«Se han roto 2 botellas de Larios en barra»</small></span>
        </button>
        <button type="button" onClick={() => onAsk("/preparar")}>
          <ShoppingCart size={16} />
          <span><b>Preparar pedidos</b><small>Por proveedor y en cajas, en borrador</small></span>
        </button>
        <button type="button" onClick={() => onAsk("/foto")}>
          <Camera size={16} />
          <span><b>Foto de albarán</b><small>La leo y te abro la recepción</small></span>
        </button>
      </div>

      <div className="copiloto-welcome-foot">
        {alerts !== null && alerts > 0 && (
          <button type="button" className="copiloto-alerts-chip" onClick={() => onAsk("/avisos")}>
            <Bell size={13} /> {alerts} {alerts === 1 ? "aviso" : "avisos"} para revisar
          </button>
        )}
        <span>Escribe <kbd>/</kbd> para ver los comandos · <kbd>/ayuda</kbd> para la guía</span>
      </div>
    </div>
  );
}

const HELP: Array<{ title: string; icon: Icon; text: string; examples: string[] }> = [
  {
    title: "Consultar",
    icon: Boxes,
    text: "Stock, consumo, mermas, precios y su evolución, proveedores, pedidos y cuándo se pidió algo, gasto, ventas y márgenes, facturas, escandallos y alérgenos, zonas, salidas de almacén sin validar, inventarios y equipo.",
    examples: ["¿Cuánta tónica queda en el Vivero?", "¿Cuándo pedimos coca por última vez?", "¿Hay salidas de almacén sin validar?", "¿Cuál es el plato estrella?"],
  },
  {
    title: "Registrar",
    icon: PencilLine,
    text: "Escríbelo como lo dirías: preparo el borrador y no se guarda nada hasta que lo confirmas. También validar salidas de almacén, marcar facturas como pagadas, el PVP de un plato y las condiciones de un proveedor.",
    examples: ["Se han roto 2 botellas de Larios en barra", "Pasa 2 cajas de tónica del Parador a Pickles", "Marca como pagada la factura de Makro"],
  },
  {
    title: "Tareas",
    icon: ShoppingCart,
    text: "Trabajo de varios pasos sobre todos tus locales, listo para revisar.",
    examples: ["/preparar", "/equilibrar", "/parte"],
  },
  {
    title: "Seguir la conversación",
    icon: Sparkles,
    text: "Me acuerdo de lo último que hemos hablado: no hace falta repetir el producto ni el local.",
    examples: ["¿Y en Pickles?", "¿Y sus proveedores?", "¿A cuánto la compramos?"],
  },
];

/** Guía de /ayuda: qué puedo hacer, ejemplos que se usan con un toque y los comandos. */
export function HelpCard({ onAsk }: { onAsk: (text: string) => void }) {
  return (
    <div className="copiloto-help">
      {HELP.map((h) => (
        <section key={h.title}>
          <header><h.icon size={15} /> <b>{h.title}</b></header>
          <p>{h.text}</p>
          <div className="copiloto-help-examples">
            {h.examples.map((e) => (
              <button type="button" key={e} onClick={() => onAsk(e)}>{label(e) === e ? e : `${e} · ${label(e)}`}</button>
            ))}
          </div>
        </section>
      ))}
      <section>
        <header><Camera size={15} /> <b>Fotos</b></header>
        <p>Con el botón de la cámara (o <code>/foto</code>) leo un albarán, compruebo que cuadra y te abro la recepción rellena.</p>
      </section>
      <section>
        <header><LayoutGrid size={15} /> <b>Comandos</b></header>
        <ul className="copiloto-help-commands">
          {COMMANDS.map((c) => (
            <li key={c.name}><code>/{c.name}</code> {c.hint}</li>
          ))}
        </ul>
      </section>
      <p className="copiloto-help-foot">Si me equivoco, pulsa «Reportar» en la respuesta: se revisa y se corrige. ↑ en el campo vacío recupera lo último que escribiste.</p>
    </div>
  );
}
