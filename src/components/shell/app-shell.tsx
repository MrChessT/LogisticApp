"use client";

// Marco común de la app: menú lateral (en el móvil, desplegable), barra superior con la sección y la
// búsqueda. Antes cada pantalla tenía su propia cabecera con «← Resumen» y el menú solo existía en el
// inicio: para ir de Stock a Pedidos había que volver atrás.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  ChefHat,
  CircleHelp,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageSquareText,
  Package,
  PackageCheck,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Users,
  Warehouse,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { forgetIdentity, useIdentity } from "@/lib/identity";
import { readLocation } from "@/lib/location-preference";
import { usePermissions } from "@/lib/permissions";
import { Logo } from "./logo";
import "./app-shell.css";

type Item = { label: string; href: string; icon: LucideIcon; badge?: number; local?: boolean; show?: boolean };

/** Pantallas sin marco: entrada, enlaces de acceso y la pantalla de almacén (kiosko). */
const BARE = [/^\/login/, /^\/auth\//];

const SECTION: Array<[RegExp, string]> = [
  [/^\/$/, "Resumen"],
  [/^\/stock/, "Stock"],
  [/^\/pedidos/, "Pedidos"],
  [/^\/recepciones/, "Recepciones"],
  [/^\/traspasos/, "Traspasos"],
  [/^\/almacen/, "Almacén"],
  [/^\/inventarios/, "Inventarios"],
  [/^\/mermas/, "Mermas"],
  [/^\/productos/, "Productos"],
  [/^\/proveedores/, "Proveedores"],
  [/^\/escandallos/, "Escandallos"],
  [/^\/facturas/, "Facturas"],
  [/^\/informes/, "Informes"],
  [/^\/equipo/, "Equipo"],
  [/^\/opiniones/, "Opiniones del asistente"],
  [/^\/zonas/, "Zonas"],
  [/^\/importar/, "Importar"],
  [/^\/cuenta/, "Tu cuenta"],
];

type Counts = { attention: number; transfers: number; moves: number };

/** Avisos del menú: productos bajo mínimo, traspasos sin cerrar y salidas de almacén por validar. */
async function loadCounts(): Promise<Counts | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const [summary, transfers, moves] = await Promise.all([
    supabase.rpc("stock_summary", { p_location: null }),
    supabase.from("transfers").select("id", { count: "exact", head: true }).in("status", ["draft", "in_transit"]),
    supabase.from("area_moves").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return {
    attention: Number(summary.data?.[0]?.below_min_count ?? 0),
    transfers: transfers.count ?? 0,
    moves: moves.count ?? 0,
  };
}

function askAssistant(message?: string) {
  window.dispatchEvent(new CustomEvent("copiloto:ask", { detail: message ? { message } : {} }));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const bare = BARE.some((re) => re.test(pathname));
  const identity = useIdentity();
  const perms = usePermissions();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [local, setLocal] = useState("");

  // Los avisos se refrescan al cambiar de pantalla (después de registrar algo se ven al momento).
  useEffect(() => {
    if (bare || !identity || identity.kiosk) return;
    let cancelled = false;
    void loadCounts().then((c) => {
      if (!cancelled && c) setCounts(c);
    });
    void Promise.resolve().then(() => {
      if (!cancelled) setLocal(readLocation());
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, bare, identity]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMenuOpen(false);
      }
      // «/» abre la búsqueda (salvo escribiendo en un campo).
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && target && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && !target.isContentEditable) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // La pantalla de almacén (kiosko) no lleva marco; mientras se sabe quién es, tampoco se pinta en ella.
  if (bare || identity === null || identity?.kiosk || (identity === undefined && pathname.startsWith("/almacen"))) return <>{children}</>;

  const role = identity?.roleKey ?? "";
  const manager = ["owner", "admin", "manager"].includes(role);
  const admin = ["owner", "admin"].includes(role);
  const withLocal = (path: string) => (local ? `${path}?local=${local}` : path);
  const operativa: Item[] = [
    { label: "Resumen", href: "/", icon: LayoutDashboard },
    { label: "Stock", href: withLocal("/stock"), icon: Boxes, badge: counts?.attention },
    { label: "Pedidos", href: "/pedidos", icon: ShoppingCart },
    { label: "Recepciones", href: "/recepciones", icon: PackageCheck },
    { label: "Traspasos", href: "/traspasos", icon: Truck, badge: counts?.transfers },
    { label: "Almacén", href: withLocal("/almacen"), icon: Warehouse, badge: counts?.moves },
    { label: "Inventarios", href: "/inventarios", icon: ClipboardList },
    { label: "Mermas", href: "/mermas", icon: XCircle },
  ];
  const gestion: Item[] = [
    { label: "Productos", href: "/productos", icon: Package },
    { label: "Proveedores", href: "/proveedores", icon: Truck },
    { label: "Escandallos", href: "/escandallos", icon: ChefHat },
    { label: "Facturas", href: "/facturas", icon: FileText, show: manager && !!perms?.seesCosts },
    { label: "Informes", href: withLocal("/informes"), icon: SlidersHorizontal, show: !!perms?.seesCosts },
    { label: "Zonas", href: "/zonas", icon: MapPin },
    { label: "Equipo", href: "/equipo", icon: Users, show: manager },
    { label: "Opiniones del asistente", href: "/opiniones", icon: MessageSquareText, show: admin },
    { label: "Importar", href: "/importar", icon: FileSpreadsheet, show: admin },
  ];
  const active = (href: string) => {
    const path = href.split("?")[0]!;
    return path === "/" ? pathname === "/" : pathname.startsWith(path);
  };
  const section = SECTION.find(([re]) => re.test(pathname))?.[1] ?? "";

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q")?.toString().trim();
    setSearchOpen(false);
    router.push(q ? `/productos?q=${encodeURIComponent(q)}&estado=all` : "/productos");
  }

  async function signOut() {
    forgetIdentity();
    await createClient()?.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const nav = (items: Item[]) =>
    items
      .filter((i) => i.show !== false)
      .map((item) => {
        const Icon = item.icon;
        const on = active(item.href);
        return (
          // Sin precarga al aparecer (el menú está siempre a la vista y descargaba todas las pantallas); se
          // precarga al ir hacia el enlace, así que la navegación sigue siendo inmediata.
          <Link
            key={item.label}
            href={item.href}
            prefetch={false}
            onMouseEnter={() => router.prefetch(item.href)}
            onFocus={() => router.prefetch(item.href)}
            onTouchStart={() => router.prefetch(item.href)}
            className={`nav-item${on ? " active" : ""}`}
            aria-current={on ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
          >
            <Icon size={17} strokeWidth={on ? 2.2 : 1.8} aria-hidden="true" />
            <span>{item.label}</span>
            {item.badge ? <span className="nav-badge" aria-label={`${item.badge} pendientes`}>{item.badge}</span> : null}
          </Link>
        );
      });

  return (
    <div className="shell">
      <aside className={`sidebar${menuOpen ? " open" : ""}`} aria-label="Menú">
        <div className="brand-row">
          <Link href="/" className="brand-link" aria-label="LogisticApp, ir al resumen" onClick={() => setMenuOpen(false)}><Logo /></Link>
          <button className="icon-button sidebar-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace">
          <span className="workspace-avatar" aria-hidden="true">{identity?.org[0]?.toUpperCase() ?? "·"}</span>
          <span className="workspace-copy">
            <strong>{identity?.org ?? "…"}</strong>
            <small>{identity ? `${identity.locations.length} ${identity.locations.length === 1 ? "local" : "locales"}` : ""}</small>
          </span>
        </div>
        <p className="nav-heading">Operativa</p>
        <nav className="main-nav" aria-label="Operativa">{nav(operativa)}</nav>
        <p className="nav-heading">Gestión</p>
        <nav className="main-nav" aria-label="Gestión">{nav(gestion)}</nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => { setMenuOpen(false); askAssistant("¿Qué puedes hacer?"); }}><CircleHelp size={17} strokeWidth={1.8} /><span>Ayuda</span></button>
          <div className="user-card">
            <Link className="user-link" href="/cuenta" title="Tu cuenta" onClick={() => setMenuOpen(false)}>
              <span className="user-avatar" aria-hidden="true">{identity?.initials ?? "·"}</span>
              <span className="workspace-copy"><strong>{identity?.name ?? "…"}</strong><small>{identity?.role}</small></span>
            </Link>
            <button className="icon-button" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => void signOut()}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      {menuOpen && <button className="mobile-backdrop" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú" />}

      <div className="shell-main">
        <header className="shell-topbar">
          <button className="icon-button mobile-menu" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <nav className="breadcrumb" aria-label="Estás en">
            <span>{identity?.org ?? ""}</span>
            {section && <><span aria-hidden="true">/</span><strong>{section}</strong></>}
          </nav>
          <span className="topbar-section">{section}</span>
          <div className="top-actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Buscar producto">
              <Search size={16} aria-hidden="true" /><span>Buscar producto</span><kbd>/</kbd>
            </button>
          </div>
        </header>
        <div className="shell-content">{children}</div>
      </div>

      {searchOpen && (
        <div className="search-overlay" onClick={() => setSearchOpen(false)}>
          <form className="search-dialog" role="search" onClick={(event) => event.stopPropagation()} onSubmit={search}>
            <Search size={18} aria-hidden="true" />
            <input name="q" autoFocus placeholder="Nombre, categoría, código o código de barras" aria-label="Buscar producto" />
            <kbd>Esc</kbd>
          </form>
        </div>
      )}
    </div>
  );
}
