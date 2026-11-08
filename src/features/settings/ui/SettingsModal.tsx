import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  CloseLine,
  DiscordFill,
  KeyboardFill,
  YoutubeFill,
} from "@mingcute/react";
import {
  Play,
  Palette,
  InfoCircle,
  Database,
  Widget5,
} from "@solar-icons/react";
import Dialog from "@/shared/ui/Dialog";
import { DialogHeader } from "@/shared/ui";
import { useScrollFade } from "@/shared/hooks";
import { useTranslation, getTranslationsForAllLocales } from "@/languages";
import { useModalStore } from "@/features/library";
import {
  PlaybackTab,
  ShortcutsTab,
  AppearanceTab,
  StorageTab,
  AboutTab,
  OverlayTab,
  DiscordTab,
  YoutubeTab,
} from "./tabs";
import { SettingsSidebar, type SettingsNavIconProps } from "./SettingsSidebar";

type TabId =
  | "Playback"
  | "Shortcuts"
  | "Overlay"
  | "Discord"
  | "Youtube"
  | "Appearance"
  | "Storage"
  | "About";

const TAB_ICONS: Record<TabId, React.ComponentType<SettingsNavIconProps>> = {
  Playback: Play,
  Shortcuts: KeyboardFill,
  Overlay: Widget5,
  Discord: DiscordFill,
  Youtube: YoutubeFill,
  Appearance: Palette,
  Storage: Database,
  About: InfoCircle,
};

type TabGroupKey = "player" | "interface" | "integrations" | "application";

const TAB_GROUPS: { labelKey: TabGroupKey; ids: TabId[] }[] = [
  { labelKey: "player", ids: ["Playback", "Shortcuts"] },
  { labelKey: "interface", ids: ["Appearance", "Overlay"] },
  { labelKey: "integrations", ids: ["Youtube", "Discord"] },
  { labelKey: "application", ids: ["Storage", "About"] },
];

