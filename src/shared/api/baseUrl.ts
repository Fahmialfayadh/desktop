export const DEFAULT_PRIMARY_API = "https://api.tryliner.fun";
export const DEFAULT_GATEWAY_URL = "https://liner-gateway.fahmialfayadh.site";
export const DEFAULT_SUPABASE_URL = "https://nkzpwrzkhstgvoimjbyl.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5renB3cnpraHN0Z3ZvaW1qYnlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMjU3MzMsImV4cCI6MjEwOTcwMTczM30.o20cmPqQu1vF9pVSAYBkwTXn1PDZKQtmrYx2KIKZykM";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isSecureBaseUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    // In HTTPS web environment (e.g. Vercel), only HTTPS is allowed to prevent Mixed Content blocks
    if (typeof window !== "undefined" && window.location?.protocol === "https:") {
      return protocol === "https:";
    }
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
  return clean || DEFAULT_GATEWAY_URL;
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
  return (env ? env.replace(/\/+$/, "") : "") || DEFAULT_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string {
  return (
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    DEFAULT_SUPABASE_ANON_KEY
  );
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
