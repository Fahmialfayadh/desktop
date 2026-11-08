import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlayerStore } from "../store/playerStore";
import { usePlayerState } from "../hooks/usePlayerState";
import { useGlassBlur, useKawarpEnabled } from "../store/visualModeStore";
import { cn } from "@/shared/lib";
import { Notch } from "@/shared/ui";
import { FullscreenTopNotch } from "./FullscreenTopNotch";
import { LyricsNotchStatus } from "./LyricsNotchStatus";
import { FullscreenFrameGlass } from "./FullscreenFrameGlass";
import { useLyricsStore, LyricsProviderIsland } from "@/features/lyrics";
import { AnimatePresence, motion } from "framer-motion";
import { PlayerUiElements } from "./PlayerUiElements";
import {
  DownLine,
  More1Line,
  HeartFill,
  HeartLine,
} from "@mingcute/react";
import { Tuning2, PlaybackSpeed } from "@solar-icons/react";
import { CoverImage, preloadCoverArt, useCoverSrc } from "@/features/covers";
import KawarpWrapper from "./KawarpWrapper";
import AmbientLayer from "./AmbientLayer";
import { BetaVisualsWarning } from "./BetaVisualsWarning";
import { CanvasLyricsView } from "./CanvasLyricsView";
import { FullscreenTimeline } from "./FullscreenTimeline";
import { FullscreenTransportControls } from "./FullscreenTransportControls";
import { EqualizerPicker } from "./EqualizerPicker";
import { SpeedPitchPicker } from "./SpeedPitchPicker";
import { isEqActive } from "../engine/equalizer";
import { useSongMenuItems } from "../hooks/useSongMenuItems";
import {
  useIsTrackLiked,
  useLikeTrack,
  useUnlikeTrack,
} from "@/features/library/hooks";
import { isLocalTrackId } from "@/shared/media/local";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import RightDrawer from "@/features/navigation/ui/RightDrawer";
import { useTranslation } from "@/languages";
import { useSettledLyricsLayout } from "../hooks/useSettledLyricsLayout";

const KAWARP_FADE_IN_MS = 600;

type MobileFullscreenTab = "player" | "lyrics" | "queue";

export interface FullscreenPlayerProps {
  effectsReady?: boolean;
  onClose: () => void;
}