const SETTING_ITEMS: { tabId: TabId; titleKey: string; descKey?: string }[] = [
  // Playback
  {
    tabId: "Playback",
    titleKey: "settings.autoplay_similar.title",
    descKey: "settings.autoplay_similar.description",
  },
  {
    tabId: "Playback",
    titleKey: "settings.track_double_click.title",
    descKey: "settings.track_double_click.description",
  },
  {
    tabId: "Playback",
    titleKey: "settings.default_playback_context.title",
    descKey: "settings.default_playback_context.description",
  },
  {
    tabId: "Playback",
    titleKey: "settings.audio.pause_on_device_change.title",
    descKey: "settings.audio.pause_on_device_change.description",
  },

  // Shortcuts
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.global_section",
    descKey: "settings.shortcuts.global_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.main_app_section",
    descKey: "settings.shortcuts.main_app_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.miniplayer_section",
    descKey: "settings.shortcuts.miniplayer_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.toggle_overlay",
    descKey: "settings.shortcuts.toggle_overlay_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.quick_like_song",
    descKey: "settings.shortcuts.quick_like_song_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.play_pause",
    descKey: "settings.shortcuts.play_pause_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.next_track",
    descKey: "settings.shortcuts.next_track_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.prev_track",
    descKey: "settings.shortcuts.prev_track_desc",
  },
  {
    tabId: "Shortcuts",
    titleKey: "settings.shortcuts.like_track",
    descKey: "settings.shortcuts.like_track_desc",
  },

  // Overlay
  {
    tabId: "Overlay",
    titleKey: "settings.overlay.position.title",
    descKey: "settings.overlay.position.description",
  },
  {
    tabId: "Overlay",
    titleKey: "settings.overlay.show_lyrics.title",
    descKey: "settings.overlay.show_lyrics.description",
  },
  {
    tabId: "Overlay",
    titleKey: "settings.overlay.auto_show_on_minimize.title",
    descKey: "settings.overlay.auto_show_on_minimize.description",
  },
  {
    tabId: "Overlay",
    titleKey: "settings.overlay.always_on_top.title",
    descKey: "settings.overlay.always_on_top.description",
  },

  // Discord
  {
    tabId: "Discord",
    titleKey: "settings.discord.enable.title",
    descKey: "settings.discord.enable.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_timeline.title",
    descKey: "settings.discord.show_timeline.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_artwork.title",
    descKey: "settings.discord.show_artwork.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_artist_image.title",
    descKey: "settings.discord.show_artist_image.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_paused.title",
    descKey: "settings.discord.show_paused.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_button.title",
    descKey: "settings.discord.show_button.description",
  },
  {
    tabId: "Discord",
    titleKey: "settings.discord.show_download_button.title",
    descKey: "settings.discord.show_download_button.description",
  },
  {
    tabId: "Youtube",
    titleKey: "settings.youtube.account_playback.title",
    descKey: "settings.youtube.account_playback.description",
  },
  {
    tabId: "Youtube",
    titleKey: "settings.youtube.prompt_sign_in.title",
    descKey: "settings.youtube.prompt_sign_in.description",
  },
  {
    tabId: "Youtube",
    titleKey: "settings.youtube.sync_library.title",
    descKey: "settings.youtube.sync_library.description",
  },

  // Appearance
  {
    tabId: "Appearance",
    titleKey: "settings.language.label",
    descKey: "settings.language.description",
  },
  {
    tabId: "Appearance",
    titleKey: "settings.theme.title",
    descKey: "settings.theme.description",
  },

  // Storage
  {
    tabId: "Storage",
    titleKey: "settings.storage.title",
    descKey: "settings.storage.description",
  },
  { tabId: "Storage", titleKey: "settings.storage.usage_title" },
  {
    tabId: "Storage",
    titleKey: "settings.storage.open_folder",
    descKey: "settings.storage.open_folder_description",
  },

  // About
  {
    tabId: "About",
    titleKey: "settings.about.liner",
    descKey: "common.app.version",
  },
  { tabId: "About", titleKey: "settings.notifications.test_button" },
];

