// Filas de esqueleto mientras carga una tabla: se ve la forma de lo que viene en vez de «Cargando...».
import "./loading-rows.css";

export function LoadingRows({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div className="loading-rows" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="loading-row" key={i} aria-hidden="true">
          <i className="sk sk-icon" />
          <span className="sk-lines"><i className="sk" style={{ width: `${46 - (i % 3) * 7}%` }} /><i className="sk sk-small" style={{ width: `${28 - (i % 2) * 6}%` }} /></span>
          <i className="sk sk-cell" />
          <i className="sk sk-cell" />
        </div>
      ))}
    </div>
  );
}
