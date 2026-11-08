import { webLocalTracks } from "@/shared/storage/webLocalTracks";

const LOCAL_TRACK_PREFIX = "local:";

export function isLocalTrackId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(LOCAL_TRACK_PREFIX);
}

export function toLocalTrackId(fileId: string): string {
  return `${LOCAL_TRACK_PREFIX}${fileId}`;
}

export function localFileId(trackId: string): string {
  return trackId.slice(LOCAL_TRACK_PREFIX.length);
}

export function localTrackAudioUrl(trackId: string): string {
  if (typeof window !== "undefined" && !window.linerElectron) {
    const webUrl = webLocalTracks.getLocalAudioUrl(localFileId(trackId));
    if (webUrl) return webUrl;
  }
  return `liner-local://audio/${localFileId(trackId)}`;
}

export function localTrackCoverUrl(fileId: string): string {
  if (typeof window !== "undefined" && !window.linerElectron) {
    const webUrl = webLocalTracks.getLocalCoverUrl(fileId);
    if (webUrl) return webUrl;
  }
  return `liner-local://cover/${fileId}`;
}
