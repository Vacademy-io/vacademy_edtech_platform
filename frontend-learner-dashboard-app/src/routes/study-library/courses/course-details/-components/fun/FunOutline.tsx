import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { serverProgress, isTestKind, type SlideKind, type SlideRowState } from "./course-outline";

/*
 * The Fun skin's course outline pieces (styles/fun/course.css). The existing
 * outline keeps its data loading, drip evaluation, open state and navigation;
 * under ui-fun it draws these instead of its own rows. Put them inside an
 * element carrying the course's fun-course-N class.
 */

const lowerTerm = (term: string) => term.toLocaleLowerCase();

/** Slide terms as the institute names them, lower-cased for running text. */
export const slidesWord = () => lowerTerm(getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides));
/** The singular or plural slide term for a count ("1 of 1 slide", "2 of 5 slides"). */
export const slidesWordFor = (count: number) =>
  count === 1 ? lowerTerm(getTerminology(ContentTerms.Slides, SystemTerms.Slides)) : slidesWord();

/** Icons for the kinds of slide. Stroke-only, 24px grid, drawn in currentColor. */
export function FunTypeIcon({ kind, className }: { kind: SlideKind; className?: string }) {
  const common = {
    className: cn("fun-type-icon", className),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "video":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="M16 10 L21 7 V17 L16 14" />
        </svg>
      );
    case "htmlVideo":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M10 8.5 L14.5 10.5 L10 12.5 Z" />
          <path d="M8 21 H16" />
        </svg>
      );
    case "audio":
      return (
        <svg {...common}>
          <path d="M4 15 V12 A8 8 0 0 1 20 12 V15" />
          <rect x="3" y="14" width="4" height="6" rx="1.5" />
          <rect x="17" y="14" width="4" height="6" rx="1.5" />
        </svg>
      );
    case "quiz":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 9 H15 M9 13 H15" />
        </svg>
      );
    case "assessment":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 12 L11 14 L15 10" />
        </svg>
      );
    case "question":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5 A2.5 2.5 0 1 1 12.8 11.9 C12.2 12.2 12 12.6 12 13.4" />
          <path d="M12 16.6 V16.7" />
        </svg>
      );
    case "assignment":
      return (
        <svg {...common}>
          <path d="M14 3 H7 A2 2 0 0 0 5 5 V19 A2 2 0 0 0 7 21 H17 A2 2 0 0 0 19 19 V8 Z" />
          <path d="M14 3 V8 H19 M9 13 H15 M9 17 H13" />
        </svg>
      );
    case "presentation":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M12 16 V20 M8 20 H16" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <path d="M9 8 L5 12 L9 16 M15 8 L19 12 L15 16" />
        </svg>
      );
    case "scorm":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12 H21 M12 3 C15 6 15 18 12 21 C9 18 9 6 12 3" />
        </svg>
      );
    case "pdf":
    case "doc":
    case "feedback":
    case "other":
    default:
      return (
        <svg {...common}>
          <path d="M14 3 H7 A2 2 0 0 0 5 5 V19 A2 2 0 0 0 7 21 H17 A2 2 0 0 0 19 19 V8 Z" />
          <path d="M14 3 V8 H19" />
        </svg>
      );
  }
}

const Padlock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11 V8 A4 4 0 0 1 16 8 V11" />
  </svg>
);

const Chevron = ({ open }: { open: boolean }) => (
  <svg className="fun-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={open ? "M6 15 L12 9 L18 15" : "M9 6 L15 12 L9 18"} />
  </svg>
);

/** The 28px circle at the start of a slide row. */
export function FunSlideMark({
  state,
  index,
  kind,
  locked,
  current,
}: {
  state: SlideRowState;
  index: number;
  kind: SlideKind;
  locked: boolean;
  current: boolean;
}) {
  if (locked) {
    return (
      <span className="fun-mark fun-mark--locked" aria-hidden="true">
        <Padlock />
      </span>
    );
  }
  if (current && state !== "done") {
    return (
      <span className="fun-mark fun-mark--current" aria-hidden="true">
        <svg viewBox="0 0 16 18">
          <path d="M2 1.5 L14.5 9 L2 16.5 Z" />
        </svg>
      </span>
    );
  }
  if (state === "done") {
    return (
      <span className="fun-mark fun-mark--done" aria-hidden="true">
        <svg viewBox="0 0 28 28">
          <path d="M8 14.5 L12 18 L20 10" />
        </svg>
      </span>
    );
  }
  if (state === "inProgress") {
    return (
      <span className="fun-mark fun-mark--half" aria-hidden="true">
        <svg viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="12" className="fun-mark__ring" />
          <path d="M14 2 A12 12 0 0 0 14 26 Z" className="fun-mark__fill" />
        </svg>
      </span>
    );
  }
  if (isTestKind(kind)) {
    return (
      <span className="fun-mark fun-mark--test" aria-hidden="true">
        <FunTypeIcon kind={kind} />
      </span>
    );
  }
  return (
    <span className="fun-mark fun-mark--number" aria-hidden="true">
      {index}
    </span>
  );
}

