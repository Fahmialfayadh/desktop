import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { useIsMobile } from "@/shared/hooks";

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
  /** persistent highlight for the currently selected option */
  active?: boolean;
}

export interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownMenuItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  position?: { x: number; y: number } | null;
  side?: "top" | "bottom";
  align?: "start" | "end";
}

function useFixedStyle(
  menuRef: RefObject<HTMLDivElement | null>,
  isFixed: boolean,
  position: { x: number; y: number } | null | undefined,
  open: boolean,
  side: "top" | "bottom" = "bottom",
  align: "start" | "end" = "start",
): React.CSSProperties {
  const [style, setStyle] = useState<React.CSSProperties>(() =>
    position ? { left: position.x, top: position.y } : {},
  );

  useLayoutEffect(() => {
    if (!isFixed || !position || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const height = Math.max(rect.height, menuRef.current.scrollHeight);
    let left = align === "end" ? position.x - rect.width : position.x;
    let top = side === "top" ? position.y - height : position.y;
    let maxHeight: number | undefined;

    if (left + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - 8;
    }
    if (left < 8) left = 8;

    const spaceBelow = window.innerHeight - position.y - 8;
    const spaceAbove = position.y - 16;
    if (side !== "top" && height > spaceBelow) {
      if (spaceAbove > spaceBelow) {
        maxHeight = Math.min(height, spaceAbove);
        top = position.y - maxHeight - 8;
      } else {
        maxHeight = spaceBelow;
      }
    }
    if (side === "top" && height > spaceAbove + 8) {
      maxHeight = spaceAbove + 8;
      top = 8;
    }
    if (top < 8) top = 8;

    setStyle({ left, top, maxHeight });
  }, [isFixed, position, open, menuRef, side, align]);

  return style;
}

export default function DropdownMenu({
  trigger,
  items,
  open: controlledOpen,
  onOpenChange,
  position,
  side = "bottom",
  align = "start",
}: DropdownMenuProps) {
  const isMobile = useIsMobile();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [computedPos, setComputedPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!position && open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = align === "end" ? rect.right : rect.left;
      const y = side === "top" ? rect.top - 4 : rect.bottom + 4;
      setComputedPos({ x, y });
    }
  }, [open, position, side, align]);

  const targetPos = position || computedPos;
  const isFixed = Boolean(targetPos);
  const fixedStyle = useFixedStyle(
    menuRef,
    isFixed,
    targetPos,
    open,
    side,
    align,
  );

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        menuRef.current?.contains(e.target as Node) ||
        containerRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  const desktopMenuContent = (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dropdown-menu"
          ref={menuRef}
          data-dropdown-menu="true"
          initial={{ opacity: 0, scale: 0.96, y: side === "top" ? 2 : -2 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: side === "top" ? 2 : -2 }}
          transition={{ duration: 0.1, ease: "easeOut" }}
          className={`overflow-y-auto overscroll-contain rounded-[11px] p-[4px] min-w-[160px] border-0 bg-fill backdrop-blur-2xl backdrop-saturate-150 ${
            isFixed
              ? "fixed z-[99999]"
              : side === "top"
                ? "absolute right-0 bottom-full mb-1 z-50"
                : "absolute right-0 top-full mt-1 z-50"
          }`}
          style={isFixed ? fixedStyle : {}}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-[1px]">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={async (e) => {
                  e.stopPropagation();
                  setOpen(false);
                  await item.onClick();
                }}
                className={`group flex w-full h-[30px] items-center gap-[8px] rounded-control px-[9px] text-body font-normal transition-colors border-none bg-transparent text-left cursor-pointer select-none outline-none ${
                  item.danger
                    ? "text-red-400 hover:bg-red-500/10 hover:text-red-400"
                    : "text-text-primary hover:bg-fill"
                } ${
                  item.active ? "bg-fill" : ""
                } disabled:pointer-events-none disabled:opacity-40`}
                aria-current={item.active ? "true" : undefined}
              >
                {item.icon && (
                  <span
                    className={`shrink-0 flex items-center justify-center text-title ${
                      item.danger
                        ? "text-red-400"
                        : "text-text-secondary group-hover:text-text-primary"
                    } transition-colors`}
                  >
                    {item.icon}
                  </span>
                )}
                <span className="truncate flex-1">{item.label}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const mobileBottomSheetContent = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="dropdown-sheet-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[99998] bg-black/50 backdrop-blur-[2px]"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <motion.div
            key="dropdown-bottom-sheet"
            ref={menuRef}
            data-dropdown-menu="true"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 bottom-0 z-[99999] max-h-[78dvh] overflow-y-auto overscroll-contain rounded-t-[20px] bg-bg-panel/95 [[data-cover-glow=on]_&]:bg-black/75 backdrop-blur-2xl backdrop-saturate-150 border-t border-border-primary/50 px-2.5 pt-2.5 pb-[calc(14px+var(--safe-bottom,0px))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-9 h-1 rounded-full bg-border-alpha-14 mx-auto mb-2" />
            <div className="flex flex-col gap-1">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setOpen(false);
                    await item.onClick();
                  }}
                  className={`group flex w-full min-h-[46px] items-center gap-3 rounded-[12px] px-3.5 text-[14.5px] font-normal transition-colors border-none bg-transparent text-left cursor-pointer select-none outline-none active:bg-fill ${
                    item.danger
                      ? "text-red-400 active:bg-red-500/10 active:text-red-400"
                      : "text-text-primary"
                  } ${
                    item.active ? "bg-fill" : ""
                  } disabled:pointer-events-none disabled:opacity-40`}
                  aria-current={item.active ? "true" : undefined}
                >
                  {item.icon && (
                    <span
                      className={`shrink-0 flex items-center justify-center text-[18px] ${
                        item.danger
                          ? "text-red-400"
                          : "text-text-secondary group-hover:text-text-primary"
                      } transition-colors`}
                    >
                      {item.icon}
                    </span>
                  )}
                  <span className="truncate flex-1">{item.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <div
      ref={containerRef}
      className="relative inline-flex"
      onClick={(e) => {
        if (!position || isMobile) {
          e.stopPropagation();
          setOpen(!open);
        }
      }}
    >
      {trigger}
      {isMobile
        ? typeof document !== "undefined"
          ? createPortal(mobileBottomSheetContent, document.body)
          : null
        : isFixed && typeof document !== "undefined"
          ? createPortal(desktopMenuContent, document.body)
          : desktopMenuContent}
    </div>
  );
}
