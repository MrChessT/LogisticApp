"use client";

import { useState } from "react";
import { KeyRound, Trash2, UserPlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { daysAgo } from "@/lib/format";
import { assignableRoles, ROLE_HELP, ROLE_LABEL, seesAllLocations, teamErrorMessage, type Role } from "@/lib/team";
import { ShareLink } from "./share-link";
import type { Account, Location, Member } from "./team-data";

export function MemberEditor({
  actor,
  member,
  locations,
  accounts,
  onClose,
  onChanged,
}: {
  actor: Role;
  member: Member | null;
  locations: Location[];
  accounts: Account[];
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const roles = assignableRoles(actor);
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [role, setRole] = useState<Role>(member?.role ?? (roles.includes("staff") ? "staff" : roles[0]!));
  const [allLocations, setAllLocations] = useState(member?.allLocations ?? false);
  const [canValidate, setCanValidate] = useState(member?.canValidate ?? false);
  const [canSeeCosts, setCanSeeCosts] = useState(member?.canSeeCosts ?? false);
  const [testMode, setTestMode] = useState(member?.testMode ?? false);
  const [selected, setSelected] = useState<Set<string>>(new Set(member?.locationIds ?? (locations.length === 1 ? [locations[0]!.id] : [])));
  const [scope, setScope] = useState<Set<string>>(new Set(member?.accountIds ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [invite, setInvite] = useState<{ link: string; name: string; existing: boolean } | null>(null);

  const needsLocations = role === "manager" || role === "staff";
  const canAllLocations = seesAllLocations(actor);

  function toggleAccount(id: string) {
    setScope((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function validate(): string | null {
    if (!member && !/^\S+@\S+\.\S+$/.test(email.trim())) return "Escribe un email válido.";
    if (needsLocations && !allLocations && selected.size === 0) return "Elige al menos un local.";
    return null;
  }

  async function submit() {
    const invalid = validate();
    if (invalid) return setError(invalid);
    setSaving(true);
    setError("");
    const body = {
      role,
      allLocations: needsLocations ? allLocations : true,
      locationIds: needsLocations && !allLocations ? [...selected] : [],
      canValidate: role === "staff" ? canValidate : undefined,
    };
    try {
      if (!member) {
        const res = await fetch("/api/equipo/invitar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), fullName: name.trim() || undefined, ...body }),
        });
        const data = (await res.json()) as { userId?: string; link?: string | null; existing?: boolean; message?: string };
        if (!res.ok) throw new Error(data.message ?? "No se pudo invitar.");
        if (testMode && data.userId) await createClient()?.rpc("team_set_tester", { p_user: data.userId, p_on: true });
        if (data.link) {
          setInvite({ link: data.link, name: name.trim() || email.trim(), existing: !!data.existing });
          onChanged(`${name.trim() || email.trim()} ya está en el equipo. Comparte su enlace de acceso.`);
        } else {
          // Ya tenía cuenta: entra con su contraseña de siempre.
          onChanged(`${name.trim() || email.trim()} ya tenía cuenta: ya puede entrar con su email y contraseña.`);
          onClose();
        }
      } else {
        const supabase = createClient();
        if (!supabase) throw new Error("Configura las variables de Supabase.");
        const { error: err } = await supabase.rpc("team_set_member", {
          p_user: member.userId,
          p_role: role,
          p_all_locations: body.allLocations,
          p_locations: body.locationIds,
          p_full_name: name.trim() && name.trim() !== member.name ? name.trim() : null,
          p_can_validate: role === "staff" ? canValidate : null,
        });
        if (err) throw new Error(teamErrorMessage(err));
        if (role === "staff" && canSeeCosts !== (member.role === "staff" && member.canSeeCosts)) {
          const { error: costErr } = await supabase.rpc("team_set_costs", { p_user: member.userId, p_value: canSeeCosts });
          if (costErr) throw new Error(teamErrorMessage(costErr, "Se guardó el acceso, pero no el permiso de costes."));
        }
        const scopeChanged = scope.size !== member.accountIds.length || member.accountIds.some((id) => !scope.has(id));
        if (needsLocations && scopeChanged) {
          const { error: scopeErr } = await supabase.rpc("team_set_accounts", { p_user: member.userId, p_accounts: [...scope] });
          if (scopeErr) throw new Error(teamErrorMessage(scopeErr, "Se guardó el acceso, pero no las cuentas."));
        }
        if (testMode !== member.testMode) {
          const { error: testErr } = await supabase.rpc("team_set_tester", { p_user: member.userId, p_on: testMode });
          if (testErr) throw new Error(teamErrorMessage(testErr, "Se guardó el acceso, pero no el modo pruebas."));
        }
        onChanged(`Acceso de ${name.trim() || member.name} actualizado.`);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function newLink() {
    if (!member) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/equipo/enlace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.userId }) });
      const data = (await res.json()) as { link?: string; message?: string };
      if (!res.ok || !data.link) throw new Error(data.message ?? "No se pudo generar el enlace.");
      setInvite({ link: data.link, name: member.name, existing: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el enlace.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!member) return;
    setSaving(true);
    const { error: err } = (await createClient()?.rpc("team_remove_member", { p_user: member.userId })) ?? { error: null };
    setSaving(false);
    setConfirmRemove(false);
    if (err) return setError(teamErrorMessage(err, "No se pudo quitar el acceso."));
    onChanged(`${member.name} ya no tiene acceso${actor === "manager" ? " a tus locales" : ""}.`);
    onClose();
  }

  const placeNames = needsLocations ? (allLocations ? "todos los locales" : locations.filter((l) => selected.has(l.id)).map((l) => l.name).join(", ")) : "todos los locales";
  const message = invite
    ? `Hola ${invite.name.split(" ")[0]}: te doy acceso a LogisticApp como ${ROLE_LABEL[role].toLowerCase()} (${placeNames}). Entra con este enlace y ponte una contraseña: ${invite.link}`
    : "";

  return (
    <div className="modal-layer editor-layer" onClick={() => !saving && onClose()}>
      <section className="product-editor team-editor" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={member ? "Acceso de una persona" : "Invitar persona"}>
        <header className="editor-header">
          <div>
            <p className="eyebrow">{member ? "Acceso" : "Invitar persona"}</p>
            <h2>{invite ? "Enlace de acceso listo" : member ? member.name : "Nueva persona en el equipo"}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>

        {invite ? (
          <div className="editor-body">
            <p className="section-hint">
              Envía este enlace a <b>{invite.name}</b>. Al abrirlo entra directamente y se pone su contraseña. Sirve una sola vez y caduca:
              si no le funciona, genera otro desde su ficha.
            </p>
            <ShareLink link={invite.link} message={message} email={email} onError={setError} />
          </div>
        ) : (
          <div className="editor-body">
            <div className="editor-grid">
              <label className="span-2">Nombre<input autoFocus={!member} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre y apellido" maxLength={120} /></label>
              <label className="span-2">
                Email
                <input value={email} disabled={!!member} onChange={(event) => setEmail(event.target.value)} placeholder="persona@email.com" inputMode="email" autoComplete="off" />
              </label>
            </div>

            <div className="editor-section">
              <p className="facet-title">Rol</p>
              <div className="team-roles" role="radiogroup" aria-label="Rol">
                {roles.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={role === r} className={`team-role-option ${role === r ? "active" : ""}`} onClick={() => setRole(r)}>
                    <b>{ROLE_LABEL[r]}</b>
                    <small>{ROLE_HELP[r]}</small>
                  </button>
                ))}
              </div>
            </div>

            {needsLocations && (
              <div className="editor-section">
                <p className="facet-title">Locales</p>
                <p className="section-hint">Solo verá el stock, los movimientos y las cifras de estos locales.</p>
                {canAllLocations && (
                  <label className="check-option">
                    <input type="checkbox" checked={allLocations} onChange={(event) => setAllLocations(event.target.checked)} /> Todos los locales (también los que se abran en el futuro)
                  </label>
                )}
                {!allLocations && (
                  <div className="team-location-grid">
                    {locations.map((l) => (
                      <label key={l.id} className={`team-location ${selected.has(l.id) ? "active" : ""}`}>
                        <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} /> {l.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {needsLocations && accounts.length > 1 && (
              <div className="editor-section">
                <p className="facet-title">Cuentas de análisis</p>
                <p className="section-hint">
                  {member
                    ? "Solo verá los productos, el stock y los precios de estas cuentas (un cocinero, Comida). Sin ninguna marcada, ve todas."
                    : "Se pueden limitar cuando la persona ya esté en el equipo."}
                </p>
                {member && (
                  <div className="team-location-grid">
                    {accounts.map((a) => (
                      <label key={a.id} className={`team-location ${scope.has(a.id) ? "active" : ""}`}>
                        <input type="checkbox" checked={scope.has(a.id)} onChange={() => toggleAccount(a.id)} /> {a.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {role === "staff" && (
              <div className="editor-section">
                <p className="facet-title">Almacén</p>
                <label className="check-option">
                  <input type="checkbox" checked={canValidate} onChange={(event) => setCanValidate(event.target.checked)} /> Puede validar salidas del almacén
                </label>
                <p className="section-hint">Con su PIN (lo pone en «Tu cuenta») confirma lo que se ha sacado para que pase al stock. Los encargados pueden siempre.</p>
                <p className="facet-title">Costes</p>
                <label className="check-option">
                  <input type="checkbox" checked={canSeeCosts} onChange={(event) => setCanSeeCosts(event.target.checked)} disabled={!member} /> Ve costes e importes
                </label>
                <p className="section-hint">{member ? "Precios de compra, valor del stock, informes y mermas en euros. Los encargados los ven siempre." : "Se puede dar cuando la persona ya esté en el equipo."}</p>
              </div>
            )}
            <div className="editor-section">
              <p className="facet-title">Asistente</p>
              <label className="check-option">
                <input type="checkbox" checked={testMode} onChange={(event) => setTestMode(event.target.checked)} /> Modo pruebas del asistente
              </label>
              <p className="section-hint">
                Para que pruebe el asistente con los datos reales sin tocar nada: lo que confirme en el chat no se guarda, y puede reportar cada respuesta.
                Solo afecta al asistente; en las pantallas de la app guarda como siempre.
              </p>
            </div>
            {member?.pending && <p className="section-hint team-pending-hint">Todavía no ha entrado nunca. Si su enlace caducó, genera uno nuevo.</p>}
            {member && !member.pending && member.lastSignIn && <p className="section-hint">Último acceso {daysAgo(member.lastSignIn).toLowerCase()}.</p>}
          </div>
        )}

        {error && <p className="editor-message error">{error}</p>}

        <footer className="editor-footer">
          {invite ? (
            <>
              <span />
              <div className="footer-right"><button className="catalog-primary" onClick={onClose}>Hecho</button></div>
            </>
          ) : (
            <>
              {member ? (
                confirmRemove ? (
                  <div className="delete-confirm">
                    <span>¿Quitar el acceso de {member.name}{actor === "manager" ? " a tus locales" : ""}?</span>
                    <button className="danger-button" disabled={saving} onClick={() => void remove()}>Sí, quitar</button>
                    <button className="ghost-button" onClick={() => setConfirmRemove(false)}>Cancelar</button>
                  </div>
                ) : (
                  <div className="footer-left">
                    <button className="ghost-button danger" disabled={saving} onClick={() => setConfirmRemove(true)}><Trash2 size={14} /> Quitar acceso</button>
                    {member.pending && <button className="ghost-button" disabled={saving} onClick={() => void newLink()}><KeyRound size={14} /> Nuevo enlace</button>}
                  </div>
                )
              ) : (
                <span />
              )}
              <div className="footer-right">
                <button className="catalog-primary" disabled={saving} onClick={() => void submit()}>
                  {saving ? "Guardando..." : member ? "Guardar cambios" : <><UserPlus size={15} /> Invitar</>}
                </button>
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
