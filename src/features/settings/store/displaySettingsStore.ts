import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { debouncedStorage } from "@/shared/utils/storage";

export const MIN_ZOOM = 70;
export const MAX_ZOOM = 130;
export const DEFAULT_ZOOM = 100;
export const ZOOM_STEP = 10;

export interface DisplaySettingsState {
  compactMode: boolean;
  zoom: number;
  setCompactMode: (enabled: boolean) => void;
  setZoom: (zoom: number) => void;
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export function applyZoom(_zoom: number) {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style as CSSStyleDeclaration & {
    zoom?: string;
  };
  style.zoom = "";
  document.documentElement.style.removeProperty("--font-scale");
  document.documentElement.style.removeProperty("--content-scale");
  document.documentElement.style.removeProperty("--card-width");
}

function getInitialZoom(): number {
  if (typeof window === "undefined") return DEFAULT_ZOOM;
  try {
    const raw = localStorage.getItem("liner_display_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.state?.zoom === "number") {
        return parsed.state.zoom;
      }
    }
  } catch {}
  return DEFAULT_ZOOM;
}

if (typeof document !== "undefined") {
  const initZoom = getInitialZoom();
  applyZoom(initZoom);
}

export const useDisplaySettingsStore = create<DisplaySettingsState>()(
  persist(
    (set, get) => ({
      compactMode: false,
      zoom: DEFAULT_ZOOM,
      setCompactMode: (compactMode) => set({ compactMode }),
      setZoom: (zoom) => {
        const clamped = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, Math.round(zoom)),
        );
        applyZoom(clamped);
        set({ zoom: clamped });
      },
      resetZoom: () => {
        applyZoom(DEFAULT_ZOOM);
        set({ zoom: DEFAULT_ZOOM });
      },
      zoomIn: () => {
        const next = Math.min(MAX_ZOOM, get().zoom + ZOOM_STEP);
        applyZoom(next);
        set({ zoom: next });
      },
      zoomOut: () => {
        const next = Math.max(MIN_ZOOM, get().zoom - ZOOM_STEP);
        applyZoom(next);
        set({ zoom: next });
      },
    }),
    {
      name: "liner_display_settings",
      storage: createJSONStorage(() => debouncedStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.zoom) {
          applyZoom(state.zoom);
        }
      },
    },
  ),
);
