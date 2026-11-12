import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { CopilotoLoader } from "@/components/copiloto/copiloto-loader";
import { ErrorReporter } from "@/components/error-reporter";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";
import "./page-chrome.css";
import "./theme.css";

// Fuentes servidas desde la propia app (sin peticiones a Google en cada visita ni saltos de texto).
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "LogisticApp | Inventario inteligente", template: "%s | LogisticApp" },
  description: "Control de stock multilocal para hostelería",
  applicationName: "LogisticApp",
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
        <AppShell>{children}</AppShell>
        <CopilotoLoader />
        <ErrorReporter />
      </body>
    </html>
  );
}
