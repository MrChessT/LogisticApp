"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, ShieldCheck, Tablet, UserPlus } from "lucide-react";
import { daysAgo, normalizeText } from "@/lib/format";
import { assignableRoles, managesScreens, managesTeam, ROLE_LABEL, seesAllLocations, type Role } from "@/lib/team";
import { MemberEditor } from "./member-editor";
import { ScreenEditor } from "./screen-editor";
import { loadTeam, type Account, type Filter, type Location, type Member } from "./team-data";
import "../productos/productos.css";
import "../productos/product-editor.css";
import "./equipo.css";
import { LoadingRows } from "@/components/ui/loading-rows";

// Equipo: quién entra en LogisticApp, con qué rol y en qué locales.
// Las reglas viven en la base de datos (migración 0021): aquí solo se ofrece lo que cada rol puede hacer.
//   Administración (propietario, administrador): todos los locales; gestiona encargados y personal.
//   Encargado: solo sus locales; gestiona al personal de sus locales.
//   Personal: no ve esta pantalla.
// Cuentas de análisis (0055-0057): a encargados y personal se les puede limitar a unas cuentas (Comida, Bebida…).
// Pantallas de almacén (migración 0024): una cuenta por tablet, en un local, que solo apunta salidas.


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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [editingScreen, setEditingScreen] = useState<Member | "new" | null>(null);
  const [notice, setNotice] = useState("");

  async function reload() {
    try {
      const team = await loadTeam();
      setActor(team.actor);
      setMembers(team.members);
      setLocations(team.locations);
      setAccounts(team.accounts);
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
  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  // Las pantallas no son personas: van en su propia sección.
  const people = useMemo(() => (members ?? []).filter((m) => m.role !== "kiosk"), [members]);
  const screens = useMemo(() => (members ?? []).filter((m) => m.role === "kiosk"), [members]);
  const counts = useMemo(() => {
    const list = people;
    return {
      todos: list.length,
      direccion: list.filter((m) => m.role === "owner" || m.role === "admin").length,
      manager: list.filter((m) => m.role === "manager").length,
      staff: list.filter((m) => m.role === "staff").length,
      pendientes: list.filter((m) => m.pending).length,
    };
  }, [people]);
  const visible = people.filter(
    (m) =>
      (filter === "todos" ||
        (filter === "direccion" && (m.role === "owner" || m.role === "admin")) ||
        (filter === "pendientes" && m.pending) ||
        m.role === filter) &&
      (!query || normalizeText(`${m.name} ${m.email}`).includes(normalizeText(query))),
  );
  const canInvite = assignableRoles(actor).length > 0;
  const canScreens = managesScreens(actor);
  const admin = seesAllLocations(actor);

  if (actor !== undefined && !managesTeam(actor)) {
    return (
      <main className="catalog-page">
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
            <div className="team-head"><span>Persona</span><span>Rol</span><span>Locales y cuentas</span><span>Último acceso</span></div>
            {!members && !error && <LoadingRows label="Cargando equipo" />}
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
                      <strong>{m.name}{m.isSelf && <em className="team-you">Tú</em>}{m.testMode && <em className="team-tester">Probando el asistente</em>}</strong>
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
                    {m.accountIds.map((id) => <span key={id} className="team-chip account">{accountName.get(id) ?? "Otra cuenta"}</span>)}
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
        {canScreens && (
          <section className="catalog-panel team-screens">
            <header className="team-screens-head">
              <div>
                <h2><Tablet size={17} /> Pantallas de almacén</h2>
                <p>Tablets fijas en el almacén: apuntan lo que sale a barra sin ver precios ni nada más. Lo apuntado queda pendiente hasta que alguien con PIN lo valida.</p>
              </div>
              <button className="ghost-button" onClick={() => setEditingScreen("new")}><Plus size={15} /> Añadir pantalla</button>
            </header>
            {screens.length === 0 ? (
              <p className="team-screens-empty">Todavía no hay ninguna. Añade una y abre su enlace en la tablet del almacén.</p>
            ) : (
              <div className="team-screen-list">
                {screens.map((m) => (
                  <button key={m.userId} className="team-screen" onClick={() => m.canEdit && setEditingScreen(m)} disabled={!m.canEdit}>
                    <span className="team-screen-icon"><Tablet size={18} /></span>
                    <span className="team-screen-copy">
                      <strong>{m.name}</strong>
                      <small>{m.locationIds.map((id) => locationName.get(id) ?? "Otro local").join(", ")}</small>
                    </span>
                    {m.pending ? <span className="team-pending">Sin abrir aún</span> : <small className="team-screen-seen">{m.lastSignIn ? `Vinculada ${daysAgo(m.lastSignIn).toLowerCase()}` : "Vinculada"}</small>}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        <p className="team-footnote">
          Lo que ve cada uno lo decide la base de datos: la administración ve todos los locales; encargados y personal, solo los suyos, también en informes y en el asistente.
        </p>
      </div>

      {editing && actor && (
        <MemberEditor
          actor={actor}
          member={editing === "new" ? null : editing}
          locations={locations}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onChanged={(message) => {
            setNotice(message);
            void reload();
          }}
        />
      )}
      {editingScreen && (
        <ScreenEditor
          screen={editingScreen === "new" ? null : editingScreen}
          locations={locations}
          onClose={() => setEditingScreen(null)}
          onChanged={(message) => {
            setNotice(message);
            void reload();
          }}
        />
      )}
    </main>
  );
}
