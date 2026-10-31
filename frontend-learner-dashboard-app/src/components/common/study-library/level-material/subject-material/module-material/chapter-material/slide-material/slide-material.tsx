import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  MarkCompleteButton,
  MANUALLY_COMPLETABLE_SLIDE_TYPES,
  type CompletionContext,
} from "./mark-complete-button";
import PDFViewer from "./pdf-viewer";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { usePresenceHeartbeat } from "@/hooks/study-library/usePresenceHeartbeat";
import { EmptySlideMaterial } from "@/assets/svgs";
import YouTubePlayerWrapper from "./youtube-player";
import VimeoPlayerWrapper from "./vimeo-player";
import { useFileUpload } from "@/hooks/use-file-upload";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { extractVideoId } from "@/utils/study-library/tracking/extractVideoId";
import {
  resolveVideoSourceType,
  extractVimeoId,
} from "@/utils/study-library/video-source-type";
// Removed SidebarTrigger and useSidebar - using doubt sidebar store instead
import { ChatText, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { DoubtResolutionSidebar } from "./doubt-resolution-sidebar/components/sidebar";
import CustomVideoPlayer from "./custom-video-player";
import QuestionSlide from "./question-slide";
import AssignmentSlide from "./assignment-slide";
import { isItemLocked } from "@/components/drip-conditions/helpers";

import { MyButton } from "@/components/design-system/button";
import { DocViewer } from "./doc-viewer";
import { SlideDownloadTypeKey } from "@/constants/slide-download-permission";
import { SlideDownloadButton, SlideImagesDownloadButton } from "./slide-download-button";
import PresentationViewer from "./presentation-viewer";
import DeckPlayer from "./deck-player";
import { CodeEditorSlide } from "./code-editor-slide";
import { JupyterNotebookSlide } from "./jupyter-notebook-slide";
import { ScratchProjectSlide } from "./scratch-project-slide";
import { SplitScreenVideoSlide } from "./split-screen-video-slide";
import { useDoubtSidebarStore } from "@/stores/study-library/doubt-sidebar-store";
import QuizViewer from "./quiz-viewer";
import { Slide, AIVideoData } from "@/hooks/study-library/use-slides";
import { SlideProtectionGuard } from "./SlideProtectionGuard";
import { AIVideoPlayer } from "@/components/ai-video-player";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { ConcentrationSettings } from "@/types/student-display-settings";
import { fetchHtmlVideoUrls } from "@/utils/htmlVideoService";
import AudioPlayer from "./audio-player";
import ScormSlideComponent from "./scorm-slide";
import { SplitScreenHtmlVideoSlide } from "./split-screen-html-video-slide";
import AssessmentSlideViewer from "./assessment-slide-viewer";
import { RequiresInternetSlide } from "./offline/requires-internet-slide";
import { LeaseLockOverlay } from "./offline/lease-lock-overlay";
import { isOnlineOnlySlide } from "@/lib/offline/online-only";
import { Network } from "@/utils/network-plugin";
import { resolveSlideSource, getOfflineLockReason } from "@/lib/offline/resolve";
import { getUserId } from "@/constants/getUserId";
import { SelectionAsk } from "@/components/chatbot/moments/SelectionAskPill";
import { VideoStuckChip } from "@/components/chatbot/moments/VideoStuckChip";
import { useVideoStuckMoment } from "@/components/chatbot/moments/use-video-stuck-moment";
import { useAvailableTutor } from "@/components/chatbot/moments/tutor-moments";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";

/**
 * Where a citation deep link (?page / ?t on the slides route) asks a slide to
 * open: a PDF page (1-based) or a video / audio second. Only honoured for the
 * slide it names.
 */
export interface SlideStartAt {
  slideId: string;
  page?: number;
  t?: number;
}

const slideStartKey = (start: SlideStartAt) =>
  `${start.slideId}|${start.page ?? ""}|${start.t ?? ""}`;

/**
 * A cited second as a player start in ms, kept a second short of the known
 * length so a stale citation cannot land on the end (and mark it watched).
 */
const clampStartMs = (seconds: number, lengthMs?: number | null): number => {
  const ms = Math.round(seconds * 1000);
  return lengthMs && lengthMs > 1000 ? Math.min(ms, lengthMs - 1000) : ms;
};

// The seek surface the video players expose through their ref. Vimeo answers
// getDuration with a promise; the HTML5 player answers NaN until metadata.
type SeekableMedia = {
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  getDuration?: () => number | Promise<number>;
};
const SEEK_READY_POLL_MS = 250;
const SEEK_READY_MAX_ATTEMPTS = 80; // ~20 s for the media to become seekable

export const SlideMaterial = ({
  onNavigateToSlide,
  standaloneNav = false,
  onPastLastSlide,
  onBeforeFirstSlide,
  manualCompletion = false,
  completionContext,
  startAt,
  onStartAtApplied,
}: {
  // Optional: lets the host route mirror the active slide into the URL so the
  // course-tree sidebar (which highlights by URL slideId) and a browser
  // refresh stay in sync with Prev/Next. Falls back to store-only when absent.
  onNavigateToSlide?: (slideId: string) => void;
  // Prev/Next is the ONLY way through the course (the viewer's sidebar is
  // turned off in Student Display Settings). The header nav then has to show
  // at every breakpoint — on mobile there is no offcanvas slide list to fall
  // back on, so hiding it below `sm` would strand the learner on one slide.
  standaloneNav?: boolean;
  // Chapter-boundary escapes for standalone nav. `items` only ever holds the
  // current chapter's slides, so without these the learner hits the last slide
  // of a chapter and stops. Only wired when there is a chapter to move to.
  onPastLastSlide?: (() => void) | undefined;
  onBeforeFirstSlide?: (() => void) | undefined;
  // Explicit "Mark as complete" beside Prev/Next. Opt-in per institute; the
  // automatic tracking underneath it is unchanged either way.
  manualCompletion?: boolean;
  // Parent ids the completion write needs so the backend can roll the change
  // up into chapter / module / subject / course progress.
  completionContext?: CompletionContext | undefined;
  // Citation deep link from the URL. Applied once when its slide is on screen
  // (on load, or straight away when that slide is already showing), after
  // which onStartAtApplied lets the host drop the params from the URL.
  startAt?: SlideStartAt | undefined;
  onStartAtApplied?: (() => void) | undefined;
}) => {
  const { t, i18n } = useTranslation("studyContent");
  const { activeItem, items, setActiveItem, slideEvaluations } =
    useContentStore();
  // Course Pulse presence: keep the learner "present" on the open slide (incl. paused
  // video/audio) while the tab is visible; stops on leave so they go offline naturally.
  usePresenceHeartbeat(activeItem?.id);
  const selectionRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const [heading, setHeading] = useState(activeItem?.title || "");
  const [content, setContent] = useState<JSX.Element | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { uploadFile, getPublicUrl } = useFileUpload();

  // Cleanup seam for offline video streaming (plan §B4/§C): holds the
  // resolver's `release()` (native `OfflineMedia.closeAsset`) for whichever
  // offline video stream is currently open, so it's always closed before the
  // next slide's content replaces it and on unmount.
  const offlineStreamReleaseRef = useRef<(() => void) | null>(null);
  const releaseOfflineStream = () => {
    offlineStreamReleaseRef.current?.();
    offlineStreamReleaseRef.current = null;
  };
  useEffect(() => releaseOfflineStream, []);

  // Offline-aware URL resolution (plan §B4): online → identical to
  // getPublicUrl(fileId); offline with a downloaded copy → decrypted blob
  // URL. Falls back to the plain remote URL if the learner isn't
  // logged in yet or offline resolution fails for any reason, so this can
  // never regress the existing online behaviour.
  const resolvePlaybackUrl = async (
    fileId: string,
    slideId: string,
    mimeType: string,
    /**
     * Stream from the local responder rather than decrypting into a Blob.
     * Required for anything big: the Blob path needs ~4-5x the file size in
     * transient memory, so a 51 MB PDF failed to load offline even though it
     * had downloaded fine.
     */
    stream = false
  ): Promise<string> => {
    try {
      const userId = await getUserId();
      if (!userId) return getPublicUrl(fileId);
      const result = await resolveSlideSource({
        userId,
        fileId,
        slideId,
        mimeType,
        stream,
        resolveRemoteUrl: () => getPublicUrl(fileId),
      });
      // Streamed sources hold a native decrypt session open; hand its closer to
      // the ref the slide lifecycle already drains on every slide change.
      if (result.kind === "offline-stream") {
        offlineStreamReleaseRef.current = result.release ?? null;
      }
      return result.url ?? "";
    } catch {
      return getPublicUrl(fileId);
    }
  };

  // Settings state
  const [concentrationSettings, setConcentrationSettings] = useState<ConcentrationSettings | undefined>(undefined);

  // Fetch settings
  useEffect(() => {
    getStudentDisplaySettings()
      .then((settings) => {
        if (settings?.concentration) {
          setConcentrationSettings(settings.concentration);
        }
      })
      .catch((err) => console.error("Failed to load display settings for concentration:", err));
  }, []);

  const playerRef = useRef<HTMLVideoElement | null>(null);

  // Slide navigation helpers
  const slidesList = Array.isArray(items) ? items : [];
  const currentIndex = slidesList.findIndex((s) => s.id === activeItem?.id);
  // The route appends a synthetic "Give Feedback" slide (source_type ===
  // "FEEDBACK") to items. Hide it from the user-visible counter so a chapter
  // with N real slides shows N, not N+1.
  const realSlides = slidesList.filter((s) => s.source_type !== "FEEDBACK");
  const realIndex = realSlides.findIndex((s) => s.id === activeItem?.id);

  // Check if prev/next slides are locked
  const prevSlide = currentIndex > 0 ? slidesList[currentIndex - 1] : null;
  const nextSlide =
    currentIndex > -1 && currentIndex < slidesList.length - 1
      ? slidesList[currentIndex + 1]
      : null;

  const isPrevLocked = prevSlide
    ? slideEvaluations[prevSlide.id] &&
    isItemLocked(slideEvaluations[prevSlide.id])
    : false;
  const isNextLocked = nextSlide
    ? slideEvaluations[nextSlide.id] &&
    isItemLocked(slideEvaluations[nextSlide.id])
    : false;

  const canStepPrev = currentIndex > 0 && !isPrevLocked;
  const canStepNext =
    currentIndex > -1 && currentIndex < slidesList.length - 1 && !isNextLocked;

  // At a chapter edge the buttons stay live only if the host handed us a
  // neighbouring chapter to jump to. A locked next slide is a drip lock, not
  // an edge — it must stay disabled rather than skipping the chapter.
  const atLastSlide =
    currentIndex > -1 && currentIndex === slidesList.length - 1;
  const canOverflowNext = atLastSlide && !!onPastLastSlide;
  const canOverflowPrev = currentIndex === 0 && !!onBeforeFirstSlide;

  const canGoPrev = canStepPrev || canOverflowPrev;
  const canGoNext = canStepNext || canOverflowNext;

  const goToPrev = () => {
    if (canStepPrev) {
      const target = slidesList[currentIndex - 1];
      setActiveItem(target); // instant content update
      onNavigateToSlide?.(target.id); // keep URL + sidebar highlight in sync
      return;
    }
    if (canOverflowPrev) onBeforeFirstSlide?.();
  };

  const goToNext = () => {
    if (canStepNext) {
      const target = slidesList[currentIndex + 1];
      setActiveItem(target); // instant content update
      onNavigateToSlide?.(target.id); // keep URL + sidebar highlight in sync
      return;
    }
    if (canOverflowNext) onPastLastSlide?.();
  };

  // Tutor moments: select-to-ask on text documents, and a "Stuck at 03:12?"
  // offer when the learner keeps rewinding to the same part of a video.
  const momentTutor = useAvailableTutor();
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // ── Citation deep links ─────────────────────────────────────────────────
  // A start is "pending" until it has been applied once. The URL keeps the
  // params until the host clears them, so the consumed key stops a second
  // application meanwhile; once the URL is clean the key resets, letting the
  // same citation be followed again later.
  const startAtKey = startAt ? slideStartKey(startAt) : null;
  const consumedStartKeyRef = useRef<string | null>(null);
  if (!startAtKey) consumedStartKeyRef.current = null;
  const pendingStartRef = useRef<SlideStartAt | null>(null);
  pendingStartRef.current =
    startAt && startAtKey !== consumedStartKeyRef.current ? startAt : null;
  // The start the current slide's content was built with; a language rebuild
  // of the same slide keeps it, any other slide drops it.
  const appliedStartRef = useRef<SlideStartAt | null>(null);
  const onStartAtAppliedRef = useRef(onStartAtApplied);
  onStartAtAppliedRef.current = onStartAtApplied;
  const activeSlideIdRef = useRef(activeItem?.id);
  activeSlideIdRef.current = activeItem?.id;

  const consumeStart = (start: SlideStartAt) => {
    consumedStartKeyRef.current = slideStartKey(start);
    pendingStartRef.current = null;
    appliedStartRef.current = start;
    onStartAtAppliedRef.current?.();
  };

  /** The start to build `slideId`'s content with, consuming a pending one. */
  const takeStartFor = (slideId: string): SlideStartAt | null => {
    const pending = pendingStartRef.current;
    if (pending && pending.slideId === slideId) {
      consumeStart(pending);
      return pending;
    }
    if (appliedStartRef.current?.slideId !== slideId) {
      appliedStartRef.current = null;
    }
    return appliedStartRef.current;
  };

  /**
   * Seeks a player that has no start prop (uploaded video, audio) once it
   * knows its length, clamped a second short of the end. The first check is
   * deferred a beat so the previous slide's player has unmounted from the
   * shared ref; it gives up when the learner leaves the slide.
   */
  const seekWhenReady = (
    slideId: string,
    seconds: number,
    kind: "VIDEO" | "AUDIO"
  ) => {
    let attempts = 0;
    const tick = async () => {
      if (activeSlideIdRef.current !== slideId) return;
      if (attempts++ >= SEEK_READY_MAX_ATTEMPTS) return;
      if (kind === "AUDIO") {
        const audio = contentAreaRef.current?.querySelector("audio");
        if (
          audio &&
          audio.readyState >= 1 &&
          Number.isFinite(audio.duration) &&
          audio.duration > 0
        ) {
          audio.currentTime = Math.min(seconds, Math.max(0, audio.duration - 1));
          return;
        }
      } else {
        const player = playerRef.current as unknown as SeekableMedia | null;
        let duration = 0;
        try {
          duration = Number(await player?.getDuration?.()) || 0;
        } catch {
          duration = 0;
        }
        if (activeSlideIdRef.current !== slideId) return;
        if (player?.seekTo && Number.isFinite(duration) && duration > 0) {
          player.seekTo(Math.min(seconds, Math.max(0, duration - 1)), true);
          return;
        }
      }
      setTimeout(tick, SEEK_READY_POLL_MS);
    };
    setTimeout(tick, SEEK_READY_POLL_MS);
  };
  const isTextDocument =
    activeItem?.source_type === "DOCUMENT" &&
    (activeItem.document_slide?.type === "PDF" ||
      activeItem.document_slide?.type === "DOC" ||
      // Creative HTML renders in a sandboxed frame that reports its selection.
      activeItem.document_slide?.type === "HTML");
  const videoMoment = useVideoStuckMoment(
    ["VIDEO", "HTML_VIDEO", "AI_VIDEO"].includes(activeItem?.source_type?.toUpperCase() ?? "")
      ? activeItem?.id
      : null,
    !!momentTutor
  );

  // Video time update handler. Questions are handled inside each player; the
  // time only feeds the stuck-moment detector (its `track` is stable, so the
  // copy baked into the player JSX at load time stays current).
  const handleVideoTimeUpdate = (currentTime?: number) => {
    videoMoment.track(currentTime);
  };

  const handleQuestionSubmit = async (selectedOption: string | string[]) => {
    const optionToSubmit = Array.isArray(selectedOption)
      ? selectedOption[0]
      : selectedOption;

    // Questions are now handled internally by the YouTube player
    // This function is kept for other question types (e.g., QuestionSlide)
    return {
      success: true,
      isCorrect: true,
      correctOption: optionToSubmit,
      explanation: "Correct answer!",
    };
  };

  const handleAssignmentUpload = async (file: File) => {
    try {
      setIsUploading(true);
      const fileId = await uploadFile({
        file,
        setIsUploading,
        userId: "your-user-id",
        source: "ASSIGNMENT",
        sourceId: activeItem?.source_id || "",
        publicUrl: true,
      });
      if (fileId) {
        console.log(`Assignment uploaded: ${fileId}`);
        return { success: true, fileId };
      }
      return { success: false, error: "Upload failed" };
    } catch (error) {
      console.error("Assignment upload error:", error);
      return { success: false, error: "Upload failed" };
    } finally {
      setIsUploading(false);
    }
  };

  const loadContent = async (generationId: number) => {
    if (generationId !== loadGenerationRef.current) return;
    // Captured before any await: the citation start this slide opens at.
    const start =
      activeItem && appliedStartRef.current?.slideId === activeItem.id
        ? appliedStartRef.current
        : null;
    setError(null);
    setIsLoading(true);

    if (!activeItem) {
      if (generationId !== loadGenerationRef.current) return;
      // Add slight delay for smooth transition
      await new Promise((resolve) => setTimeout(resolve, 200));
      setContent(
        <div className="flex h-reg-500 flex-col items-center justify-center rounded-lg py-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="relative group">
            <div className="bg-neutral-50 rounded-full p-6 transition-transform duration-300 group-hover:scale-105">
              <EmptySlideMaterial />
            </div>
          </div>
          <p className="mt-6 text-neutral-500 animate-in fade-in duration-700 delay-200 text-center">
            No study material has been added yet
          </p>
        </div>
      );
      setIsLoading(false);
      return;
    }

    if (generationId !== loadGenerationRef.current) return;
    setContent(<DashboardLoader />);
    // Leaving whatever slide was previously shown — close any open offline
    // video decrypt session before the new slide's content (possibly a new
    // one) is resolved.
    releaseOfflineStream();

    // Offline gate (plan §B4/§7): third-party-hosted / execution-environment
    // slide types are never downloadable — when offline, show the
    // "Requires internet" message instead of attempting (and failing) to load.
    const { connected } = await Network.getStatus();
    if (!connected && isOnlineOnlySlide(activeItem)) {
      if (generationId !== loadGenerationRef.current) return;
      setContent(<RequiresInternetSlide slideTypeLabel={activeItem.source_type} />);
      setIsLoading(false);
      return;
    }

    // Offline lease/revocation gate (plan §B6/§B7): a downloadable slide's
    // bytes are only readable while this device's offline lease is valid —
    // check once up front (mirrors the online-only gate above) instead of
    // letting every VIDEO/DOCUMENT/AUDIO/ASSIGNMENT branch fail separately.
    if (!connected) {
      const userId = await getUserId();
      const lockReason = userId ? await getOfflineLockReason(userId) : null;
      if (lockReason) {
        if (generationId !== loadGenerationRef.current) return;
        setContent(<LeaseLockOverlay reason={lockReason} />);
        setIsLoading(false);
        return;
      }
    }

    try {
      // Add artificial delay for smooth loading experience
      await new Promise((resolve) => setTimeout(resolve, 300));

      switch (activeItem.source_type?.toUpperCase()) {
        case "AI_VIDEO": {
          // AI_VIDEO slides from course generation - have aiVideoData already
          const aiVideoData = activeItem.aiVideoData || (activeItem as any).ai_video_data;

          // Transform snake_case to camelCase if needed
          let transformedData: AIVideoData | undefined;
          if (aiVideoData) {
            if (aiVideoData.status && aiVideoData.timeline_url && aiVideoData.audio_url) {
              transformedData = {
                status: aiVideoData.status,
                timelineUrl: aiVideoData.timeline_url,
                audioUrl: aiVideoData.audio_url,
                progress: aiVideoData.progress,
              };
            } else if (aiVideoData.status && aiVideoData.timelineUrl && aiVideoData.audioUrl) {
              transformedData = aiVideoData;
            }
          }

          if (transformedData?.status === "COMPLETED" &&
            transformedData.timelineUrl &&
            transformedData.audioUrl) {
            setContent(
              <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="h-full w-full bg-white rounded-lg overflow-hidden border border-neutral-200">
                  <AIVideoPlayer
                    timelineUrl={transformedData.timelineUrl}
                    audioUrl={transformedData.audioUrl}
                    className="w-full"
                    onTimeUpdate={handleVideoTimeUpdate}
                  />
                </div>
              </div>
            );
          } else if (transformedData?.status === "GENERATING") {
            setContent(
              <div className="h-full w-full flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-gray-600 font-medium">{t("videoState.generating")}</p>
                  {transformedData.progress !== undefined && (
                    <p className="text-gray-500 text-sm mt-2">
                      {t("videoState.percentComplete", { percent: transformedData.progress })}
                    </p>
                  )}
                  <p className="text-sm mt-2 text-gray-500">{t("videoState.availableInFewMinutes")}</p>
                </div>
              </div>
            );
          } else {
            setContent(
              <div className="h-full w-full flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <p>{t("videoState.pendingGeneration")}</p>
                  <p className="text-sm mt-2 text-gray-500">{t("videoState.availableInFewMinutes")}</p>
                </div>
              </div>
            );
          }
          break;
        }



        case "HTML_VIDEO": {
          // HTML_VIDEO slides from backend
          // Check multiple possible field names (snake_case, camelCase, etc.)
          const htmlVideoSlide =
            activeItem.html_video_slide ||
            (activeItem as any).htmlVideoSlide ||
            (activeItem as any).html_video ||
            (activeItem as any).htmlVideo;

          console.log("[SlideMaterial] HTML_VIDEO slide detected:", {
            source_type: activeItem.source_type,
            slide_id: activeItem.id,
            source_id: activeItem.source_id,
            html_video_slide: htmlVideoSlide,
            // Log all keys to see what's available
            allKeys: Object.keys(activeItem),
            // Log the entire slide object
            fullSlide: activeItem,
          });

          // Check for embedded content (Code, Scratch, Jupyter)
          // It might be in htmlVideoSlide or activeItem directly
          let embeddedType =
            htmlVideoSlide?.embedded_type ||
            (activeItem as any).embedded_type;

          let embeddedData =
            htmlVideoSlide?.embedded_data ||
            (activeItem as any).embedded_data ||
            htmlVideoSlide?.code_data ||
            (activeItem as any).code_data;

          // SPECIAL HANDLING: Check for code_editor_config (used in some HTML_VIDEO slides)
          const codeEditorConfig =
            htmlVideoSlide?.code_editor_config ||
            (activeItem as any).code_editor_config;

          if (codeEditorConfig && !embeddedData) {
            try {
              console.log("[SlideMaterial] Found code_editor_config, transforming to embedded data");
              const config = typeof codeEditorConfig === 'string'
                ? JSON.parse(codeEditorConfig)
                : codeEditorConfig;

              if (config.enabled) {
                embeddedType = "CODE";
                // Transform into CodeEditorData format expected by CodeEditorSlide
                const codeData = {
                  language: config.language || "python",
                  theme: config.theme || "dark",
                  code: config.initial_code || "",
                  viewMode: "edit",
                  readOnly: false
                };
                embeddedData = JSON.stringify(codeData);
              }
            } catch (e) {
              console.error("[SlideMaterial] Failed to parse code_editor_config", e);
            }
          }

          console.log("[SlideMaterial] Embedded content check:", {
            embeddedType,
            hasEmbeddedData: !!embeddedData
          });

          // Snapshot URLs that may have been embedded in the slide payload at
          // course-creation time. Used ONLY as a fallback when no
          // `ai_gen_video_id` is available — when the video_id is known we
          // always fetch fresh URLs from the API below so editor-side
          // changes (per-sentence re-narration, re-renders) are visible to
          // learners without requiring slide records to be re-synced.
          let existingHtmlUrl =
            htmlVideoSlide?.html_url ||
            htmlVideoSlide?.htmlUrl ||
            htmlVideoSlide?.timeline_url ||
            htmlVideoSlide?.timelineUrl ||
            (activeItem as any).html_url ||
            (activeItem as any).htmlUrl ||
            (activeItem as any).timeline_url ||
            (activeItem as any).timelineUrl;

          let existingAudioUrl =
            htmlVideoSlide?.audio_url ||
            htmlVideoSlide?.audioUrl ||
            (activeItem as any).audio_url ||
            (activeItem as any).audioUrl;

          // If validation fails (e.g. empty strings), treat as not found
          if (!existingHtmlUrl || existingHtmlUrl === "") existingHtmlUrl = null;
          if (!existingAudioUrl || existingAudioUrl === "") existingAudioUrl = null;

          // If we have an ai_gen_video_id, prefer the fresh API lookup and
          // discard the snapshot — keeps audio in sync with edits made in
          // the admin sentence editor. Only legacy slides that have no
          // video_id at all fall back to the snapshot below.
          const hasVideoId = !!(
            htmlVideoSlide?.ai_gen_video_id ||
            htmlVideoSlide?.aiGenVideoId ||
            (activeItem as any).ai_gen_video_id ||
            (activeItem as any).aiGenVideoId
          );
          if (hasVideoId) {
            existingHtmlUrl = null;
            existingAudioUrl = null;
          }

          // Helper to render content (Split or Full)
          const renderHtmlVideoContent = (htmlUrl: string, audioUrl: string) => {
            if (embeddedType && embeddedData) {
              return (
                <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <SplitScreenHtmlVideoSlide
                    videoId={activeItem.source_id}
                    videoUrls={{ htmlUrl, audioUrl }}
                    documentId={activeItem.id}
                    embeddedContent={{
                      embedded_type: embeddedType,
                      embedded_data: embeddedData
                    }}
                  />
                </div>
              );
            } else {
              return (
                <div
                  key={`html-video-${activeItem.id}`}
                  className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700"
                >
                  <div className="h-full w-full bg-white rounded-lg overflow-hidden border border-neutral-200">
                    <AIVideoPlayer
                      timelineUrl={htmlUrl}
                      audioUrl={audioUrl}
                      className="w-full"
                      onTimeUpdate={handleVideoTimeUpdate}
                    />
                  </div>
                </div>
              );
            }
          };

          // If URLs are already available, use them directly
          if (existingHtmlUrl && existingAudioUrl) {
            console.log("[SlideMaterial] Using URLs from slide data:", {
              htmlUrl: existingHtmlUrl,
              audioUrl: existingAudioUrl,
            });
            setContent(renderHtmlVideoContent(existingHtmlUrl, existingAudioUrl));
            break;
          }

          // If URLs not in slide data, try to fetch from API
          // Check for video ID
          const videoId =
            htmlVideoSlide?.ai_gen_video_id ||
            htmlVideoSlide?.aiGenVideoId ||
            (activeItem as any).ai_gen_video_id ||
            (activeItem as any).aiGenVideoId ||
            activeItem.source_id;

          if (!videoId) {
            console.error("[SlideMaterial] HTML_VIDEO slide missing video ID and URLs", {
              slide_id: activeItem.id,
              source_id: activeItem.source_id,
              html_video_slide: htmlVideoSlide,
              allKeys: Object.keys(activeItem),
            });
            setContent(
              <div className="h-full w-full flex items-center justify-center">
                <div className="text-center text-red-500">
                  <p>{t("videoState.dataNotFound")}</p>
                  {/* Engineer-facing diagnostic — intentionally untranslated. */}
                  <p className="text-xs mt-2">HTML_VIDEO slide is missing video ID and URLs</p>
                  <p className="text-xs mt-1">Source ID: {activeItem.source_id || "N/A"}</p>
                </div>
              </div>
            );
            break;
          }

          // Fetch video URLs from API (only if not already in slide data)
          try {
            console.log("[SlideMaterial] Fetching video URLs from API for videoId:", videoId);
            const videoUrls = await fetchHtmlVideoUrls(videoId);

            console.log("[SlideMaterial] Fetched HTML video URLs:", {
              videoId: videoId,
              hasHtmlUrl: !!videoUrls.htmlUrl,
              hasAudioUrl: !!videoUrls.audioUrl,
              htmlUrl: videoUrls.htmlUrl,
              audioUrl: videoUrls.audioUrl,
            });

            if (videoUrls.htmlUrl && videoUrls.audioUrl) {
              setContent(renderHtmlVideoContent(videoUrls.htmlUrl, videoUrls.audioUrl));
            } else {
              setContent(
                <div className="h-full w-full flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-gray-600 font-medium">{t("videoState.processing")}</p>
                    {/* Engineer-facing diagnostic — intentionally untranslated. */}
                    <p className="text-xs mt-2">Video URLs not available yet</p>
                    <p className="text-sm mt-2 text-gray-500">{t("videoState.availableInFewMinutes")}</p>
                  </div>
                </div>
              );
            }
          } catch (err: any) {
            console.error("[SlideMaterial] Error fetching HTML video URLs:", {
              error: err,
              videoId: videoId,
              status: err.response?.status,
              message: err.message,
              response: err.response?.data,
              // CORS error details
              isCorsError: err.code === 'ERR_NETWORK' || err.message === 'Network Error',
            });

            // Check if it's a CORS error
            const isCorsError = err.code === 'ERR_NETWORK' || err.message === 'Network Error';
            const errorMessage = isCorsError
              // Engineer-facing diagnostic — intentionally untranslated.
              ? 'CORS Error: Backend proxy route may not be configured. Please check backend configuration for /ai-service/video/urls/ endpoint.'
              : err.response?.status === 404
                ? t("videoState.videoNotFound", { videoId })
                : t("videoState.failedToLoadUrls");

            setContent(
              <div className="h-full w-full flex items-center justify-center">
                <div className="text-center text-red-500 max-w-md">
                  <p className="font-medium">{errorMessage}</p>
                  <p className="text-xs mt-2">
                    {isCorsError
                      // Engineer-facing diagnostic — intentionally untranslated.
                      ? 'The backend needs to configure a proxy route for /ai-service/video/urls/'
                      : t("videoState.tryAgainLater")}
                  </p>
                  <p className="text-xs mt-1 text-gray-400">Video ID: {videoId}</p>
                </div>
              </div>
            );
          }
          break;
        }

        case "VIDEO": {
          if (generationId !== loadGenerationRef.current) return;
          const videoSlide = activeItem.video_slide;
          const videoStatus = activeItem.status;

          // Check if this is a split-screen video
          if (videoSlide?.embedded_type && videoSlide?.embedded_data) {
            setContent(
              <div
                key={`split-video-${activeItem.id}`}
                className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700"
              >
                <SplitScreenVideoSlide
                  videoSlide={videoSlide}
                  status={videoStatus}
                  onTimeUpdate={handleVideoTimeUpdate}
                  progressMarker={activeItem.progress_marker}
                />
              </div>
            );
            break;
          }

          // Regular video handling
          // Falls back to the URL when source_type is blank, so a Vimeo link
          // never lands on the YouTube player (which renders an empty frame).
          const videoSourceType = resolveVideoSourceType(videoSlide);
          // Prefer the field matching the slide's status, but fall back to the
          // other one: resolveVideoSourceType reads published_url||url, so
          // without this a row carrying only the opposite field would resolve
          // to FILE_ID and then fail with "file ID not available".
          const fileId =
            (videoStatus === "PUBLISHED"
              ? videoSlide?.published_url
              : videoSlide?.url) ||
            videoSlide?.published_url ||
            videoSlide?.url;
          const videoLengthMs =
            videoSlide?.published_video_length_in_millis ||
            videoSlide?.video_length_in_millis ||
            null;

          switch (videoSourceType) {
            case "VIMEO": {
              const vimeoUrl = videoSlide?.published_url || videoSlide?.url || "";
              const vimeoId = extractVimeoId(vimeoUrl);
              setContent(
                <div
                  key={`video-${activeItem.id}`}
                  className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700"
                >
                  <div className="h-full w-full bg-black rounded-lg overflow-hidden border border-neutral-200">
                    <VimeoPlayerWrapper
                      videoId={vimeoId}
                      onTimeUpdate={handleVideoTimeUpdate}
                      ref={playerRef}
                      ms={
                        start?.t !== undefined
                          ? clampStartMs(start.t, videoLengthMs)
                          : activeItem.progress_marker
                      }
                      questions={videoSlide?.questions || []}
                      concentrationSettings={concentrationSettings}
                    />
                  </div>
                </div>
              );
              break;
            }
            case "FILE_ID": {
              if (!fileId) throw new Error("Video file ID not available");
              // Offline playback (plan §B4/§C): only attempt the resolver
              // while offline — online always stays on the existing
              // getPublicUrl path (untouched behavior, no offline lookup
              // cost while connected).
              const { connected: videoOnline } = await Network.getStatus();
              let videoUrl: string;
              let isOfflineVideoSource = false;
              if (!videoOnline) {
                const userId = await getUserId();
                const resolved = userId
                  ? await resolveSlideSource({
                      userId,
                      fileId,
                      slideId: activeItem.id,
                      mimeType: "video/mp4",
                      stream: true,
                      resolveRemoteUrl: () => getPublicUrl(fileId),
                    })
                  : null;
                if (resolved?.kind === "offline-stream" && resolved.url) {
                  videoUrl = resolved.url;
                  isOfflineVideoSource = true;
                  offlineStreamReleaseRef.current = resolved.release ?? null;
                } else if (resolved?.kind === "remote" && resolved.url) {
                  videoUrl = resolved.url;
                } else {
                  throw new Error("Video not available offline");
                }
              } else {
                videoUrl = await getPublicUrl(fileId);
              }
              if (!videoUrl) throw new Error("Failed to retrieve video URL");
              setContent(
                <div
                  key={`video-${activeItem.id}`}
                  className="h-full w-full overflow-hidden rounded-lg animate-in fade-in slide-in-from-bottom-4 duration-700"
                >
                  <div className="h-full w-full bg-black rounded-lg overflow-hidden border border-neutral-200">
                    <CustomVideoPlayer
                      videoUrl={videoUrl}
                      isOfflineSource={isOfflineVideoSource}
                      onTimeUpdate={handleVideoTimeUpdate}
                      ref={playerRef}
                      questions={videoSlide?.questions || []}
                      concentrationSettings={concentrationSettings}
                    />
                  </div>
                </div>
              );
              // The uploaded-video player has no start prop: seek it once it
              // has loaded its metadata.
              if (start?.t !== undefined) {
                seekWhenReady(activeItem.id, start.t, "VIDEO");
              }
              break;
            }
            default:
              setContent(
                <div
                  key={`video-${activeItem.id}`}
                  className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700"
                >
                  <div className="h-full w-full bg-black rounded-lg overflow-hidden border border-neutral-200">
                    <YouTubePlayerWrapper
                      videoId={extractVideoId(
                        videoSlide?.published_url || videoSlide?.url || ""
                      )}
                      onTimeUpdate={handleVideoTimeUpdate}
                      ref={playerRef}
                      ms={
                        start?.t !== undefined
                          ? clampStartMs(start.t, videoLengthMs)
                          : activeItem.progress_marker
                      }
                      questions={videoSlide?.questions || []}
                      concentrationSettings={concentrationSettings}
                    />
                  </div>
                </div>
              );
              break;
          }
          break;
        }

        case "QUIZ": {
          // Support for new quiz slide structure
          const slideWithQuiz = activeItem as Slide & { quiz_slide?: unknown };
          const quizSlide = slideWithQuiz.quiz_slide as
            | {
                questions?: unknown[];
                time_limit_in_minutes?: number | null;
                marks_per_question?: number;
                negative_marking?: number;
                partial_marking?: boolean | null;
              }
            | undefined;
          const questions = Array.isArray(quizSlide?.questions)
            ? quizSlide!.questions
            : [];

          // Map questions to QuizViewer format
          const mappedQuestions = questions.map((q: unknown) => {
            const question = q as {
              id: string;
              parent_rich_text?: {
                id?: string;
                type?: string;
                content?: string;
              };
              text?: { id?: string; type?: string; content?: string };
              options?: Array<{ id?: string; text?: { content?: string } }>;
              question_type?: string;
              auto_evaluation_json?: string;
              explanation_text?: {
                id?: string;
                type?: string;
                content?: string;
              };
              marks?: number | null;
              negative_marking?: number | null;
            };
            return {
              id: question.id,
              parent_rich_text: question.parent_rich_text,
              text: question.text,
              question_type: question.question_type,
              options:
                Array.isArray(question.options) && question.options.length > 0
                  ? question.options.map((opt, idx) => ({
                    id: opt.id || String(idx),
                    text: { content: opt.text?.content || "Option" },
                  }))
                  : [
                    // If no options, provide a default for numeric/text input
                    { id: "input", text: { content: "(Enter your answer)" } },
                  ],
              auto_evaluation_json: question.auto_evaluation_json,
              explanation_text: question.explanation_text,
              marks: question.marks ?? null,
              negative_marking: question.negative_marking ?? null,
            };
          });

          setContent(
            <QuizViewer
              questions={mappedQuestions}
              timeLimitMinutes={quizSlide?.time_limit_in_minutes ?? null}
              marksPerQuestion={quizSlide?.marks_per_question ?? 1}
              defaultNegativeMarking={quizSlide?.negative_marking ?? 0}
              partialMarking={quizSlide?.partial_marking === true}
              passPercentage={(quizSlide as any)?.pass_percentage ?? null}
              reAttemptCount={(quizSlide as any)?.re_attempt_count ?? null}
              onAnswer={async (_questionId, selectedOptionId) => {
                // Send/save answer data here if needed
                await handleQuestionSubmit(String(selectedOptionId));
              }}
              onComplete={() => {
                // Optionally handle quiz completion
              }}
            />
          );
          break;
        }

        case "QUESTION": {
          // Fallback: if quiz_slide is present, use it
          const slideWithQuiz = activeItem as Slide & { quiz_slide?: unknown };
          const quizSlide = slideWithQuiz.quiz_slide as
            | { questions?: unknown[] }
            | undefined;
          if (quizSlide && Array.isArray(quizSlide.questions)) {
            const questions = quizSlide.questions;
            const mappedQuestions = questions.map((q: unknown) => {
              const question = q as {
                id: string;
                parent_rich_text?: {
                  id?: string;
                  type?: string;
                  content?: string;
                };
                text?: { id?: string; type?: string; content?: string };
                options?: Array<{ id?: string; text?: { content?: string } }>;
                question_type?: string;
              };
              return {
                id: question.id,
                parent_rich_text: question.parent_rich_text,
                text: question.text,
                question_type: question.question_type,
                options:
                  Array.isArray(question.options) && question.options.length > 0
                    ? question.options.map((opt, idx) => ({
                      id: opt.id || String(idx),
                      text: { content: opt.text?.content || "Option" },
                    }))
                    : [
                      {
                        id: "input",
                        text: { content: "(Enter your answer)" },
                      },
                    ],
              };
            });
            setContent(
              <QuizViewer
                questions={mappedQuestions}
                passPercentage={(quizSlide as any)?.pass_percentage ?? null}
              reAttemptCount={(quizSlide as any)?.re_attempt_count ?? null}
                onAnswer={async (_questionId, selectedOptionId) => {
                  await handleQuestionSubmit(String(selectedOptionId));
                }}
                onComplete={() => {
                  // Optionally handle quiz completion
                }}
              />
            );
            break;
          }
          // Legacy: single question slide
          if (activeItem.question_slide) {
            setContent(
              <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="h-full w-full bg-white rounded-lg overflow-hidden border border-neutral-200">
                  <QuestionSlide
                    questionData={activeItem.question_slide}
                    onSubmit={handleQuestionSubmit}
                  />
                </div>
              </div>
            );
          } else {
            setContent(
              <div className="flex h-reg-500 flex-col items-center justify-center rounded-lg py-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-red-50 rounded-full p-6 transition-transform duration-300">
                  <svg
                    className="w-8 h-8 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p className="text-red-500 mt-4 animate-in fade-in duration-700 delay-200 text-center">
                  {t("slideState.quizDataNotAvailable")}
                </p>
              </div>
            );
          }
          break;
        }

        case "DOCUMENT":
          if (activeItem.document_slide?.type === "PDF") {
            const pdfFileId = activeItem.document_slide.published_data || "";
            const url = await resolvePlaybackUrl(
              pdfFileId,
              activeItem.id,
              "application/pdf",
              true
            );
            if (!url) throw new Error("Failed to retrieve PDF URL");
            setContent(
              <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="h-full w-full bg-white rounded-lg overflow-hidden border border-neutral-200">
                  {/* Keyed by slide so moving between two PDF slides mounts a
                      fresh viewer instead of reusing one carrying the previous
                      slide's activity id and page-view buffer. */}
                  <PDFViewer
                    key={activeItem.id}
                    pdfUrl={url}
                    startPage={start?.page}
                  />
                </div>
              </div>
            );
          } else if (
            activeItem.document_slide?.type === "DOC" ||
            activeItem.document_slide?.type === "HTML"
          ) {
            // 'HTML' (Tiptap-authored) docs ALWAYS store inline HTML — no
            // file-id sniffing needed. Legacy 'DOC' may hold either HTML or
            // a DOCX file id, so keep the content sniff for those.
            const isHtml =
              activeItem.document_slide?.type === "HTML" ||
              (activeItem.document_slide.published_data &&
                (activeItem.document_slide.published_data.includes("<html") ||
                  activeItem.document_slide.published_data.includes("<body") ||
                  activeItem.document_slide.published_data
                    .trim()
                    .startsWith("<")));
            if (isHtml) {
              // 'HTML' = creative, self-contained HTML → sandboxed iframe.
              const isCreativeHtml = activeItem.document_slide?.type === "HTML";
              setContent(
                <div className="relative h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                  {/* Content Protection → Document (Docs) / Images (in Docs): off for learners unless switched on. */}
                  <div className="absolute end-3 top-3 z-10 flex gap-2">
                    <SlideImagesDownloadButton
                      title={activeItem.title}
                      html={activeItem.document_slide.published_data || ""}
                      className="bg-white"
                    />
                    <SlideDownloadButton
                      typeKey={SlideDownloadTypeKey.DOCUMENT_DOC}
                      title={activeItem.title}
                      html={activeItem.document_slide.published_data || ""}
                      className="bg-white"
                    />
                  </div>
                  <div className="h-full w-full bg-white rounded-lg overflow-hidden border border-neutral-200">
                    <DocViewer
                      docUrl={activeItem.document_slide.published_data || ""}
                      documentId={activeItem.id}
                      isHtml={true}
                      creativeHtml={isCreativeHtml}
                    />
                  </div>
                </div>
              );
            } else {
              const url = await resolvePlaybackUrl(
                activeItem.document_slide.published_data || "",
                activeItem.id,
                "application/octet-stream"
              );
              setContent(
                <div className="relative h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <SlideDownloadButton
                    typeKey={SlideDownloadTypeKey.DOCUMENT_DOC}
                    title={activeItem.title}
                    url={url}
                    className="absolute end-3 top-3 z-10 bg-white"
                  />
                  <div className="h-full w-full bg-white rounded-lg overflow-hidden border border-neutral-200">
                    <DocViewer
                      docUrl={url || ""}
                      documentId={activeItem.id}
                      isHtml={false}
                    />
                  </div>
                </div>
              );
            }
          } else if (activeItem.document_slide?.type === "PRESENTATION") {
            const url = await resolvePlaybackUrl(
              activeItem.document_slide.published_data || "",
              activeItem.id,
              "application/octet-stream"
            );
            if (!url) throw new Error("Failed to retrieve presentation URL");
            setContent(
              <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="h-full w-full bg-white rounded-lg overflow-hidden border border-neutral-200">
                  <PresentationViewer slide={activeItem} />
                </div>
              </div>
            );
          } else if (activeItem.document_slide?.type === "PPT_ANIM") {
            // .pptx converted to build-step snapshots; data/published_data holds
            // the deck base URL (manifest.json lives at <base>/manifest.json).
            const deckBase =
              activeItem.document_slide.published_data ||
              activeItem.document_slide.data ||
              "";
            if (!deckBase) throw new Error("Failed to retrieve presentation URL");
            // aspect-video gives the player an intrinsic 16:9 height so it never
            // depends on the parent resolving a height (a pure h-full child
            // collapses to 0 here, unlike PDF/pdf.js which self-sizes).
            setContent(
              <div className="flex h-full w-full items-center justify-center animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="aspect-video w-full overflow-hidden rounded-lg border border-neutral-200">
                  <DeckPlayer baseUrl={deckBase} />
                </div>
              </div>
            );
          } else if (activeItem.document_slide?.type === "CODE") {
            const publishedData = activeItem.document_slide.published_data;

            if (publishedData) {
              console.log("[SlideMaterial] Creating CodeEditorSlide component");
              setContent(
                <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <CodeEditorSlide
                    published_data={publishedData}
                    documentId={activeItem.id}
                  />
                </div>
              );
            } else {
              setContent(
                <div className="flex items-center justify-center h-full">
                  <div className="text-neutral-500">{t("slideState.noCodeData")}</div>
                </div>
              );
            }
          } else if (activeItem.document_slide?.type === "JUPYTER") {
            // Jupyter Notebook Slide
            const publishedData = activeItem.document_slide.published_data;
            if (publishedData) {
              setContent(
                <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <JupyterNotebookSlide
                    published_data={publishedData}
                    documentId={activeItem.id}
                  />
                </div>
              );
            }
          } else if (activeItem.document_slide?.type === "SCRATCH") {
            // Scratch Project Slide
            const publishedData = activeItem.document_slide.published_data;
            if (publishedData) {
              setContent(
                <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <ScratchProjectSlide
                    published_data={publishedData}
                    documentId={activeItem.id}
                  />
                </div>
              );
            }
          }
          break;

        case "ASSIGNMENT": {
          if (activeItem.assignment_slide) {
            setContent(
              <div className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="h-full w-full bg-white rounded-lg overflow-hidden border border-neutral-200">
                  <AssignmentSlide
                    assignmentData={activeItem.assignment_slide}
                    onUpload={handleAssignmentUpload}
                    isUploading={isUploading}
                  />
                </div>
              </div>
            );
          }
          break;
        }

        case "AUDIO": {
          const audioSlide = activeItem.audio_slide || activeItem.audioSlide;

          if (audioSlide) {
            setContent(
              <div
                key={`audio-${activeItem.id}`}
                className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700"
              >
                <AudioPlayer audioSlide={audioSlide} />
              </div>
            );
            if (start?.t !== undefined) {
              seekWhenReady(activeItem.id, start.t, "AUDIO");
            }
          } else {
            setContent(
              <div className="flex h-reg-300 flex-col items-center justify-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                <p className="text-red-500 font-medium">{t("slideState.audioDataMissing")}</p>
              </div>
            );
          }
          break;
        }

        case "SCORM": {
          setContent(
            <div
              key={`scorm-${activeItem.id}`}
              className="h-full w-full animate-in fade-in slide-in-from-bottom-4 duration-700"
            >
              <ScormSlideComponent
                slide={activeItem}
              />
            </div>
          );
          break;
        }

        case "ASSESSMENT": {
          setContent(
            <div
              key={`assessment-${activeItem.id}`}
              className="w-full animate-in fade-in slide-in-from-bottom-4 duration-700"
            >
              <AssessmentSlideViewer activeItem={activeItem} />
            </div>
          );
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error("Error loading content:", err);
      if (generationId === loadGenerationRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load content");
        setContent(
          <div className="flex h-reg-300 flex-col items-center justify-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-red-50 rounded-full p-4 transition-transform duration-300">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p className="text-red-500 mt-4 animate-in fade-in duration-700 delay-200 text-center">
              {error || "An error occurred while loading content"}
            </p>
          </div>
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const prevSlideIdRef = useRef<string | null>(null);
  const prevLangRef = useRef<string>(i18n.language);

  useEffect(() => {
    // loadContent() bakes translated copy into the JSX it stores in state, so a
    // language switch has to rebuild it — the slide-id guard alone would keep
    // showing the previous language until the learner navigated away.
    const languageChanged = prevLangRef.current !== i18n.language;
    if (languageChanged) prevLangRef.current = i18n.language;

    // Only reload content if the slide ID actually changed (or the language did)
    if (activeItem?.id !== prevSlideIdRef.current || languageChanged) {
      loadGenerationRef.current += 1;
      const currentGeneration = loadGenerationRef.current;

      if (activeItem) {
        setHeading(activeItem.title || "");
        // Settles which citation start (if any) this build opens at, before
        // loadContent reads it.
        takeStartFor(activeItem.id);
        loadContent(currentGeneration);
        prevSlideIdRef.current = activeItem.id;
      } else {
        setHeading(t("slideState.noContent"));
        prevSlideIdRef.current = null;
        if (currentGeneration === loadGenerationRef.current) {
          setContent(
            <div className="flex h-reg-500 flex-col items-center justify-center rounded-lg py-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-neutral-50 rounded-full p-6 transition-transform duration-300 group-hover:scale-105">
                <EmptySlideMaterial />
              </div>
              <p className="mt-6 text-neutral-500 animate-in fade-in duration-700 delay-200 text-center">
                {t("slideState.noStudyMaterial")}
              </p>
            </div>
          );
        }
      }
    } else if (activeItem) {
      // Slide ID is the same, just update heading (no content reload)
      setHeading(activeItem.title || "");
    }
  }, [activeItem, t, i18n.language]);

  // The slide on screen when a citation for another slide became pending. The
  // host may take a render or two to open the cited slide, so a mismatch alone
  // proves nothing; but once the active slide moves to a third slide (the cited
  // one was drip-locked or hidden and the host fell back, or the learner picked
  // another slide) the citation has lost and is dropped, so a later navigation
  // that keeps its params cannot replay it onto a slide it never named.
  const pendingBaselineRef = useRef<{
    key: string;
    activeId: string;
  } | null>(null);

  // A citation for the slide already on screen (a chat link to the lesson
  // being read) does not reload it, so apply the start to the live viewer.
  // A slide still to load picks its start up in the effect above instead.
  useEffect(() => {
    const pending = pendingStartRef.current;
    if (!pending) {
      pendingBaselineRef.current = null;
      return;
    }
    if (!activeItem) return;
    if (pending.slideId !== activeItem.id) {
      const key = slideStartKey(pending);
      const baseline = pendingBaselineRef.current;
      if (!baseline || baseline.key !== key) {
        pendingBaselineRef.current = { key, activeId: activeItem.id };
      } else if (baseline.activeId !== activeItem.id) {
        // Dropped without clearing the URL: the host's clean-up navigation
        // keeps the URL's slideId and would race the learner's own
        // navigation to the slide now open.
        consumedStartKeyRef.current = key;
        pendingStartRef.current = null;
        pendingBaselineRef.current = null;
      }
      return;
    }
    pendingBaselineRef.current = null;
    if (prevSlideIdRef.current !== activeItem.id) return;
    consumeStart(pending);
    if (
      pending.page !== undefined &&
      activeItem.source_type === "DOCUMENT" &&
      activeItem.document_slide?.type === "PDF"
    ) {
      const { currentPdfLength, navigateToPdfPage } =
        useMediaRefsStore.getState();
      const lastPageIndex = currentPdfLength > 0 ? currentPdfLength - 1 : null;
      const pageIndex = pending.page - 1;
      navigateToPdfPage(
        lastPageIndex !== null ? Math.min(pageIndex, lastPageIndex) : pageIndex
      );
    }
    if (pending.t !== undefined) {
      if (activeItem.source_type === "VIDEO") {
        seekWhenReady(activeItem.id, pending.t, "VIDEO");
      } else if (activeItem.source_type === "AUDIO") {
        seekWhenReady(activeItem.id, pending.t, "AUDIO");
      }
    }
    // Keyed on the link itself; the helpers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAtKey, activeItem?.id]);

  return (
    <div className="flex h-full w-full flex-col bg-white" ref={selectionRef}>
      <SlideProtectionGuard />
      {/* Compact Header */}
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-neutral-100 bg-white px-3 py-1.5 sm:px-4">
        <h3 className="text-xs sm:text-sm font-medium text-neutral-700 leading-tight truncate min-w-0 flex-1">
          {heading || "No content"}
        </h3>

        <div
          className={cn(
            "items-center gap-2 shrink-0",
            standaloneNav ? "flex" : "hidden sm:flex",
          )}
        >
          <button
            onClick={goToPrev}
            disabled={!canGoPrev}
            aria-label={t("slideNav.previousSlide")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-neutral-200 disabled:hover:text-neutral-700 transition-colors"
          >
            <CaretLeft size={14} />
            <span className={cn(standaloneNav && "hidden sm:inline")}>
              {t("slideNav.previous")}
            </span>
          </button>
          {realSlides.length > 0 && realIndex > -1 && (
            <span className="text-xs font-medium text-neutral-500 tabular-nums">
              {realIndex + 1} / {realSlides.length}
            </span>
          )}
          <button
            onClick={goToNext}
            disabled={!canGoNext}
            aria-label={t("slideNav.nextSlide")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-neutral-200 disabled:hover:text-neutral-700 transition-colors"
          >
            <span className={cn(standaloneNav && "hidden sm:inline")}>
              {t("slideNav.next")}
            </span>
            <CaretRight size={14} />
          </button>
          {/* Consumption slides only — the synthesised feedback slide is not
              content, and graded types complete by submission. */}
          {manualCompletion &&
            activeItem &&
            MANUALLY_COMPLETABLE_SLIDE_TYPES.has(
              activeItem.source_type || ""
            ) && (
              <MarkCompleteButton
                slideId={activeItem.id}
                slideType={activeItem.source_type as string}
                percentageCompleted={activeItem.percentage_completed || 0}
                context={completionContext ?? {}}
                compact={standaloneNav}
              />
            )}
          <div className="h-4 w-px bg-neutral-200"></div>
          <AskDoubtButton />
        </div>
      </div>

      {/* Play-theme mobile: inline slide nav right below the compact header.
          Sits in flex flow so it pushes the content down (no fixed-overlap).
          Standalone nav already renders its row at every breakpoint, so this
          one stands down there rather than stacking a second set of arrows. */}
      <div
        className={cn(
          "flex-shrink-0 items-center gap-2 border-b border-neutral-100 bg-white px-3 py-2",
          standaloneNav ? "hidden" : "hidden sm:hidden [.ui-play_&]:flex",
        )}
      >
        <MyButton
          scale="large"
          layoutVariant="icon"
          buttonType="secondary"
          onClick={goToPrev}
          disabled={!canGoPrev}
          aria-label={t("slideNav.previousSlide")}
          className="flex items-center justify-center font-medium transition-all duration-200 bg-white border border-neutral-200 hover:border-primary-300 rounded-lg hover:bg-primary-50/50 disabled:opacity-50"
        >
          <CaretLeft size={18} />
        </MyButton>

        <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
          {realSlides.length > 0 && realIndex > -1 && (
            <span className="text-2xs font-semibold text-neutral-400 shrink-0 tabular-nums">
              {realIndex + 1} / {realSlides.length}
            </span>
          )}
          <AskDoubtButton />
        </div>

        <MyButton
          scale="large"
          layoutVariant="icon"
          buttonType="secondary"
          onClick={goToNext}
          disabled={!canGoNext}
          aria-label={t("slideNav.nextSlide")}
          className="flex items-center justify-center font-medium transition-all duration-200 bg-white border border-neutral-200 hover:border-primary-300 rounded-lg hover:bg-primary-50/50 disabled:opacity-50"
        >
          <CaretRight size={18} />
        </MyButton>
      </div>

      <div className="w-full flex-1 min-h-0 relative pb-16 sm:pb-0 [.ui-play_&]:pb-0">
        <div ref={contentAreaRef} className="h-full w-full transition-all duration-500">
          {content}
        </div>
        <SelectionAsk
          containerRef={contentAreaRef}
          lessonName={activeItem?.title}
          enabled={isTextDocument && !isLoading}
        />
        {videoMoment.stuckAt !== null && !isLoading && (
          <VideoStuckChip
            stuckAt={videoMoment.stuckAt}
            lessonName={activeItem?.title}
            onDismiss={videoMoment.dismiss}
            className="absolute start-3 top-3 z-20 max-w-pct-80"
          />
        )}

        {/* Loading skeleton of slide content */}
        {isLoading && (
          <div className="absolute inset-0 bg-white z-50 animate-in fade-in duration-200 p-4 sm:p-6 overflow-hidden">
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="h-6 w-2/3 rounded-md bg-neutral-200 animate-pulse" />
              <div className="h-3 w-1/3 rounded-md bg-neutral-100 animate-pulse" />
              <div className="aspect-video w-full rounded-lg bg-neutral-100 animate-pulse mt-4" />
              <div className="space-y-2 mt-6">
                <div className="h-3 w-full rounded bg-neutral-100 animate-pulse" />
                <div className="h-3 w-[94%] rounded bg-neutral-100 animate-pulse"></div>{/* design-lint-ignore: decorative skeleton width */}
                <div className="h-3 w-[88%] rounded bg-neutral-100 animate-pulse"></div>{/* design-lint-ignore: decorative skeleton width */}
                <div className="h-3 w-[72%] rounded bg-neutral-100 animate-pulse"></div>{/* design-lint-ignore: decorative skeleton width */}
              </div>
            </div>
          </div>
        )}
      </div>

      {isUploading && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-xl border border-neutral-200 p-6 max-w-sm w-full mx-4 animate-in zoom-in-95 slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-4">
                <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
                <div
                  className="absolute inset-0 w-12 h-12 border-4 border-transparent border-e-blue-400 rounded-full animate-spin"
                  style={{
                    animationDelay: "0.1s",
                    animationDirection: "reverse",
                  }}
                ></div>
              </div>
              <h3 className="text-base font-semibold text-neutral-900 mb-2">
                {t("slideState.uploadingContent")}
              </h3>
              <p className="text-sm text-neutral-500">
                {t("slideState.uploadingWait")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom navigation — default theme only. In play theme the app
          bottom tab bar hides this, so we render the inline top version above. */}
      <div className="sm:hidden fixed bottom-0 start-0 end-0 z-40 [.ui-play_&]:hidden">
        <div className="pointer-events-none absolute -top-3 start-0 end-0 h-3 bg-gradient-to-t from-white to-transparent"></div>
        <div className="bg-white border-t border-neutral-100 shadow-[0_-2px_8px_-2px_rgba(0,0,0,0.08)] px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+10px)]"> {/* design-lint-ignore: custom shadow, safe-area viewport math */}
          {/* Context strip: slide title + position */}
          <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-1.5 mb-2">
            <span className="text-2xs font-medium text-neutral-600 truncate flex-1 min-w-0">
              {heading || "No content"}
            </span>
            {slidesList.length > 0 && currentIndex > -1 && (
              <span className="text-2xs font-semibold text-neutral-400 shrink-0 tabular-nums">
                {currentIndex + 1} / {slidesList.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <MyButton
              scale="large"
              layoutVariant="icon"
              buttonType="secondary"
              onClick={goToPrev}
              disabled={!canGoPrev}
              aria-label={t("slideNav.previousSlide")}
              className="flex items-center justify-center font-medium transition-all duration-200 bg-white border border-neutral-200 hover:border-primary-300 rounded-lg hover:bg-primary-50/50 disabled:opacity-50"
            >
              <CaretLeft size={18} />
            </MyButton>

            <div className="flex-1 flex justify-center">
              <AskDoubtButton />
            </div>

            <MyButton
              scale="large"
              layoutVariant="icon"
              buttonType="secondary"
              onClick={goToNext}
              disabled={!canGoNext}
              aria-label={t("slideNav.nextSlide")}
              className="flex items-center justify-center font-medium transition-all duration-200 bg-white border border-neutral-200 hover:border-primary-300 rounded-lg hover:bg-primary-50/50 disabled:opacity-50"
            >
              <CaretRight size={18} />
            </MyButton>
          </div>
        </div>
      </div>

      <DoubtResolutionSidebar />
    </div>
  );
};

const AskDoubtButton = () => {
  const { t } = useTranslation("studyContent");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    getStudentDisplaySettings(false)
      .then((s) =>
        setEnabled(s?.courseDetails?.slidesView?.canAskDoubt !== false)
      )
      .catch(() => setEnabled(true));
  }, []);
  if (!enabled) return null;
  return (
    <button
      onClick={() => {
        const { openSidebar } = useDoubtSidebarStore.getState();
        openSidebar();
      }}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-600 bg-white border border-neutral-200 rounded-md hover:bg-neutral-50 hover:border-neutral-300 transition-colors"
    >
      <ChatText size={12} className="text-neutral-500" />
      <span>{t("slideNav.doubts")}</span>
    </button>
  );
};
