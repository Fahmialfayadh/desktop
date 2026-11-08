import { useEffect, useState } from "react";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.innerWidth === "number"
      ? window.innerWidth < 768
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return;
    const media = window.matchMedia("(max-width: 767px)");
    if (!media) return;
    const onChange = () => setIsMobile(media.matches);
    setIsMobile(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    if (
      typeof (media as unknown as { addListener?: (fn: () => void) => void })
        .addListener === "function"
    ) {
      (media as unknown as { addListener: (fn: () => void) => void }).addListener(
        onChange,
      );
      return () => {
        (
          media as unknown as { removeListener?: (fn: () => void) => void }
        ).removeListener?.(onChange);
      };
    }
  }, []);

  return isMobile;
}

export default useIsMobile;
