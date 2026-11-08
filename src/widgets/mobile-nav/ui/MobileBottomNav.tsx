import { memo, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Home7Fill,
  Home7Line,
  Search3Fill,
  Search3Line,
  Download2Line,
  BookmarksFill,
  BookmarksLine,
  Settings4Fill,
  Settings4Line,
} from "@mingcute/react";
import { useTranslation } from "@/languages";
import { useModalStore } from "@/features/library";
import { useOfflineModeStore } from "@/features/connectivity";
import { cn } from "@/shared/lib";

export interface MobileBottomNavProps {
  searchOpen: boolean;
  onSearchToggle: () => void;
  onSearchClose?: () => void;
  onImportOpen?: () => void;
  className?: string;
}

export const MobileBottomNav = memo(function MobileBottomNav({
  searchOpen,
  onSearchToggle,
  onSearchClose,
  onImportOpen,
  className,
}: MobileBottomNavProps) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const offline = useOfflineModeStore((s) => s.offline);
  const settingsOpen = useModalStore((s) => s.settingsOpen);
  const openSettings = useModalStore((s) => s.openSettings);

  const isHomeActive = !searchOpen && (pathname === "/" || pathname === "/home");
  const isLibraryActive =
    !searchOpen && (pathname === "/library" || pathname.startsWith("/library/"));

  const handleImport = useCallback(() => {
    onSearchClose?.();
    if (onImportOpen) {
      onImportOpen();
    } else {
      useModalStore.getState().openCreatePlaylist();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("liner:open-import-tab"));
      }
    }
  }, [onImportOpen, onSearchClose]);

  const handleSettings = useCallback(() => {
    onSearchClose?.();
    openSettings();
  }, [openSettings, onSearchClose]);

  const navButtonClass =
    "min-h-[48px] flex-1 flex flex-col items-center justify-center relative touch-manipulation cursor-pointer select-none py-1 text-center transition-colors border-none bg-transparent";

  const disabledClass =
    "pointer-events-none opacity-25 cursor-not-allowed";

  return (
    <nav
      data-no-window-drag
      data-mobile-bottom-nav
      className={cn(
        "md:hidden z-[56] shrink-0 w-full select-none",
        "bg-bg-glass backdrop-blur-[24px] backdrop-saturate-150 border-t border-border-primary/40 [[data-cover-glow=on]_&]:bg-black/45",
        "pb-[var(--safe-bottom)]",
        className,
      )}
    >
      <div className="flex h-[56px] w-full items-center justify-around px-1">
        {/* 1. Home */}
        <Link
          to="/"
          onClick={() => onSearchClose?.()}
          aria-label={t("common.sidebar.home") || "Home"}
          aria-current={isHomeActive ? "page" : undefined}
          aria-disabled={offline}
          className={cn(
            navButtonClass,
            isHomeActive
              ? "text-text-primary"
              : "text-text-secondary opacity-70 hover:opacity-100",
            offline && disabledClass,
          )}
        >
          {isHomeActive && (
            <motion.div
              layoutId="mobileBottomNavPill"
              className="absolute inset-x-1.5 inset-y-1 rounded-[10px] bg-border-alpha-14 pointer-events-none -z-10"
              transition={{ type: "spring", stiffness: 450, damping: 35 }}
            />
          )}
          {isHomeActive ? <Home7Fill size={22} /> : <Home7Line size={22} />}
          <span className="text-[10.5px] font-medium leading-none mt-1 truncate">
            {t("common.sidebar.home") || "Home"}
          </span>
        </Link>

        {/* 2. Search */}
        <button
          type="button"
          onClick={onSearchToggle}
          disabled={offline}
          aria-label={t("common.sidebar.search") || "Search"}
          aria-pressed={searchOpen}
          aria-disabled={offline}
          className={cn(
            navButtonClass,
            searchOpen
              ? "text-text-primary"
              : "text-text-secondary opacity-70 hover:opacity-100",
            offline && disabledClass,
          )}
        >
          {searchOpen && (
            <motion.div
              layoutId="mobileBottomNavPill"
              className="absolute inset-x-1.5 inset-y-1 rounded-[10px] bg-border-alpha-14 pointer-events-none -z-10"
              transition={{ type: "spring", stiffness: 450, damping: 35 }}
            />
          )}
          {searchOpen ? <Search3Fill size={22} /> : <Search3Line size={22} />}
          <span className="text-[10.5px] font-medium leading-none mt-1 truncate">
            {t("common.sidebar.search") || "Search"}
          </span>
        </button>

        {/* 3. Import */}
        <button
          type="button"
          onClick={handleImport}
          disabled={offline}
          aria-label={t("common.import") || "Import"}
          aria-disabled={offline}
          className={cn(
            navButtonClass,
            "text-text-secondary opacity-70 hover:opacity-100",
            offline && disabledClass,
          )}
        >
          <Download2Line size={22} />
          <span className="text-[10.5px] font-medium leading-none mt-1 truncate">
            {t("common.import") || "Import"}
          </span>
        </button>

        {/* 4. Library */}
        <Link
          to="/library"
          onClick={() => onSearchClose?.()}
          aria-label={t("common.sidebar.library") || "Library"}
          aria-current={isLibraryActive ? "page" : undefined}
          className={cn(
            navButtonClass,
            isLibraryActive
              ? "text-text-primary"
              : "text-text-secondary opacity-70 hover:opacity-100",
          )}
        >
          {isLibraryActive && (
            <motion.div
              layoutId="mobileBottomNavPill"
              className="absolute inset-x-1.5 inset-y-1 rounded-[10px] bg-border-alpha-14 pointer-events-none -z-10"
              transition={{ type: "spring", stiffness: 450, damping: 35 }}
            />
          )}
          {isLibraryActive ? (
            <BookmarksFill size={22} />
          ) : (
            <BookmarksLine size={22} />
          )}
          <span className="text-[10.5px] font-medium leading-none mt-1 truncate">
            {t("common.sidebar.library") || "Library"}
          </span>
        </Link>

        {/* 5. Settings */}
        <button
          type="button"
          onClick={handleSettings}
          aria-label={t("common.sidebar.settings") || "Settings"}
          aria-pressed={settingsOpen}
          className={cn(
            navButtonClass,
            settingsOpen
              ? "text-text-primary"
              : "text-text-secondary opacity-70 hover:opacity-100",
          )}
        >
          {settingsOpen && (
            <motion.div
              layoutId="mobileBottomNavPill"
              className="absolute inset-x-1.5 inset-y-1 rounded-[10px] bg-border-alpha-14 pointer-events-none -z-10"
              transition={{ type: "spring", stiffness: 450, damping: 35 }}
            />
          )}
          {settingsOpen ? (
            <Settings4Fill size={22} />
          ) : (
            <Settings4Line size={22} />
          )}
          <span className="text-[10.5px] font-medium leading-none mt-1 truncate">
            {t("common.sidebar.settings") || "Settings"}
          </span>
        </button>
      </div>
    </nav>
  );
});

export default MobileBottomNav;
