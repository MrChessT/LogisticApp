// Nivel de un producto frente a su mínimo: la marca central es el mínimo y la barra llega al doble.
// Se lee de un vistazo cuánto falta (o sobra) sin comparar dos cifras con unidades distintas.
import "./level-bar.css";

export function LevelBar({ qty, min, status }: { qty: number; min: number | null; status: "ok" | "low" | "critical" }) {
  if (!min || min <= 0) return <span className="level-bar none" title="Sin mínimo">Sin mínimo</span>;
  const fill = Math.max(0, Math.min(1, qty / (min * 2)));
  const pct = Math.round((qty / min) * 100);
  return (
    <span className={`level-bar ${status}`} role="img" aria-label={`${pct} % del mínimo`} title={`${pct} % del mínimo`}>
      <i style={{ width: `${fill * 100}%` }} />
    </span>
  );
}
