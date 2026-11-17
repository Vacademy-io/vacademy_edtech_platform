import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowSquareOut, CircleNotch, SignOut, WarningCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import {
  BBB_EXIT_MESSAGE,
  BBB_FRAME_ALLOW,
  canHostClassInApp,
  preferExternalForAWeek,
  takeClassroomJoin,
} from "@/lib/live-class/bbb-classroom";
import { fetchBbbJoin, openBbbExternally } from "@/lib/live-class/bbb-join";

/**
 * In-app BBB class view (web pilot). The class runs in a full-screen frame with
 * a thin bar for "Open in browser" and "Leave". No polling queries live here on
 * purpose: one failed background refetch must never replace a running class
 * with an error card.
 */
export const Route = createFileRoute("/study-library/live-class/classroom/")({
  validateSearch: z.object({ scheduleId: z.string() }),
  component: ClassroomPage,
});

const LIST = "/study-library/live-class";
const SLOW_LOAD_MS = 25_000;

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string; title?: string }
  | { kind: "error" };

function ClassroomPage() {
  const { scheduleId } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Set before any navigation we start ourselves, so the blocker lets it through.
  const allowLeaveRef = useRef(false);

  const leaveTo = useCallback(
    (to: string) => {
      allowLeaveRef.current = true;
      navigate({ to });
    },
    [navigate]
  );

  // Get the join URL: handed over in memory by the join helper, or (after a
  // reload) fetched again. If the class can't be shown here, open it outside.
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const handed = takeClassroomJoin(scheduleId);
    if (handed) {
      setState({ kind: "ready", url: handed.joinUrl, title: handed.title });
      return;
    }
    try {
      const res = await fetchBbbJoin(scheduleId);
      const url: string | undefined = res.data?.joinUrl;
      if (!url) {
        setState({ kind: "error" });
        return;
      }
      if (res.data?.openMode === "IN_APP" && canHostClassInApp()) {
        setState({ kind: "ready", url });
      } else {
        await openBbbExternally(url);
        leaveTo(LIST);
      }
    } catch {
      setState({ kind: "error" });
    }
  }, [scheduleId, leaveTo]);

  useEffect(() => {
    void load();
  }, [load]);

  // A slow first load (the class app is large on mobile data) offers the
  // browser instead of leaving the learner staring at a spinner.
  useEffect(() => {
    if (state.kind !== "ready" || frameLoaded) return;
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [state, frameLoaded]);

  // BBB's leave/ended page carries vxBbbExit=1; index.html inside the frame
  // posts this message instead of loading the whole portal in the frame.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; path?: string } | null;
      if (!data || data.type !== BBB_EXIT_MESSAGE) return;
      const path =
        typeof data.path === "string" && data.path.startsWith(LIST) ? data.path : LIST;
      allowLeaveRef.current = true;
      navigate({ to: path as never });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  // Leaving by any in-app route (sidebar, back button) asks first.
  useBlocker({
    shouldBlockFn: () => {
      if (allowLeaveRef.current || state.kind !== "ready") return false;
      return !window.confirm(t("liveClass.classroom.leaveConfirm"));
    },
  });

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

  const openInBrowser = () => {
    if (state.kind !== "ready") return;
    // Open synchronously inside the tap so popup blockers allow it, then drop
    // the frame so the learner isn't in the class twice.
    window.open(state.url, "_blank", "noopener,noreferrer");
    preferExternalForAWeek();
    leaveTo(LIST);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-900">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-700 bg-neutral-800 px-3">
        <p className="min-w-0 flex-1 truncate text-body font-semibold text-neutral-50">
          {state.kind === "ready" && state.title ? state.title : t("liveClass.classroom.title")}
        </p>
        {state.kind === "ready" && (
          <MyButton
            buttonType="secondary"
            scale="small"
            layoutVariant="default"
            onClick={openInBrowser}
          >
            <ArrowSquareOut size={14} />
            <span className="hidden xs:inline">{t("liveClass.classroom.openInBrowser")}</span>
          </MyButton>
        )}
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
            {slow && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-caption text-neutral-400">{t("liveClass.classroom.slow")}</p>
                <MyButton buttonType="secondary" scale="small" layoutVariant="default" onClick={openInBrowser}>
                  <ArrowSquareOut size={14} />
                  {t("liveClass.classroom.openInBrowser")}
                </MyButton>
              </div>
            )}
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
