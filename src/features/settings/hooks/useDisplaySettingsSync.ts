import { useEffect } from "react";
import {
  applyZoom,
  useDisplaySettingsStore,
} from "../store/displaySettingsStore";

export function useDisplaySettingsSync() {
  const zoom = useDisplaySettingsStore((s) => s.zoom);

  useEffect(() => {
    applyZoom(zoom);
  }, [zoom]);
}