const activateOnKey = (handler?: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if (!handler) return;
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handler();
  }
};

/**
 * One slide row. Clickability and the lock come from the caller, exactly as the
 * existing outline decides them for that depth.
 */
export function FunSlideRow({
  title,
  index,
  state,
  kind,
  current,
  locked,
  unlockMessage,
  clickable,
  onOpen,
  meta,
  trailing,
  activeStyle = false,
}: {
  title: string;
  index: number;
  state: SlideRowState;
  kind: SlideKind;
  current: boolean;
  locked: boolean;
  unlockMessage?: string | null | undefined;
  clickable: boolean;
  onOpen?: () => void;
  meta?: string;
  trailing?: ReactNode;
  /** The viewer's slide list: `current` is the open slide, drawn filled even when done, with no Continue label. */
  activeStyle?: boolean;
}) {
  const { t } = useTranslation("funCourse");
  const { t: tc } = useTranslation("funCommon");
  const stateWord = locked
    ? t("course.locked")
    : state === "done"
      ? tc("done")
      : state === "inProgress"
        ? t("course.inProgress")
        : tc("notStarted");
  const isCurrent = current && !locked && (activeStyle || state !== "done");
  return (
    <div
      className={cn(
        "fun-row",
        isCurrent && "fun-row--current",
        locked && "fun-row--locked",
        state === "done" && !locked && "fun-row--done",
        clickable && "fun-row--link",
      )}
      data-fun-row-state={locked ? "locked" : isCurrent ? "current" : state}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? t("course.stateLabel", { state: stateWord, title }) : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={clickable ? activateOnKey(onOpen) : undefined}
    >
      <FunSlideMark state={state} index={index} kind={kind} locked={locked} current={isCurrent} />
      <span className="fun-row__body">
        <span className="fun-row__title" title={title}>
          {title}
        </span>
        {!clickable && <span className="sr-only">{stateWord}</span>}
        {locked && unlockMessage ? <span className="fun-row__lock">{unlockMessage}</span> : null}
      </span>
      {meta ? (
        <span className="fun-row__meta">
          <FunTypeIcon kind={kind} />
          <span>{meta}</span>
        </span>
      ) : null}
      {kind === "quiz" && !isCurrent ? <span className="fun-row__tag">{t("course.quizTag")}</span> : null}
      {isCurrent && !activeStyle ? <span className="fun-row__continue">{t("course.continue")}</span> : null}
      {trailing}
    </div>
  );
}


