/**
 * YouTube URL helpers shared by the live-class embed players.
 *
 * Handles every common share form:
 *   https://www.youtube.com/watch?v=<id>            (plus extra query params)
 *   https://youtu.be/<id>?si=...                    (mobile/share links)
 *   https://www.youtube.com/shorts/<id>
 *   https://www.youtube.com/live/<id>
 *   https://www.youtube.com/embed/<id> , /v/<id>
 */
const YOUTUBE_ID_REGEX =
  /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|live\/|shorts\/))([a-zA-Z0-9_-]{11})/;

export const extractYouTubeVideoId = (
  url: string | null | undefined
): string | null => {
  if (!url) return null;
  const match = url.match(YOUTUBE_ID_REGEX);
  return match ? match[1] : null;
};

/**
 * True when the link is a playable YouTube URL. Used to embed YouTube links
 * even when the session's declared link_type is "other" — admins paste
 * youtu.be/shorts links with the platform dropdown left untouched, and
 * YouTube always iframes cleanly, so URL detection beats the declared type.
 */
export const isYouTubeUrl = (url: string | null | undefined): boolean =>
  extractYouTubeVideoId(url) !== null;

/**
 * True when a scheduled session should play its YouTube link as a LIVE class —
 * position pinned to the wall clock, held before the start and after the end —
 * rather than as a recording the learner may watch freely.
 *
 * The declared type alone is not enough: the same admin habit that leaves the
 * platform dropdown on "other" with a youtu.be link pasted in (a dozen prod
 * sessions in two months) produced classes the player embedded by URL but
 * never synced, so they resumed from a pause, played from 0:00 on a late join
 * and could be started over once the video ran out. So an UNSPECIFIED type
 * ("other", "unknown", empty) follows the URL, like the player choice does.
 * A declared platform that is not YouTube (zoom, google meet, zoho, bbb) is
 * left as it was — not live — even with a YouTube link, and an explicit
 * "youtube_recorded" always opts out. Declared types compare
 * case-insensitively: the schedule row stores "YOUTUBE".
 *
 * `hasSchedule` is false for the default-class flow (a plain videoUrl with no
 * scheduled slot), which has no start time to sync to.
 */
const UNSPECIFIED_LINK_TYPES = new Set(["", "other", "unknown"]);

export const isLiveYouTubeSession = ({
  linkType,
  link,
  hasSchedule,
}: {
  linkType: string | null | undefined;
  link: string | null | undefined;
  hasSchedule: boolean;
}): boolean => {
  if (!hasSchedule) return false;
  const declared = (linkType ?? "").toString().trim().toLowerCase();
  if (declared === "youtube") return true;
  if (!UNSPECIFIED_LINK_TYPES.has(declared)) return false;
  return isYouTubeUrl(link);
};
