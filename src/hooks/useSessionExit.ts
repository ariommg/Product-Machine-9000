import { useEffect, useRef } from "react";
import { beaconHostedImageDeletion } from "../lib/api";

type SessionExitOptions = {
  /** Blob URLs that would be orphaned if the tab closed right now. */
  hostedImageUrls: string[];
  warnOnClose: boolean;
};

/**
 * The session is deliberately memory-only, so closing the tab is the point of no
 * return: unexported products are lost, and any generated image left in blob
 * storage becomes unreachable. Warn first, then clean up on the way out.
 */
export const useSessionExit = ({ hostedImageUrls, warnOnClose }: SessionExitOptions) => {
  const stateRef = useRef({ hostedImageUrls, warnOnClose });
  stateRef.current = { hostedImageUrls, warnOnClose };

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!stateRef.current.warnOnClose) {
        return;
      }
      event.preventDefault();
      // Browsers show their own wording; a non-empty returnValue is what triggers it.
      event.returnValue = "";
    };

    // pagehide fires after the user confirms they are leaving, which is the only
    // moment the cleanup should actually run.
    const handlePageHide = () => {
      beaconHostedImageDeletion(stateRef.current.hostedImageUrls);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);
};
