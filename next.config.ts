import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
// Las vistas previas de Vercel inyectan su barra de comentarios (vercel.live); producción no.
const vercelLive = process.env.VERCEL_ENV === "preview" ? " https://vercel.live" : "";

// El navegador solo habla con la propia app y con Supabase (REST, Auth y, si algún día se usa, Realtime).
function supabaseOrigins(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return ` ${url.origin} ${url.origin.replace(/^http/, "ws")}`;
  } catch {
    return "";
  }
}

// Sin nonces: las páginas se generan estáticas y Next necesita sus scripts en línea para hidratar.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${vercelLive}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${supabaseOrigins()}${vercelLive}`,
  `frame-src 'self'${vercelLive}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // App privada con datos del negocio: fuera de los buscadores.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
