"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { decimalText } from "@/lib/format";
import { lookupProducts, type LookupOptions, type LookupProduct } from "@/lib/product-lookup";
import "./product-picker.css";

// Buscador de productos para formularios: escribe dos letras (o escanea un código de barras) y elige.
// Pide al servidor solo los resultados que se ven; con el campo vacío propone lo del local.

const DEBOUNCE_MS = 180;

export function ProductPicker({
  value,
  onChange,
  options,
  placeholder = "Buscar producto",
  exclude,
  autoFocus,
  clearOnSelect,
  renderMeta,
  ariaLabel,
}: {
  value: LookupProduct | null;
  onChange: (product: LookupProduct | null) => void;
  options?: LookupOptions;
  placeholder?: string;
  /** Productos que no deben salir (ya están en la lista). */
  exclude?: Set<string>;
  autoFocus?: boolean;
  /** Para «añadir a la lista»: tras elegir, el campo se vacía. */
  clearOnSelect?: boolean;
  /** Texto a la derecha de cada resultado (p. ej. el último precio). */
  renderMeta?: (product: LookupProduct) => string | null;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<LookupProduct[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const listId = useId();
  const request = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const locationId = options?.locationId ?? null;
  const supplierId = options?.supplierId ?? null;
  const limit = options?.limit ?? 8;

  // Si el valor cambia desde fuera (otra línea, reinicio del formulario), el texto lo sigue.
  const [shownValue, setShownValue] = useState(value?.id ?? null);
  if ((value?.id ?? null) !== shownValue) {
    setShownValue(value?.id ?? null);
    setText(value?.name ?? "");
  }

  useEffect(() => {
    if (!open) return;
    const id = ++request.current;
    const query = value && text === value.name ? "" : text;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const found = await lookupProducts(query, { locationId, supplierId, limit: limit + (exclude?.size ?? 0) });
        if (id !== request.current) return;
        setResults(found.filter((p) => !exclude?.has(p.id)).slice(0, limit));
        setActive(0);
        setError("");
      } catch {
        if (id === request.current) setError("No se pudo buscar. Revisa la conexión.");
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, query ? DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [open, text, value, locationId, supplierId, limit, exclude]);

  // Cerrar al pulsar fuera.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function choose(product: LookupProduct) {
    onChange(product);
    setText(clearOnSelect ? "" : product.name);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      if (open && results[active]) {
        event.preventDefault();
        choose(results[active]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="product-picker" ref={boxRef}>
      <div className="product-picker-field">
        <Search size={14} aria-hidden="true" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel ?? placeholder}
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="search"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            if (value && !clearOnSelect) onChange(null);
          }}
          onKeyDown={onKeyDown}
        />
        {text && (
          <button
            type="button"
            className="product-picker-clear"
            aria-label="Borrar"
            onClick={() => {
              setText("");
              if (value) onChange(null);
              setOpen(true);
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <ul className="product-picker-list" id={listId} role="listbox">
          {error && <li className="product-picker-note">{error}</li>}
          {!error && loading && results.length === 0 && <li className="product-picker-note">Buscando…</li>}
          {!error && !loading && results.length === 0 && <li className="product-picker-note">{text.trim() ? "Ningún producto coincide." : "Escribe para buscar."}</li>}
          {results.map((p, i) => {
            const meta = renderMeta?.(p);
            return (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : undefined}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(p)}
                onPointerEnter={() => setActive(i)}
              >
                <span>
                  <b>{p.name}</b>
                  <small>
                    {p.family ?? "Sin familia"}
                    {p.stock !== null && ` · stock ${decimalText(p.stock)} ${p.base_unit}`}
                    {locationId && !p.in_location && " · no está en este local"}
                  </small>
                </span>
                {meta && <em>{meta}</em>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
