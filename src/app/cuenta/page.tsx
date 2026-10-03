"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_HELP, ROLE_LABEL, seesAllLocations, type Role } from "@/lib/team";
import "../productos/productos.css";
import "../productos/product-editor.css";
import "./cuenta.css";

// Tu cuenta: nombre visible y contraseña. Aquí llega también el enlace de «¿Has olvidado la contraseña?».

export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState<"" | "name" | "password">("");
  const [access, setAccess] = useState<{ role: Role; locations: string[] | null } | null>(null);
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      const supabase = createClient();
      const { data } = (await supabase?.auth.getSession()) ?? { data: null };
      const user = data?.session?.user;
      if (!supabase || !user) return;
      setEmail(user.email ?? "");
      setUserId(user.id);
      setWelcome(new URLSearchParams(window.location.search).has("bienvenida"));
      const [{ data: profile }, { data: membership }, { data: locations }] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
        supabase.from("memberships").select("role, all_locations").eq("user_id", user.id).limit(1).maybeSingle(),
        // RLS: cada uno solo ve sus locales (todos, si es propietario o administrador).
        supabase.from("locations").select("name").eq("active", true).order("name"),
      ]);
      setName(profile?.full_name ?? "");
      if (membership) {
        const role = membership.role as Role;
        setAccess({ role, locations: seesAllLocations(role) || membership.all_locations ? null : (locations ?? []).map((l) => l.name) });
      }
    }
    void start();
  }, []);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase || !userId) return;
    setSaving("name");
    const { data, error } = await supabase.from("profiles").update({ full_name: name.trim() || null }).eq("user_id", userId).select("user_id");
    setSaving("");
    setMessage(error || !data?.length ? { ok: false, text: "No se pudo guardar el nombre." } : { ok: true, text: "Nombre actualizado." });
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setMessage({ ok: false, text: "La contraseña debe tener al menos 8 caracteres." });
    if (password !== repeat) return setMessage({ ok: false, text: "Las contraseñas no coinciden." });
    const supabase = createClient();
    if (!supabase) return;
    setSaving("password");
    const { error } = await supabase.auth.updateUser({ password });
    setSaving("");
    setPassword("");
    setRepeat("");
    setMessage(error ? { ok: false, text: "No se pudo cambiar la contraseña. Vuelve a entrar e inténtalo de nuevo." } : { ok: true, text: "Contraseña cambiada." });
  }

  async function signOut() {
    await createClient()?.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="catalog-page">
      <header className="catalog-topbar">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Resumen</Link>
        <span className="catalog-title">Tu cuenta</span>
        <span />
      </header>
      <div className="catalog-content account-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">{email}</p>
            <h1>Tu cuenta</h1>
          </div>
          <button className="ghost-button" onClick={() => void signOut()}><LogOut size={14} /> Cerrar sesión</button>
        </div>
        {welcome && (
          <div className="catalog-panel account-card account-welcome">
            <h2>Bienvenido a LogisticApp</h2>
            <p className="section-hint">Ya tienes acceso. Escribe tu nombre y ponte una contraseña: así entras la próxima vez sin necesitar otro enlace.</p>
          </div>
        )}
        {message && <p className={message.ok ? "editor-message" : "editor-message error"}>{message.text}</p>}
        {access && (
          <div className="catalog-panel account-card">
            <h2>Tu acceso</h2>
            <p className="section-hint">{ROLE_HELP[access.role]}</p>
            <p className="account-access"><b>{ROLE_LABEL[access.role]}</b> · {access.locations ? access.locations.join(", ") || "Sin locales asignados" : "Todos los locales"}</p>
          </div>
        )}
        <form className="catalog-panel account-card" onSubmit={saveName}>
          <h2>Nombre</h2>
          <p className="section-hint">Es el que ven tus compañeros y el que aparece en el resumen.</p>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre y apellido" maxLength={80} />
          <button className="catalog-primary" disabled={saving !== "" || !userId}>{saving === "name" ? "Guardando..." : "Guardar nombre"}</button>
        </form>
        <form className="catalog-panel account-card" onSubmit={savePassword}>
          <h2>Contraseña</h2>
          <p className="section-hint">Si entraste con un enlace mágico, puedes ponerte una contraseña para no depender del email.</p>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nueva contraseña (mínimo 8 caracteres)" autoComplete="new-password" />
          <input type="password" value={repeat} onChange={(event) => setRepeat(event.target.value)} placeholder="Repite la contraseña" autoComplete="new-password" />
          <button className="catalog-primary" disabled={saving !== "" || !password}>{saving === "password" ? "Guardando..." : "Cambiar contraseña"}</button>
        </form>
      </div>
    </main>
  );
}
