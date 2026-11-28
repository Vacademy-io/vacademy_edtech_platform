import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { CircleNotch, SignOut, WarningCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { registerBackGuard } from "@/lib/back-guard";
import {
  BBB_EXIT_MESSAGE,
  BBB_FRAME_ALLOW,
  BBB_PIP_HELLO,
  BBB_PIP_MESSAGE,
  BBB_PIP_REPLY,
  canHostClassInApp,
  takeClassroomJoin,
} from "@/lib/live-class/bbb-classroom";
import { fetchBbbJoin, openBbbExternally } from "@/lib/live-class/bbb-join";
import {
  VacademyLiveClass,
  enterNativeClass,
  enterNativePictureInPicture,
  exitNativeClass,
  nativePictureInPictureAvailable,
  prepareNativeClass,
} from "@/lib/live-class/native-live-class";

/**
 * In-app BBB class view (web, and the Android / iOS / desktop apps that carry
 * the native live-class support). The class runs in a full-screen frame under a
 * thin bar with "Leave". Learners get no "open in browser" option (owner
 * decision); picture-in-picture comes from the Vacademy PiP plugin inside the
 * class, or — on Android — from the app itself.
 *
 * No polling queries live here on purpose: one failed background refetch must
 * never replace a running class with an error card.
 */
export const Route = createFileRoute("/study-library/live-class/classroom/")({
  validateSearch: z.object({ scheduleId: z.string() }),
  component: ClassroomPage,
});

const LIST = "/study-library/live-class";

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string; title?: string }
  | { kind: "error" };

function ClassroomPage() {
  const { scheduleId } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useTranslation("study");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [inPip, setInPip] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Set before any navigation we start ourselves, so the blocker lets it through.
  const allowLeaveRef = useRef(false);

  const leaveTo = useCallback(
    (to: string) => {
      allowLeaveRef.current = true;
      navigate({ to: to as never });
    },
    [navigate]
  );

  // Get the join URL: handed over in memory by the join helper, or (after a
  // reload) fetched again. Native shells get mic/camera permission first, so
  // BBB's own requests inside the frame are already granted.
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    let joinUrl: string | undefined;
    let title: string | undefined;
    const handed = takeClassroomJoin(scheduleId);
    if (handed) {
      joinUrl = handed.joinUrl;
      title = handed.title;
    } else {
      try {
        const res = await fetchBbbJoin(scheduleId);
        joinUrl = res.data?.joinUrl;
        if (joinUrl && !(res.data?.openMode === "IN_APP" && canHostClassInApp())) {
          // Not an in-app class (or this device can't host one): today's behaviour.
          await openBbbExternally(joinUrl);
          leaveTo(LIST);
          return;
        }
      } catch {
        joinUrl = undefined;
      }
    }
    if (!joinUrl) {
      setState({ kind: "error" });
      return;
    }
    await prepareNativeClass();
    setState({ kind: "ready", url: joinUrl, title });
  }, [scheduleId, leaveTo]);

  useEffect(() => {
    void load();
  }, [load]);

  // Native class mode (screen on, audio when locked, auto-PiP) for as long as
  // the class is on screen.
  useEffect(() => {
    if (state.kind !== "ready") return;
    void enterNativeClass(state.title);
    return () => {
      void exitNativeClass();
    };
  }, [state]);

  // Android tells us when the app shrinks into its PiP window: show only the class.
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    let remove: (() => Promise<void>) | undefined;
    VacademyLiveClass.addListener("pictureInPictureChanged", (s) => setInPip(!!s?.active))
      .then((h) => {
        remove = h.remove;
      })
      .catch(() => undefined);
    return () => {
      void remove?.();
    };
  }, []);

  // Messages from inside the class frame:
  // - BBB's leave/ended page carries vxBbbExit=1; index.html there posts the exit;
  // - the Vacademy PiP plugin asks the app for PiP where the WebView can't do it.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; path?: string } | null;
      if (!data) return;
      if (data.type === BBB_PIP_HELLO) {
        // The PiP plugin asks whether the app can do PiP itself (Android only).
        (event.source as Window | null)?.postMessage(
          { type: BBB_PIP_REPLY, available: nativePictureInPictureAvailable() },
          "*"
        );
        return;
      }
      if (data.type === BBB_PIP_MESSAGE) {
        void enterNativePictureInPicture();
        return;
      }
      if (data.type !== BBB_EXIT_MESSAGE) return;
      const path =
        typeof data.path === "string" && data.path.startsWith(LIST) ? data.path : LIST;
      leaveTo(path);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [leaveTo]);

  const confirmLeave = useCallback(
    () => window.confirm(t("liveClass.classroom.leaveConfirm")),
    [t]
  );

  // Leaving by any in-app route (sidebar, browser back) asks first.
  useBlocker({
    shouldBlockFn: () => {
      if (allowLeaveRef.current || state.kind !== "ready") return false;
      return !confirmLeave();
    },
  });

  // Hardware back on Android: ask, then leave — never a silent history.back()
  // that would only step the class frame backwards.
  useEffect(
    () =>
      registerBackGuard(() => {
        if (confirmLeave()) leaveTo(LIST);
        return true;
      }),
    [confirmLeave, leaveTo]
  );

  // Closing or reloading the tab mid-class asks too.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowLeaveRef.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state.kind]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-900">
      {!inPip && (
        <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-neutral-700 bg-neutral-800 px-3 pt-safe">
          <p className="min-w-0 flex-1 truncate text-body font-semibold text-neutral-50">
            {state.kind === "ready" && state.title ? state.title : t("liveClass.classroom.title")}
          </p>
          <MyButton
            buttonType="primary"
            scale="small"
            layoutVariant="default"
            onClick={() => navigate({ to: LIST })}
          >
            <SignOut size={14} />
            {t("liveClass.classroom.leave")}
          </MyButton>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {state.kind === "ready" && (
          <iframe
            ref={frameRef}
            src={state.url}
            title={state.title || t("liveClass.classroom.title")}
            allow={BBB_FRAME_ALLOW}
            allowFullScreen
            onLoad={() => setFrameLoaded(true)}
            className="size-full border-0 bg-neutral-900"
          />
        )}

        {(state.kind === "loading" || (state.kind === "ready" && !frameLoaded)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900 p-6 text-center">
            <CircleNotch size={32} className="animate-spin text-primary-300" />
            <p className="text-body text-neutral-200">{t("liveClass.classroom.loading")}</p>
          </div>
        )}

        {state.kind === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900 p-6 text-center">
            <WarningCircle size={32} className="text-danger-400" />
            <p className="text-body text-neutral-200">{t("liveClass.classroom.error")}</p>
            <MyButton buttonType="primary" scale="medium" layoutVariant="default" onClick={() => void load()}>
              {t("liveClass.classroom.retry")}
            </MyButton>
          </div>
        )}
      </div>
    </div>
  );
}
