"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { LogoMark } from "@/components/shell/logo";
import { createClient } from "@/lib/supabase/client";
import "./login.css";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Un enlace de acceso caducado o ya usado vuelve aquí con ?error=enlace.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") !== "enlace") return;
    const timer = window.setTimeout(() => setMessage("Ese enlace ya se usó, ha caducado o se abrió en otro dispositivo. Entra con tu contraseña o pide un enlace nuevo."), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const supabase = createClient();
      if (!supabase) {
        setMessage("La conexión con Supabase no está configurada.");
        setLoading(false);
        return;
      }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage("No hemos podido iniciar sesión. Revisa tus datos.");
    else router.push("/");
    setLoading(false);
  }

  async function magicLink() {
    if (!email) { setMessage("Escribe tu email para enviarte el enlace."); return; }
    setLoading(true);
    const supabase = createClient();
      if (!supabase) {
        setMessage("La conexión con Supabase no está configurada.");
        setLoading(false);
        return;
      }
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: false } });
    setMessage(error ? "No hemos podido enviar el enlace. Usa el email con el que te dieron acceso." : "Revisa tu email. Te hemos enviado un enlace de acceso.");
    setLoading(false);
  }

  async function resetPassword() {
    if (!email) { setMessage("Escribe tu email y te enviamos un enlace para cambiar la contraseña."); return; }
    setLoading(true);
    const supabase = createClient();
    if (!supabase) {
      setMessage("La conexión con Supabase no está configurada.");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/cuenta` });
    setMessage(error ? "No hemos podido enviar el enlace. Inténtalo en unos minutos." : "Revisa tu email: el enlace te lleva a tu cuenta para poner una contraseña nueva.");
    setLoading(false);
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-logo"><LogoMark size={36} /></div>
        <h1>Entra en LogisticApp</h1>
        <p className="login-subtitle">Usa el email con el que te dieron acceso.</p>
        <form onSubmit={submit} noValidate={false}>
          <label>
            Email
            <span className="login-field">
              <Mail size={16} aria-hidden="true" />
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.com" required />
            </span>
          </label>
          <label>
            <span className="login-label-row">
              Contraseña
              <button type="button" className="forgot-button" onClick={resetPassword} disabled={loading}>¿La has olvidado?</button>
            </span>
            <span className="login-field">
              <LockKeyhole size={16} aria-hidden="true" />
              <input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tu contraseña" required />
              <button type="button" className="login-eye" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span>
          </label>
          {message && <p className="login-message" role="status">{message}</p>}
          <button className="login-submit" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button>
        </form>
        <div className="login-divider"><span>o</span></div>
        <button className="magic-button" onClick={magicLink} disabled={loading}>Recibir un enlace de acceso por email</button>
      </div>
      <p className="login-legal">LogisticApp · Inventario y compras para hostelería</p>
    </main>
  );
}
