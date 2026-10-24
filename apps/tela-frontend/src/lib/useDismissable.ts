import { useEffect, useRef } from "react";

// Dismiss mechanics shared by every popover-like surface in the room
// (PeopleList, the aspect-mode menu): a pointerdown outside the
// container and the Escape key both close it. The returned ref goes on
// the element that CONTAINS both the trigger and the panel -- taps
// inside it (including on the trigger itself, which toggles) don't
// count as "outside".
export function useDismissable<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return ref;
}