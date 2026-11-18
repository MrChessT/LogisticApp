"use client";

// El asistente pesa (panel, borradores, gráficas): no viaja con cada pantalla. Hasta que se abre solo está su botón.
// Para que al pulsarlo se abra ya, el panel se descarga por adelantado cuando el navegador está libre (o al acercar el
// ratón o el foco al botón). Si aún no ha llegado al pulsar, el botón se queda en su sitio diciendo que se abre: antes
// desaparecía hasta que llegaba el panel, y parecía que se había roto.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Loader2, MessagesSquare } from "lucide-react";
import "./copiloto-launcher.css";

/** La misma descarga para la carga anticipada y para abrirlo: el navegador la hace una sola vez. */
const loadPanel = () => import("./copiloto");

const Copiloto = dynamic(() => loadPanel().then((m) => m.Copiloto), { ssr: false, loading: () => <Launcher opening /> });

function Launcher({ opening = false, onOpen }: { opening?: boolean; onOpen?: () => void }) {
  return (
    <button type="button" className="copiloto-launcher" onClick={onOpen} onPointerEnter={() => void loadPanel()} onFocus={() => void loadPanel()} aria-label="Abrir asistente (Ctrl+K)" aria-busy={opening} disabled={opening}>
      {opening ? <Loader2 size={18} className="copiloto-launcher-spin" /> : <MessagesSquare size={18} />}
      <span>{opening ? "Abriendo…" : "Asistente"}</span>
      {!opening && <kbd>Ctrl K</kbd>}
    </button>
  );
}

export function CopilotoLoader() {
  const pathname = usePathname();
  const [start, setStart] = useState<{ message?: string } | null>(null);

  // Descarga anticipada cuando la pantalla ya está cargada y el navegador no tiene nada que hacer.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => void loadPanel().catch(() => undefined), { timeout: 6000 });
    return () => cancel(id);
  }, []);

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
  return <Launcher onOpen={() => setStart({})} />;
}
