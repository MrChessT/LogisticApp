import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, reportError } from "./report-error";

const env = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stub(isNew: boolean) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown>, auth: new Headers(init.headers).get("Authorization") });
    return new Response(JSON.stringify(isNew), { status: 200 });
  });
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return calls;
}

describe("registro de errores", () => {
  it("guarda el error con su ruta y, si es nuevo hoy, avisa por el webhook", async () => {
    const calls = stub(true);
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://hooks.example.com/x");
    await reportError("server", new TypeError("no va"), { path: "/stock?x=1", token: "jwt" });
    expect(calls[0]!.url).toBe("https://x.supabase.co/rest/v1/rpc/report_app_error");
    expect(calls[0]!.body).toMatchObject({ p_source: "server", p_message: "TypeError: no va", p_path: "/stock?x=1" });
    expect(calls[0]!.auth).toBe("Bearer jwt");
    expect(calls[1]!.url).toBe("https://hooks.example.com/x");
    expect(String(calls[1]!.body.text)).toContain("error nuevo (servidor) en /stock: TypeError: no va");
  });

  it("si ya se había visto hoy, o no hay webhook, no avisa", async () => {
    const repeated = stub(false);
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://hooks.example.com/x");
    await reportError("client", "falla", { token: "jwt" });
    expect(repeated).toHaveLength(1);
    const noHook = stub(true);
    vi.stubEnv("ERROR_WEBHOOK_URL", "");
    await reportError("client", "falla", { token: "jwt" });
    expect(noHook).toHaveLength(1);
  });

  it("sin sesión lo registra el servidor con su clave; sin ella, no se intenta (la base no deja sin sesión)", async () => {
    const calls = stub(true);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    await reportError("server", new Error("al pintar"));
    expect(calls[0]!.auth).toBe("Bearer service");
    const none = stub(true);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await reportError("server", new Error("al pintar"));
    expect(none).toHaveLength(0);
  });

  it("nunca lanza, aunque falle el registro", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.stubGlobal("fetch", async () => {
      throw new Error("sin red");
    });
    await expect(reportError("assistant", new Error("x"))).resolves.toBeUndefined();
    expect(errorMessage({})).toBe("Error desconocido");
  });
});
