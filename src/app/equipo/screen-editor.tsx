"use client";

import { useState } from "react";
import { KeyRound, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { daysAgo } from "@/lib/format";
import { teamErrorMessage } from "@/lib/team";
import { ShareLink } from "./share-link";
import type { Location, Member } from "./team-data";

/**
 * Ficha de una pantalla de almacén: nombre, local, enlace para vincular la tablet y quitarla.
 * El enlace se puede pedir siempre (tablet nueva, sesión cerrada): la cuenta solo entra en /almacen.
 */
export function ScreenEditor({
  screen,
  locations,
  onClose,
  onChanged,
}: {
  screen: Member | null;
  locations: Location[];
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [locationId, setLocationId] = useState(screen?.locationIds[0] ?? (locations.length === 1 ? locations[0]!.id : ""));
  const defaultName = (id: string) => `Pantalla · ${locations.find((l) => l.id === id)?.name ?? "almacén"}`;
  const [name, setName] = useState(screen?.name ?? (locationId ? defaultName(locationId) : ""));
  const [nameTouched, setNameTouched] = useState(!!screen);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  function pickLocation(id: string) {
    setLocationId(id);
    if (!nameTouched) setName(defaultName(id));
  }

  async function call(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { link?: string; message?: string };
    if (!res.ok) throw new Error(data.message ?? "No se pudo guardar.");
    return data;
  }

  async function submit() {
    if (!name.trim()) return setError("Ponle un nombre (por ejemplo «Pantalla · Almacén Pickles»).");
    if (!locationId) return setError("Elige el local.");
    setSaving(true);
    setError("");
    try {
      if (!screen) {
        const data = await call("/api/equipo/pantalla", "POST", { name: name.trim(), locationId });
        setLink(data.link ?? null);
        onChanged(`${name.trim()} creada. Abre su enlace en la tablet del almacén.`);
      } else {
        const { error: err } = (await createClient()?.rpc("team_set_member", {
          p_user: screen.userId,
          p_role: "kiosk",
          p_all_locations: false,
          p_locations: [locationId],
          p_full_name: name.trim(),
        })) ?? { error: null };
        if (err) throw new Error(teamErrorMessage(err));
        onChanged(`${name.trim()} actualizada.`);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function newLink() {
    if (!screen) return;
    setSaving(true);
    setError("");
    try {
      const data = await call("/api/equipo/enlace", "POST", { userId: screen.userId });
      setLink(data.link ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el enlace.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!screen) return;
    setSaving(true);
    setError("");
    try {
      await call("/api/equipo/pantalla", "DELETE", { userId: screen.userId });
      onChanged(`${screen.name} quitada: esa tablet ya no puede apuntar salidas.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la pantalla.");
      setConfirmRemove(false);
    } finally {
      setSaving(false);
    }
  }

  const message = link ? `Enlace para la pantalla del almacén (${name.trim()}). Ábrelo en la tablet del almacén: ${link}` : "";

  return (
    <div className="modal-layer editor-layer" onClick={() => !saving && onClose()}>
      <section className="product-editor team-editor" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={screen ? "Pantalla de almacén" : "Añadir pantalla"}>
        <header className="editor-header">
          <div>
            <p className="eyebrow">Pantalla de almacén</p>
            <h2>{link ? "Enlace de la pantalla listo" : screen ? screen.name : "Nueva pantalla"}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>

        {link ? (
          <div className="editor-body">
            <p className="section-hint">
              Abre este enlace <b>en la tablet del almacén</b> (o envíatelo y ábrelo allí). Entra directamente en la pantalla de salidas y se queda
              vinculada. Sirve una sola vez: si cambias de tablet o se cierra la sesión, genera otro desde aquí.
            </p>
            <ShareLink link={link} message={message} onError={setError} />
          </div>
        ) : (
          <div className="editor-body">
            <div className="editor-grid">
              <label className="span-2">
                Nombre
                <input
                  autoFocus={!screen}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameTouched(true);
                  }}
                  placeholder="Pantalla · Almacén"
                  maxLength={60}
                />
              </label>
            </div>
            <div className="editor-section">
              <p className="facet-title">Local</p>
              <p className="section-hint">Una pantalla va en un único local: solo verá sus productos y sus zonas, sin precios.</p>
              <div className="team-location-grid" role="radiogroup" aria-label="Local">
                {locations.map((l) => (
                  <label key={l.id} className={`team-location ${locationId === l.id ? "active" : ""}`}>
                    <input type="radio" name="screen-location" checked={locationId === l.id} onChange={() => pickLocation(l.id)} /> {l.name}
                  </label>
                ))}
              </div>
            </div>
            {screen?.pending && <p className="section-hint team-pending-hint">Todavía no se ha abierto en ninguna tablet. Genera su enlace y ábrelo allí.</p>}
            {screen && !screen.pending && screen.lastSignIn && <p className="section-hint">Vinculada {daysAgo(screen.lastSignIn).toLowerCase()}.</p>}
          </div>
        )}

        {error && <p className="editor-message error">{error}</p>}

        <footer className="editor-footer">
          {link ? (
            <>
              <span />
              <div className="footer-right"><button className="catalog-primary" onClick={onClose}>Hecho</button></div>
            </>
          ) : (
            <>
              {screen ? (
                confirmRemove ? (
                  <div className="delete-confirm">
                    <span>¿Quitar {screen.name}? Esa tablet dejará de funcionar.</span>
                    <button className="danger-button" disabled={saving} onClick={() => void remove()}>Sí, quitar</button>
                    <button className="ghost-button" onClick={() => setConfirmRemove(false)}>Cancelar</button>
                  </div>
                ) : (
                  <div className="footer-left">
                    <button className="ghost-button danger" disabled={saving} onClick={() => setConfirmRemove(true)}><Trash2 size={14} /> Quitar</button>
                    <button className="ghost-button" disabled={saving} onClick={() => void newLink()}><KeyRound size={14} /> {screen.pending ? "Enlace" : "Nuevo enlace"}</button>
                  </div>
                )
              ) : (
                <span />
              )}
              <div className="footer-right">
                <button className="catalog-primary" disabled={saving} onClick={() => void submit()}>
                  {saving ? "Guardando..." : screen ? "Guardar cambios" : <><Plus size={15} /> Crear pantalla</>}
                </button>
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
