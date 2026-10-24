import { describe, expect, it } from "vitest";
import { extractYouTubeVideoId, isLiveYouTubeSession, isYouTubeUrl } from "./youtube";

describe("isLiveYouTubeSession", () => {
  const share = "https://youtu.be/qpIdoaaPa6U?si=Wr2xD54i31zJOZJS";

  it("declared youtube on a scheduled slot is live", () => {
    expect(isLiveYouTubeSession({ linkType: "youtube", link: share, hasSchedule: true })).toBe(true);
  });

  it("platform left on 'other' with a YouTube link is still a live class (prod session 377107b8)", () => {
    expect(isLiveYouTubeSession({ linkType: "other", link: share, hasSchedule: true })).toBe(true);
    expect(isLiveYouTubeSession({ linkType: "", link: share, hasSchedule: true })).toBe(true);
    expect(isLiveYouTubeSession({ linkType: undefined, link: share, hasSchedule: true })).toBe(true);
  });

  it("declared type is matched case-insensitively (the schedule row stores YOUTUBE)", () => {
    expect(isLiveYouTubeSession({ linkType: "YOUTUBE", link: null, hasSchedule: true })).toBe(true);
  });

  it("an explicit recording is never live, whatever the URL", () => {
    expect(isLiveYouTubeSession({ linkType: "youtube_recorded", link: share, hasSchedule: true })).toBe(false);
    expect(isLiveYouTubeSession({ linkType: "YOUTUBE_RECORDED", link: share, hasSchedule: true })).toBe(false);
  });

  it("a declared non-YouTube platform keeps its old (non-live) behaviour even with a YouTube link", () => {
    for (const declared of ["zoom", "google meet", "GOOGLE_MEET", "zoho", "ZOHO_MEETING", "bbb"]) {
      expect(isLiveYouTubeSession({ linkType: declared, link: share, hasSchedule: true })).toBe(false);
    }
  });

  it("'unknown' and whitespace-padded types count as unspecified", () => {
    expect(isLiveYouTubeSession({ linkType: "unknown", link: share, hasSchedule: true })).toBe(true);
    expect(isLiveYouTubeSession({ linkType: " Other ", link: share, hasSchedule: true })).toBe(true);
  });

  it("the default-class flow (no scheduled slot) is not live", () => {
    expect(isLiveYouTubeSession({ linkType: "youtube", link: share, hasSchedule: false })).toBe(false);
  });

  it("non-YouTube links typed 'other' stay non-live", () => {
    expect(isLiveYouTubeSession({ linkType: "other", link: "https://vimeo.com/123", hasSchedule: true })).toBe(false);
    expect(isLiveYouTubeSession({ linkType: "zoom", link: "https://zoom.us/j/1", hasSchedule: true })).toBe(false);
  });
});

describe("YouTube URL detection", () => {
  it("recognises share, watch, shorts and live forms", () => {
    for (const u of [
      "https://youtu.be/qpIdoaaPa6U?si=x",
      "https://www.youtube.com/watch?v=qpIdoaaPa6U&t=10",
      "https://www.youtube.com/shorts/qpIdoaaPa6U",
      "https://www.youtube.com/live/qpIdoaaPa6U",
    ]) {
      expect(extractYouTubeVideoId(u)).toBe("qpIdoaaPa6U");
      expect(isYouTubeUrl(u)).toBe(true);
    }
  });
});
