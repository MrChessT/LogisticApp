"use client";

// Selector de local en pestañas: con pocos locales se ven todos de un vistazo y se cambia con un toque.
// Con muchos (más de MAX_TABS) vuelve a ser un desplegable, que no desborda la cabecera.
import { ChevronDown } from "lucide-react";
import "./location-tabs.css";

const MAX_TABS = 6;

export type LocationOption = { id: string; name: string };

export function LocationTabs({
  locations,
  value,
  onChange,
  allLabel = "Todos",
}: {
  locations: LocationOption[];
  value: string;
  onChange: (id: string) => void;
  /** null: sin opción «todos» (un solo local). */
  allLabel?: string | null;
}) {
  const options = [...(allLabel !== null && locations.length !== 1 ? [{ id: "", name: allLabel }] : []), ...locations];
  if (options.length <= 1) return null;
  if (options.length > MAX_TABS) {
    return (
      <label className="location-pick">
        <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Local">
          {options.map((o) => (
            <option key={o.id || "all"} value={o.id}>{o.name}</option>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </label>
    );
  }
  return (
    <div className="location-tabs" role="tablist" aria-label="Local">
      {options.map((o) => (
        <button
          key={o.id || "all"}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className={value === o.id ? "on" : undefined}
          onClick={() => onChange(o.id)}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}
