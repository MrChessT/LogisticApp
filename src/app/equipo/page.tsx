"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, KeyRound, Mail, MessageCircle, Search, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { daysAgo, normalizeText } from "@/lib/format";
import { assignableRoles, managesTeam, ROLE_HELP, ROLE_LABEL, seesAllLocations, teamErrorMessage, type Role } from "@/lib/team";
import "../productos/productos.css";
import "../productos/product-editor.css";
import "./equipo.css";

// Equipo: quién entra en LogisticApp, con qué rol y en qué locales.
// Las reglas viven en la base de datos (migración 0021): aquí solo se ofrece lo que cada rol puede hacer.
//   Administración (propietario, administrador): todos los locales; gestiona encargados y personal.
//   Encargado: solo sus locales; gestiona al personal de sus locales.
//   Personal: no ve esta pantalla.

type Member = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  allLocations: boolean;
  locationIds: string[];
  lastSignIn: string | null;
  pending: boolean;
  isSelf: boolean;
  canEdit: boolean;
};
type Location = { id: string; name: string };
type Filter = "todos" | "direccion" | "manager" | "staff" | "pendientes";

async function loadTeam(): Promise<{ actor: Role | null; members: Member[]; locations: Location[] }> {
  const supabase = createClient();
  if (!supabase) throw new Error("Configura las variables de Supabase.");
  const userId = (await supabase.auth.getSession()).data.session?.user.id;
  if (!userId) throw new Error("Inicia sesión de nuevo.");
  const [{ data: me }, { data: locations }] = await Promise.all([
    supabase.from("memberships").select("role").eq("user_id", userId).limit(1).maybeSingle(),
    supabase.from("locations").select("id, name").eq("active", true).order("name"),
  ]);
  const actor = (me?.role ?? null) as Role | null;
  if (!managesTeam(actor)) return { actor, members: [], locations: (locations ?? []) as Location[] };
  const { data, error } = await supabase.rpc("team_members");
  if (error) throw new Error(teamErrorMessage(error, "No se pudo cargar el equipo."));
  return {
    actor,
    locations: (locations ?? []) as Location[],
    members: (data ?? []).map((m) => ({
      userId: m.user_id,
      name: m.full_name?.trim() || m.email?.split("@")[0] || "Sin nombre",
      email: m.email ?? "",
      role: m.role,
      allLocations: m.all_locations || seesAllLocations(m.role),
      locationIds: m.location_ids ?? [],
      lastSignIn: m.last_sign_in_at,
      pending: m.pending,
      isSelf: m.is_self,
      canEdit: m.can_edit,
    })),
  };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default function TeamPage() {
  const [actor, setActor] = useState<Role | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [notice, setNotice] = useState("");

  async function reload() {
    try {
      const team = await loadTeam();
      setActor(team.actor);
      setMembers(team.members);
      setLocations(team.locations);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el equipo.");
    }
  }

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      await reload();
    }
    void start();
  }, []);

  const locationName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const counts = useMemo(() => {
    const list = members ?? [];
    return {
      todos: list.length,
      direccion: list.filter((m) => m.role === "owner" || m.role === "admin").length,
      manager: list.filter((m) => m.role === "manager").length,
      staff: list.filter((m) => m.role === "staff").length,
      pendientes: list.filter((m) => m.pending).length,
    };
  }, [members]);
  const visible = (members ?? []).filter(
    (m) =>
      (filter === "todos" ||
        (filter === "direccion" && (m.role === "owner" || m.role === "admin")) ||
        (filter === "pendientes" && m.pending) ||
        m.role === filter) &&
      (!query || normalizeText(`${m.name} ${m.email}`).includes(normalizeText(query))),
  );
  const canInvite = assignableRoles(actor).length > 0;
  const admin = seesAllLocations(actor);

  if (actor !== undefined && !managesTeam(actor)) {
    return (
      <main className="catalog-page">
        <header className="catalog-topbar">
          <Link href="/" className="back-link"><ArrowLeft size={16} /> Resumen</Link>
          <span className="catalog-title">Equipo</span>
          <span />
        </header>
        <div className="catalog-content">
          <div className="catalog-empty team-locked">
            <ShieldCheck size={28} />
            <strong>El equipo lo gestionan los encargados y la administración</strong>
            <span>Si necesitas dar acceso a alguien, pídeselo a tu encargado. Tu propio acceso está en <Link href="/cuenta">tu cuenta</Link>.</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="catalog-page">
      <header className="catalog-topbar">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Resumen</Link>
        <span className="catalog-title">Equipo</span>
        <span />
      </header>
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Gestión · Personas</p>
            <h1>Equipo</h1>
            <p className="catalog-subtitle">
              {admin
                ? "Quién entra en LogisticApp, con qué rol y en qué locales. Cada persona solo ve las cifras de sus locales."
                : `El personal de tus locales: ${locations.map((l) => l.name).join(", ") || "—"}.`}
            </p>
          </div>
          {canInvite && <button className="catalog-primary" onClick={() => setEditing("new")}><UserPlus size={17} /> Invitar persona</button>}
        </div>

        {notice && <p className="editor-message team-notice">{notice}</p>}

        <div className="catalog-tabs">
          <button className={filter === "todos" ? "active" : undefined} onClick={() => setFilter("todos")}>Todos <b>{counts.todos}</b></button>
          {admin && <button className={filter === "direccion" ? "active" : undefined} onClick={() => setFilter("direccion")}>Administración <b>{counts.direccion}</b></button>}
          <button className={filter === "manager" ? "active" : undefined} onClick={() => setFilter("manager")}>Encargados <b>{counts.manager}</b></button>
          <button className={filter === "staff" ? "active" : undefined} onClick={() => setFilter("staff")}>Personal <b>{counts.staff}</b></button>
          {counts.pendientes > 0 && <button className={filter === "pendientes" ? "active" : undefined} onClick={() => setFilter("pendientes")}>Sin entrar aún <b>{counts.pendientes}</b></button>}
        </div>

        <section className="catalog-panel">
          <div className="catalog-toolbar">
            <div className="catalog-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o email" />
            </div>
          </div>
          <div className="team-table">
            <div className="team-head"><span>Persona</span><span>Rol</span><span>Locales</span><span>Último acceso</span></div>
            {!members && !error && <div className="catalog-empty"><strong>Cargando equipo...</strong></div>}
            {error && (
              <div className="catalog-empty">
                <strong>{error}</strong>
                <button className="filter-button" onClick={() => void reload()}>Reintentar</button>
              </div>
            )}
            {visible.map((m) => {
              const open = () => (m.canEdit ? setEditing(m) : undefined);
              return (
                <div
                  key={m.userId}
                  className={`team-row ${m.canEdit ? "editable" : ""}`}
                  role={m.canEdit ? "button" : undefined}
                  tabIndex={m.canEdit ? 0 : undefined}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (m.canEdit && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      open();
                    }
                  }}
                >
                  <span className="team-person">
                    <span className={`team-avatar role-${m.role}`}>{initials(m.name)}</span>
                    <span>
                      <strong>{m.name}{m.isSelf && <em className="team-you">Tú</em>}</strong>
                      <small>{m.email}</small>
                    </span>
                  </span>
                  <span><span className={`team-role role-${m.role}`}>{ROLE_LABEL[m.role]}</span></span>
                  <span className="team-locations">
                    {m.allLocations ? (
                      <span className="team-chip all">Todos los locales</span>
                    ) : (
                      m.locationIds.map((id) => <span key={id} className="team-chip">{locationName.get(id) ?? "Otro local"}</span>)
                    )}
                  </span>
                  <span>{m.pending ? <span className="team-pending">Sin entrar aún</span> : m.lastSignIn ? daysAgo(m.lastSignIn) : "—"}</span>
                </div>
              );
            })}
            {members && visible.length === 0 && !error && (
              <div className="catalog-empty">
                <strong>{query || filter !== "todos" ? "Nadie coincide" : "Todavía no hay nadie más"}</strong>
                {canInvite && !query && <span>Invita a tu equipo con «Invitar persona».</span>}
              </div>
            )}
          </div>
        </section>
        <p className="team-footnote">
          Lo que ve cada uno lo decide la base de datos: la administración ve todos los locales; encargados y personal, solo los suyos, también en informes y en el asistente.
        </p>
      </div>

      {editing && actor && (
        <MemberEditor
          actor={actor}
          member={editing === "new" ? null : editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onChanged={(message) => {
            setNotice(message);
            void reload();
          }}
        />
      )}
    </main>
  );
}

