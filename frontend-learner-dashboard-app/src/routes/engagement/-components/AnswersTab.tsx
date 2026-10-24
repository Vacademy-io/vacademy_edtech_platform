import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChatCircleText } from "@phosphor-icons/react";
import type { EngagementFeed, EngagementItem } from "@/services/engagement";
import { EmptyState, ErrorState, LoadingState } from "@/components/design-system/states";
import type { UseEngagementFeedResult } from "@/routes/dashboard/-components/engagement/use-engagement-feed";
import { useServerClockSkew } from "@/routes/dashboard/-components/engagement/use-engagement-feed";
import { ecn, skinClasses } from "@/routes/dashboard/-components/engagement/engagement-tone";
import { answerFormat } from "@/routes/dashboard/-components/engagement/engagement-copy";
import { RevealCard, type EngagementAnswerItem } from "./RevealCard";
import { useEngagementHistory } from "./PastTab";

/**
 * The Answers tab (D10, D25): every question and poll the learner answered
 * recently, with the payoff.
 *
 * - "Waiting" holds answers whose result, key or model answer is still to come,
 *   soonest first.
 * - "Revealed" holds the rest, newest first: the key and explanation, the class's
 *   correct rate, poll bars, "You wrote…" and the model answer.
 *
 * Sources, merged by task (attempts are per task): the feed's `revealed` list (it
 * alone carries `correctRate`), today's finished tasks, and two weeks of history.
 */

const ANSWER_WINDOW_DAYS = 14;

function isAnswerable(item: EngagementItem): boolean {
  return item.itemType === "QUESTION_OF_DAY" || item.itemType === "POLL";
}

function isFinished(item: EngagementItem): boolean {
  return (item.attemptStatus ?? "").toUpperCase() === "COMPLETED" || item.historyStatus === "DONE";
}

function ms(iso: string | null | undefined): number | null {
  const value = Date.parse(iso ?? "");
  return Number.isFinite(value) ? value : null;
}

/** Still waiting for something the reveal brings. */
function isWaiting(item: EngagementAnswerItem, now: number): boolean {
  if (item.isRevealed === true) return false;
  if (item.resultPending === true) return true;
  const reveal = ms(item.revealAt);
  if (reveal == null || reveal <= now) return false;
  if (item.itemType === "POLL") return !(item.pollResults && item.pollResults.length > 0);
  if (answerFormat(item) === "MCQ") return !item.correctOptionId;
  // Written and uploaded answers wait for the model answer.
  return true;
}

export interface AnswerGroups {
  waiting: EngagementAnswerItem[];
  revealed: EngagementAnswerItem[];
}

/** Merge and split the answer sources. Pure; `now` is server time. */
export function buildAnswerGroups(
  feed: EngagementFeed | null | undefined,
  history: EngagementItem[] | undefined,
  now: number
): AnswerGroups {
  const byId = new Map<string, EngagementAnswerItem>();
  const add = (item: EngagementItem) => {
    if (!isAnswerable(item) || !isFinished(item)) return;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      return;
    }
    // Earlier sources are richer; a later one only fills the fields they lack.
    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(item)) {
      if (merged[key] === null || merged[key] === undefined) merged[key] = value;
    }
    byId.set(item.id, merged as unknown as EngagementAnswerItem);
  };
  for (const item of feed?.revealed ?? []) add(item);
  for (const item of feed?.doneToday ?? []) add(item);
  for (const item of history ?? []) add(item);

  const waiting: EngagementAnswerItem[] = [];
  const revealed: EngagementAnswerItem[] = [];
  for (const item of byId.values()) {
    (isWaiting(item, now) ? waiting : revealed).push(item);
  }
  const revealMs = (i: EngagementItem) => ms(i.revealAt) ?? ms(i.completedAt) ?? 0;
  waiting.sort((a, b) => revealMs(a) - revealMs(b));
  revealed.sort((a, b) => revealMs(b) - revealMs(a));
  return { waiting, revealed };
}

export interface AnswersTabProps {
  feed: UseEngagementFeedResult;
  showPoints: boolean;
}

export function AnswersTab({ feed, showPoints }: AnswersTabProps) {
  const { t } = useTranslation("dashboardEngagement");
  const history = useEngagementHistory(ANSWER_WINDOW_DAYS);
  const skew = useServerClockSkew();
  const now = Date.now() + skew;

  const groups = useMemo(
    () => buildAnswerGroups(feed.feed, history.data?.items, Date.now() + skew),
    [feed.feed, history.data, skew]
  );

  const loading = (feed.status === "loading" || history.status === "loading") && groups.revealed.length + groups.waiting.length === 0;
  const failed = feed.status === "error" && history.status === "error";
  const partialError = !failed && (feed.status === "error" || history.status === "error" || history.refetchError || feed.refetchError);
  const retry = () => {
    feed.retry();
    history.retry();
  };

  if (failed) {
    return (
      <div className={ecn(skinClasses("card"), "p-card")}>
        <ErrorState title={t("page.answers.error")} onRetry={retry} />
      </div>
    );
  }
  if (loading) return <LoadingState variant="list" count={3} />;

  const empty = groups.waiting.length === 0 && groups.revealed.length === 0;

  return (
    <div className="flex flex-col gap-section">
      {partialError && <ErrorState variant="inline" message={t("page.refreshError")} onRetry={retry} />}

      {empty ? (
        <div className={ecn(skinClasses("card"), "p-card")}>
          <EmptyState
            icon={ChatCircleText}
            title={t("page.answers.emptyTitle")}
            description={t("page.answers.emptyBody")}
            compact
          />
        </div>
      ) : (
        <>
          {groups.waiting.length > 0 && (
            <section aria-labelledby="engagement-answers-waiting" className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 id="engagement-answers-waiting" className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
                  {t("page.answers.waiting", { count: groups.waiting.length })}
                </h2>
                <p className={ecn("text-caption", skinClasses("mutedInk"))}>{t("page.answers.waitingHint")}</p>
              </div>
              {groups.waiting.map((item) => (
                <RevealCard key={item.id} item={item} variant="waiting" showPoints={showPoints} now={now} />
              ))}
            </section>
          )}
          {groups.revealed.length > 0 && (
            <section aria-labelledby="engagement-answers-revealed" className="flex flex-col gap-3">
              <h2 id="engagement-answers-revealed" className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
                {t("page.answers.revealed", { count: groups.revealed.length })}
              </h2>
              {groups.revealed.map((item) => (
                <RevealCard key={item.id} item={item} variant="revealed" showPoints={showPoints} now={now} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
