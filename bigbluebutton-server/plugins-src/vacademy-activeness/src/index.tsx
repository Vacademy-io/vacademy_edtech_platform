/**
 * Vacademy activeness score — BBB HTML5 plugin entry.
 *
 * Loaded only for classes whose session has `activeness_score` on (admin_core
 * adds this manifest to the create call). It shows itself only to learners whose
 * join URL carries a signed token (`userdata-vacademy_activeness`): never to
 * moderators or guests, and never on phones/tablets.
 */
import * as React from "react";
import { useEffect, useRef } from "react";
import * as ReactDOM from "react-dom/client";
import { BbbPluginSdk, FloatingWindow, type PluginApi } from "bigbluebutton-html-plugin-sdk";
import { ActivenessController } from "./controller";
import { sendStatus } from "./report";
import { isDesktop } from "./camera";
import { Panel } from "./Panel";

/**
 * Nothing this plugin does may reach BBB: an uncaught error here is caught by the
 * client's global handler, which can offer the learner a reload mid-class. A
 * failure only hides the score.
 */
class Contained extends React.Component<{ children: React.ReactNode; onError?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[activeness] disabled after an error", error);
    try {
      // With the panel gone the learner could not turn the camera off: stop it.
      this.props.onError?.();
    } catch {
      // Nothing more to do.
    }
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface MetadataRow {
  parameter: string;
  value: string;
}
interface MetadataResult {
  user_metadata: MetadataRow[];
}

// The root `user_metadata` list (this user's join `userdata-*` params, filtered by
// session server-side). Not `user_current.userMetadata`: that one is an OBJECT
// relationship in BBB's schema and returns a single row, not a list.
const METADATA_SUBSCRIPTION = `subscription VacademyActivenessMetadata {
  user_metadata {
    parameter
    value
  }
}`;

const readParam = (rows: unknown, name: string): string | null => {
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r: MetadataRow | null) => r && r.parameter === name) as MetadataRow | undefined;
  return typeof row?.value === "string" ? row.value : null;
};

const TOKEN_PARAM = "vacademy_activeness";
const URL_PARAM = "vacademy_activeness_url";
/** Panel position: bottom-left, clear of BBB's action bar. */
const PANEL_LEFT = 16;
const PANEL_BOTTOM_GAP = 460;

function ActivenessPlugin({ uuid, pluginName }: { uuid: string; pluginName: string }) {
  BbbPluginSdk.initialize(uuid);
  const pluginApi: PluginApi = BbbPluginSdk.getPluginApi(uuid, pluginName);

  const currentUser = pluginApi.useCurrentUser?.();
  const metadata = pluginApi.useCustomSubscription?.<MetadataResult>(METADATA_SUBSCRIPTION);
  const shouldUnmount = pluginApi.useShouldUnmountPlugin?.() ?? false;

  const rows = metadata?.data?.user_metadata;
  const token = readParam(rows, TOKEN_PARAM);
  const reportUrl = readParam(rows, URL_PARAM);
  const role = currentUser?.data?.role;

  // Latched: once a learner qualifies, a transient blip — the window snapped to
  // half the screen, a GraphQL reconnect briefly returning no data — must not stop
  // the camera and reload the face model. Only the meeting ending, or a real role
  // change to moderator, turns it off.
  const identity = useRef<{ token: string; reportUrl: string } | null>(null);
  if (!identity.current && token && reportUrl && /^https:\/\//.test(reportUrl) && role === "VIEWER" && isDesktop()) {
    identity.current = { token, reportUrl };
  }
  const eligible = !shouldUnmount && role !== "MODERATOR" && identity.current !== null;
  const latched = identity.current;

  // Phones and tablets are not measured (camera conflicts with BBB's own webcam on
  // iOS, battery, a phone-sized panel). Say so once, so the admin sees
  // "Phone — not measured" rather than a blank next to this learner.
  const phoneReported = useRef(false);
  if (
    !phoneReported.current &&
    !identity.current &&
    !shouldUnmount &&
    token &&
    reportUrl &&
    /^https:\/\//.test(reportUrl) &&
    role === "VIEWER" &&
    !isDesktop()
  ) {
    phoneReported.current = true;
    sendStatus(reportUrl, token, "unsupported_device");
  }

  const controllerRef = useRef<ActivenessController | null>(null);

  useEffect(() => {
    if (!eligible || !latched) return undefined;
    let controller: ActivenessController;
    try {
      controller = new ActivenessController(latched.token, latched.reportUrl);
    } catch (error) {
      console.warn("[activeness] could not start", error);
      return undefined;
    }
    controllerRef.current = controller;
    const stub = { render() {}, unmount() {} } as unknown as ReactDOM.Root;
    try {
      pluginApi.setFloatingWindows([
      new FloatingWindow({
        top: Math.max(72, window.innerHeight - PANEL_BOTTOM_GAP),
        left: PANEL_LEFT,
        movable: true,
        backgroundColor: "#ffffff",
        boxShadow: "0 8px 24px rgba(17,24,39,0.18)",
        dataTest: "vacademy-activeness",
        contentFunction: (element: HTMLElement) => {
          // Runs inside BBB's own React tree: nothing may throw out of here.
          try {
            const root = ReactDOM.createRoot(element);
            root.render(
              <Contained onError={controller.dispose}>
                <Panel controller={controller} />
              </Contained>
            );
            return root;
          } catch (error) {
            console.warn("[activeness] panel failed", error);
            controller.dispose();
            return stub;
          }
        },
      }),
      ]);
    } catch (error) {
      console.warn("[activeness] floating window failed", error);
      controller.dispose();
      controllerRef.current = null;
      return undefined;
    }
    return () => {
      // Camera off first, whatever happens to the window removal after.
      controller.dispose();
      controllerRef.current = null;
      try {
        pluginApi.setFloatingWindows([]);
      } catch {
        // BBB is tearing the plugin down anyway.
      }
    };
    // pluginApi is a stable per-uuid object; re-run only when eligibility or identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, latched]);

  return null;
}

const uuid = document.currentScript?.getAttribute("uuid");
const pluginName = document.currentScript?.getAttribute("pluginName") || "VacademyActiveness";
// Only ever run as a BBB plugin: without BBB's uuid there is no plugin API to talk to.
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
        <ActivenessPlugin uuid={uuid} pluginName={pluginName} />
      </Contained>
    );
  } catch (error) {
    console.warn("[activeness] could not mount", error);
  }
}
