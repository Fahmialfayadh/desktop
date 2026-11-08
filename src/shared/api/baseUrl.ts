export const DEFAULT_PRIMARY_API = "https://api.tryliner.fun";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isSecureBaseUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" ||
      (protocol === "http:" && LOOPBACK_HOSTS.has(hostname))
    );
  } catch {
    return false;
  }
}

export function resolveApiBaseUrl(envUrl: string | undefined): string {
  const clean = envUrl?.trim().replace(/\/+$/, "");
  return clean && isSecureBaseUrl(clean) ? clean : DEFAULT_PRIMARY_API;
}

const baseUrl = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL as string | undefined,
);

export function getApiBaseUrl(): string {
  return baseUrl;
}

export function getStreamGatewayUrl(): string {
  const env = (import.meta.env.VITE_STREAM_GATEWAY_URL as string | undefined)?.trim();
  const clean = env ? env.replace(/\/+$/, "") : "";
  return clean || "http://localhost:8787";
}

export function buildDirectMp3DownloadUrl(
  videoId: string,
  meta?: { title?: string; artist?: string },
): string {
  const base = `${getStreamGatewayUrl()}/api/download/${encodeURIComponent(videoId)}.mp3`;
  const params = new URLSearchParams();
  if (meta?.title?.trim()) params.set("title", meta.title.trim());
  if (meta?.artist?.trim()) params.set("artist", meta.artist.trim());
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function getSupabaseUrl(): string {
  const env = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  return env ? env.replace(/\/+$/, "") : "";
}

export function getSupabaseAnonKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "";
}

export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) return false;
  if (
    url.includes("your-project-ref") ||
    url.includes("placeholder") ||
    key.includes("your-anon-key") ||
    key.includes("placeholder")
  ) {
    return false;
  }
  return true;
}

