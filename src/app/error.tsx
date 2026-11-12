"use client";

import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/lib/report-client-error";
import "./status-page.css";

// Si una pantalla falla al pintarse, se ofrece reintentar en lugar de dejar la página en blanco.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    reportClientError(error, error.digest);
  }, [error]);

  return (
    <main className="status-page">
      <div className="status-card">
        <p className="status-code">Error</p>
        <h1>Algo ha fallado al cargar esta pantalla</h1>
        <p>Puede ser un corte de conexión. Tus datos están a salvo: nada se guarda hasta que lo confirmas.</p>
        <div className="status-actions">
          <button className="primary-button" onClick={() => retry()}>Reintentar</button>
          <Link className="secondary-button" href="/">Ir al resumen</Link>
        </div>
        {error.digest && <small>Referencia: {error.digest}</small>}
      </div>
    </main>
  );
}
