import dns from "node:dns";
import { JSDOM } from "jsdom";
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { buildURL, getHeaders, USER_AGENT } from "bgutils-js/utils";

// The gateway HTTP client is IPv4-only; make the minter use the same family so
// the PO token and the player request are issued to the same egress address.
dns.setDefaultResultOrder("ipv4first");

const CHALLENGE_URL =
  "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false";
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const CLIENT_VERSION = "2.20250925.01.00";
const REQUEST_TIMEOUT_MS = 25_000;
const TOKEN_CACHE_MS = 6 * 60 * 60 * 1000;
const INTERPRETER_CACHE_MS = 60 * 60 * 1000;

const tokenCache = new Map();
let interpreterCache = null;
let mintChain = Promise.resolve();
let domReady = false;

function ensureDom() {
  if (domReady) return;
  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
    {
      url: "https://www.youtube.com/",
      referrer: "https://www.youtube.com/",
      userAgent: USER_AGENT,
    },
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
  });
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: dom.window.navigator,
      configurable: true,
    });
  } catch {
    // Node exposes a read-only navigator on some versions; the VM still works.
  }
  domReady = true;
}

function enqueue(run) {
  const next = mintChain.then(run, run);
  mintChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function decodeVisitorData(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function fetchChallenge() {
  const response = await fetch(CHALLENGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.youtube.com",
      referer: "https://www.youtube.com/",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: CLIENT_VERSION,
          hl: "en",
          gl: "US",
        },
      },
      engagementType: "ENGAGEMENT_TYPE_UNBOUND",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`att/get failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  const raw = body.bgChallenge;
  if (!raw) throw new Error("att/get returned no BotGuard challenge");
  return {
    raw,
    visitorData: decodeVisitorData(body.responseContext?.visitorData),
  };
}

async function getInterpreterScript(raw) {
  const inline =
    raw.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (typeof inline === "string" && inline) return inline;

  const wrappedUrl =
    raw.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (typeof wrappedUrl !== "string" || !wrappedUrl) {
    throw new Error("BotGuard challenge has no interpreter script");
  }
  const url = wrappedUrl.startsWith("//") ? `https:${wrappedUrl}` : wrappedUrl;
  if (
    interpreterCache &&
    interpreterCache.url === url &&
    interpreterCache.expiresAt > Date.now()
  ) {
    return interpreterCache.script;
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`BotGuard interpreter failed with HTTP ${response.status}`);
  }
  const script = await response.text();
  interpreterCache = {
    url,
    script,
    expiresAt: Date.now() + INTERPRETER_CACHE_MS,
  };
  return script;
}

async function generateIntegrityToken(botguardResponse) {
  const headers = {
    ...getHeaders(),
    origin: "https://www.youtube.com",
    referer: "https://www.youtube.com/",
  };
  const response = await fetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers,
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GenerateIT failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  const integrityToken = typeof data[0] === "string" ? data[0] : "";
  if (!integrityToken) throw new Error("GenerateIT returned no token");
  return {
    integrityToken,
    ttlSecs: Number(data[1]) || 43_200,
  };
}

async function mint(videoId) {
  ensureDom();
  const { raw, visitorData } = await fetchChallenge();
  const script = await getInterpreterScript(raw);
  new Function(script)();

  const botguard = await BotGuardClient.create({
    program: raw.program,
    globalName: raw.globalName,
    globalObject: globalThis,
  });
  const webPoSignalOutput = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
  const { integrityToken, ttlSecs } =
    await generateIntegrityToken(botguardResponse);
  const minter = await WebPoMinter.create(
    { integrityToken: integrityToken.replace(/\+/g, "-").replace(/\//g, "_") },
    webPoSignalOutput,
  );
  const poToken = await minter.mintAsWebsafeString(videoId);
  const result = { poToken, visitorData, ttlSecs };
  tokenCache.set(videoId, {
    result,
    expiresAt: Date.now() + Math.min(ttlSecs * 1000, TOKEN_CACHE_MS),
  });
  return result;
}

export async function mintPoToken(videoId) {
  const cached = tokenCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  return enqueue(() => mint(videoId));
}

export function clearPoTokenCache() {
  tokenCache.clear();
  interpreterCache = null;
}
