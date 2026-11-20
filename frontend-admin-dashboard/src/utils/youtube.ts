/**
 * YouTube video id from any common link form:
 *   https://www.youtube.com/watch?v=<id>   (extra query params in any order)
 *   https://youtu.be/<id>?si=...           (mobile/share links)
 *   https://www.youtube.com/shorts/<id>
 *   https://www.youtube.com/live/<id>
 *   https://www.youtube.com/embed/<id> , /v/<id> , youtube-nocookie.com/embed/<id>
 *
 * The older inline regex knew only watch/youtu.be/embed, so a Shorts link
 * passed the "contains youtube.com" check but yielded no id — the video slide
 * dialog then refused it as an invalid URL.
 *
 * Returns null when the link is not a YouTube video link.
 */
const YOUTUBE_ID_REGEX =
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

export const extractYouTubeVideoId = (url: string | null | undefined): string | null => {
    if (!url) return null;
    return url.match(YOUTUBE_ID_REGEX)?.[1] ?? null;
};
