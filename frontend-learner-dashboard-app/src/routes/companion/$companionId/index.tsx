import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookOpen,
  CaretRight,
  ChatCircleDots,
  Exam,
  ListBullets,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  getMyCompanion,
  readCompanionError,
  type CompanionDetail,
  type CompanionMode,
  type LessonCard,
  type ProgressUpdateResponse,
} from "@/services/kb-companion-api";
import {
  accentAlpha,
  accentOf,
  companionErrorText,
  companionKeys,
  findLeaf,
  flattenLeaves,
  masteryTone,
  nextLeafAfter,
} from "../-components/companion-utils";
import { CompanionAvatar, ProgressBar, ProgressRingMini } from "../-components/CompanionVisuals";
import { ErrorPanel } from "../-components/CompanionParts";
import { ContinueCard, TopicMap } from "../-components/TopicMap";
import { LessonPlayer } from "../-components/LessonPlayer";
import { PracticeRunner } from "../-components/PracticeRunner";
import { AskPanel } from "../-components/AskPanel";
import { useReadAloud } from "../-components/useReadAloud";

export const Route = createFileRoute("/companion/$companionId/")({
  component: CompanionStudyRoom,
});

const MODE_ORDER: CompanionMode[] = ["learn", "practice", "ask"];
const MODE_ICON = { learn: BookOpen, practice: Exam, ask: ChatCircleDots } as const;

/**
 * The study room for one knowledge-base companion: topic map with progress,
 * and three modes — Learn (visual lesson cards), Practice (MCQs) and Ask
 * (a grounded doubt thread). Remembers where the learner stopped.
 */
