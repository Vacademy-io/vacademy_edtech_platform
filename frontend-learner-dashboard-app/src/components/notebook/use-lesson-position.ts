import { useCallback } from "react";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";

export type LessonPosition = { page_index?: number; time_ms?: number };

/** Where the learner is in the open lesson: a PDF page or a video moment. */
export function readLessonPosition(): LessonPosition {
  const { activeItem } = useContentStore.getState();
  const media = useMediaRefsStore.getState();
  if (activeItem?.source_type === "DOCUMENT" && activeItem.document_slide?.type === "PDF") {
    return { page_index: media.currentPdfPage };
  }
  if (activeItem?.source_type === "VIDEO") {
    const seconds =
      activeItem.video_slide?.source_type === "FILE_ID"
        ? media.currentUploadedVideoTime
        : media.currentYoutubeTime;
    return { time_ms: Math.floor((seconds || 0) * 1000) };
  }
  return {};
}

/** Moves the open lesson to a saved page or moment. */
export function useJumpToNote() {
  const setActiveItem = useContentStore((state) => state.setActiveItem);
  const navigateToPdfPage = useMediaRefsStore((state) => state.navigateToPdfPage);
  return useCallback(
    (position: LessonPosition) => {
      if (position.page_index !== undefined && position.page_index !== null) {
        navigateToPdfPage(position.page_index);
        return;
      }
      const { activeItem } = useContentStore.getState();
      if (position.time_ms !== undefined && position.time_ms !== null && activeItem) {
        setActiveItem({
          ...activeItem,
          new_slide: false,
          percentage_completed: 0,
          progress_marker: position.time_ms,
        });
      }
    },
    [navigateToPdfPage, setActiveItem],
  );
}
