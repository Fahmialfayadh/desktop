import { describe, it, expect, beforeEach } from "vitest";
import {
  useDisplaySettingsStore,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  ZOOM_STEP,
  applyZoom,
} from "./displaySettingsStore";

describe("displaySettingsStore", () => {
  beforeEach(() => {
    const store = useDisplaySettingsStore.getState();
    store.setCompactMode(false);
    store.resetZoom();
  });

  it("initializes with default values", () => {
    const state = useDisplaySettingsStore.getState();
    expect(state.compactMode).toBe(false);
    expect(state.zoom).toBe(DEFAULT_ZOOM);
  });

  it("updates compactMode", () => {
    const store = useDisplaySettingsStore.getState();
    store.setCompactMode(true);
    expect(useDisplaySettingsStore.getState().compactMode).toBe(true);

    store.setCompactMode(false);
    expect(useDisplaySettingsStore.getState().compactMode).toBe(false);
  });

  it("adjusts zoom via zoomIn and zoomOut", () => {
    const store = useDisplaySettingsStore.getState();
    expect(store.zoom).toBe(100);

    store.zoomIn();
    expect(useDisplaySettingsStore.getState().zoom).toBe(100 + ZOOM_STEP);

    store.zoomOut();
    expect(useDisplaySettingsStore.getState().zoom).toBe(100);

    store.zoomOut();
    expect(useDisplaySettingsStore.getState().zoom).toBe(100 - ZOOM_STEP);

    store.resetZoom();
    expect(useDisplaySettingsStore.getState().zoom).toBe(100);
  });

  it("clamps zoom within [MIN_ZOOM, MAX_ZOOM]", () => {
    const store = useDisplaySettingsStore.getState();

    store.setZoom(200);
    expect(useDisplaySettingsStore.getState().zoom).toBe(MAX_ZOOM);

    store.setZoom(20);
    expect(useDisplaySettingsStore.getState().zoom).toBe(MIN_ZOOM);
  });

  it("applies zoom to CSS variables and clears viewport zoom", () => {
    applyZoom(90);
    expect(document.documentElement.style.zoom).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--font-scale"),
    ).toBe("0.9");

    applyZoom(100);
    expect(document.documentElement.style.zoom).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--font-scale"),
    ).toBe("");
  });
});
