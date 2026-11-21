import { useState } from "react";
import { useCallback, useEffect } from "react";
import { isMobileSafari, isIOS, isChrome } from "react-device-detect";
import { Capacitor } from "@capacitor/core";

type Props = {
  disabled?: boolean;
};

/**
 * Extending the `Document` interface to include types for different vendors.
 */
declare global {
  interface Document {
    mozFullScreenElement?: Element;
    msFullscreenElement?: Element;
    webkitFullscreenElement?: Element;
  }
  interface HTMLBodyElement {
    webkitRequestFullscreen?: VoidFunction;
    webkitRequestFullScreen?: VoidFunction;
    mozRequestFullScreen?: VoidFunction;
    msRequestFullscreen?: VoidFunction;
  }
}

export type FullScreenStatus = "pending" | "on" | "off" | "not-supported";

/**
 * The iOS app already fills the screen, and element fullscreen inside its
 * WKWebView makes iOS overlay a "capacitor://localhost/... is in full screen.
 * Swipe down to exit." banner on top of the question.
 */
const isIOSApp = () => Capacitor.getPlatform() === "ios";

export const triggerFullscreen = () => {
  if (isIOSApp()) return;

  const methods = [
    "requestFullscreen",
    "webkitRequestFullscreen",
    "webkitRequestFullScreen",
    "mozRequestFullScreen",
    "msRequestFullscreen",
  ] as const;

  const ref = document.body as HTMLBodyElement;
  if (ref) {
    for (const name of methods) {
      if (name in ref) {
        ref[name]!()?.catch(() => {
          // console.error(err)
        });
        ref.style.overflowY = "auto";
        break;
      }
    }
  }
};

export function useFullScreenDetection(
  { disabled }: Props = { disabled: false }
) {
  /**
   * `undefined` signifies that we have not determined if the browser is in fullscreen mode or not.
   * `true` means that the browser is in fullscreen mode.
   * `false` means that the browser is not in fullscreen mode.
   */
  const [fullScreenStatus, setFullScreenStatus] =
    useState<FullScreenStatus>("pending");

  const changeFullscreenStatus = useCallback(() => {
    setFullScreenStatus(
      document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
        ? "on"
        : "off"
    );
  }, []);

  const listener = useCallback((e: KeyboardEvent) => {
    /**
     * This code is for preventing user from ENTERING full screen mode using keyboard.
     * Browsers don't allow us to prevent user from exiting full screen.
     * Because in that case, the `fullscreenchange` does not fire and our state becomes invalid. The browser becomes full screen but our `status` still says 'off'.
     * The `fullscreenchange` event only fires when we use JavaScript to trigger full screen.
     * https://stackoverflow.com/questions/21103478/fullscreenchange-event-not-firing-in-chrome#:~:text=There%20appears%20to%20be%20a%20security%20restriction%20that%20prevents%20JavaScript%20from%20monitoring%20if%20a%20user%20manually%20enables%20fullscreen%20mode%20via%20a%20hotkey.
     */
    if (["F11", "Escape"].includes(e.key)) {
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    if (disabled) {
      setFullScreenStatus("pending");
      return;
    }

    /**
     * 'Mobile Safari' and 'iOS Chrome' don't support fullscreen; the iOS app
     * never requests it (see triggerFullscreen).
     */
    if (isMobileSafari || (isChrome && isIOS) || isIOSApp()) {
      setFullScreenStatus("not-supported");
      return;
    }

    changeFullscreenStatus();

    const vendorPrefix = ["", "moz", "webkit", "ms"];

    vendorPrefix.forEach(function (prefix) {
      document.addEventListener(
        prefix + "fullscreenchange",
        changeFullscreenStatus
      );
    });

    window.addEventListener("keydown", listener);

    return () => {
      vendorPrefix.forEach(function (prefix) {
        document.removeEventListener(
          prefix + "fullscreenchange",
          changeFullscreenStatus
        );
      });
      window.removeEventListener("keydown", listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { fullScreenStatus, triggerFullscreen } as const;
}
