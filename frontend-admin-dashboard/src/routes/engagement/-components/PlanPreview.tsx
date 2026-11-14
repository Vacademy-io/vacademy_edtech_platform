import DOMPurify from 'dompurify';
import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
    CalendarCheck,
    CaretRight,
    GameController,
    GraduationCap,
    Info,
    LockSimple,
    Star,
    UploadSimple,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { getEngagementSettings } from '@/routes/settings/-services/engagement-settings';
import type {
    EngagementItemType,
    FlashcardCard,
    MissPolicy,
    QuestionFormat,
} from '../-types/types';
import { ENGAGEMENT_TYPE_META, typeMeta } from '../-utils/type-meta';
import { formatTime } from '../-utils/format';
import type { ItemForm, SlotForm } from './forms/composer-schema';
import {
    estimateFlashcardMinutes,
    extractLegacyDeck,
    parseFlashcardsPayload,
} from './flashcards/flashcards-schema';
import { FlashcardPreview } from './flashcards/FlashcardPreview';
import { SandboxHarness } from './preview/SandboxHarness';

/**
 * "What learners see": a live preview of one day, built from the composer's form as the
 * teacher types: the task being edited as the learner's runner shows it, then the
 * learner app's Today module (the day's task list). The runner comes first so the task
 * the teacher is editing stays in sight however long the day is.
 *
 * It mirrors the learner rules rather than listing fields:
 * - the answer key never shows (the server redacts it until the reveal), and a line
 *   says when learners find out if they were right: straight away, or at the reveal,
 *   driven by `hideResultUntilReveal`;
 * - TEXT and UPLOAD questions show a text box or an upload drop zone, not options;
 * - flashcards show the flip card and follow the card the editor is on;
 * - a game's score bonus only shows when the institute rewards unverified scores
 *   (a game reports its own score), and "Test game" runs it in a sandbox;
 * - teacher-only facts (reveal timing, catch-up, reading gate) sit in "Notes for you"
 *   under the mock, never inside it.
 *
 * Rows are clickable: a click opens that task above the list and calls `onSelect`, so the
 * composer can open its editor. `activeKey` (the composer's open task) wins again the
 * next time it changes.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * One task as the preview needs it. The first block of fields is the original
 * (wave 1) shape, still passed by callers that build tasks by hand; the rest are
 * optional and only sharpen the preview.
 */
export interface PreviewTask {
    key: string;
    itemType: EngagementItemType;
    title: string;
    isRequired?: boolean;
    contentHtml?: string;
    prompt?: string;
    options?: { id: string; text: string }[];
    correctOptionId?: string;
    explanation?: string;
    completionPoints?: number;
    correctPoints?: number;
    /** QUESTION_OF_DAY answer format; MCQ when absent. */
    format?: QuestionFormat;
    hideResultUntilReveal?: boolean;
    /** GAME top score. */
    maxScore?: number | null;
    /** FLASHCARDS deck; parsed from `payloadJson` when absent. */
    cards?: Pick<FlashcardCard, 'id' | 'front' | 'back' | 'hint'>[];
    shuffle?: boolean;
    /** Raw payload, for callers that only have the saved/AI item. */
    payloadJson?: string | null;
    /** COURSE_SLIDE: the picked lesson's title. */
    lessonTitle?: string;
    /** Per-task miss policy override (null = the plan's). */
    missPolicy?: MissPolicy | null;
    catchUpDays?: number | null;
    catchUpPercent?: number | null;
}

/** The composer's day form (`slots.${n}`). */
export type ComposerSlotForm = SlotForm;

interface PreviewCommonProps {
    /** The task to show opened; defaults to the first. */
    activeKey?: string | null;
    /** A row was clicked. */
    onSelect?: (key: string) => void;
    /** FLASHCARDS: the card the deck editor is on. */
    activeCardId?: string | null;
    className?: string;
}

/** Preview one day of the composer form. */
export interface PlanPreviewSlotProps extends PreviewCommonProps {
    slot: ComposerSlotForm | null | undefined;
    /** The plan's miss policy, used when a task has no override. */
    defaultMissPolicy?: MissPolicy | null;
    defaultCatchUpDays?: number | null;
    defaultCatchUpPercent?: number | null;
    tasks?: undefined;
}

/** The original props (hand-built tasks plus the day's window). */
export interface PlanPreviewLegacyProps extends PreviewCommonProps {
    tasks: PreviewTask[];
    startTime: string;
    endTime: string;
    revealTime?: string;
    missPolicy: MissPolicy;
    catchUpPercent?: number;
    slot?: undefined;
}

export type PlanPreviewProps = PlanPreviewSlotProps | PlanPreviewLegacyProps;

