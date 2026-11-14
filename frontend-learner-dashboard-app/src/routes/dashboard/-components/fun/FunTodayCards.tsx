import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CalendarChip } from "@/components/design-system/fun/chips";
import { FunButton } from "@/components/design-system/fun/FunButton";
import type { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import type { DailyTaskProgress } from "../play/useDashboardHeroData";
import { bannerClassOf, dayOffset, formatClassTime, laterClassOf, sessionStartMs } from "./live-timing";
import { goalCardKind, orderTodayCards, type TodayCardId } from "./home-state";
import { goalTaskOf } from "./goal-task";
import { useEngagementFeed } from "../engagement/use-engagement-feed";
import { useEngagementTaskHost } from "../engagement/EngagementTaskHost";
import { CheckSquareIcon, ClipboardIcon } from "./fun-icons";
import { useNow } from "./use-fun-home-bits";
import { useHideProgress } from "@/hooks/use-hide-progress";

export interface FunTodayInput {
  liveSessions: readonly SessionDetails[];
  /** upcomingLiveClasses widget on. */
  showClass: boolean;
  /** todayTasks widget on. The card shows only while a plan runs. */
  showGoal: boolean;
  /** gamification widget on: the goal card may show the ring and its count. */
  showRing: boolean;
  /** Set while a teacher's daily plan runs (done / scheduled today). */
  taskProgress: DailyTaskProgress | null;
  /** evaluationStat widget on. */
  showTests: boolean;
  /** Live tests open now (the evaluation stat's own count). */
  testCount: number;
  /** Each card's widget order, so the institute's saved order holds. */
  order: Record<TodayCardId, number>;
}

/** The goal ring: done / scheduled, never more than full. */
function GoalRing({ done, total, size }: { done: number; total: number; size: number }) {
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const fraction = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <svg className="fun-ring" aria-hidden="true" width={size} height={size} viewBox="0 0 44 44">
      <circle className="fun-ring__track" cx="22" cy="22" r={r} />
      {fraction > 0 && (
        <circle
          className="fun-ring__fill"
          cx="22"
          cy="22"
          r={r}
          strokeDasharray={`${(fraction * circumference).toFixed(1)} ${circumference.toFixed(1)}`}
          transform="rotate(-90 22 22)"
        />
      )}
    </svg>
  );
}

/** "TODAY 5:00 PM" / "TOMORROW 10:00 AM" in the learner's own zone and language. */
export function useClassWhen() {
  const { t, i18n } = useTranslation("funHome");
  return (session: SessionDetails, nowMs: number): string => {
    const startMs = sessionStartMs(session);
    const time = formatClassTime(startMs, i18n.language) ?? "";
    const offset = dayOffset(startMs, nowMs);
    return offset <= 0 ? t("today.chipToday", { time }) : t("today.chipTomorrow", { time });
  };
}

/**
 * The Today cards (boards Main, A-LiveNow, A-HideProgress, A-Laptop, A-Done):
 * - goal: tasks done / scheduled while a teacher's plan runs (the next task instead
 *   where the institute hides progress or has gamification off). It opens the plan's
 *   next task in the same runner the Today module uses, or the plan's page when no
 *   task is open;
 * - class: the next class within 24 hours that is not live or about to start (those
 *   sit above the hero), with a calendar chip;
 * - tests: how many live tests are open now. Count only: there is no title or date.
 *
 * `grid` sits under the hero on a phone, `rail` is the laptop's right column, `next`
 * is the finished home's "What's next" (the goal card leads it while a plan runs).
 */
