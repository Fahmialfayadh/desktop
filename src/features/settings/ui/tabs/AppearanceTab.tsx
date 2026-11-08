import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { AddLine, MinimizeLine, ExitLine } from "@mingcute/react";
import { useTranslation, LOCALE_OPTIONS } from "@/languages";
import { MenuSelect, ToggleSwitch } from "@/shared/ui";
import { revealThemeChange, cn } from "@/shared/lib";
import { useAuthStore } from "@/features/auth";
import { useModalStore } from "@/features/library";
import { SettingBlock, SettingRow, SettingSection } from "../controls";
import {
  useDisplaySettingsStore,
  MIN_ZOOM,
  MAX_ZOOM,
} from "../../store/displaySettingsStore";
import { ThemeCard } from "./ThemeCard";

function ZoomControl() {
  const { zoom, zoomIn, zoomOut, resetZoom } = useDisplaySettingsStore();
  const canZoomOut = zoom > MIN_ZOOM;
  const canZoomIn = zoom < MAX_ZOOM;

  return (
    <div className="flex items-center gap-[6px]">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={zoomOut}
        className="flex h-[28px] w-[32px] items-center justify-center rounded-[6px] border-0 text-text-primary transition-colors bg-fill-hover hover:bg-black/[0.1] dark:hover:bg-white/[0.16] disabled:cursor-default disabled:opacity-40 cursor-pointer"
      >
        <MinimizeLine size={14} />
      </button>
      <button
        type="button"
        onClick={resetZoom}
        className={cn(
          "flex h-[28px] min-w-[56px] items-center justify-center rounded-[6px] border-0 px-[8px] text-caption font-[600] tabular-nums text-text-primary bg-fill-hover",
          zoom !== 100
            ? "cursor-pointer hover:bg-black/[0.1] dark:hover:bg-white/[0.16]"
            : "cursor-default",
        )}
      >
        {zoom}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={zoomIn}
        className="flex h-[28px] w-[32px] items-center justify-center rounded-[6px] border-0 text-text-primary transition-colors bg-fill-hover hover:bg-black/[0.1] dark:hover:bg-white/[0.16] disabled:cursor-default disabled:opacity-40 cursor-pointer"
      >
        <AddLine size={14} />
      </button>
    </div>
  );
}

export function AppearanceTab({ searchQuery }: { searchQuery?: string }) {
  const { t, locale, setLocale } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const { compactMode, setCompactMode } = useDisplaySettingsStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <SettingSection>
      <SettingRow
        title={t("settings.language.label")}
        description={t("settings.language.description")}
        titleKey="settings.language.label"
        descKey="settings.language.description"
        searchQuery={searchQuery}
        control={
          mounted ? (
            <MenuSelect
              options={LOCALE_OPTIONS}
              value={locale}
              onChange={setLocale}
              className="min-w-[130px]"
              aria-label={t("settings.language.label")}
            />
          ) : (
            <span />
          )
        }
      />

      <SettingRow
        title={t("settings.compact_mode.title")}
        titleKey="settings.compact_mode.title"
        searchQuery={searchQuery}
        control={
          mounted ? (
            <ToggleSwitch checked={compactMode} onChange={setCompactMode} />
          ) : (
            <span />
          )
        }
      />

      <SettingRow
        title={t("settings.zoom.title")}
        titleKey="settings.zoom.title"
        searchQuery={searchQuery}
        control={mounted ? <ZoomControl /> : <span />}
      />

      <SettingBlock
        title={t("settings.theme.title")}
        description={t("settings.theme.description")}
        titleKey="settings.theme.title"
        descKey="settings.theme.description"
        searchQuery={searchQuery}
      >
        {mounted ? (
          <div className="grid grid-cols-3 gap-[10px]">
            {(
              [
                { value: "system", label: t("settings.theme.system") },
                { value: "light", label: t("settings.theme.light") },
                { value: "dark", label: t("settings.theme.dark") },
              ] as const
            ).map((item) => {
              return (
                <ThemeCard
                  key={item.value}
                  mode={item.value}
                  label={item.label}
                  active={theme === item.value}
                  onSelect={(event) =>
                    revealThemeChange(() => setTheme(item.value), {
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }
                />
              );
            })}
          </div>
        ) : null}
      </SettingBlock>

      {user ? (
        <SettingSection label={t("common.account") || "Account"}>
          <SettingRow
            title={t("common.sign_out") || "Sign out"}
            titleKey="common.sign_out"
            searchQuery={searchQuery}
            control={
              mounted ? (
                <button
                  type="button"
                  onClick={async () => {
                    useModalStore.getState().closeSettings();
                    await logout();
                  }}
                  className="flex items-center gap-[6px] h-[32px] px-[12px] rounded-control border-0 bg-red-500/10 text-red-500 hover:bg-red-500/20 active:scale-[0.97] transition-all cursor-pointer text-caption font-[600]"
                >
                  <ExitLine size={15} />
                  <span>{t("common.sign_out") || "Sign out"}</span>
                </button>
              ) : (
                <span />
              )
            }
          />
        </SettingSection>
      ) : null}
    </SettingSection>
  );
}