/** A solid per-type marker (design tokens only), kept for callers of the old export. */
export const ENGAGEMENT_TYPE_ACCENT: Partial<Record<EngagementItemType, string>> =
    Object.fromEntries(
        Object.values(ENGAGEMENT_TYPE_META).map((meta) => [meta.type, meta.accent.dot])
    );

// ── Form → preview ───────────────────────────────────────────────────────────

/** Map one composer task to the preview's shape. */
export function previewTaskFromItem(item: ItemForm): PreviewTask {
    const base: PreviewTask = {
        key: item.key,
        itemType: item.itemType,
        title: item.title,
        isRequired: item.isRequired,
        contentHtml: item.contentHtml,
        completionPoints: item.completionPoints,
        correctPoints: item.correctPoints,
        hideResultUntilReveal: item.hideResultUntilReveal,
        maxScore: item.maxScore ?? null,
        missPolicy: item.missPolicy ?? null,
        catchUpDays: item.catchUpDays ?? null,
        catchUpPercent: item.catchUpPercent ?? null,
    };
    switch (item.itemType) {
        case 'QUESTION_OF_DAY':
        case 'POLL':
            return {
                ...base,
                format: item.itemType === 'POLL' ? 'MCQ' : item.question.format,
                prompt: item.question.prompt,
                options: item.question.options,
                correctOptionId: item.question.correctOptionId,
                explanation: item.question.explanation,
            };
        case 'FLASHCARDS':
            return {
                ...base,
                cards: item.flashcards.cards,
                shuffle: item.flashcards.shuffle,
                // The server forces these for a deck; show what learners will get.
                correctPoints: 0,
                hideResultUntilReveal: false,
            };
        case 'COURSE_SLIDE': {
            const title = item.slide?.slideTitle;
            return { ...base, lessonTitle: typeof title === 'string' ? title : undefined };
        }
        case 'QUIZ':
            return { ...base, payloadJson: item.payloadJson ?? null };
        default:
            return base;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(html: string): string {
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        // A <style> or <link> would restyle the admin page itself.
        FORBID_TAGS: ['style', 'link', 'form', 'input', 'button', 'textarea', 'select'],
    });
}

function plainText(html: string | undefined): string {
    if (!html) return '';
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Reading frame (mirrors the learner's ReadingBody) ────────────────────────

function sameText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

const TITLE_WRAPPERS = new Set(['MAIN', 'ARTICLE', 'SECTION', 'DIV', 'HEADER', 'HGROUP']);

function hasLeadingText(el: Element): boolean {
    for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 1) return false;
        if (node.nodeType === 3 && (node.textContent ?? '').trim()) return true;
    }
    return false;
}

/**
 * The learner runner drops a reading's first heading when it repeats the task title
 * (the runner header already shows it); do the same so the preview matches.
 */
export function stripLeadingTitleHeading(html: string, title?: string | null): string {
    if (!html || !title || typeof DOMParser === 'undefined') return html;
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        if (hasLeadingText(doc.body)) return html;
        let first: Element | null = doc.body.firstElementChild;
        while (
            first &&
            TITLE_WRAPPERS.has(first.tagName) &&
            first.firstElementChild &&
            !hasLeadingText(first)
        ) {
            first = first.firstElementChild;
        }
        if (!first || !/^H[1-3]$/.test(first.tagName)) return html;
        if (sameText(first.textContent ?? '') !== sameText(title)) return html;
        first.remove();
        const doctype = /^\s*<!doctype/i.test(html) ? '<!DOCTYPE html>' : '';
        return `${doctype}${doc.documentElement.outerHTML}`;
    } catch {
        return html;
    }
}

