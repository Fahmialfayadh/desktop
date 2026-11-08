import { describe, expect, it } from "vitest";
import { shouldProxyRequest, buildProxiedUrl } from "./webCorsProxy";
import { getStreamGatewayUrl } from "./baseUrl";

describe("webCorsProxy", () => {
  it("identifies external catalog/media domains for proxying", () => {
    expect(shouldProxyRequest("https://music.youtube.com/youtubei/v1/search")).toBe(true);
    expect(shouldProxyRequest("https://www.youtube.com/watch?v=123")).toBe(true);
    expect(shouldProxyRequest("https://i.ytimg.com/vi/123/hqdefault.jpg")).toBe(true);
    expect(shouldProxyRequest("https://lh3.googleusercontent.com/avatar")).toBe(true);
    expect(shouldProxyRequest("https://yt3.ggpht.com/avatar")).toBe(true);
    expect(shouldProxyRequest("https://i.scdn.co/image/ab67616d0000b273")).toBe(true);
    expect(shouldProxyRequest("https://api-v2.soundcloud.com/tracks")).toBe(true);
    expect(shouldProxyRequest("https://cf-media.sndcdn.com/audio.mp3")).toBe(true);
    expect(shouldProxyRequest("https://api.deezer.com/track/123")).toBe(true);
    expect(shouldProxyRequest("https://amp-api.music.apple.com/v1/catalog")).toBe(true);
  });

  it("does not proxy internal, loopback, lrclib, blob or data urls", () => {
    expect(shouldProxyRequest("http://localhost:8787/api/stream")).toBe(false);
    expect(shouldProxyRequest("http://127.0.0.1:3000")).toBe(false);
    expect(shouldProxyRequest("https://lrclib.net/api/get")).toBe(false);
    expect(shouldProxyRequest("blob:http://localhost:3000/123-456")).toBe(false);
    expect(shouldProxyRequest("data:image/png;base64,abc")).toBe(false);
  });

  it("builds the correct proxy url", () => {
    const target = "https://i.ytimg.com/vi/test/hqdefault.jpg";
    const expected = `${getStreamGatewayUrl()}/api/proxy?url=${encodeURIComponent(target)}`;
    expect(buildProxiedUrl(target)).toBe(expected);
  });
});
