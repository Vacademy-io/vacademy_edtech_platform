import { useMemo, useState, useRef, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    FileText,
    Play,
    ArrowCounterClockwise,
    CaretDown,
    CaretUp,
    Clock,
    ListBullets,
    Pencil,
    Trash,
    Plus,
} from '@phosphor-icons/react';

interface ScriptReviewProps {
    script: string;
    prompt: string;
    onScriptChange: (text: string) => void;
    onResume: () => void;
    onDiscard: () => void;
    isResuming?: boolean;
    /** Header title. Defaults to "Review Script"; the assist narration gate
     *  relabels it to "Review narration". */
    title?: string;
    /** Subtitle under the title. */
    subtitle?: string;
    /** Primary CTA label. Defaults to "Proceed to Video". */
    ctaLabel?: string;
    /** Secondary action label. Defaults to "Start Over". */
    discardLabel?: string;
}

/**
 * Reading rate used to estimate sentence durations. Google TTS Chirp3-HD
 * speaks at roughly 160 words per minute (~14 characters per second). This is
 * a heuristic — real timings come out of TTS + Whisper alignment in the next
 * pipeline stage. The estimate is close enough for editing decisions:
 * "is this sentence too long?", "does the pacing feel even?"
 */
const WORDS_PER_SECOND = 160 / 60; // ≈ 2.667
const MIN_SENTENCE_DURATION = 0.4; // floor for short fragments like "Right."

/**
 * Split a script into sentences. Handles period / question / exclamation
 * followed by whitespace + a capital letter or opening quote. Common
 * abbreviations don't cleanly handle here, but for narration scripts (which
 * are written for speech, not academic prose) the heuristic is good enough.
 *
 * Newlines are flattened — narration scripts use line breaks for readability,
 * not as sentence separators.
 */
