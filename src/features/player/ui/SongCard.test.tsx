import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

// @ts-expect-error - act support flag in vitest browserless DOM environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("lottie-web", () => ({ default: { loadAnimation: vi.fn() } }));
vi.mock("lottie-web/build/player/lottie_light", () => ({
  default: { loadAnimation: vi.fn() },
}));

vi.mock("@/languages", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("@/features/artist", () => ({
  ArtistLink: () => <span>Artist</span>,
}));

vi.mock("@/features/covers/ui/CoverImage", () => ({
  default: (props: any) => (
    <img data-testid="cover-image" src={props.src} alt={props.alt} />
  ),
}));

import SongCard from "./SongCard";

describe("SongCard", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container) {
      document.body.removeChild(container);
    }
    container = null;
    root = null;
  });

  it("renders cover image by default", async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SongCard
            title="Track 1"
            artists="Artist 1"
            coverUrl="https://example.com/cover.jpg"
          />
        </MemoryRouter>,
      );
    });

    const img = container?.querySelector('[data-testid="cover-image"]');
    expect(img).not.toBeNull();
  });

  it("does not render cover image when hideCover is true", async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SongCard
            title="Track 1"
            artists="Artist 1"
            coverUrl="https://example.com/cover.jpg"
            hideCover={true}
          />
        </MemoryRouter>,
      );
    });

    const img = container?.querySelector('[data-testid="cover-image"]');
    expect(img).toBeNull();
  });
});