export default function SettingsModal() {
  const { t } = useTranslation();
  const open = useModalStore((state) => state.settingsOpen);
  const close = useModalStore((state) => state.closeSettings);

  const isElectron =
    typeof window !== "undefined" && Boolean(window.linerElectron);
  const ELECTRON_ONLY_TABS = useMemo(
    () => new Set<TabId>(["Shortcuts", "Overlay", "Discord"]),
    [],
  );

  const [activeTab, setActiveTab] = useState<TabId>("Playback");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isElectron && ELECTRON_ONLY_TABS.has(activeTab)) {
      setActiveTab("Playback");
    }
  }, [isElectron, activeTab, ELECTRON_ONLY_TABS]);

  const handleClose = () => {
    setSearchQuery("");
    close();
  };

  const tabLabels: Record<TabId, string> = {
    Playback: t("settings.tabs.playback"),
    Shortcuts: t("settings.tabs.shortcuts") || "Shortcuts",
    Overlay: t("settings.tabs.overlay") || "Overlay",
    Discord: t("settings.tabs.discord") || "Discord RPC",
    Youtube: t("settings.tabs.youtube") || "YouTube",
    Appearance: t("settings.tabs.appearance"),
    Storage: t("settings.tabs.storage"),
    About: t("settings.tabs.about"),
  };

  const tabDescriptions: Record<TabId, string> = {
    Playback: t("settings.playback.description"),
    Shortcuts:
      t("settings.shortcuts.description") ||
      "System-wide and player keyboard shortcuts.",
    Overlay:
      t("settings.overlay.description") ||
      "Desktop overlay behavior, position and lyrics display.",
    Discord:
      t("settings.discord.description") ||
      "Show what you're listening to on Discord with artwork, artist badge and progress bar.",
    Youtube:
      t("settings.youtube.description") ||
      "Sign in to your YouTube account to prevent playback errors.",
    Appearance: t("settings.theme.description"),
    Storage: t("settings.storage.description"),
    About: t("settings.about.tagline"),
  };

  const matchingTabIds = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase().trim();
    const set = new Set<TabId>();

    const TAB_LABEL_KEYS: Record<TabId, string> = {
      Playback: "settings.tabs.playback",
      Shortcuts: "settings.tabs.shortcuts",
      Overlay: "settings.tabs.overlay",
      Discord: "settings.tabs.discord",
      Youtube: "settings.tabs.youtube",
      Appearance: "settings.theme.title",
      Storage: "settings.tabs.storage",
      About: "settings.tabs.about",
    };

    const TAB_DESC_KEYS: Record<TabId, string> = {
      Playback: "settings.playback.description",
      Shortcuts: "settings.shortcuts.description",
      Overlay: "settings.overlay.description",
      Discord: "settings.discord.description",
      Youtube: "settings.youtube.description",
      Appearance: "settings.theme.description",
      Storage: "settings.storage.description",
      About: "settings.about.tagline",
    };

    (Object.keys(TAB_LABEL_KEYS) as TabId[]).forEach((tabId) => {
      if (!isElectron && ELECTRON_ONLY_TABS.has(tabId)) return;
      const texts = [
        ...getTranslationsForAllLocales(TAB_LABEL_KEYS[tabId]),
        ...getTranslationsForAllLocales(TAB_DESC_KEYS[tabId]),
      ];
      if (texts.some((txt) => txt.toLowerCase().includes(query))) {
        set.add(tabId);
      }
    });

    SETTING_ITEMS.forEach((item) => {
      if (!isElectron && ELECTRON_ONLY_TABS.has(item.tabId)) return;
      const texts = [
        ...getTranslationsForAllLocales(item.titleKey),
        ...(item.descKey ? getTranslationsForAllLocales(item.descKey) : []),
      ];
      if (texts.some((txt) => txt.toLowerCase().includes(query))) {
        set.add(item.tabId);
      }
    });

    return set;
  }, [searchQuery, isElectron, ELECTRON_ONLY_TABS]);

  const baseGroups = useMemo(() => {
    return TAB_GROUPS.map((group) => ({
      ...group,
      ids: isElectron
        ? group.ids
        : group.ids.filter((id) => !ELECTRON_ONLY_TABS.has(id)),
    })).filter((group) => group.ids.length > 0);
  }, [isElectron, ELECTRON_ONLY_TABS]);

  const filteredGroups = useMemo(() => {
    if (!matchingTabIds) return baseGroups;

    return baseGroups
      .map((group) => {
        const ids = group.ids.filter((id) => matchingTabIds.has(id));
        return { ...group, ids };
      })
      .filter((group) => group.ids.length > 0);
  }, [matchingTabIds, baseGroups]);

  const allVisibleTabs = useMemo(() => {
    return filteredGroups.flatMap((group) => group.ids);
  }, [filteredGroups]);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    if (
      matchingTabIds &&
      matchingTabIds.size > 0 &&
      !matchingTabIds.has(activeTab)
    ) {
      const firstMatch = baseGroups
        .flatMap((g) => g.ids)
        .find((id) => matchingTabIds.has(id));
      if (firstMatch) {
        setActiveTab(firstMatch);
      }
    }
  }, [searchQuery, matchingTabIds, activeTab, baseGroups]);

  const {
    attach: attachContentFade,
    onScroll: onContentScroll,
    style: contentFadeStyle,
  } = useScrollFade<HTMLDivElement>();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? handleClose() : undefined)}
      maxWidth={940}
      className="p-0 h-[88dvh] md:h-[720px] !max-h-[88dvh] md:!max-h-[90vh] flex flex-col md:!flex-row overflow-hidden"
    >
      <div className="hidden md:flex min-h-0 shrink-0">
        <SettingsSidebar
          groups={filteredGroups}
          activeTab={activeTab}
          onSelect={setActiveTab}
          labels={tabLabels}
          icons={TAB_ICONS}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClose={handleClose}
        />
      </div>

      {/* Mobile top bar and scrollable tab selector */}
      <div className="flex md:hidden flex-col shrink-0 border-b border-border-primary/40 bg-bg-panel/50 pt-2.5 pb-2 px-3">
        <div className="flex items-center justify-between pb-2">
          <span className="text-[17px] font-semibold text-text-primary">
            {t("settings.title") || "Settings"}
          </span>
          <button
            type="button"
            aria-label={t("common.close") || "Close"}
            onClick={handleClose}
            className="inline-flex h-[32px] w-[32px] cursor-pointer items-center justify-center rounded-control border-0 bg-transparent p-0 text-text-tertiary transition-colors hover:bg-fill hover:text-text-primary"
          >
            <CloseLine size={18} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto overscroll-contain no-scrollbar py-0.5">
          {allVisibleTabs.map((id) => {
            const Icon = TAB_ICONS[id];
            const isActive = id === activeTab;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 shrink-0 px-3 py-1.5 rounded-[9px] text-[13px] font-medium border-0 cursor-pointer transition-colors ${
                  isActive
                    ? "bg-fill text-text-primary"
                    : "bg-transparent text-text-secondary hover:text-text-primary active:bg-fill/50"
                }`}
              >
                <Icon
                  size={15}
                  className={
                    isActive ? "text-text-primary" : "text-text-tertiary"
                  }
                />
                <span>{tabLabels[id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:block">
          <DialogHeader
            className="shrink-0 px-[20px] pt-[20px] pb-[16px]"
            title={tabLabels[activeTab]}
            description={tabDescriptions[activeTab]}
            trailing={
              <button
                type="button"
                aria-label={t("common.close") || "Close"}
                onClick={handleClose}
                className="-mt-[2px] -mr-[6px] inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-control border-0 bg-transparent p-0 text-text-tertiary transition-colors hover:bg-fill hover:text-text-primary"
              >
                <CloseLine size={17} />
              </button>
            }
          />
        </div>

        {/* Mobile current section indicator */}
        <div className="md:hidden px-3.5 pt-3 pb-1">
          <h2 className="text-[17px] font-semibold text-text-primary m-0">
            {tabLabels[activeTab]}
          </h2>
          {tabDescriptions[activeTab] && (
            <p className="text-caption text-text-tertiary m-0 mt-0.5">
              {tabDescriptions[activeTab]}
            </p>
          )}
        </div>

        <div
          ref={attachContentFade}
          onScroll={onContentScroll}
          style={contentFadeStyle}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="flex min-h-full w-full flex-col px-3.5 py-2 md:px-[20px] md:pt-[2px] md:pb-[20px] font-sans">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 flex flex-col"
            >
              {activeTab === "Playback" && (
                <PlaybackTab searchQuery={searchQuery} />
              )}
              {isElectron && activeTab === "Shortcuts" && (
                <ShortcutsTab searchQuery={searchQuery} />
              )}
              {isElectron && activeTab === "Overlay" && (
                <OverlayTab searchQuery={searchQuery} />
              )}
              {isElectron && activeTab === "Discord" && (
                <DiscordTab searchQuery={searchQuery} />
              )}
              {activeTab === "Youtube" && (
                <YoutubeTab searchQuery={searchQuery} />
              )}
              {activeTab === "Appearance" && (
                <AppearanceTab searchQuery={searchQuery} />
              )}
              {activeTab === "Storage" && (
                <StorageTab searchQuery={searchQuery} />
              )}
              {activeTab === "About" && <AboutTab searchQuery={searchQuery} />}
            </motion.div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