function splitSentences(text: string): string[] {
    if (!text || !text.trim()) return [];
    const flat = text.replace(/\s*\n+\s*/g, ' ').trim();
    // Split on sentence terminators followed by whitespace and a capital /
    // opening quote / opening paren / opening bracket.
    const parts = flat.split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/);
    return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function countWords(s: string): number {
    return s.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function estimateDuration(s: string): number {
    const words = countWords(s);
    if (words === 0) return 0;
    return Math.max(MIN_SENTENCE_DURATION, words / WORDS_PER_SECOND);
}

function formatTime(sec: number): string {
    const total = Math.max(0, Math.round(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m === 0) return `0:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function joinSentences(sentences: string[]): string {
    return sentences
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join(' ');
}

interface Sentence {
    id: string;
    text: string;
    start: number;
    end: number;
    words: number;
}

function buildTimeline(text: string): Sentence[] {
    const raw = splitSentences(text);
    let cursor = 0;
    return raw.map((s, i) => {
        const dur = estimateDuration(s);
        const start = cursor;
        const end = start + dur;
        cursor = end;
        return {
            id: `s${i}`,
            text: s,
            start,
            end,
            words: countWords(s),
        };
    });
}

/**
 * One sentence row in the timeline view. Inline-edits update a draft string
 * which is committed back to the parent on blur (avoids re-splitting on every
 * keystroke).
 */
function SentenceRow({
    s,
    index,
    total,
    onUpdate,
    onDelete,
    onInsertAfter,
    disabled,
}: {
    s: Sentence;
    index: number;
    total: number;
    onUpdate: (id: string, newText: string) => void;
    onDelete: (id: string) => void;
    onInsertAfter: (id: string) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation('videoApiStudioScriptReview');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(s.text);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        // Keep draft in sync when the parent re-derives sentences (e.g. after
        // an insert/delete shifts indices).
        setDraft(s.text);
    }, [s.text]);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            // Auto-size to content
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
        }
    }, [editing]);

    const commit = () => {
        const next = draft.trim();
        if (next !== s.text.trim()) {
            onUpdate(s.id, next);
        }
        setEditing(false);
    };

    const tooShort = s.words > 0 && s.words < 3;
    const tooLong = s.words > 28;

    return (
        <div className="group relative flex gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-muted/30">
            {/* Time badge column */}
            <div className="flex w-24 shrink-0 flex-col items-end gap-0.5 pt-0.5">
                <span className="font-mono text-2xs font-medium tabular-nums text-foreground">
                    {formatTime(s.start)} – {formatTime(s.end)}
                </span>
                <span className="text-2xs text-muted-foreground">
                    {t('counts.words', { count: s.words })}
                </span>
            </div>

            {/* Vertical timeline rule */}
            <div className="relative flex shrink-0 flex-col items-center">
                <span className="mt-1.5 inline-block size-2 rounded-full bg-violet-400 ring-2 ring-violet-100" />
                {index < total - 1 && (
                    <span className="mt-1 w-px flex-1 bg-border" />
                )}
            </div>

            {/* Body */}
            <div className="min-w-0 flex-1">
                {editing ? (
                    <textarea
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => {
                            setDraft(e.target.value);
                            if (inputRef.current) {
                                inputRef.current.style.height = 'auto';
                                inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
                            }
                        }}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                commit();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setDraft(s.text);
                                setEditing(false);
                            }
                        }}
                        disabled={disabled}
                        className="w-full resize-none rounded-md border bg-background px-2 py-1 text-sm leading-relaxed outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                        rows={1}
                    />
                ) : (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setEditing(true)}
                        className="block w-full cursor-text rounded-md px-2 py-1 text-left text-sm leading-relaxed text-foreground hover:bg-muted/50 disabled:cursor-default disabled:opacity-60"
                    >
                        {s.text}
                    </button>
                )}
                <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
                    {tooShort && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            {t('sentenceRow.shortFragment')}
                        </span>
                    )}
                    {tooLong && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            {t('sentenceRow.longSentence')}
                        </span>
                    )}
                </div>
            </div>

            {/* Hover actions */}
            {!editing && !disabled && (
                <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        title={t('sentenceRow.editTitle')}
                    >
                        <Pencil className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => onInsertAfter(s.id)}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        title={t('sentenceRow.insertTitle')}
                    >
                        <Plus className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => onDelete(s.id)}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                        title={t('sentenceRow.deleteTitle')}
                    >
                        <Trash className="size-3.5" />
                    </button>
                </div>
            )}
        </div>
    );
}

export function ScriptReview({
    script,
    prompt,
    onScriptChange,
    onResume,
    onDiscard,
    isResuming,
    title,
    subtitle,
    ctaLabel,
    discardLabel,
}: ScriptReviewProps) {
    const { t } = useTranslation('videoApiStudioScriptReview');
    const resolvedTitle = title ?? t('defaults.title');
    const resolvedSubtitle = subtitle ?? t('defaults.subtitle');
    const resolvedCtaLabel = ctaLabel ?? t('defaults.ctaLabel');
    const resolvedDiscardLabel = discardLabel ?? t('defaults.discardLabel');

    const [showPrompt, setShowPrompt] = useState(false);
    const [view, setView] = useState<'timeline' | 'raw'>('timeline');

    // Recompute the timeline whenever the script string changes. Splitting is
    // cheap (~milliseconds) for narration-length scripts.
    const sentences = useMemo(() => buildTimeline(script), [script]);

    const totalDuration = sentences[sentences.length - 1]?.end ?? 0;
    const wordCount = useMemo(
        () => script.trim().split(/\s+/).filter((w) => w.length > 0).length,
        [script],
    );

    // Sentence-level edits compose a new script string and bubble it up to
    // the parent. The parent's `onScriptChange` is the single source of truth.
    const updateSentence = (id: string, newText: string) => {
        const next = sentences.map((s) =>
            s.id === id ? { ...s, text: newText } : s,
        );
        onScriptChange(joinSentences(next.map((s) => s.text)));
    };

    const deleteSentence = (id: string) => {
        const next = sentences.filter((s) => s.id !== id);
        onScriptChange(joinSentences(next.map((s) => s.text)));
    };

    const insertAfter = (id: string) => {
        const idx = sentences.findIndex((s) => s.id === id);
        if (idx < 0) return;
        const before = sentences.slice(0, idx + 1).map((s) => s.text);
        const after = sentences.slice(idx + 1).map((s) => s.text);
        onScriptChange(
            joinSentences([
                ...before,
                t('sentenceRow.newSentencePlaceholder'),
                ...after,
            ]),
        );
    };

    return (
        <div className="mx-auto w-full max-w-3xl px-2 py-4 sm:px-4">
            <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
                {/* Header */}
                <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                            <FileText className="size-5 text-violet-600" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold text-foreground">
                                {resolvedTitle}
                            </h2>
                            <p className="truncate text-xs text-muted-foreground">
                                {resolvedSubtitle}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                        <span className="hidden items-center gap-1 rounded-md bg-muted px-2 py-1 sm:flex">
                            <Clock className="size-3" />
                            {t('approxDuration', { time: formatTime(totalDuration) })}
                        </span>
                        <span className="rounded-md bg-muted px-2 py-1">
                            {t('counts.words', { count: wordCount })}
                        </span>
                        <span className="rounded-md bg-muted px-2 py-1">
                            {t('counts.sentences', { count: sentences.length })}
                        </span>
                    </div>
                </div>

                {/* Original prompt (collapsible) */}
                <button
                    className="flex w-full items-center gap-2 border-b px-5 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/30"
                    onClick={() => setShowPrompt((v) => !v)}
                >
                    {showPrompt ? (
                        <CaretUp className="size-3.5" />
                    ) : (
                        <CaretDown className="size-3.5" />
                    )}
                    <span className="font-medium">{t('prompt.toggleLabel')}</span>
                    {!showPrompt && (
                        <span className="ml-1 truncate opacity-60">{prompt}</span>
                    )}
                </button>
                {showPrompt && (
                    <div className="border-b bg-muted/20 px-5 py-3 text-sm text-foreground">
                        {prompt}
                    </div>
                )}

                {/* View toggle */}
                <div className="flex items-center justify-between border-b px-5 py-2.5">
                    <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
                        <button
                            type="button"
                            onClick={() => setView('timeline')}
                            className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
                                view === 'timeline'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <ListBullets className="size-3.5" />
                            {t('viewToggle.timeline')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setView('raw')}
                            className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
                                view === 'raw'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <Pencil className="size-3.5" />
                            {t('viewToggle.editRaw')}
                        </button>
                    </div>
                    <span className="text-2xs text-muted-foreground">
                        {t('viewToggle.estimatesNote', { wpm: Math.round(WORDS_PER_SECOND * 60) })}
                    </span>
                </div>

                {/* Body */}
                {view === 'timeline' ? (
                    <div className="max-h-[60vh] overflow-y-auto px-3 py-3" /* design-lint-ignore: viewport-relative scroll panel (not a dialog), no named token matches 60vh */>
                        {sentences.length === 0 ? (
                            <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
                                <Trans
                                    t={t}
                                    i18nKey="timeline.empty"
                                    components={{ strong: <strong /> }}
                                />
                            </div>
                        ) : (
                            <div className="flex flex-col gap-0.5">
                                {sentences.map((s, i) => (
                                    <SentenceRow
                                        key={s.id}
                                        s={s}
                                        index={i}
                                        total={sentences.length}
                                        onUpdate={updateSentence}
                                        onDelete={deleteSentence}
                                        onInsertAfter={insertAfter}
                                        disabled={isResuming}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="p-5">
                        <Textarea
                            value={script}
                            onChange={(e) => onScriptChange(e.target.value)}
                            rows={20}
                            className="resize-y font-mono text-sm leading-relaxed"
                            placeholder={t('rawView.placeholder')}
                            disabled={isResuming}
                        />
                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
                    <button
                        onClick={onDiscard}
                        disabled={isResuming}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                        <ArrowCounterClockwise className="size-3.5" />
                        {resolvedDiscardLabel}
                    </button>
                    <Button
                        onClick={onResume}
                        disabled={isResuming || !script.trim()}
                        className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                    >
                        <Play className="size-4" />
                        {isResuming ? t('resuming') : resolvedCtaLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}
