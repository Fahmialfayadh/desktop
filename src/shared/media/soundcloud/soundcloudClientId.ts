import { tryFetchText } from "@/shared/api/tryFetch";

const SOUNDCLOUD_HOME = "https://soundcloud.com";
const SCRIPT_URL =
  /src="((?:https:)?\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
const CLIENT_ID_PATTERN = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/;

const FALLBACK_CLIENT_ID = "39AVoiZVrdvJEMFLH8T0c5WGshQaAPRJ";

let cachedSoundCloudClientId: string | undefined = FALLBACK_CLIENT_ID;

export function rememberSoundCloudClientId(clientId: string): void {
  cachedSoundCloudClientId = clientId;
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem("sc_client_id", clientId);
  } catch {}
}

export function resetSoundCloudClientIdCache(): void {
  cachedSoundCloudClientId = undefined;
  try {
    if (typeof localStorage !== "undefined")
      localStorage.removeItem("sc_client_id");
  } catch {}
}

function scriptUrlsFromHtml(html: string): string[] {
  return [...html.matchAll(SCRIPT_URL)].map((match) =>
    match[1].startsWith("//") ? `https:${match[1]}` : match[1],
  );
}

async function discoverSoundCloudClientId(
  signal?: AbortSignal,
): Promise<string | undefined> {
  const html = await tryFetchText(SOUNDCLOUD_HOME, {
    headers: { accept: "text/html,application/xhtml+xml" },
    signal,
  });
  for (const scriptUrl of html ? scriptUrlsFromHtml(html).reverse() : []) {
    const found = (await tryFetchText(scriptUrl, { signal }))?.match(
      CLIENT_ID_PATTERN,
    )?.[1];
    if (found) {
      cachedSoundCloudClientId = found;
      return found;
    }
  }
  return undefined;
}

export async function getSoundCloudClientId(
  configuredClientId?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (configuredClientId?.trim()) return configuredClientId.trim();
  if (cachedSoundCloudClientId) return cachedSoundCloudClientId;
  try {
    const stored =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("sc_client_id")
        : null;
    if (stored) {
      cachedSoundCloudClientId = stored;
      return stored;
    }
  } catch {}
  const discovered = await discoverSoundCloudClientId(signal);
  if (discovered) {
    try {
      if (typeof localStorage !== "undefined")
        localStorage.setItem("sc_client_id", discovered);
    } catch {}
    return discovered;
  }
  return FALLBACK_CLIENT_ID;
}

export async function refreshSoundCloudClientId(
  rejectedClientId: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (cachedSoundCloudClientId === rejectedClientId) {
    cachedSoundCloudClientId = undefined;
    try {
      if (typeof localStorage !== "undefined")
        localStorage.removeItem("sc_client_id");
    } catch {}
  }
  const discovered = await discoverSoundCloudClientId(signal);
  if (discovered && discovered !== rejectedClientId) {
    rememberSoundCloudClientId(discovered);
    return discovered;
  }
  return undefined;
}
