// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Slide } from "@/hooks/study-library/use-slides";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDS = {
  slideId: "slide-1",
  packageSessionId: "ps-1",
  chapterId: "ch-1",
  moduleId: "mod-1",
  subjectId: "sub-1",
};

const markSlideCompletion = vi.fn<[unknown], Promise<boolean>>(async () => true);
const announceSlideCompleted = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../discussion/use-discussion", () => ({
  useDiscussionContext: () => ({ ids: IDS, ready: true }),
}));
vi.mock("./activity-api", () => ({
  fetchGame: async () => ({ bestScore: null, lastScore: null, maxScore: null, attempts: 0 }),
  sendGameScore: async () => ({ bestScore: 1, lastScore: 1, maxScore: null, attempts: 1 }),
}));
vi.mock("@/services/study-library/tracking-api/mark-slide-completion", () => ({
  markSlideCompletion: (params: unknown) => markSlideCompletion(params),
}));
vi.mock("@/services/slide-engagement", () => ({
  announceSlideCompleted: (id: string) => announceSlideCompleted(id),
}));
vi.mock("@/constants/study-library", () => ({ getSlideCompletionThreshold: () => 90 }));
// The sandboxed frame is not under test; the slide's own completion rule is.
vi.mock("../html-slide-iframe", () => ({ HtmlSlideIframe: () => <div data-testid="game-frame" /> }));

const { GameSlide } = await import("./game-slide");

const UNSCORED_PAGE = "<html><body><button>Play</button></body></html>";
const SCORED_PAGE =
  "<html><body><script>parent.postMessage({ type: 'vacademy:complete', score: 1 }, '*')</script></body></html>";

function gameSlide(html: string, percentageCompleted = 0): Slide {
  return {
    id: IDS.slideId,
    title: "Game 1",
    source_type: "DOCUMENT",
    percentage_completed: percentageCompleted,
    document_slide: { type: "GAME", published_data: JSON.stringify({ html, maxScore: null, instructions: "" }) },
  } as unknown as Slide;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let visibility: DocumentVisibilityState = "visible";

async function render(slide: Slide) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <GameSlide slide={slide} />
      </QueryClientProvider>
    )
  );
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  markSlideCompletion.mockClear();
  announceSlideCompleted.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GameSlide completion when the page never reports a result", () => {
  it("completes the slide after 30 seconds on screen, once, with the course context", async () => {
    await render(gameSlide(UNSCORED_PAGE));

    await advance(29_000);
    expect(markSlideCompletion).not.toHaveBeenCalled();

    await advance(1_000);
    expect(markSlideCompletion).toHaveBeenCalledTimes(1);
    expect(markSlideCompletion).toHaveBeenCalledWith({
      slideId: "slide-1",
      slideType: "DOCUMENT",
      completed: true,
      chapterId: "ch-1",
      moduleId: "mod-1",
      subjectId: "sub-1",
      packageSessionId: "ps-1",
    });
    expect(announceSlideCompleted).toHaveBeenCalledWith("slide-1");

    await advance(120_000);
    expect(markSlideCompletion).toHaveBeenCalledTimes(1);
  });

  it("does not count time while the tab is hidden", async () => {
    await render(gameSlide(UNSCORED_PAGE));
    visibility = "hidden";
    await advance(60_000);
    expect(markSlideCompletion).not.toHaveBeenCalled();

    visibility = "visible";
    await advance(30_000);
    expect(markSlideCompletion).toHaveBeenCalledTimes(1);
  });

  it("leaves a game that reports its own result to the game", async () => {
    await render(gameSlide(SCORED_PAGE));
    await advance(120_000);
    expect(markSlideCompletion).not.toHaveBeenCalled();
  });

  it("does nothing for a game the learner already completed", async () => {
    await render(gameSlide(UNSCORED_PAGE, 100));
    await advance(120_000);
    expect(markSlideCompletion).not.toHaveBeenCalled();
  });
});
