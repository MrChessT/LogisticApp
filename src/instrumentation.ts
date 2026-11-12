// Errores del servidor (pantallas, rutas de la API, acciones): Next los entrega aquí y se registran con
// reportError (tabla app_errors + aviso). Ver docs/ARQUITECTURA.md, «Errores y alertas».
import type { Instrumentation } from "next";
import { reportError } from "@/lib/report-error";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest?: unknown }).digest) : null;
  await reportError("server", err, {
    path: request.path,
    digest,
    detail: { method: request.method, route: context.routePath, type: context.routeType },
  });
};
