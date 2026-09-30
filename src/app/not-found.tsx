import Link from "next/link";
import "./status-page.css";

export default function NotFound() {
  return (
    <main className="status-page">
      <div className="status-card">
        <p className="status-code">404</p>
        <h1>Esta página no existe</h1>
        <p>Puede que el enlace esté mal escrito o que la página se haya movido.</p>
        <div className="status-actions">
          <Link className="primary-button" href="/">Ir al resumen</Link>
        </div>
      </div>
    </main>
  );
}
