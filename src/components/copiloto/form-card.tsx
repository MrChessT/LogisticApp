"use client";

// Miniformulario del asistente: la operación está clara y faltan varios datos. Campos con etiqueta
// (accesibles), lo entendido ya puesto y el botón activo solo con lo obligatorio rellenado. Se envía una
// vez; después queda como registro de lo que se pidió.
import { useId, useState } from "react";
import { Check } from "lucide-react";
import type { FormEvent as AssistantForm } from "@/copiloto/contract";

export type FormValues = Partial<Record<AssistantForm["fields"][number]["key"], string>>;

export function FormCard({ form, disabled, sent, onSubmit }: { form: AssistantForm; disabled: boolean; sent: boolean; onSubmit: (values: FormValues) => void }) {
  const id = useId();
  const [values, setValues] = useState<FormValues>(() => Object.fromEntries(form.fields.filter((f) => f.value).map((f) => [f.key, f.value!])));
  const missing = form.fields.filter((f) => f.required && !(values[f.key] ?? "").trim());
  const locked = disabled || sent;

  return (
    <form
      className="copiloto-form"
      aria-label={form.title}
      onSubmit={(event) => {
        event.preventDefault();
        if (missing.length === 0 && !locked) onSubmit(values);
      }}
    >
      <strong className="copiloto-form-title">{form.title}</strong>
      {form.fields.map((field) => {
        const inputId = `${id}-${field.key}`;
        const value = values[field.key] ?? "";
        const set = (v: string) => setValues((prev) => ({ ...prev, [field.key]: v }));
        return (
          <label key={field.key} htmlFor={inputId} className="copiloto-form-field">
            <span>
              {field.label}
              {!field.required && <small> (opcional)</small>}
            </span>
            {field.kind === "select" ? (
              <select id={inputId} value={value} onChange={(e) => set(e.target.value)} disabled={locked} required={field.required}>
                <option value="">{field.required ? "Elige…" : "—"}</option>
                {field.options?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  id={inputId}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  disabled={locked}
                  required={field.required}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  {...(field.kind === "product" ? { list: `${inputId}-list` } : {})}
                />
                {field.kind === "product" && (
                  <datalist id={`${inputId}-list`}>
                    {field.options?.map((o) => <option key={o.id} value={o.label} />)}
                  </datalist>
                )}
              </>
            )}
          </label>
        );
      })}
      <button type="submit" className="primary-button" disabled={locked || missing.length > 0}>
        <Check size={15} /> {sent ? "Enviado" : "Preparar borrador"}
      </button>
    </form>
  );
}