/** The inside of a chapter card's toggle: number badge, name, subtitle, chevron. */
export function FunChapterHead({
  index,
  name,
  open,
  locked,
  unlockMessage,
  doneCount,
  percent,
  hideProgress = false,
  slideCount = null,
  trailing,
}: {
  index: number;
  name: string;
  open: boolean;
  locked: boolean;
  unlockMessage?: string | null | undefined;
  /** "X of Y done" once the chapter's slides are loaded and one is done; else null. */
  doneCount: { done: number; total: number } | null;
  /** The server's chapter percent, for a chapter whose slides are not loaded. */
  percent: number | null | undefined;
  /**
   * The institute hides progress: no percent, "Done" or "X of Y done". The card says
   * how many slides it holds once they are loaded, and nothing before that.
   */
  hideProgress?: boolean;
  /** The chapter's slide count once its slides are loaded; else null. */
  slideCount?: number | null;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation("funCourse");
  const { t: tc } = useTranslation("funCommon");
  const progress = serverProgress(percent);
  const subtitle: { text: string; done: boolean } | null = hideProgress
    ? slideCount !== null && slideCount > 0
      ? { text: t("course.countChip", { count: slideCount, term: slidesWordFor(slideCount) }), done: false }
      : null
    : doneCount
    ? {
        text: t("course.doneOf", { done: doneCount.done, total: doneCount.total, slides: slidesWordFor(doneCount.total) }),
        done: doneCount.done === doneCount.total,
      }
    : progress.kind === "done"
      ? { text: tc("done"), done: true }
      : progress.kind === "percent"
        ? { text: tc("percentDone", { percent: progress.percent }), done: false }
        : { text: tc("notStarted"), done: false };
  return (
    <>
      <span className={cn("fun-ch__badge", locked && "fun-ch__badge--locked")} aria-hidden="true">
        {locked ? <Padlock /> : index}
      </span>
      <span className="fun-ch__text">
        <span className="fun-ch__title">{name}</span>
        {locked && unlockMessage ? (
          <span className="fun-ch__sub">{unlockMessage}</span>
        ) : subtitle ? (
          <span className={cn("fun-ch__sub", subtitle.done && "fun-ch__sub--done")}>{subtitle.text}</span>
        ) : null}
      </span>
      {trailing ? <span className="fun-ch__end">{trailing}</span> : null}
      {!locked && <Chevron open={open} />}
    </>
  );
}

/** The inside of a subject or module toggle: eyebrow, name, progress, chevron. */
export function FunLevelHead({
  level,
  index,
  name,
  open,
  locked,
  unlockMessage,
  percent,
  childCount,
  childTerm,
  hideProgress = false,
  trailing,
}: {
  level: "subject" | "module";
  index: number;
  name: string;
  open: boolean;
  locked: boolean;
  unlockMessage?: string | null | undefined;
  percent: number | null | undefined;
  childCount: number;
  childTerm: "modules" | "chapters";
  /** The institute hides progress: the head says how many it holds, never a percent or "Done". */
  hideProgress?: boolean;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation("funCourse");
  const { t: tc } = useTranslation("funCommon");
  const levelTerm =
    level === "subject"
      ? getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)
      : getTerminology(ContentTerms.Modules, SystemTerms.Modules);
  const childWord =
    childTerm === "modules"
      ? childCount === 1
        ? getTerminology(ContentTerms.Modules, SystemTerms.Modules)
        : getTerminologyPlural(ContentTerms.Modules, SystemTerms.Modules)
      : childCount === 1
        ? getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)
        : getTerminologyPlural(ContentTerms.Chapters, SystemTerms.Chapters);
  const progress = serverProgress(percent);
  return (
    <>
      {locked ? (
        <span className="fun-lv__lock" aria-hidden="true">
          <Padlock />
        </span>
      ) : null}
      <span className="fun-lv__text">
        <span className="fun-lv__eyebrow">{t("course.levelEyebrow", { level: levelTerm, index })}</span>
        <span className="fun-lv__title">{name}</span>
        {locked && unlockMessage ? <span className="fun-lv__sub">{unlockMessage}</span> : null}
      </span>
      {locked ? (
        <span className="fun-lv__locked">{t("course.locked")}</span>
      ) : hideProgress ? (
        <span className="fun-lv__muted">{t("course.countChip", { count: childCount, term: lowerTerm(childWord) })}</span>
      ) : progress.kind === "done" ? (
        <span className="fun-lv__done">{t("course.levelDone", { count: childCount, term: lowerTerm(childWord) })}</span>
      ) : progress.kind === "percent" ? (
        <span className="fun-lv__progress">
          <FunProgress percent={progress.percent} />
          <span>{tc("percentDone", { percent: progress.percent })}</span>
        </span>
      ) : (
        <span className="fun-lv__muted">{tc("notStarted")}</span>
      )}
      {trailing ? <span className="fun-lv__end">{trailing}</span> : null}
      {!locked && <Chevron open={open} />}
    </>
  );
}

/** Placeholder rows at the final size while a chapter's slides load. */
export function FunRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="fun-rows-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="fun-rows-skeleton__row">
          <span className="fun-skeleton fun-rows-skeleton__mark" />
          <span className="fun-skeleton fun-rows-skeleton__line" />
        </div>
      ))}
    </div>
  );
}

/** A loaded chapter with nothing in it (or nothing left after the search). */
export function FunNoSlides() {
  const { t } = useTranslation("funCourse");
  return <p className="fun-no-slides">{t("course.noSlides", { slides: slidesWord() })}</p>;
}

/**
 * The outline's controls under ui-fun: search, "only unfinished", expand all and
 * the whole-course download. The state and handlers stay with the outline.
 */
export function FunOutlineTools({
  search,
  onSearch,
  onlyUnfinished,
  onOnlyUnfinished,
  showExpand,
  allExpanded,
  onToggleExpand,
  download,
  switchSlot,
}: {
  search: string;
  onSearch: (value: string) => void;
  onlyUnfinished: boolean;
  onOnlyUnfinished: (value: boolean) => void;
  showExpand: boolean;
  allExpanded: boolean;
  onToggleExpand: () => void;
  download?: ReactNode;
  /** The app's switch control, rendered by the caller so the toggle stays the same component. */
  switchSlot: (props: { id: string; checked: boolean; onCheckedChange: (value: boolean) => void }) => ReactNode;
}) {
  const { t } = useTranslation("funCourse");
  const slides = slidesWord();
  return (
    <div className="fun-tools">
      <label className="fun-tools__search">
        <span className="sr-only">{t("course.searchSlides", { slides })}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 L20 20" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t("course.searchSlides", { slides })}
        />
      </label>
      <div className="fun-tools__row">
        <label className="fun-tools__switch" htmlFor="fun-only-unfinished">
          {switchSlot({ id: "fun-only-unfinished", checked: onlyUnfinished, onCheckedChange: onOnlyUnfinished })}
          <span>{t("course.onlyUnfinished")}</span>
        </label>
        {showExpand ? (
          <button type="button" className="fun-btn fun-btn--outline fun-btn--compact fun-tools__expand" onClick={onToggleExpand}>
            {allExpanded ? t("course.collapseAll") : t("course.expandAll")}
          </button>
        ) : null}
        {download}
      </div>
    </div>
  );
}
