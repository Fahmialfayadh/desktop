import { DIAG_ENDPOINTS, resolveApiProbeBase } from "./diagnostics";
import type { ConnectionProbe } from "./classify";

const API_PROBE_TIMEOUT_MS = 8000;

async function probeApi(): Promise<ConnectionProbe["api"]> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false };
  }

  const isElectron =
    typeof window !== "undefined" && Boolean(window.linerElectron);
  const streamGatewayEnv = (
    import.meta.env.VITE_STREAM_GATEWAY_URL as string | undefined
  )?.trim();
  const apiBase = resolveApiProbeBase();

  // If in Electron without VITE_STREAM_GATEWAY_URL, ONLY probe ${apiBase}/health
  // and return { ok: false } if failed (without fallbacks)
  if (isElectron && !streamGatewayEnv) {
    try {
      const res = await fetch(`${apiBase}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(API_PROBE_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, status: res.status };
    } catch {}
    return { ok: false };
  }

  // Web mode (or Electron with VITE_STREAM_GATEWAY_URL):
  // 1. Probe Stream Gateway
  try {
    const res = await fetch(`${apiBase}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(API_PROBE_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true, status: res.status };
  } catch {}

  // 2. Fallback to Supabase /auth/v1/health if configured
  const supabaseUrl = (
    import.meta.env.VITE_SUPABASE_URL as string | undefined
  )?.trim();
  const supabaseKey = (
    import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  )?.trim();
  if (
    supabaseUrl &&
    supabaseKey &&
    !supabaseUrl.includes("your-project-ref") &&
    !supabaseKey.includes("your-anon-key")
  ) {
    try {
      const res = await fetch(
        `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/health`,
        {
          cache: "no-store",
          headers: { apikey: supabaseKey },
          signal: AbortSignal.timeout(API_PROBE_TIMEOUT_MS),
        },
      );
      if (res.ok) return { ok: true, status: res.status };
    } catch {}
  }

  return { ok: false };
}

export async function probeConnection(): Promise<ConnectionProbe> {
  const deviceOnline =
    typeof navigator === "undefined" ? true : navigator.onLine;
  const bridge =
    typeof window !== "undefined" ? window.linerElectron?.probeNetwork : null;
  const [api, net] = await Promise.all([
    probeApi(),
    bridge ? bridge().catch(() => null) : Promise.resolve(null),
  ]);
  return {
    deviceOnline,
    api,
    internet: net ? net.internet : null,
    youtube: net ? net.youtube : null,
    youtubeFailure: net?.youtubeFailure ?? null,
    country: net?.country ?? null,
  };
}
