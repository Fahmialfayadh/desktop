import { getStreamGatewayUrl, getSupabaseUrl } from "./baseUrl";

const PROXIED_ROOT_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "ggpht.com",
  "googleusercontent.com",
  "googleapis.com",
  "google.com",
  "gstatic.com",
  "soundcloud.com",
  "sndcdn.com",
  "spotify.com",
  "spotify.link",
  "scdn.co",
  "spotifycdn.com",
  "deezer.com",
  "deezer.page.link",
  "dzcdn.net",
  "apple.com",
  "music.apple.com",
  "amp-api.music.apple.com",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isHostMatching(hostname: string, targetDomain: string): boolean {
  return hostname === targetDomain || hostname.endsWith(`.${targetDomain}`);
}

export function shouldProxyRequest(urlStr: string): boolean {
  if (!urlStr || urlStr.startsWith("blob:") || urlStr.startsWith("data:")) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr, typeof window !== "undefined" ? window.location?.href : "http://localhost");
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname)) {
    return false;
  }

  if (typeof window !== "undefined" && window.location?.hostname) {
    if (hostname === window.location.hostname.toLowerCase()) {
      return false;
    }
  }

  const supabaseUrl = getSupabaseUrl();
  if (supabaseUrl) {
    try {
      const spHost = new URL(supabaseUrl).hostname.toLowerCase();
      if (hostname === spHost) return false;
    } catch {}
  }

  if (isHostMatching(hostname, "lrclib.net")) {
    return false;
  }

  return PROXIED_ROOT_DOMAINS.some((domain) => isHostMatching(hostname, domain));
}

export function buildProxiedUrl(targetUrl: string): string {
  const gateway = getStreamGatewayUrl();
  return `${gateway}/api/proxy?url=${encodeURIComponent(targetUrl)}`;
}

let originalFetch: typeof globalThis.fetch | null = null;
let isProxyInstalled = false;

export function installWebCorsFetchProxy(): void {
  if (isProxyInstalled || typeof globalThis === "undefined" || !globalThis.fetch) {
    return;
  }

  // Only run when NOT in Electron
  if (typeof window !== "undefined" && (window as any).linerElectron) {
    return;
  }

  originalFetch = globalThis.fetch;

  const proxiedFetch: typeof globalThis.fetch = async (input, init) => {
    let targetUrl: string;
    if (typeof input === "string") {
      targetUrl = input;
    } else if (input instanceof URL) {
      targetUrl = input.toString();
    } else if (typeof Request !== "undefined" && input instanceof Request) {
      targetUrl = input.url;
    } else {
      targetUrl = String(input);
    }

    if (shouldProxyRequest(targetUrl)) {
      const newUrl = buildProxiedUrl(targetUrl);
      if (typeof Request !== "undefined" && input instanceof Request) {
        // If input is Request, preserve headers and body
        return originalFetch!(new Request(newUrl, input));
      }
      return originalFetch!(newUrl, init);
    }

    return originalFetch!(input, init);
  };

  globalThis.fetch = proxiedFetch;
  isProxyInstalled = true;
}

export function uninstallWebCorsFetchProxy(): void {
  if (!isProxyInstalled || !originalFetch) return;
  globalThis.fetch = originalFetch;
  originalFetch = null;
  isProxyInstalled = false;
}

// Auto-install on Web in browser environment when not running under test runner
if (
  typeof window !== "undefined" &&
  !(window as any).linerElectron &&
  import.meta.env?.MODE !== "test"
) {
  installWebCorsFetchProxy();
}