export function FullscreenPlayer({
  effectsReady = true,
  onClose,
}: FullscreenPlayerProps) {
  const { t } = useTranslation();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playerState = usePlayerState();
  const nextCoverUrl = usePlayerStore(
    (s) => s.queue[s.currentIndex + 1]?.coverUrl,
  );
  const coverUrl = currentTrack?.coverUrl;
  const kawarpSrc = useCoverSrc(coverUrl);

  const [mobileTab, setMobileTab] = useState<MobileFullscreenTab>("player");
  const [mobileEqOpen, setMobileEqOpen] = useState(false);
  const [mobileSpeedOpen, setMobileSpeedOpen] = useState(false);

  const isLocal = isLocalTrackId(currentTrack?.id);
  const isLiked = useIsTrackLiked(currentTrack?.id);
  const likeMutation = useLikeTrack();
  const unlikeMutation = useUnlikeTrack();
  const togglingLikeRef = useRef(false);

  const handleLikeToggle = useCallback(() => {
    if (!currentTrack || togglingLikeRef.current) return;
    togglingLikeRef.current = true;
    const onSettled = () => {
      togglingLikeRef.current = false;
    };
    if (isLiked) {
      unlikeMutation.mutate(currentTrack.id, { onSettled });
    } else {
      likeMutation.mutate(currentTrack.id, { onSettled });
    }
  }, [currentTrack, isLiked, likeMutation, unlikeMutation]);

  const songMenuItems = useSongMenuItems({
    id: currentTrack?.id,
    title: currentTrack?.title ?? "",
    artists: currentTrack?.artists ?? "",
    coverUrl: currentTrack?.coverUrl ?? "",
    durationMs: currentTrack?.durationMs,
  });

  const eqActive = isEqActive(playerState.isEqEnabled, playerState.eqGains);

  useEffect(() => {
    if (!currentTrack) {
      onClose();
    }
  }, [currentTrack, onClose]);

  const {
    braccatoLyrics,
    lyricsLoading,
    lyricsError,
    plainLyrics,
    instrumental,
    availableProviders,
    currentLyricsTrackId,
  } = useLyricsStore();

  const onError = useCallback((err: Error) => {
    console.error("kawarp load error:", err);
  }, []);

  const kawarpEnabled = useKawarpEnabled();
  const glassBlur = useGlassBlur();
  const [kawarpShown, setKawarpShown] = useState(false);
  const [kawarpWasEnabled, setKawarpWasEnabled] = useState(kawarpEnabled);
  if (kawarpWasEnabled !== kawarpEnabled) {
    setKawarpWasEnabled(kawarpEnabled);
    setKawarpShown(false);
  }
  const onKawarpLoad = useCallback(() => {
    setTimeout(() => setKawarpShown(true), KAWARP_FADE_IN_MS);
  }, []);

  useEffect(() => {
    void preloadCoverArt(coverUrl);
    void preloadCoverArt(nextCoverUrl);
  }, [coverUrl, nextCoverUrl]);

  const currentTrackId = currentTrack?.id;
  const isMatchingTrack = Boolean(
    currentTrackId && currentLyricsTrackId === currentTrackId,
  );
  const hasLyrics = isMatchingTrack && braccatoLyrics.length > 0;
  const showProviderIsland = hasLyrics && availableProviders.length > 0;
  const isInstrumental =
    isMatchingTrack &&
    !lyricsLoading &&
    !hasLyrics &&
    !lyricsError &&
    (instrumental || plainLyrics === "[INSTRUMENTAL]");
  const isLyricsLoading = !hasLyrics && lyricsLoading;
  const isLyricsMissing = isMatchingTrack && !hasLyrics && !lyricsLoading;
  const isCompactLayout = useSettledLyricsLayout({
    isMatchingTrack,
    lyricsLoading,
    hasLyrics,
  });

  return (
    <div
      data-theme="dark"
      className="dark relative h-full w-full overflow-hidden bg-black text-white"
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ backgroundColor: "var(--color-bg-primary)" }}
        />
        {(kawarpSrc || coverUrl) && (!kawarpShown || !kawarpEnabled) && (
          <img
            src={kawarpSrc || coverUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover pointer-events-none"
            style={{
              filter: "blur(64px) saturate(1.3)",
              transform: "scale(1.3)",
            }}
          />
        )}
        {effectsReady && kawarpEnabled ? (
          <KawarpWrapper
            src={kawarpSrc}
            onLoad={onKawarpLoad}
            onError={onError}
          />
        ) : null}
        <AmbientLayer trackId={currentTrackId} />
      </div>

      <div className="absolute inset-0 z-[1] bg-black/40" />

      <FullscreenFrameGlass />

      {/* Desktop Layout (>= 768px) */}
      <div className="hidden md:flex absolute inset-1.5 z-10">
        <div className="flex-1 flex flex-col items-center justify-center gap-5">
          <PlayerUiElements
            onClose={onClose}
            layout={isCompactLayout ? "horizontal" : "vertical"}
          />
        </div>

        <div
          className={cn(
            "h-full min-h-0 flex flex-col relative overflow-hidden",
            isCompactLayout ? "grow-0 basis-0 px-0" : "grow basis-0 pl-2 pr-6",
          )}
        >
          <div
            className="flex-1 min-h-0 relative w-full h-full"
            style={{
              display: hasLyrics ? "flex" : "none",
            }}
          >
            <AnimatePresence initial={false}>
              {hasLyrics && (
                <motion.div
                  key={`lyrics-${currentTrackId}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, pointerEvents: "none" }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="absolute inset-0 flex flex-col"
                >
                  <CanvasLyricsView lyrics={braccatoLyrics} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Desktop Top Notch (>= 768px) */}
      <div className="hidden md:flex absolute top-1.5 left-1/2 z-30 -translate-x-1/2 justify-center pointer-events-none">
        <FullscreenTopNotch>
          <BetaVisualsWarning docked={false} />
          {showProviderIsland && <LyricsProviderIsland />}
          {isLyricsLoading && <LyricsNotchStatus kind="loading" />}
          {isLyricsMissing && (
            <LyricsNotchStatus
              kind={isInstrumental ? "instrumental" : "missing"}
            />
          )}
        </FullscreenTopNotch>
      </div>

      {/* Desktop Close Notch (>= 768px) */}
      <div className="hidden md:block absolute top-1.5 left-1.5 z-30">
        <Notch align="start" tone="glass" blur={glassBlur}>
          <button
            type="button"
            aria-label={t("player.close_fullscreen")}
            onClick={onClose}
            data-no-window-drag
            className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-control border-none bg-transparent text-white/70 transition-colors select-none hover:bg-white/10 hover:text-white active:scale-95"
          >
            <DownLine size={16} />
          </button>
        </Notch>
      </div>

      {/* Mobile Layout (< 768px) */}
      <div className="flex md:hidden flex-col h-full w-full z-10 px-4 pt-[calc(12px+var(--safe-top))] pb-[calc(16px+var(--safe-bottom))] relative overflow-hidden">
        {/* Mobile Top Bar */}
        <div className="flex items-center justify-between w-full h-[48px] shrink-0 z-20">
          <button
            type="button"
            aria-label={t("player.close_fullscreen")}
            onClick={onClose}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 transition-colors border-none cursor-pointer shrink-0 active:scale-95 touch-manipulation"
          >
            <DownLine size={20} />
          </button>

          {/* Segmented Glass Pill in Center */}
          <div className="flex items-center rounded-full bg-black/40 backdrop-blur-xl border border-white/10 p-1">
            {(["player", "lyrics", "queue"] as const).map((tab) => {
              const isActive = mobileTab === tab;
              const tabLabel =
                tab === "player"
                  ? t("common.player") || "Player"
                  : tab === "lyrics"
                    ? t("player.lyrics") || "Lyrics"
                    : t("player.queue") || "Queue";
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMobileTab(tab)}
                  className={cn(
                    "relative px-3.5 py-1.5 text-[13px] font-medium transition-colors border-none bg-transparent cursor-pointer rounded-full touch-manipulation",
                    isActive ? "text-white" : "text-white/60 hover:text-white/80",
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="mobileFullscreenTabPill"
                      className="absolute inset-0 rounded-full bg-white/20 backdrop-blur-md -z-10"
                      transition={{ type: "spring", stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10">{tabLabel}</span>
                </button>
              );
            })}
          </div>

          {/* Song Menu Dropdown */}
          <DropdownMenu
            items={songMenuItems}
            align="end"
            trigger={
              <button
                type="button"
                aria-label="Track options"
                className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 transition-colors border-none cursor-pointer shrink-0 active:scale-95 touch-manipulation"
              >
                <More1Line size={20} />
              </button>
            }
          />
        </div>

        {/* Mobile Tab Content */}
        <div className="flex-1 min-h-0 relative w-full mt-2 overflow-hidden">
          {/* Tab 1: Player */}
          {mobileTab === "player" && (
            <div className="flex flex-col h-full w-full justify-between py-2 overflow-y-auto">
              {/* Cover Art */}
              <div className="flex items-center justify-center my-auto py-2">
                <div className="w-[min(74vw,300px)] aspect-square rounded-[18px] shadow-2xl overflow-hidden bg-bg-elevated mx-auto relative border border-white/10">
                  <CoverImage
                    key={coverUrl || ""}
                    src={coverUrl || ""}
                    alt={currentTrack?.title ?? "Artwork"}
                    width={300}
                    height={300}
                    priority
                    draggable={false}
                    className="w-full h-full object-cover rounded-[18px]"
                  />
                </div>
              </div>

              {/* Track Info & Like Button */}
              <div className="flex items-center justify-between gap-3 px-2 mt-2 shrink-0">
                <div className="flex flex-col min-w-0 flex-1">
                  <p className="m-0 truncate text-[18px] font-semibold text-white leading-tight">
                    {currentTrack?.title ?? t("player.nothing_playing")}
                  </p>
                  <p className="m-0 truncate text-[14px] font-normal text-white/70 leading-tight mt-1">
                    {currentTrack?.artists ?? t("player.choose_track")}
                  </p>
                </div>
                {!isLocal && (
                  <button
                    type="button"
                    aria-label={isLiked ? "Unlike" : "Like"}
                    className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-transparent border-none p-0 cursor-pointer text-white/70 hover:text-white active:scale-90 transition-transform touch-manipulation"
                    onClick={handleLikeToggle}
                  >
                    {isLiked ? (
                      <HeartFill size={24} className="text-accent-primary" />
                    ) : (
                      <HeartLine size={24} />
                    )}
                  </button>
                )}
              </div>

              {/* Timeline Slider */}
              <div className="mt-3 px-2 shrink-0">
                <FullscreenTimeline />
              </div>

              {/* Transport Controls */}
              <div className="mt-2 px-2 shrink-0">
                <FullscreenTransportControls />
              </div>

              {/* Quick Controls: Equalizer & Speed/Pitch */}
              <div className="mt-3 flex items-center justify-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setMobileEqOpen(true)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 bg-white/10 backdrop-blur-md text-[13px] font-medium text-white/80 active:scale-95 transition-all cursor-pointer touch-manipulation",
                    eqActive && "bg-white/20 text-white border-white/25",
                  )}
                >
                  <Tuning2 size={16} weight={eqActive ? "Bold" : "Outline"} />
                  <span>{t("player.equalizer") || "EQ"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMobileSpeedOpen(true)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 bg-white/10 backdrop-blur-md text-[13px] font-medium text-white/80 active:scale-95 transition-all cursor-pointer touch-manipulation",
                    (Math.abs((playerState.playbackRate ?? 1) - 1) > 0.001 ||
                      Math.abs(playerState.pitchSemitones ?? 0) > 0.001) &&
                      "bg-white/20 text-white border-white/25",
                  )}
                >
                  <PlaybackSpeed size={16} weight="Outline" />
                  <span>{`${(playerState.playbackRate ?? 1).toFixed(2)}x`}</span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: Lyrics */}
          {mobileTab === "lyrics" && (
            <div className="h-full w-full flex flex-col overflow-hidden relative">
              {showProviderIsland && (
                <div className="mb-2 shrink-0 flex justify-center">
                  <LyricsProviderIsland />
                </div>
              )}
              {hasLyrics ? (
                <div className="flex-1 min-h-0 relative w-full h-full">
                  <CanvasLyricsView lyrics={braccatoLyrics} />
                </div>
              ) : isLyricsLoading ? (
                <div className="h-full flex items-center justify-center text-white/70 text-[15px]">
                  {t("player.loading_lyrics") || "Loading lyrics..."}
                </div>
              ) : isInstrumental ? (
                <div className="h-full flex items-center justify-center text-white/70 text-[15px]">
                  {t("player.instrumental") || "Instrumental"}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-white/50 text-[15px]">
                  {t("player.no_lyrics") || "No lyrics available"}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Queue */}
          {mobileTab === "queue" && (
            <div className="h-full w-full flex flex-col overflow-hidden rounded-[14px]">
              <RightDrawer onClose={() => setMobileTab("player")} />
            </div>
          )}
        </div>
      </div>

      {/* Mobile Equalizer Modal */}
      <AnimatePresence>
        {mobileEqOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => setMobileEqOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.16 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[340px] rounded-[18px] bg-fill backdrop-blur-2xl p-4 border border-white/10"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="m-0 text-[15px] font-semibold text-white">
                  {t("player.equalizer") || "Equalizer"}
                </h3>
                <button
                  type="button"
                  onClick={() => setMobileEqOpen(false)}
                  className="p-1 rounded-full bg-white/10 text-white/70 hover:text-white border-none cursor-pointer flex items-center justify-center"
                >
                  <DownLine size={16} />
                </button>
              </div>
              <EqualizerPicker />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile Speed & Pitch Modal */}
      <AnimatePresence>
        {mobileSpeedOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => setMobileSpeedOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.16 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[340px] rounded-[18px] bg-fill backdrop-blur-2xl p-4 border border-white/10"
            >
              <SpeedPitchPicker onClose={() => setMobileSpeedOpen(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function PlayerPage() {
  const navigate = useNavigate();
  return <FullscreenPlayer onClose={() => navigate(-1)} />;
}