function MemberEditor({
  actor,
  member,
  locations,
  onClose,
  onChanged,
}: {
  actor: Role;
  member: Member | null;
  locations: Location[];
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const roles = assignableRoles(actor);
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [role, setRole] = useState<Role>(member?.role ?? (roles.includes("staff") ? "staff" : roles[0]!));
  const [allLocations, setAllLocations] = useState(member?.allLocations ?? false);
  const [selected, setSelected] = useState<Set<string>>(new Set(member?.locationIds ?? (locations.length === 1 ? [locations[0]!.id] : [])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [invite, setInvite] = useState<{ link: string; name: string; existing: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const needsLocations = role === "manager" || role === "staff";
  const canAllLocations = seesAllLocations(actor);

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
    const body = { role, allLocations: needsLocations ? allLocations : true, locationIds: needsLocations && !allLocations ? [...selected] : [] };
    try {
      if (!member) {
        const res = await fetch("/api/equipo/invitar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), fullName: name.trim() || undefined, ...body }),
        });
        const data = (await res.json()) as { link?: string | null; existing?: boolean; message?: string };
        if (!res.ok) throw new Error(data.message ?? "No se pudo invitar.");
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
        });
        if (err) throw new Error(teamErrorMessage(err));
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

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite?.link ?? "");
      setCopied(true);
    } catch {
      setError("No se pudo copiar: selecciona el enlace y cópialo a mano.");
    }
  }

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
            <div className="team-link">
              <input readOnly value={invite.link} onFocus={(event) => event.target.select()} aria-label="Enlace de acceso" />
              <button className="catalog-primary" onClick={() => void copy()}>{copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}</button>
            </div>
            <div className="team-share">
              <a className="ghost-button" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Enviar por WhatsApp</a>
              {email && <a className="ghost-button" href={`mailto:${email}?subject=${encodeURIComponent("Tu acceso a LogisticApp")}&body=${encodeURIComponent(message)}`}><Mail size={15} /> Enviar por email</a>}
            </div>
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
