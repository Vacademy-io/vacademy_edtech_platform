/**
 * Vacademy picture-in-picture — BBB HTML5 plugin entry.
 *
 * Loaded instead of BBB's stock PiP plugin for institutes whose classes open
 * inside the learner app (admin_core: bbb.inapp.institute-ids). Adds one
 * "Picture in picture" button to the actions bar:
 * - where the browser/WebView can do video PiP (web, Electron, iOS) it opens a
 *   floating window with the screen share and webcams (see pip.ts);
 * - inside the Android app, whose WebView has no video PiP, it asks the app to
 *   shrink into Android's own PiP window (the app listens for this message).
 * Works the same for a learner on a normal top-level tab.
 */
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import * as ReactDOM from "react-dom/client";
import {
  ActionsBarButton,
  ActionsBarPosition,
  BbbPluginSdk,
  type PluginApi,
} from "bigbluebutton-html-plugin-sdk";
import { CompositePip, videoPipSupported } from "./pip";

/** Nothing this plugin does may reach BBB: a failure only hides the button. */
class Contained extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[vacademy-pip] disabled after an error", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const isFramed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

/** Message the learner app's class view listens for (src/routes/study-library/live-class/classroom). */
const NATIVE_PIP_MESSAGE = "vacademy:bbb-pip";
/** Plugin asks / app answers whether the app can do PiP itself. */
const NATIVE_PIP_HELLO = "vacademy:bbb-pip-hello";
const NATIVE_PIP_REPLY = "vacademy:bbb-pip-native";

const lang = (navigator.language || "en").toLowerCase();
const TEXT = lang.startsWith("hi")
  ? { open: "पिक्चर-इन-पिक्चर", close: "पिक्चर-इन-पिक्चर बंद करें", empty: "अभी कोई वीडियो नहीं है" }
  : { open: "Picture in picture", close: "Close picture in picture", empty: "No video yet" };

/** Picture-in-picture glyph (outer screen + small inset window). */
const pipIcon = (active: boolean) => ({
  svgContent: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <rect x="12" y="11" width="7.5" height="6" rx="1" fill={active ? "currentColor" : "none"} />
    </svg>
  ),
});

function PipPlugin({ uuid, pluginName }: { uuid: string; pluginName: string }) {
  BbbPluginSdk.initialize(uuid);
  const pluginApi: PluginApi = BbbPluginSdk.getPluginApi(uuid, pluginName);
  const [active, setActive] = useState(false);
  const pipRef = useRef<CompositePip | null>(null);

  const canVideoPip = videoPipSupported();
  // Inside an app whose WebView has no video PiP (Android), the app itself does
  // PiP — but only if the app says so (an old app, or a browser like Firefox,
  // would leave a dead button).
  const [appCanPip, setAppCanPip] = useState(false);
  const canAskApp = !canVideoPip && isFramed && appCanPip;

  useEffect(() => {
    if (canVideoPip || !isFramed) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as { type?: string; available?: boolean } | null;
      if (data?.type === NATIVE_PIP_REPLY) setAppCanPip(!!data.available);
    };
    window.addEventListener("message", onMessage);
    // Ask a few times: the app may still be wiring its listener.
    let tries = 0;
    const ask = () => window.parent.postMessage({ type: NATIVE_PIP_HELLO }, "*");
    ask();
    const timer = window.setInterval(() => {
      tries += 1;
      if (tries > 5) window.clearInterval(timer);
      else ask();
    }, 2000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, [canVideoPip]);

  useEffect(() => {
    if (!canVideoPip && !canAskApp) {
      pluginApi.setActionsBarItems([]);
      return undefined;
    }
    if (!pipRef.current && canVideoPip) {
      pipRef.current = new CompositePip(TEXT.empty, setActive);
    }
    const onClick = () => {
      if (canAskApp) {
        window.parent.postMessage({ type: NATIVE_PIP_MESSAGE }, "*");
        return;
      }
      const pip = pipRef.current;
      if (!pip) return;
      if (pip.isActive()) {
        void pip.close();
      } else {
        pip.open().catch((error) => console.warn("[vacademy-pip] could not open", error));
      }
    };
    pluginApi.setActionsBarItems([
      new ActionsBarButton({
        icon: pipIcon(active),
        tooltip: active ? TEXT.close : TEXT.open,
        dataTest: "vacademyPipButton",
        position: ActionsBarPosition.RIGHT,
        onClick,
      }),
    ]);
    return undefined;
    // pluginApi is stable per uuid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, canVideoPip, canAskApp]);

  useEffect(
    () => () => {
      pipRef.current?.destroy();
      pipRef.current = null;
    },
    []
  );

  return null;
}

const uuid = document.currentScript?.getAttribute("uuid");
const pluginName = document.currentScript?.getAttribute("pluginName") || "VacademyPip";
if (uuid) {
  try {
    let mount = document.getElementById(uuid);
    if (!mount) {
      mount = document.createElement("div");
      mount.id = uuid;
      document.body.appendChild(mount);
    }
    ReactDOM.createRoot(mount).render(
      <Contained>
        <PipPlugin uuid={uuid} pluginName={pluginName} />
      </Contained>
    );
  } catch (error) {
    console.warn("[vacademy-pip] could not mount", error);
  }
}
