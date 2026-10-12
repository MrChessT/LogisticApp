"use client";

// Menú de funciones del asistente. Primero las TAREAS: trabajo que el panel no hace solo (cruza todos
// los locales y deja borradores listos para confirmar: pedidos, traspasos) o que encuentra lo que está
// mal. Después, consultas rápidas. Registrar operaciones se hace escribiendo («se han roto 2 botellas de
// Beefeater en barra»): el asistente prepara el borrador. Local y producto son filtros opcionales.
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArrowLeftRight,
  Boxes,
  ClipboardList,
  FileText,
  MapPin,
  Newspaper,
  Scale,
  Search,
  ShieldCheck,
  ShoppingCart,
  Tag,
  TrendingUp,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Icon = ComponentType<{ size?: number }>;

interface QueryFn {
  /** Comando del atajo en el servidor (/existencias, /reponer…). */
  command: string;
  label: string;
  hint: string;
  icon: Icon;
  /** Sin producto no tiene sentido (la ficha). */
  needsProduct?: boolean;
}

interface TaskFn {
  /** Comando de la tarea en el servidor (/preparar, /equilibrar…). */
  command: string;
  label: string;
  /** Qué obtienes: el resultado, no la pantalla. */
  hint: string;
  icon: Icon;
}

export const TASK_FUNCTIONS: TaskFn[] = [
  { command: "preparar", label: "Preparar pedidos", hint: "Lo que hay que pedir esta semana en cada local, por proveedor y en cajas. Un toque y queda en borrador.", icon: ShoppingCart },
  { command: "equilibrar", label: "Equilibrar locales", hint: "Lo que sobra en un local y falta en otro: traspasos listos en vez de compras.", icon: ArrowLeftRight },
  { command: "revisar", label: "Revisar catálogo", hint: "Precios, formatos y stock que dan cifras falsas, con qué arreglar primero.", icon: ShieldCheck },
  { command: "parte", label: "Parte de ayer", hint: "Consumo, mermas y compras por local, y lo que requiere atención hoy.", icon: Newspaper },
];

export const QUERY_FUNCTIONS: QueryFn[] = [
  { command: "ficha", label: "Ficha", hint: "Precio, proveedores, stock y consumo de un producto", icon: FileText, needsProduct: true },
  { command: "existencias", label: "Stock", hint: "Cuánto queda y cuánto vale", icon: Boxes },
  { command: "precios", label: "Precios", hint: "Último precio y subidas", icon: Tag },
  { command: "consumo", label: "Lo que más se gasta", hint: "Ranking del último mes", icon: TrendingUp },
  { command: "desvios", label: "Desvíos de inventario", hint: "Diferencias del último recuento", icon: Scale },
  { command: "pendientes", label: "Traspasos pendientes", hint: "Enviados sin recibir", icon: Truck },
  { command: "pedidos", label: "Pedidos abiertos", hint: "Por enviar, en camino o con retraso", icon: ClipboardList },
  { command: "gasto", label: "Gasto en compras", hint: "Por proveedor, último mes", icon: Wallet },
];

/** Comando del atajo y texto que se enseña en el chat («Stock · Vivero · Beefeater»). */
export function buildQuery(fn: Pick<QueryFn, "command" | "label">, location: string, product: string): { message: string; display: string } {
  const args = [product.trim(), location].filter(Boolean);
  return { message: `/${fn.command}${args.length ? ` ${args.join(" ")}` : ""}`, display: [fn.label, location, product.trim()].filter(Boolean).join(" · ") };
}

interface Props {
  disabled: boolean;
  onRun: (message: string, display: string) => void;
  onClose: () => void;
}

export function QuickActions({ disabled, onRun, onClose }: Props) {
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [location, setLocation] = useState("");
  const [product, setProduct] = useState("");
  const [missing, setMissing] = useState(false);
  const productRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    void supabase
      .from("locations")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setLocations(data ?? []));
  }, []);

  function run(fn: QueryFn) {
    if (fn.needsProduct && !product.trim()) {
      setMissing(true);
      productRef.current?.focus();
      return;
    }
    const { message, display } = buildQuery(fn, location, product);
    onRun(message, display);
  }

  function runTask(fn: TaskFn) {
    // Las tareas trabajan por local; el producto no aplica.
    onRun(`/${fn.command}${location ? ` ${location}` : ""}`, [fn.label, location].filter(Boolean).join(" · "));
  }

  return (
    <div className="copiloto-functions" role="dialog" aria-label="Funciones">
      <div className="copiloto-functions-head">
        <div>
          <strong>Funciones</strong>
          <small>Trabajo hecho en un toque, sin escribir</small>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar funciones">
          <X size={15} />
        </button>
      </div>

      <div className="copiloto-functions-filters">
        <label>
          <MapPin size={13} />
          <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Local">
            <option value="">Todos los locales</option>
            {locations.map((l) => (
              <option key={l.id} value={l.name}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className={missing && !product.trim() ? "missing" : ""}>
          <Search size={13} />
          <input
            ref={productRef}
            value={product}
            onChange={(e) => {
              setProduct(e.target.value);
              setMissing(false);
            }}
            placeholder="Producto (opcional)"
            aria-label="Producto"
            maxLength={80}
          />
        </label>
      </div>
      {missing && !product.trim() && <p className="copiloto-functions-note">La ficha necesita un producto.</p>}

      <p className="copiloto-section">Tareas</p>
      <div className="copiloto-functions-grid tasks">
        {TASK_FUNCTIONS.map((fn) => <FunctionButton key={fn.command} fn={fn} disabled={disabled} onClick={() => runTask(fn)} />)}
      </div>

      <p className="copiloto-section">Consultas rápidas</p>
      <div className="copiloto-functions-grid">
        {QUERY_FUNCTIONS.map((fn) => <FunctionButton key={fn.command} fn={fn} disabled={disabled} onClick={() => run(fn)} />)}
      </div>
      <p className="copiloto-functions-tip">Para registrar algo, escríbelo: «se han roto 2 botellas de Beefeater en barra» o «han llegado 3 cajas de tónica».</p>
    </div>
  );
}

function FunctionButton({ fn, disabled, onClick }: { fn: TaskFn; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}>
      <span className="copiloto-functions-icon"><fn.icon size={16} /></span>
      <span>
        <b>{fn.label}</b>
        <small>{fn.hint}</small>
      </span>
    </button>
  );
}
