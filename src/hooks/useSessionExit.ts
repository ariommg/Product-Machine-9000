import { useEffect, useRef } from "react";

/**
 * The session is memory-only, so closing the tab loses every unexported product.
 * Hosted images are deliberately NOT deleted here — they need to outlive the tab
 * so the CSV can be imported into Shopify a day or two later. They expire on
 * their own instead.
 */
export const useSessionExit = (warnOnClose: boolean) => {
  const warnRef = useRef(warnOnClose);
  warnRef.current = warnOnClose;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!warnRef.current) {
        return;
      }
      event.preventDefault();
      // Browsers show their own wording; a non-empty returnValue is what triggers it.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
};