/** The admin theme's font and colours, read live so the reading looks like the app. */
function hostReadingCss(): string {
    if (typeof document === 'undefined') return '';
    try {
        const root = getComputedStyle(document.documentElement);
        const hsl = (name: string) => {
            const value = root.getPropertyValue(name).trim();
            return value ? `hsl(${value})` : '';
        };
        const vars: Record<string, string> = {
            '--vac-font': getComputedStyle(document.body).fontFamily,
            '--vac-ink': hsl('--foreground'),
            '--vac-muted': hsl('--muted-foreground'),
            '--vac-primary': hsl('--primary-500'),
            '--vac-border': hsl('--border'),
        };
        const fonts = Array.from(
            document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
        )
            .map((link) => link.href)
            .filter((href) => /^https:\/\/fonts\.googleapis\.com\/[^"'()\\\s]+$/.test(href))
            .map((href) => `@import url("${href}");`)
            .join('');
        const declared = Object.entries(vars)
            .filter(([, value]) => Boolean(value) && !/[;{}<>]/.test(value))
            .map(([key, value]) => `${key}:${value};`)
            .join('');
        return `${fonts}:root{${declared}}`;
    } catch {
        return '';
    }
}

/** The learner's base reading styles (ReadingBody), sized for the preview column. */
const READING_BASE_CSS = [
    'html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}',
    'html,body{background:transparent;}',
    'body{margin:0;padding:0;font-family:var(--vac-font,system-ui,sans-serif);font-size:15px;line-height:1.6;color:var(--vac-ink,CanvasText);overflow-wrap:anywhere;}',
    'h1,h2,h3,h4{line-height:1.3;font-weight:700;margin:1.2em 0 .5em;}',
    'h1{font-size:1.5em;margin-top:0;}h2{font-size:1.25em;}h3{font-size:1.1em;}h4{font-size:1em;}',
    'p,ul,ol,blockquote,pre,figure,table{margin-top:0;margin-bottom:1em;}',
    'ul,ol{padding-inline-start:1.4em;}li{margin-bottom:.35em;}',
    'img,video,svg,canvas,iframe{max-width:100%;height:auto;}',
    'a{color:var(--vac-primary,LinkText);}',
    'blockquote{margin-inline:0;padding-inline-start:1em;border-inline-start:3px solid var(--vac-border,currentColor);color:var(--vac-muted,inherit);}',
    'pre{white-space:pre-wrap;overflow-x:auto;}',
    'table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto;}',
    'th,td{border:1px solid var(--vac-border,currentColor);padding:.4em .6em;text-align:start;}',
].join('');

/** Put the base styles first, so the document's own CSS still wins (as for learners). */
function readingDocument(html: string, hostCss: string): string {
    const style = `<style>${hostCss}${READING_BASE_CSS}</style>`;
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => head + style);
    if (/<html[^>]*>/i.test(html)) {
        return html.replace(/<html[^>]*>/i, (open) => `${open}<head>${style}</head>`);
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body dir="auto">${html}</body></html>`;
}

/** Tallest a reading grows in the preview before it scrolls inside its frame. */
const READING_MAX_HEIGHT = 420;
const READING_MIN_HEIGHT = 48;

/**
 * A reading or visual note rendered the way the learner app renders it: a document in
 * a frame, so its own <style> and SVG work and none of it can restyle this page.
 *
 * `sandbox="allow-same-origin"` WITHOUT `allow-scripts`: the document's scripts never
 * run, so the same origin only lets this page measure the content height.
 */
function ReadingFrame({ html, title, label }: { html: string; title: string; label: string }) {
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    // Typing re-renders on every keystroke; reload the frame only once typing pauses.
    const [shown, setShown] = useState(html);
    useEffect(() => {
        const timer = window.setTimeout(() => setShown(html), 250);
        return () => window.clearTimeout(timer);
    }, [html]);
    const hostCss = useMemo(() => hostReadingCss(), []);
    const srcDoc = useMemo(
        () => readingDocument(stripLeadingTitleHeading(shown, title), hostCss),
        [shown, title, hostCss]
    );

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        let observer: ResizeObserver | null = null;
        const measure = () => {
            const doc = frame.contentDocument;
            if (!doc?.documentElement) return;
            const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
            const clamped = Math.min(READING_MAX_HEIGHT, Math.max(READING_MIN_HEIGHT, height));
            // A measured content height: dynamic by nature, so set on the element.
            frame.style.height = `${clamped}px`;
        };
        const onLoad = () => {
            measure();
            observer?.disconnect();
            const body = frame.contentDocument?.body;
            if (body && typeof ResizeObserver !== 'undefined') {
                observer = new ResizeObserver(measure);
                observer.observe(body);
            }
        };
        frame.addEventListener('load', onLoad);
        if (frame.contentDocument?.readyState === 'complete') onLoad();
        return () => {
            frame.removeEventListener('load', onLoad);
            observer?.disconnect();
        };
    }, []);

    return (
        <iframe
            ref={frameRef}
            title={label}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            className="block h-24 w-full border-0 bg-transparent"
        />
    );
}

/** Text, or a picture of some kind (a visual note can be an image or SVG only). */
function hasVisibleContent(html: string): boolean {
    return plainText(html) !== '' || /<(img|svg|video|canvas|iframe|picture)\b/i.test(html);
}

/** About 200 words a minute, at least 1; null when there is nothing to read. */
function readMinutes(html: string | undefined): number | null {
    const words = plainText(html).split(' ').filter(Boolean).length;
    return words === 0 ? null : Math.max(1, Math.ceil(words / 200));
}

function deckOf(task: PreviewTask): Pick<FlashcardCard, 'id' | 'front' | 'back' | 'hint'>[] {
    if (task.cards) return task.cards;
    return parseFlashcardsPayload(task.payloadJson ?? null)?.cards ?? [];
}

function formatOf(task: PreviewTask): QuestionFormat {
    return task.itemType === 'QUESTION_OF_DAY' ? task.format ?? 'MCQ' : 'MCQ';
}

type BonusKind = 'correct' | 'score' | null;

/** Which bonus a learner can see for this task (flashcards never have one). */
function bonusKindOf(task: PreviewTask, gameBonusEnabled: boolean): BonusKind {
    const correct = task.correctPoints ?? 0;
    if (correct <= 0) return null;
    if (task.itemType === 'QUESTION_OF_DAY' && formatOf(task) === 'MCQ') return 'correct';
    if (task.itemType === 'GAME' && gameBonusEnabled) return 'score';
    return null;
}

function maxPointsOf(task: PreviewTask, gameBonusEnabled: boolean): number {
    const completion = Math.max(0, task.completionPoints ?? 0);
    return bonusKindOf(task, gameBonusEnabled)
        ? completion + Math.max(0, task.correctPoints ?? 0)
        : completion;
}

// ── Component ────────────────────────────────────────────────────────────────

interface PreviewDay {
    tasks: PreviewTask[];
    startTime: string;
    endTime: string;
    revealTime: string;
    missPolicy: MissPolicy | null;
    catchUpDays: number | null;
    catchUpPercent: number | null;
}

function toPreviewDay(props: PlanPreviewProps): PreviewDay {
    if (props.tasks !== undefined) {
        return {
            tasks: props.tasks,
            startTime: props.startTime,
            endTime: props.endTime,
            revealTime: props.revealTime ?? '',
            missPolicy: props.missPolicy,
            catchUpDays: null,
            catchUpPercent: props.catchUpPercent ?? null,
        };
    }
    const slot = props.slot;
    return {
        tasks: (slot?.items ?? []).map(previewTaskFromItem),
        startTime: slot?.startTime ?? '',
        endTime: slot?.endTime ?? '',
        revealTime: slot?.revealTime ?? '',
        missPolicy: props.defaultMissPolicy ?? null,
        catchUpDays: props.defaultCatchUpDays ?? null,
        catchUpPercent: props.defaultCatchUpPercent ?? null,
    };
}

export function PlanPreview(props: PlanPreviewProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language || 'en';
    const { activeKey, onSelect, activeCardId, className } = props;

    // Cheap to rebuild each render; the form changes on every keystroke anyway.
    const day = toPreviewDay(props);

    // Institute settings: the game score bonus and the reading gate depend on them.
    const settingsQuery = useQuery({
        queryKey: ['engagement-settings'],
        queryFn: getEngagementSettings,
        staleTime: 5 * 60_000,
        retry: 1,
    });
    const settings = settingsQuery.data?.settings ?? null;
    const gameBonusEnabled = settings?.allowUnverifiedScoreBonus === true;

    // A click shows that row; the composer's activeKey takes over when it next changes.
    const [picked, setPicked] = useState<string | null>(null);
    useEffect(() => setPicked(null), [activeKey]);
    const runnerRef = useRef<HTMLElement | null>(null);

    const { tasks } = day;
    const wantedKey = picked ?? activeKey ?? null;
    const activeIndex = Math.max(
        0,
        tasks.findIndex((task) => task.key === wantedKey)
    );
    const active = tasks[activeIndex];

    const upNextKey = (tasks.find((task) => task.isRequired) ?? tasks[0])?.key;
    const totalPoints = tasks.reduce((sum, task) => sum + maxPointsOf(task, gameBonusEnabled), 0);
    const revealLabel = formatTime(day.revealTime || day.endTime, lang);
    const hasWindow = Boolean(day.startTime && day.endTime);

    return (
        <section aria-label={t('preview.heading')} className={cn('min-w-0 space-y-3', className)}>
            <div>
                <p className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                    {t('preview.heading')}
                </p>
                {hasWindow && (
                    <p className="mt-0.5 text-caption text-neutral-500">
                        {t('preview.open', {
                            start: formatTime(day.startTime, lang),
                            end: formatTime(day.endTime, lang),
                        })}
                        {day.revealTime && tasks.some((task) => task.itemType === 'QUESTION_OF_DAY')
                            ? ` · ${t('preview.answersAt', { time: revealLabel })}`
                            : ''}
                    </p>
                )}
            </div>

            {/* The opened task, as the learner's runner shows it */}
            {active && (
                <TaskRunnerMock
                    ref={runnerRef}
                    key={active.key}
                    task={active}
                    index={activeIndex}
                    total={tasks.length}
                    gameBonusEnabled={gameBonusEnabled}
                    revealLabel={revealLabel}
                    activeCardId={activeCardId}
                />
            )}

            {active && (
                <TeacherNotes
                    task={active}
                    day={day}
                    lang={lang}
                    revealLabel={revealLabel}
                    settingsState={settingsQuery.isError ? 'error' : settings ? 'ready' : 'loading'}
                    gameBonusEnabled={gameBonusEnabled}
                    minReadSeconds={settings?.minReadSeconds ?? null}
                    minScrollPercent={settings?.minScrollPercent ?? null}
                />
            )}
            {/* The learner's Today module */}
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                <div className="space-y-2 px-4 pb-3 pt-3.5">
                    <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-subtitle font-semibold text-neutral-900">
                            <CalendarCheck
                                size={18}
                                className="text-primary-500"
                                aria-hidden="true"
                            />
                            {t('preview.today')}
                        </p>
                        {tasks.length > 0 && (
                            <p className="text-caption tabular-nums text-neutral-500">
                                {t('preview.ofTasks', { done: 0, total: tasks.length })}
                            </p>
                        )}
                    </div>
                    {totalPoints > 0 && (
                        <p className="text-caption tabular-nums text-neutral-500">
                            {t('preview.pointsToday', { earned: 0, total: totalPoints })}
                        </p>
                    )}
                    {tasks.length > 0 && (
                        <div className="flex h-1 gap-0.5" aria-hidden="true">
                            {tasks.map((task) => (
                                <span
                                    key={task.key}
                                    className={cn(
                                        'h-full flex-1 rounded-full',
                                        task.isRequired ? 'bg-neutral-300' : 'bg-neutral-200'
                                    )}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {tasks.length === 0 ? (
                    <p className="border-t border-neutral-100 px-4 py-6 text-center text-body text-neutral-500">
                        {t('preview.addTask')}
                    </p>
                ) : (
                    <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                        {tasks.map((task) => (
                            <li key={task.key}>
                                <TaskRow
                                    task={task}
                                    active={task.key === active?.key}
                                    upNext={task.key === upNextKey}
                                    gameBonusEnabled={gameBonusEnabled}
                                    revealLabel={revealLabel}
                                    onClick={() => {
                                        setPicked(task.key);
                                        onSelect?.(task.key);
                                        // The opened task sits above the list; bring it back
                                        // into view when the list was scrolled to reach a row.
                                        runnerRef.current?.scrollIntoView?.({
                                            block: 'nearest',
                                            behavior: 'smooth',
                                        });
                                    }}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function usePointsLine(task: PreviewTask, gameBonusEnabled: boolean, revealLabel: string): string {
    const { t } = useTranslation('engagement');
    const completion = Math.max(0, task.completionPoints ?? 0);
    const correct = Math.max(0, task.correctPoints ?? 0);
    switch (bonusKindOf(task, gameBonusEnabled)) {
        case 'correct':
            return task.hideResultUntilReveal
                ? t('preview.points.withBonusAt', {
                      now: completion,
                      bonus: correct,
                      time: revealLabel,
                  })
                : t('preview.points.withBonus', { now: completion, bonus: correct });
        case 'score':
            return t('preview.points.upTo', { count: completion + correct });
        default:
            return completion > 0 ? t('preview.points.plain', { count: completion }) : '';
    }
}

function useDetailLine(task: PreviewTask): string {
    const { t } = useTranslation('engagement');
    switch (task.itemType) {
        case 'READING_HTML':
        case 'VISUAL_NOTE': {
            const minutes = readMinutes(task.contentHtml);
            return minutes ? t('preview.meta.minutes', { count: minutes }) : '';
        }
        case 'FLASHCARDS': {
            const n = deckOf(task).length;
            if (n === 0) return '';
            return `${t('preview.meta.cards', { count: n })} · ${t('preview.meta.estimate', {
                count: estimateFlashcardMinutes(n),
            })}`;
        }
        case 'QUESTION_OF_DAY':
            return t(`preview.formats.${formatOf(task)}`);
        default:
            return '';
    }
}

function TypeTile({ type, size = 'md' }: { type: EngagementItemType; size?: 'md' | 'lg' }) {
    const meta = typeMeta(type);
    const Icon = meta.icon;
    return (
        <span
            aria-hidden="true"
            className={cn(
                'flex shrink-0 items-center justify-center rounded-md',
                size === 'lg' ? 'size-10' : 'size-9',
                meta.accent.soft
            )}
        >
            <Icon size={size === 'lg' ? 20 : 18} weight="duotone" />
        </span>
    );
}

function MustDoBadge() {
    const { t } = useTranslation('engagement');
    return (
        <span className="inline-flex shrink-0 items-center rounded-sm border border-neutral-300 px-1.5 text-2xs font-medium text-neutral-700">
            {t('preview.mustDo')}
        </span>
    );
}

function TaskRow({
    task,
    active,
    upNext,
    gameBonusEnabled,
    revealLabel,
    onClick,
}: {
    task: PreviewTask;
    active: boolean;
    upNext: boolean;
    gameBonusEnabled: boolean;
    revealLabel: string;
    onClick: () => void;
}) {
    const { t } = useTranslation('engagement');
    const typeLabel = t(typeMeta(task.itemType).labelKey);
    const detail = useDetailLine(task);
    const points = usePointsLine(task, gameBonusEnabled, revealLabel);
    // A question's format ("Quick question", "Write it") already names it, like the learner app.
    const caption = [task.itemType === 'QUESTION_OF_DAY' ? '' : typeLabel, detail, points]
        .filter(Boolean)
        .join(' · ');
    const title = task.title.trim() || t('preview.untitled');

    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'true' : undefined}
            className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-start transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
                active ? 'bg-primary-50' : 'hover:bg-neutral-50'
            )}
        >
            <TypeTile type={task.itemType} />
            <span className="min-w-0 flex-1">
                {upNext && (
                    <span className="block text-2xs font-semibold uppercase tracking-wide text-primary-500">
                        {t('preview.upNext')}
                    </span>
                )}
                <span
                    dir="auto"
                    className={clsx(
                        'line-clamp-2 break-words text-body font-medium',
                        task.title.trim() ? 'text-neutral-900' : 'italic text-neutral-400'
                    )}
                >
                    {title}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    {caption && (
                        <span className="text-caption tabular-nums text-neutral-500">
                            {caption}
                        </span>
                    )}
                    {task.isRequired && <MustDoBadge />}
                </span>
            </span>
            <CaretRight
                size={16}
                className={clsx(
                    'shrink-0 rtl:rotate-180',
                    active ? 'text-primary-500' : 'text-neutral-400'
                )}
                aria-hidden="true"
            />
        </button>
    );
}

interface TaskRunnerMockProps {
    task: PreviewTask;
    index: number;
    total: number;
    gameBonusEnabled: boolean;
    revealLabel: string;
    activeCardId?: string | null;
}

const TaskRunnerMock = forwardRef<HTMLElement, TaskRunnerMockProps>(function TaskRunnerMock(
    { task, index, total, gameBonusEnabled, revealLabel, activeCardId },
    ref
) {
    const { t } = useTranslation('engagement');
    const title = task.title.trim() || t('preview.untitled');
    const completion = Math.max(0, task.completionPoints ?? 0);
    const points = usePointsLine(task, gameBonusEnabled, revealLabel);
    const format = formatOf(task);
    const isMcqQuestion = task.itemType === 'QUESTION_OF_DAY' && format === 'MCQ';
    const resultLater = isMcqQuestion && task.hideResultUntilReveal === true;

    return (
        <article
            ref={ref}
            aria-label={t('preview.runnerLabel', { title })}
            className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm"
        >
            {/* Header: tile, title, "2 of 4", meta chips */}
            <header className="border-b border-neutral-100 px-4 py-3">
                <div className="flex items-start gap-3">
                    <TypeTile type={task.itemType} size="lg" />
                    <div className="min-w-0 flex-1">
                        <p
                            dir="auto"
                            className={clsx(
                                'line-clamp-2 break-words text-subtitle font-semibold',
                                task.title.trim() ? 'text-neutral-900' : 'italic text-neutral-400'
                            )}
                        >
                            {title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                            <span className="text-caption tabular-nums text-neutral-500">
                                {t('preview.taskOf', { index: index + 1, total })}
                            </span>
                            <span className="flex h-1 w-24 gap-0.5" aria-hidden="true">
                                {Array.from({ length: total }, (_, i) => (
                                    <span
                                        key={i}
                                        className={cn(
                                            'h-full flex-1 rounded-full',
                                            i <= index ? 'bg-primary-500' : 'bg-neutral-200'
                                        )}
                                    />
                                ))}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {completion > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption font-medium tabular-nums text-neutral-700">
                            <Star
                                size={12}
                                weight="fill"
                                className="text-primary-500"
                                aria-hidden="true"
                            />
                            {t('preview.pts', { count: completion })}
                        </span>
                    )}
                    {task.isRequired && <MustDoBadge />}
                    {resultLater && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
                            <LockSimple size={12} aria-hidden="true" />
                            {t('preview.resultAt', { time: revealLabel })}
                        </span>
                    )}
                </div>
            </header>

            <div className="space-y-3 p-4">
                <RunnerBody
                    task={task}
                    gameBonusEnabled={gameBonusEnabled}
                    activeCardId={activeCardId}
                />
            </div>

            {/* Footer: reward line + the one primary action (flashcards own their footer). */}
            {task.itemType !== 'FLASHCARDS' && task.itemType !== 'QUIZ' && (
                <footer className="flex flex-col gap-2 border-t border-neutral-100 px-4 py-3">
                    <span className="min-w-0 text-caption tabular-nums text-neutral-600">
                        {task.itemType === 'GAME'
                            ? t(
                                  bonusKindOf(task, gameBonusEnabled) === 'score'
                                      ? 'preview.game.gateUpTo'
                                      : 'preview.game.gate',
                                  { count: maxPointsOf(task, gameBonusEnabled) }
                              )
                            : points}
                    </span>
                    {task.itemType !== 'GAME' && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable
                            className="w-full"
                        >
                            {t(actionKeyFor(task))}
                        </MyButton>
                    )}
                </footer>
            )}
        </article>
    );
});

function actionKeyFor(task: PreviewTask): string {
    switch (task.itemType) {
        case 'READING_HTML':
        case 'VISUAL_NOTE':
            return 'preview.actions.done';
        case 'POLL':
            return 'preview.actions.vote';
        case 'COURSE_SLIDE':
            return 'preview.actions.openLesson';
        case 'QUESTION_OF_DAY':
            return formatOf(task) === 'MCQ' ? 'preview.actions.check' : 'preview.actions.submit';
        default:
            return 'preview.actions.done';
    }
}

function RunnerBody({
    task,
    gameBonusEnabled,
    activeCardId,
}: {
    task: PreviewTask;
    gameBonusEnabled: boolean;
    activeCardId?: string | null;
}) {
    const { t } = useTranslation('engagement');
    const legacyDeck = useMemo(
        () => (task.itemType === 'GAME' ? extractLegacyDeck(task.contentHtml) : null),
        [task.itemType, task.contentHtml]
    );

    switch (task.itemType) {
        case 'READING_HTML':
        case 'VISUAL_NOTE':
            return task.contentHtml && hasVisibleContent(task.contentHtml) ? (
                <ReadingFrame
                    html={task.contentHtml}
                    title={task.title}
                    label={t('preview.reading.frameTitle', {
                        title: task.title.trim() || t('preview.untitled'),
                    })}
                />
            ) : (
                <p className="text-body text-neutral-500">{t('preview.reading.empty')}</p>
            );

        case 'QUESTION_OF_DAY':
        case 'POLL':
            return <QuestionBody task={task} />;

        case 'FLASHCARDS':
            return (
                <FlashcardPreview
                    cards={deckOf(task)}
                    activeCardId={activeCardId}
                    shuffle={task.shuffle}
                />
            );

        case 'GAME':
            return (
                <div className="space-y-3">
                    <div className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4">
                        <GameController
                            size={24}
                            className="shrink-0 text-neutral-500"
                            aria-hidden="true"
                        />
                        <p className="text-body text-neutral-600">{t('preview.game.stage')}</p>
                    </div>
                    <SandboxHarness
                        key={task.key}
                        html={task.contentHtml ?? ''}
                        kind={legacyDeck ? 'deck' : 'game'}
                        maxScore={task.maxScore}
                        completionPoints={task.completionPoints ?? 0}
                        correctPoints={task.correctPoints ?? 0}
                        bonusEnabled={gameBonusEnabled}
                    />
                </div>
            );

        case 'COURSE_SLIDE':
            return (
                <div className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3">
                    <GraduationCap
                        size={24}
                        className="shrink-0 text-success-600"
                        aria-hidden="true"
                    />
                    <div className="min-w-0">
                        <p
                            dir="auto"
                            className={clsx(
                                'line-clamp-2 break-words text-body font-medium',
                                task.lessonTitle ? 'text-neutral-900' : 'italic text-neutral-400'
                            )}
                        >
                            {task.lessonTitle || t('preview.lessonCard.pick')}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {t('preview.lessonCard.caption')}
                        </p>
                    </div>
                </div>
            );

        default:
            return <p className="text-body text-neutral-500">{t('preview.unsupported')}</p>;
    }
}

function QuestionBody({ task }: { task: PreviewTask }) {
    const { t } = useTranslation('engagement');
    const format = formatOf(task);
    const hasPrompt = plainText(task.prompt) !== '' || /<img\b/i.test(task.prompt ?? '');
    const options = (task.options ?? []).filter((option) => option.text.trim().length > 0);

    return (
        <div className="space-y-3">
            {hasPrompt ? (
                <div
                    dir="auto"
                    className="transform-gpu break-words text-body font-medium text-neutral-900 [&_img]:h-auto [&_img]:max-w-full"
                    // Composer-authored prompt, sanitized.
                    dangerouslySetInnerHTML={{ __html: sanitize(task.prompt ?? '') }}
                />
            ) : (
                <p className="text-body italic text-neutral-400">
                    {t('preview.question.noPrompt')}
                </p>
            )}

            {format === 'TEXT' && (
                <Textarea
                    disabled
                    rows={4}
                    placeholder={t('preview.question.textPlaceholder')}
                    aria-label={t('preview.question.textPlaceholder')}
                    className="resize-none"
                />
            )}

            {format === 'UPLOAD' && (
                <div className="flex flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center">
                    <UploadSimple size={24} className="text-neutral-500" aria-hidden="true" />
                    <p className="text-body font-medium text-neutral-700">
                        {t('preview.question.uploadTitle')}
                    </p>
                    <p className="text-caption text-neutral-500">
                        {t('preview.question.uploadHint')}
                    </p>
                </div>
            )}

            {format === 'MCQ' &&
                (options.length === 0 ? (
                    <p className="text-caption text-neutral-500">{t('preview.optionsHint')}</p>
                ) : (
                    <ul className="grid gap-2">
                        {options.map((option) => (
                            <li
                                key={option.id}
                                className="flex min-h-11 items-center gap-2.5 rounded-md border border-neutral-200 bg-white px-3 py-2"
                            >
                                <span
                                    aria-hidden="true"
                                    className="size-4 shrink-0 rounded-full border-2 border-neutral-300"
                                />
                                <span
                                    dir="auto"
                                    className="min-w-0 break-words text-body text-neutral-800"
                                >
                                    {option.text}
                                </span>
                            </li>
                        ))}
                    </ul>
                ))}
        </div>
    );
}

type SettingsState = 'loading' | 'ready' | 'error';

/** EngagementLearnerService.MIN_RESPONSES_FOR_RESULTS: a poll's split shows from this many votes. */
const POLL_MIN_VOTES = 5;

function TeacherNotes({
    task,
    day,
    lang,
    revealLabel,
    settingsState,
    gameBonusEnabled,
    minReadSeconds,
    minScrollPercent,
}: {
    task: PreviewTask;
    day: PreviewDay;
    lang: string;
    revealLabel: string;
    settingsState: SettingsState;
    gameBonusEnabled: boolean;
    minReadSeconds: number | null;
    minScrollPercent: number | null;
}) {
    const { t } = useTranslation('engagement');
    const notes: ReactNode[] = [];
    const format = formatOf(task);
    const correct = Math.max(0, task.correctPoints ?? 0);

    // When learners find out.
    if (task.itemType === 'QUESTION_OF_DAY') {
        if (format === 'MCQ') {
            notes.push(
                task.hideResultUntilReveal
                    ? t('preview.reveal.later', { time: revealLabel })
                    : t('preview.reveal.now', { time: revealLabel })
            );
        } else {
            notes.push(t('preview.reveal.written', { time: revealLabel }));
        }
    } else if (task.itemType === 'POLL') {
        // The server shows the split after a vote (or from the reveal when results are
        // held back), and only once POLL_MIN_VOTES have voted.
        notes.push(
            task.hideResultUntilReveal
                ? t('preview.reveal.pollAt', { time: revealLabel, count: POLL_MIN_VOTES })
                : t('preview.reveal.pollNow', { count: POLL_MIN_VOTES })
        );
    }

    // What finishing takes, and what it pays.
    if (task.itemType === 'READING_HTML' || task.itemType === 'VISUAL_NOTE') {
        if (minReadSeconds != null && minScrollPercent != null) {
            notes.push(
                t('preview.reading.gate', { seconds: minReadSeconds, percent: minScrollPercent })
            );
        }
    } else if (task.itemType === 'GAME' && correct > 0) {
        notes.push(
            settingsState === 'ready'
                ? gameBonusEnabled
                    ? t('preview.game.bonusOn', { count: correct })
                    : t('preview.game.bonusOff')
                : settingsState === 'error'
                  ? t('preview.game.bonusUnknown')
                  : null
        );
    } else if (task.itemType === 'FLASHCARDS') {
        notes.push(t('preview.flashcards.pointsNote'));
    } else if (task.itemType === 'COURSE_SLIDE') {
        notes.push(t('preview.lesson'));
    }

    // Catch-up.
    const policy = task.missPolicy ?? day.missPolicy;
    const days = task.catchUpDays ?? day.catchUpDays;
    const percent = task.catchUpPercent ?? day.catchUpPercent ?? 50;
    if (policy === 'EXPIRES') {
        notes.push(t('preview.catchUpNote.expires', { time: formatTime(day.endTime, lang) }));
    } else if (policy === 'CATCH_UP_FULL') {
        notes.push(
            days
                ? t('preview.catchUpNote.fullDays', { count: days })
                : t('preview.catchUpNote.full')
        );
    } else if (policy === 'CATCH_UP_REDUCED') {
        notes.push(
            days
                ? t('preview.catchUpNote.reducedDays', { count: days, percent })
                : t('preview.catchUpNote.reduced', { percent })
        );
    }

    const shown = notes.filter(Boolean);
    if (shown.length === 0) return null;

    return (
        <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
            <p className="text-caption font-semibold text-neutral-700">{t('preview.notesTitle')}</p>
            <ul className="mt-1 space-y-1">
                {shown.map((note, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-caption text-neutral-600">
                        <Info
                            size={14}
                            className="mt-0.5 shrink-0 text-info-500"
                            aria-hidden="true"
                        />
                        <span className="min-w-0">{note}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
