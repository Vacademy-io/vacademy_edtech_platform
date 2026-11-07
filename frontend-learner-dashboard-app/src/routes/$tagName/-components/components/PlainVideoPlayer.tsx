import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import "./plain-video-player.css";
import playerCss from "./plain-video-player.css?inline";

/**
 * Play/pause-only player for an UPLOADED video file (mp4/webm on our CDN).
 *
 * Why not `<video controls>`: the browser's native bar carries a download
 * button (Chrome's ⋮ menu), "Save video as…" on right-click, playback-rate,
 * picture-in-picture and remote playback — none of which a marketing site
 * wants on a client's classroom footage (Sreedhar's TTS gallery, 2026-09-18).
 * `controlsList="nodownload"` only works in Chromium, so the native UI is
 * dropped entirely: one big play/pause button, a passive progress line, and
 * the context menu suppressed. The file URL is still fetchable by anyone who
 * opens dev tools — this hides the affordance, it is not DRM.
 *
 * Used in two places: the typed `videoEmbed` block, and htmlPage markup via a
 * `<div data-vacademy="video" data-src="…">` placeholder (HtmlPageSection
 * portals the player into the shadow root). Styling therefore lives in
 * plain-video-player.css (classes + token variables), not Tailwind — utility
 * classes do not reach into a shadow root. PLAIN_VIDEO_PLAYER_CSS is that
 * sheet as a string for injection.
 */
export const PLAIN_VIDEO_PLAYER_CSS: string = playerCss;

export interface PlainVideoPlayerProps {
  src: string;
  poster?: string;
  /** Accessible name for the player; falls back to the generic "Video". */
  title?: string;
  /** Padding-bottom percentage box, e.g. "56.25%" for 16:9 — matches videoEmbed. */
  paddingBottom: string;
}

export const PlainVideoPlayer: React.FC<PlainVideoPlayerProps> = ({ src, poster, title, paddingBottom }) => {
  const { t } = useTranslation("coursePlayerA");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [hasStarted, setHasStarted] = useState(false);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      // play() rejects when the browser blocks it (no user gesture yet); the
      // `playing` state follows the element's own events, so nothing to do here.
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => { setPlaying(true); setHasStarted(true); };
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setProgress(0); setHasStarted(false); };
    const onTime = () => { if (v.duration > 0) setProgress(v.currentTime / v.duration); };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [src]);

  const label = playing ? t("jsonRenderer.pause") : t("jsonRenderer.play");
  const rootClass = ["pvp", playing ? "pvp--playing" : "", hasStarted ? "pvp--started" : ""].filter(Boolean).join(" ");

  return (
    <div
      className={rootClass}
      style={{ paddingBottom }} // design-lint-ignore: author-picked aspect ratio (page-builder value)
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster || undefined}
        preload="metadata"
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
        className="pvp__video"
        onClick={toggle}
        aria-label={title || t("jsonRenderer.video")}
      >
        {t("jsonRenderer.videoTagUnsupported")}
      </video>
      {/* soft scrim so the white button reads on a bright poster; fades once playing */}
      <div aria-hidden="true" className="pvp__scrim" />
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={playing}
        className={`pvp__btn ${playing ? "pvp__btn--pause" : "pvp__btn--play"}`}
      >
        {playing ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
      </button>
      <div aria-hidden="true" className="pvp__bar">
        <div className="pvp__fill" style={{ width: `${Math.round(progress * 1000) / 10}%` }} /> {/* design-lint-ignore: playback position */}
      </div>
    </div>
  );
};

export default PlainVideoPlayer;
