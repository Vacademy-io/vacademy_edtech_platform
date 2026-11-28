// YouTube video id for the video slide player (and course intro media).
// Handles watch?v= (extra params in any order), youtu.be/, /shorts/, /live/,
// /embed/, /v/ and youtube-nocookie.com/embed/ — the old inline regex knew only
// watch/youtu.be/embed and returned "" for Shorts and /live/ links.
// Kept separate from "@/utils/youtube": that one drives live-class YouTube
// detection, where widening the match would change which sessions sync live.
const YOUTUBE_ID_REGEX =
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

export const extractVideoId = (url: string | null | undefined): string =>
    (url && url.match(YOUTUBE_ID_REGEX)?.[1]) || "";
