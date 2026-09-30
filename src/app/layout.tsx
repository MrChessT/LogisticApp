import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { Copiloto } from "@/components/copiloto/copiloto";
import "./globals.css";

// Fuentes servidas desde la propia app (sin peticiones a Google en cada visita ni saltos de texto).
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Nexo | Inventario inteligente", template: "%s | Nexo" },
  description: "Control de stock multilocal para hostelería",
  applicationName: "Nexo",
  // App privada: nada que indexar.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#2e8064",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${sans.variable} ${display.variable}`}>
      <body>
        {children}
        <Copiloto />
      </body>
    </html>
  );
}