export function FunTodayCards({ variant, ...input }: FunTodayInput & { variant: "grid" | "rail" | "next" }) {
  const { t } = useTranslation("funHome");
  const now = useNow();
  const classWhen = useClassWhen();
  const hideProgress = useHideProgress();
  const navigate = useNavigate();
  const host = useEngagementTaskHost();
  // The same query (and key) the dashboard already reads: no extra request.
  const { feed } = useEngagementFeed({ enabled: input.showGoal });

  const banner = bannerClassOf(input.liveSessions, now);
  const later = input.showClass ? laterClassOf(input.liveSessions, now, banner) : null;
  const plan = input.taskProgress && input.taskProgress.scheduled > 0 ? input.taskProgress : null;
  const goal = goalCardKind({ planRunning: Boolean(plan), showGoal: input.showGoal, hideProgress, showRing: input.showRing });
  const goalTask = goal ? goalTaskOf(feed) : null;
  const openGoal = () => {
    if (goalTask) host.open(goalTask.item.id, { queue: goalTask.queue, item: goalTask.item });
    else void navigate({ to: "/engagement", search: { tab: "today" } });
  };
  const tests = input.showTests && input.testCount > 0 ? input.testCount : 0;

  const present: { id: TodayCardId; order: number }[] = [];
  if (goal) present.push({ id: "goal", order: variant === "next" ? Number.MIN_SAFE_INTEGER : input.order.goal });
  if (later) present.push({ id: "class", order: input.order.class });
  if (tests > 0) present.push({ id: "tests", order: input.order.tests });
  const ids = orderTodayCards(present);
  if (ids.length === 0) return null;

  const rail = variant === "rail";
  const testsCard = (
    <Link key="tests" to="/assessment/examination" className={cn("fun-today__card fun-today__card--tests", rail && "fun-today__card--stack")}>
      {rail ? (
        <>
          <span className="fun-today__eyebrow fun-t-eyebrow">{t("today.testsEyebrow")}</span>
          <span className="fun-today__title">{t("today.testsLong", { count: tests })}</span>
          <span className="fun-today__sub">{t("today.testsSee")}</span>
        </>
      ) : (
        <>
          <span className="fun-today__icon" aria-hidden="true">
            <ClipboardIcon />
          </span>
          <span className="fun-today__text">
            <span className="fun-today__big">{t("today.tests", { count: tests })}</span>
            <span className="fun-today__small">{t("today.openNow")}</span>
          </span>
        </>
      )}
    </Link>
  );

  const render = (id: TodayCardId) => {
    if (id === "goal" && plan) {
      const done = Math.min(plan.done, plan.scheduled);
      const openLabel = goalTask ? t("today.openTask") : t("today.openPlan");
      if (goal === "next") {
        // No task open now: either today's plan is done, or its next tasks open later.
        const title =
          goalTask?.item.title || (plan.done >= plan.scheduled ? t("today.tasksDone") : t("today.seePlan"));
        return (
          <button
            key="goal"
            type="button"
            className="fun-today__card fun-today__card--goal fun-today__card--stack fun-today__card--button"
            onClick={openGoal}
            aria-label={`${t("today.nextTask")}: ${title}. ${openLabel}`}
          >
            <span className="fun-today__eyebrow fun-t-eyebrow fun-today__eyebrow--icon" aria-hidden="true">
              <CheckSquareIcon />
              {t("today.nextTask")}
            </span>
            <span className="fun-today__title fun-clamp-2" aria-hidden="true">
              {title}
            </span>
          </button>
        );
      }
      const left = Math.max(0, plan.scheduled - plan.done);
      return (
        <button
          key="goal"
          type="button"
          className="fun-today__card fun-today__card--goal fun-today__card--button"
          onClick={openGoal}
          aria-label={`${t("today.ringLabel", { done, total: plan.scheduled })}. ${openLabel}`}
        >
          <GoalRing done={plan.done} total={plan.scheduled} size={rail ? 64 : 44} />
          <span className="fun-today__text" aria-hidden="true">
            <span className="fun-today__big">
              {rail
                ? t("today.tasksLong", { done, total: plan.scheduled })
                : t("today.tasks", { done, total: plan.scheduled })}
            </span>
            <span className="fun-today__small">
              {rail ? (left > 0 ? t("today.tasksLeft", { count: left }) : t("today.tasksDone")) : t("today.tasksToday")}
            </span>
          </span>
        </button>
      );
    }
    if (id === "class" && later) {
      return (
        <Link key="class" to="/study-library/live-class" className="fun-today__card fun-today__card--class fun-today__card--stack">
          <CalendarChip>{classWhen(later, now)}</CalendarChip>
          <span className="fun-today__title fun-clamp-2">{later.title}</span>
        </Link>
      );
    }
    if (id === "tests" && tests > 0) {
      if (variant === "next") {
        return (
          <section key="tests" className="fun-next__tests" aria-labelledby="fun-next-tests">
            <div className="fun-next__tests-head">
              <span className="fun-today__icon" aria-hidden="true">
                <ClipboardIcon />
              </span>
              <span className="fun-today__text">
                <h3 id="fun-next-tests" className="fun-next__tests-title">{t("done.testsTitle", { count: tests })}</h3>
                <span className="fun-next__tests-body">{t("done.testsBody")}</span>
              </span>
            </div>
            <FunButton asChild variant="primary" block>
              <Link to="/assessment/examination">{t("done.goTests")}</Link>
            </FunButton>
          </section>
        );
      }
      return testsCard;
    }
    return null;
  };

  if (variant === "next") {
    return (
      <section className="fun-next" aria-labelledby="fun-next-title">
        <h2 id="fun-next-title" className="fun-section-title">{t("done.next")}</h2>
        <div className="fun-next__list">{ids.map(render)}</div>
      </section>
    );
  }

  return (
    <section
      className={cn("fun-today", rail ? "fun-today--rail" : "fun-today--grid", !rail && ids.length === 1 && "fun-today--single")}
      aria-label={rail ? undefined : t("today.label")}
      aria-labelledby={rail ? "fun-today-title" : undefined}
    >
      {rail && (
        <h2 id="fun-today-title" className="fun-section-title">
          {t("today.label")}
        </h2>
      )}
      {ids.map(render)}
    </section>
  );
}