function CompanionStudyRoom() {
  const { companionId } = Route.useParams();
  const { t } = useTranslation("kbCompanion");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isPlay = usePlayTheme();
  const { setNavHeading } = useNavHeadingStore();
  const detailKey = companionKeys.detail(companionId);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: detailKey,
    queryFn: () => getMyCompanion(companionId),
    retry: 1,
  });

  const companion = data?.companion;
  const modes = useMemo(
    () => MODE_ORDER.filter((m) => companion?.modes?.includes(m)),
    [companion?.modes],
  );
  const [mode, setMode] = useState<CompanionMode | null>(null);
  const activeMode: CompanionMode | null = mode && modes.includes(mode) ? mode : (modes[0] ?? null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [askLeafId, setAskLeafId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const readAloud = useReadAloud(companion?.language);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setNavHeading(companion?.name || t("room.navHeading"));
  }, [setNavHeading, companion?.name, t]);

  const topics = useMemo(() => data?.topics ?? [], [data]);
  const active = findLeaf(topics, activeLeafId);
  const askLeaf = findLeaf(topics, askLeafId)?.leaf ?? null;
  const nextLeaf = active ? nextLeafAfter(topics, active.leaf.id) : null;

  const scrollToMain = () => {
    window.setTimeout(() => mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const selectLeaf = useCallback(
    (leafId: string) => {
      setMapOpen(false);
      readAloud.stop();
      if (activeMode === "ask") {
        setAskLeafId(leafId);
      } else {
        setActiveLeafId(leafId);
      }
      scrollToMain();
    },
    [activeMode, readAloud],
  );

  const switchMode = (next: CompanionMode) => {
    readAloud.stop();
    if (next === "ask" && activeLeafId) setAskLeafId(activeLeafId);
    setMode(next);
  };

  const continueLearning = (leafId: string) => {
    readAloud.stop();
    setActiveLeafId(leafId);
    if (activeMode === "ask" || !activeMode) setMode(modes.includes("learn") ? "learn" : modes[0]);
    setMapOpen(false);
    scrollToMain();
  };

  // Keep the map, rings and resume point live as progress is saved.
  const applyProgress = useCallback(
    (nodeId: string, res: ProgressUpdateResponse) => {
      queryClient.setQueryData<CompanionDetail>(detailKey, (prev) => {
        if (!prev) return prev;
        const node = res.node;
        const topicsNext = prev.topics.map((topic) => ({
          ...topic,
          leaves: topic.leaves.map((leaf) =>
            leaf.id === nodeId && node
              ? {
                  ...leaf,
                  progress: {
                    status: node.status ?? leaf.progress?.status ?? "IN_PROGRESS",
                    card_index: node.card_index ?? leaf.progress?.card_index ?? 0,
                    cards_total: node.cards_total ?? leaf.progress?.cards_total ?? 0,
                    mastery: node.mastery ?? leaf.progress?.mastery ?? 0,
                    last_activity_at: node.last_activity_at ?? leaf.progress?.last_activity_at ?? null,
                  },
                }
              : leaf,
          ),
        }));
        const resumeTitle = res.resume ? findLeaf(topicsNext, res.resume.node_id)?.leaf.title : null;
        return {
          ...prev,
          topics: topicsNext,
          progress: res.progress ?? prev.progress,
          resume: res.resume ? { ...res.resume, title: res.resume.title ?? resumeTitle ?? null } : null,
        };
      });
      void queryClient.invalidateQueries({ queryKey: companionKeys.list });
    },
    [queryClient, detailKey],
  );

  const askAboutCard = (card: LessonCard) => {
    readAloud.stop();
    setAskLeafId(activeLeafId);
    setPrefill({ text: t("ask.aboutCardPrefill", { title: card.title }), nonce: Date.now() });
    setMode("ask");
    scrollToMain();
  };

  // ── loading / error ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <LayoutContainer>
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <div className="flex gap-6">
            <Skeleton className="hidden h-96 w-80 shrink-0 rounded-2xl lg:block" />
            <Skeleton className="h-96 flex-1 rounded-2xl" />
          </div>
        </div>
      </LayoutContainer>
    );
  }

  if (error || !data || !companion) {
    const e = readCompanionError(error);
    return (
      <LayoutContainer>
        <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-10">
          <ErrorPanel
            message={e.status === 404 || e.status === 403 ? t("errors.companionUnavailable") : companionErrorText(t, e)}
            onRetry={e.status === 404 || e.status === 403 ? undefined : () => void refetch()}
          />
          <div className="text-center">
            <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })} className="gap-1.5">
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
              {t("room.backHome")}
            </Button>
          </div>
        </div>
      </LayoutContainer>
    );
  }

  const accent = accentOf(companion.accent_color);
  const { progress, resume } = data;
  const allLeaves = flattenLeaves(topics);
  const topicMap = (
    <TopicMap
      topics={topics}
      activeLeafId={activeMode === "ask" ? askLeafId : activeLeafId}
      resumeLeafId={resume?.node_id ?? null}
      onSelect={selectLeaf}
    />
  );

  return (
    <LayoutContainer>
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 sm:py-6 lg:space-y-6">
        {/* Header */}
        <header className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div
            aria-hidden
            className={cn("absolute inset-0", !accent && "bg-app-gradient opacity-50")}
            style={
              accent
                ? { backgroundImage: `linear-gradient(120deg, ${accentAlpha(accent, "26")}, ${accentAlpha(accent, "05")} 60%)` }
                : undefined
            }
          />
          <div className="relative flex items-start gap-3 p-card sm:gap-4 sm:p-card-lg">
            <CompanionAvatar emoji={companion.avatar_emoji} accent={companion.accent_color} size="lg" className="bg-white shadow-sm" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl dark:text-neutral-50">
                {companion.name}
              </h1>
              <p className="truncate text-sm text-neutral-600 dark:text-neutral-400">{companion.kb_name}</p>
              <div className="mt-3 max-w-md space-y-1.5">
                <ProgressBar percent={progress.leaves_total ? (progress.completed / progress.leaves_total) * 100 : 0} />
                <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  {t("shelf.stats", {
                    done: progress.completed,
                    total: progress.leaves_total,
                    mastery: progress.mastery,
                  })}
                </p>
              </div>
            </div>
            <ProgressRingMini
              percent={progress.mastery}
              size="lg"
              tone={masteryTone(progress.mastery)}
              className="hidden sm:inline-flex"
            >
              <span className="flex flex-col items-center leading-none">
                <span className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-50">
                  {progress.mastery}%
                </span>
                <span className="mt-0.5 text-xs text-neutral-500">{t("room.masteredShort")}</span>
              </span>
            </ProgressRingMini>
          </div>

          {/* Mode switch + mobile map button */}
          <div className="relative flex items-center gap-2 border-t border-neutral-100 bg-white/70 px-3 py-2.5 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/70">
            {modes.length > 1 && (
              <div role="tablist" aria-label={t("room.modes")} className="flex flex-1 gap-1 rounded-xl bg-neutral-100 p-1 sm:flex-none dark:bg-neutral-800">
                {modes.map((m) => {
                  const Icon = MODE_ICON[m];
                  const selected = m === activeMode;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => switchMode(m)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all sm:flex-none sm:px-4",
                        selected
                          ? "bg-white text-primary-500 shadow-sm dark:bg-neutral-900"
                          : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                      )}
                    >
                      <Icon className="size-4" weight={selected ? "fill" : "regular"} aria-hidden />
                      {t(`modes.${m}`)}
                    </button>
                  );
                })}
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => setMapOpen(true)}
              className="ms-auto h-10 shrink-0 gap-1.5 rounded-xl lg:hidden"
              aria-label={t("map.open")}
            >
              <ListBullets className="size-4" aria-hidden />
              <span className="hidden xs:inline">{t("map.title")}</span>
            </Button>
          </div>
        </header>

        <div className="lg:flex lg:items-start lg:gap-6">
          {/* Topic map — desktop column */}
          <aside className="hidden space-y-4 lg:sticky lg:top-4 lg:block lg:w-80 lg:shrink-0">
            {activeMode !== "ask" && <ContinueCard topics={topics} resume={resume} onContinue={continueLearning} compact />}
            <div className="max-h-screen overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {t("map.title")}
              </p>
              {topicMap}
            </div>
          </aside>

          {/* Main */}
          <main ref={mainRef} className="min-w-0 flex-1 scroll-mt-4">
            {activeMode === "ask" ? (
              <section className="rounded-2xl border border-neutral-200 bg-white p-card shadow-sm sm:p-card-lg dark:border-neutral-800 dark:bg-neutral-900">
                <AskPanel
                  companionId={companionId}
                  companion={companion}
                  contextLeaf={askLeaf}
                  onClearContext={() => setAskLeafId(null)}
                  prefill={prefill}
                  readAloud={readAloud}
                  suggestionLeaves={allLeaves}
                />
              </section>
            ) : active && activeMode ? (
              <section className="rounded-2xl border border-neutral-200 bg-white p-card shadow-sm sm:p-card-lg dark:border-neutral-800 dark:bg-neutral-900">
                {/* Where am I */}
                <div className="mb-4 flex items-center gap-2">
                  <nav aria-label={t("room.breadcrumb")} className="flex min-w-0 flex-1 items-center gap-1 text-sm">
                    {!active.leaf.is_topic && (
                      <>
                        <span className="truncate text-neutral-500 dark:text-neutral-400">{active.topic.title}</span>
                        <CaretRight className="size-3.5 shrink-0 text-neutral-400 rtl:rotate-180" aria-hidden />
                      </>
                    )}
                    <span className="truncate font-semibold text-neutral-900 dark:text-neutral-50">
                      {active.leaf.title}
                    </span>
                  </nav>
                  <button
                    type="button"
                    onClick={() => {
                      readAloud.stop();
                      setActiveLeafId(null);
                    }}
                    className="shrink-0 rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
                    aria-label={t("room.closeTopic")}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>

                {activeMode === "learn" ? (
                  <LessonPlayer
                    key={active.leaf.id}
                    companionId={companionId}
                    companion={companion}
                    leaf={active.leaf}
                    nextLeaf={nextLeaf}
                    readAloud={readAloud}
                    isPlay={isPlay}
                    onProgress={applyProgress}
                    onPractice={modes.includes("practice") ? () => switchMode("practice") : null}
                    onOpenLeaf={(id) => {
                      setActiveLeafId(id);
                      scrollToMain();
                    }}
                    onAskAboutCard={modes.includes("ask") ? askAboutCard : null}
                  />
                ) : (
                  <PracticeRunner
                    key={active.leaf.id}
                    companionId={companionId}
                    leaf={active.leaf}
                    isPlay={isPlay}
                    onProgress={applyProgress}
                    onLearn={modes.includes("learn") ? () => switchMode("learn") : null}
                  />
                )}
              </section>
            ) : (
              <div className="space-y-4">
                <section className="rounded-2xl border border-neutral-200 bg-white p-card shadow-sm sm:p-card-lg dark:border-neutral-800 dark:bg-neutral-900">
                  <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                    {data.learner_name
                      ? t("room.greeting", { name: data.learner_name.split(" ")[0] })
                      : t("room.greetingNoName")}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {activeMode === "practice"
                      ? t("room.pickToPractise")
                      : companion.description || t("room.pickToLearn", { kb: companion.kb_name })}
                  </p>
                  {activeMode === "learn" && (
                    <div className="mt-4">
                      <ContinueCard topics={topics} resume={resume} onContinue={continueLearning} />
                    </div>
                  )}
                </section>
                {/* On small screens the map lives here as well as in the sheet. */}
                <section className="rounded-2xl border border-neutral-200 bg-white p-2 lg:hidden dark:border-neutral-800 dark:bg-neutral-900">
                  <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {t("map.title")}
                  </p>
                  {topicMap}
                </section>
                <section className="hidden rounded-2xl border border-dashed border-neutral-200 px-6 py-12 text-center lg:block dark:border-neutral-700">
                  <p className="text-4xl" aria-hidden>
                    👈
                  </p>
                  <p className="mt-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">
                    {t("room.pickFromMap")}
                  </p>
                </section>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Topic map — mobile sheet */}
      <Sheet open={mapOpen} onOpenChange={setMapOpen}>
        <SheetContent side="left" className="w-full overflow-y-auto p-3 sm:max-w-sm">
          <SheetTitle className="px-2 pb-3 pt-1">{t("map.title")}</SheetTitle>
          {activeMode !== "ask" && (
            <div className="mb-3">
              <ContinueCard topics={topics} resume={resume} onContinue={continueLearning} compact />
            </div>
          )}
          {topicMap}
        </SheetContent>
      </Sheet>
    </LayoutContainer>
  );
}
