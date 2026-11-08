import type {
  LocalImportResult,
  LocalTrackRecord,
} from "@/shared/media/local";
import type {
  SavedLyricsState,
  SavedTrackInput,
  SavedTrackRecord,
} from "@/shared/media/saved";

const DB_NAME = "liner_web_files_v1";
const DB_VERSION = 1;
const STORE_LOCAL = "local_tracks";
const STORE_SAVED = "saved_tracks";

interface StoredLocalTrack extends LocalTrackRecord {
  audioBlob: Blob;
  coverBlob?: Blob;
}

interface StoredSavedTrack extends SavedTrackRecord {
  audioBlob: Blob;
  coverBlob?: Blob;
  lyricsData?: unknown;
}

class WebLocalTracksManager {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private localAudioUrls = new Map<string, string>();
  private localCoverUrls = new Map<string, string>();
  private savedAudioUrls = new Map<string, string>();
  private savedCoverUrls = new Map<string, string>();
  private initialized = false;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this environment"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_LOCAL)) {
          db.createObjectStore(STORE_LOCAL, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_SAVED)) {
          db.createObjectStore(STORE_SAVED, { keyPath: "trackId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  async init(): Promise<void> {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    try {
      const [locals, saveds] = await Promise.all([
        this.listStoredLocalTracks(),
        this.listStoredSavedTracks(),
      ]);

      for (const loc of locals) {
        if (loc.audioBlob && !this.localAudioUrls.has(loc.id)) {
          this.localAudioUrls.set(loc.id, URL.createObjectURL(loc.audioBlob));
        }
        if (loc.coverBlob && !this.localCoverUrls.has(loc.id)) {
          this.localCoverUrls.set(loc.id, URL.createObjectURL(loc.coverBlob));
        }
      }

      for (const sav of saveds) {
        if (sav.audioBlob && !this.savedAudioUrls.has(sav.trackId)) {
          this.savedAudioUrls.set(sav.trackId, URL.createObjectURL(sav.audioBlob));
        }
        if (sav.coverBlob && !this.savedCoverUrls.has(sav.trackId)) {
          this.savedCoverUrls.set(sav.trackId, URL.createObjectURL(sav.coverBlob));
        }
      }
    } catch {}
  }

  getLocalAudioUrl(fileId: string): string | undefined {
    return this.localAudioUrls.get(fileId);
  }

  getLocalCoverUrl(fileId: string): string | undefined {
    return this.localCoverUrls.get(fileId);
  }

  getSavedAudioUrl(trackId: string): string | undefined {
    return this.savedAudioUrls.get(trackId);
  }

  getSavedCoverUrl(trackId: string): string | undefined {
    return this.savedCoverUrls.get(trackId);
  }

  private async listStoredLocalTracks(): Promise<StoredLocalTrack[]> {
    const db = await this.openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_LOCAL, "readonly");
      const store = tx.objectStore(STORE_LOCAL);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  private async listStoredSavedTracks(): Promise<StoredSavedTrack[]> {
    const db = await this.openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SAVED, "readonly");
      const store = tx.objectStore(STORE_SAVED);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async listLocalTracks(): Promise<LocalTrackRecord[]> {
    await this.init();
    const stored = await this.listStoredLocalTracks();
    return stored.map(({ audioBlob: _a, coverBlob: _c, ...record }) => record);
  }

  async listSavedTracks(): Promise<SavedTrackRecord[]> {
    await this.init();
    const stored = await this.listStoredSavedTracks();
    return stored.map(({ audioBlob: _a, coverBlob: _c, lyricsData: _l, ...record }) => record);
  }

  async importFiles(files: File[]): Promise<LocalImportResult> {
    await this.init();
    const existing = await this.listStoredLocalTracks();
    const existingSet = new Set(existing.map((r) => `${r.fileName}:${r.byteSize}`));

    const db = await this.openDb();
    const added: LocalTrackRecord[] = [];
    let duplicates = 0;
    const failed: string[] = [];

    for (const file of files) {
      const key = `${file.name}:${file.size}`;
      if (existingSet.has(key)) {
        duplicates += 1;
        continue;
      }

      try {
        const durationMs = await this.probeDuration(file);
        const { artist, title } = this.parseTitleArtist(file.name);
        const id = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `web_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        const record: LocalTrackRecord = {
          id,
          title,
          artist,
          durationMs,
          fileName: file.name,
          audioFile: file.name,
          mimeType: file.type || "audio/mpeg",
          byteSize: file.size,
          addedAt: Date.now(),
        };

        const stored: StoredLocalTrack = {
          ...record,
          audioBlob: file,
        };

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_LOCAL, "readwrite");
          const store = tx.objectStore(STORE_LOCAL);
          const req = store.put(stored);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });

        this.localAudioUrls.set(id, URL.createObjectURL(file));
        added.push(record);
        existingSet.add(key);
      } catch (err) {
        failed.push(file.name);
      }
    }

    return { added, duplicates, failed };
  }

  async removeLocalTracks(fileIds: string[]): Promise<void> {
    const db = await this.openDb();
    const idSet = new Set(fileIds);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_LOCAL, "readwrite");
      const store = tx.objectStore(STORE_LOCAL);
      for (const id of fileIds) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    for (const id of idSet) {
      const audioUrl = this.localAudioUrls.get(id);
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        this.localAudioUrls.delete(id);
      }
      const coverUrl = this.localCoverUrls.get(id);
      if (coverUrl) {
        URL.revokeObjectURL(coverUrl);
        this.localCoverUrls.delete(id);
      }
    }
  }

  async removeAllLocalTracks(): Promise<number> {
    const db = await this.openDb();
    const count = this.localAudioUrls.size;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_LOCAL, "readwrite");
      const store = tx.objectStore(STORE_LOCAL);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });

    for (const url of this.localAudioUrls.values()) {
      URL.revokeObjectURL(url);
    }
    for (const url of this.localCoverUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.localAudioUrls.clear();
    this.localCoverUrls.clear();

    return count;
  }

  async saveTrack(input: SavedTrackInput): Promise<SavedTrackRecord> {
    await this.init();
    const db = await this.openDb();
    const key = input.meta.trackId;
    const audioBlob = new Blob([input.audio as unknown as BlobPart], {
      type: input.mimeType,
    });
    const coverBlob = input.cover
      ? new Blob([input.cover.data as unknown as BlobPart], {
          type: input.cover.mimeType,
        })
      : undefined;

    const record: SavedTrackRecord = {
      ...input.meta,
      key,
      audioFile: `${key}.audio`,
      mimeType: input.mimeType,
      coverFile: input.cover ? `${key}.cover` : undefined,
      byteSize: input.audio.byteLength,
      savedAt: Date.now(),
      lyrics: input.lyricsState,
    };

    const stored: StoredSavedTrack = {
      ...record,
      audioBlob,
      coverBlob,
      lyricsData: input.lyrics,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SAVED, "readwrite");
      const store = tx.objectStore(STORE_SAVED);
      const req = store.put(stored);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    if (this.savedAudioUrls.has(key)) {
      URL.revokeObjectURL(this.savedAudioUrls.get(key)!);
    }
    this.savedAudioUrls.set(key, URL.createObjectURL(audioBlob));

    if (coverBlob) {
      if (this.savedCoverUrls.has(key)) {
        URL.revokeObjectURL(this.savedCoverUrls.get(key)!);
      }
      this.savedCoverUrls.set(key, URL.createObjectURL(coverBlob));
    }

    return record;
  }

  async setSavedLyrics(
    trackId: string,
    state: SavedLyricsState,
    lyricsData?: unknown,
  ): Promise<boolean> {
    const db = await this.openDb();
    const stored = await new Promise<StoredSavedTrack | null>((resolve) => {
      const tx = db.transaction(STORE_SAVED, "readonly");
      const store = tx.objectStore(STORE_SAVED);
      const req = store.get(trackId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });

    if (!stored) return false;

    stored.lyrics = state;
    stored.lyricsData = lyricsData;

    return new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_SAVED, "readwrite");
      const store = tx.objectStore(STORE_SAVED);
      const req = store.put(stored);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  async getSavedLyrics(trackId: string): Promise<unknown | null> {
    const db = await this.openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SAVED, "readonly");
      const store = tx.objectStore(STORE_SAVED);
      const req = store.get(trackId);
      req.onsuccess = () => {
        const item = req.result as StoredSavedTrack | undefined;
        resolve(item?.lyricsData ?? null);
      };
      req.onerror = () => resolve(null);
    });
  }

  async removeSavedTracks(trackIds: string[]): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_SAVED, "readwrite");
      const store = tx.objectStore(STORE_SAVED);
      for (const id of trackIds) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    for (const id of trackIds) {
      const a = this.savedAudioUrls.get(id);
      if (a) {
        URL.revokeObjectURL(a);
        this.savedAudioUrls.delete(id);
      }
      const c = this.savedCoverUrls.get(id);
      if (c) {
        URL.revokeObjectURL(c);
        this.savedCoverUrls.delete(id);
      }
    }
  }

  async getLocalUsage(): Promise<{ count: number; bytes: number }> {
    const list = await this.listStoredLocalTracks();
    const bytes = list.reduce((sum, item) => sum + (item.byteSize || 0), 0);
    return { count: list.length, bytes };
  }

  async getSavedUsage(): Promise<{
    count: number;
    bytes: number;
    freeBytes: number | null;
  }> {
    const list = await this.listStoredSavedTracks();
    const bytes = list.reduce((sum, item) => sum + (item.byteSize || 0), 0);
    let freeBytes: number | null = null;
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota !== undefined && estimate.usage !== undefined) {
          freeBytes = Math.max(0, estimate.quota - estimate.usage);
        }
      } catch {}
    }
    return { count: list.length, bytes, freeBytes };
  }

  private probeDuration(blob: Blob): Promise<number> {
    return new Promise((resolve) => {
      if (typeof Audio === "undefined") {
        resolve(0);
        return;
      }
      const audio = new Audio();
      const url = URL.createObjectURL(blob);
      audio.preload = "metadata";
      const cleanup = () => {
        URL.revokeObjectURL(url);
        audio.src = "";
      };
      audio.onloadedmetadata = () => {
        const d = audio.duration;
        cleanup();
        resolve(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : 0);
      };
      audio.onerror = () => {
        cleanup();
        resolve(0);
      };
      setTimeout(() => {
        cleanup();
        resolve(0);
      }, 5000);
      audio.src = url;
    });
  }

  private parseTitleArtist(fileName: string): { title: string; artist: string } {
    const base = fileName.replace(/\.[^/.]+$/, "");
    const parts = base.split(" - ");
    if (parts.length >= 2) {
      return {
        artist: parts[0].trim(),
        title: parts.slice(1).join(" - ").trim(),
      };
    }
    return {
      artist: "Unknown Artist",
      title: base.trim(),
    };
  }
}

export const webLocalTracks = new WebLocalTracksManager();

export async function pickAudioFilesFromBrowser(): Promise<File[]> {
  if (typeof document === "undefined") return [];
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus,.webm";
    input.multiple = true;
    input.style.display = "none";

    let resolved = false;
    const cleanup = () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    input.onchange = () => {
      if (resolved) return;
      resolved = true;
      const files = Array.from(input.files || []);
      cleanup();
      resolve(files);
    };

    input.oncancel = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve([]);
    };

    document.body.appendChild(input);
    input.click();
  });
}
