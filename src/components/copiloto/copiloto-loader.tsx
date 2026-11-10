"use client";

// El asistente pesa (panel, borradores, gráficas): se descarga la primera vez que se abre, no en cada
// pantalla. Hasta entonces solo está su botón, y Ctrl+K o una pregunta desde otra pantalla también lo cargan.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import "./copiloto-launcher.css";

const Copiloto = dynamic(() => import("./copiloto").then((m) => m.Copiloto), { ssr: false });

export function CopilotoLoader() {
  const pathname = usePathname();
  const [start, setStart] = useState<{ message?: string } | null>(null);

  useEffect(() => {
    if (start) return;
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setStart({});
      }
    }
    function onAsk(event: Event) {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setStart(message ? { message } : {});
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("copiloto:ask", onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("copiloto:ask", onAsk);
    };
  }, [start]);

  if (pathname?.startsWith("/login") || pathname?.startsWith("/almacen") || pathname?.startsWith("/auth/")) return null;
  if (start) return <Copiloto initial={start} />;
  return (
    <button type="button" className="copiloto-launcher" onClick={() => setStart({})} aria-label="Abrir asistente (Ctrl+K)">
      <MessagesSquare size={18} />
      <span>Asistente</span>
      <kbd>Ctrl K</kbd>
    </button>
  );
}
