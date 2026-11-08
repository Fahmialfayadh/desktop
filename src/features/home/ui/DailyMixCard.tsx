import { memo, useState } from "react";
import { More2Fill } from "@mingcute/react";
import { ScrollableText } from "@/shared/ui";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import type { DailyMix } from "../hooks/useDailyMixes";
import { useDailyMixActions } from "../hooks/useDailyMixActions";
import DailyMixCover from "./DailyMixCover";

export interface DailyMixCardProps {
  mix: DailyMix;
  index?: number;
}

function DailyMixCard({ mix, index }: DailyMixCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isCardHovered, setIsCardHovered] = useState(false);
  const {
    menuItems,
    menuOpen,
    setMenuOpen,
    menuPosition,
    setMenuPosition,
    handleContextMenu,
    handleClick,
  } = useDailyMixActions(mix);

  const subtitleText =
    (mix.clusterArtists && mix.clusterArtists.length > 0
      ? mix.clusterArtists.join(", ")
      : mix.description) || "";

  const mixNumber = mix.title.match(/\d+/)?.[0] ?? String((index ?? 0) + 1);

  return (
    <div
      className="group relative flex-shrink-0 w-[175px] cursor-pointer select-none"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
    >
      <DailyMixCover
        coverUrl={mix.coverUrl}
        mixNumber={mixNumber}
        imageLoaded={imageLoaded}
        onLoad={() => setImageLoaded(true)}
      />

      <div className="flex flex-col mt-[8px]">
        <span className="truncate text-label font-[500] text-text-primary">
          {mix.title}
        </span>
        <ScrollableText
          text={subtitleText}
          isParentHovered={isCardHovered}
          className="text-body text-text-tertiary"
          fadeColorClass="from-bg-primary"
        />
      </div>

      {menuItems.length > 0 && (
        <div className="absolute top-2 right-2 z-10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label="More options"
                className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md border-0 p-0 cursor-pointer active:scale-95 touch-manipulation"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(!menuOpen);
                }}
              >
                <More2Fill size={18} />
              </button>
            }
            items={menuItems}
            open={menuOpen}
            onOpenChange={(isOpen) => {
              setMenuOpen(isOpen);
              if (!isOpen) setMenuPosition(null);
            }}
            position={menuPosition}
          />
        </div>
      )}
    </div>
  );
}

export default memo(DailyMixCard);
