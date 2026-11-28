import { MyButton } from "@/components/design-system/button";
import { useTranslation } from "react-i18next";

/**
 * The institute's disclaimer, shown before a learner joins a class they have not
 * attended yet. Purely presentational — the caller decides when it appears and
 * what happens on continue.
 *
 * It sits BEFORE the join, not on the class screen, because joining marks the
 * learner present; anything shown afterwards could no longer tell a newcomer
 * from a returning learner.
 */
export const DisclaimerVideoScreen = ({
  videoUrl,
  onContinue,
}: {
  videoUrl: string;
  onContinue: () => void;
}) => {
  const { t } = useTranslation("study");
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-3xl">
        <h2 className="text-title font-semibold text-neutral-700">
          {t("liveClass.disclaimer.title")}
        </h2>
        <p className="mt-1 text-body text-neutral-500">
          {t("liveClass.disclaimer.description")}
        </p>

        <div className="mt-4 aspect-video w-full overflow-hidden rounded-xl bg-neutral-900">
          <iframe
            src={toEmbedUrl(videoUrl)}
            title={t("liveClass.disclaimer.iframeTitle")}
            className="size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            onLoad={suppressCaptions}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <MyButton buttonType="primary" onClick={onContinue}>
            {t("liveClass.disclaimer.continue")}
          </MyButton>
        </div>
      </div>
    </div>
  );
};

/**
 * YouTube watch/short links do not render inside an iframe; only /embed/ does.
 * Anything else is passed through untouched so a direct MP4 or an already-embed
 * URL still works.
 *
 * enablejsapi=1 is what lets {@link suppressCaptions} talk to the player. There is
 * no query parameter that turns subtitles off — cc_load_policy only accepts 1,
 * meaning "force them ON" — so the only lever is the JS API.
 */
const toEmbedUrl = (url: string): string => {
  const trimmed = url.trim();
  const yt =
    /(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(
      trimmed
    );
  return yt?.[1]
    ? `https://www.youtube.com/embed/${yt[1]}?enablejsapi=1`
    : trimmed;
};

/**
 * Turn subtitles off on the embedded disclaimer.
 *
 * YouTube's default is to follow the VIEWER's own preference — a Google account
 * set to "always show captions", or an OS-level subtitle toggle — which is why
 * the same disclaimer plays clean for most learners and captioned for one.
 *
 * Driven by postMessage because this is a plain iframe rather than the JS-API
 * player wrapper, and that brings two requirements the first attempt missed:
 *
 *  1. A {"event":"listening"} handshake must be sent first. Until the embed has
 *     been addressed it ignores commands outright, so posting at iframe onLoad —
 *     when the player inside has not finished initialising — was simply dropped.
 *  2. It has to be repeated. The captions module is usually loaded when playback
 *     starts, well after load, so a single early command has nothing to unload.
 *
 * Hence a short repeating burst rather than one shot. setOption("track", {})
 * selects "no track" and is what sticks once the module is already loaded;
 * unloadModule covers players that expose the module under either name.
 *
 * Entirely best-effort: every failure is ignored, and the interval always clears
 * itself. A learner seeing subtitles is a blemish — never a reason to block the
 * class behind it.
 */
const CAPTION_SUPPRESS_ATTEMPTS = 12; // ~6s at 500ms — covers load + first play
const CAPTION_SUPPRESS_INTERVAL_MS = 500;

const suppressCaptions = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
  const win = e.currentTarget.contentWindow;
  if (!win) return;
  const post = (payload: Record<string, unknown>) => {
    try {
      win.postMessage(JSON.stringify(payload), "https://www.youtube.com");
    } catch {
      /* iframe gone or cross-origin refused — nothing to do */
    }
  };
  post({ event: "listening" });
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    for (const moduleName of ["captions", "cc"]) {
      post({ event: "command", func: "unloadModule", args: [moduleName] });
      post({ event: "command", func: "setOption", args: [moduleName, "track", {}] });
    }
    if (attempts >= CAPTION_SUPPRESS_ATTEMPTS) window.clearInterval(timer);
  }, CAPTION_SUPPRESS_INTERVAL_MS);
};
