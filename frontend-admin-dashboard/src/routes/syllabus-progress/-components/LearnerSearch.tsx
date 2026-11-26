import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { syllabusErrorMessage, useSyllabusLearnerSearch } from '@/services/syllabus-progress';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

/** Find one learner by name, username or enrolment number, without choosing a batch first. */
export function LearnerSearch({
    instituteId,
    onPick,
}: {
    instituteId: string;
    onPick: (userId: string) => void;
}) {
    const { t } = useTranslation('syllabusProgress');
    const [text, setText] = useState('');
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // Close the results on a click or tap anywhere outside the search box.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    useEffect(() => {
        const id = window.setTimeout(() => setQ(text.trim()), DEBOUNCE_MS);
        return () => window.clearTimeout(id);
    }, [text]);

    const { data, isFetching, isError, error } = useSyllabusLearnerSearch(instituteId, q);
    const typed = text.trim();
    const showPanel = open && typed.length > 0;
    const results = data ?? [];

    const pick = (userId: string) => {
        setText('');
        setQ('');
        setOpen(false);
        onPick(userId);
    };

    const renderPanel = () => {
        if (typed.length < MIN_CHARS) {
            return (
                <p className="px-3 py-2 text-caption text-neutral-500">{t('search.minChars')}</p>
            );
        }
        // Until the debounce catches up with what is typed, show loading — never the previous
        // query's error or results.
        if (q !== typed || (!data && !isError)) {
            return (
                <div className="space-y-2 p-3" aria-busy>
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                </div>
            );
        }
        if (isError) {
            return (
                <p className="px-3 py-2 text-caption text-danger-600">
                    {syllabusErrorMessage(error, t('search.failed'))}
                </p>
            );
        }
        if (results.length === 0) {
            return (
                <p className="px-3 py-2 text-caption text-neutral-500">
                    {t('search.empty', { q: typed })}
                </p>
            );
        }
        return (
            <ul className="divide-y divide-border" aria-label={t('search.results')}>
                {results.map((learner) => (
                    <li key={learner.user_id}>
                        <button
                            type="button"
                            onClick={() => pick(learner.user_id)}
                            className="flex w-full flex-col items-start gap-1 px-3 py-2 text-start hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none"
                        >
                            <span className="text-body font-semibold text-neutral-800">
                                {learner.full_name || learner.username || t('search.noName')}
                            </span>
                            {learner.enrollment_number && (
                                <span className="text-caption text-neutral-500">
                                    {t('grid.enrollment', { number: learner.enrollment_number })}
                                </span>
                            )}
                            {learner.batches.map((b) => (
                                <span
                                    key={b.package_session_id}
                                    className="text-caption text-neutral-600"
                                >
                                    {t('search.batchLine', {
                                        course: b.course_name,
                                        stage: b.level_name,
                                        batch: b.batch_name,
                                        done: b.completed_blocks,
                                        total: b.total_blocks,
                                    })}
                                </span>
                            ))}
                        </button>
                    </li>
                ))}
            </ul>
        );
    };

    return (
        <div
            ref={rootRef}
            className="relative w-full"
            onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
            }}
            onFocus={() => setOpen(true)}
            onBlur={(e) => {
                // Focus moving to another element (Tab) closes the results. A null relatedTarget
                // (a click on a result in Safari) is left to the pointerdown listener above.
                const next = e.relatedTarget as Node | null;
                if (next && !e.currentTarget.contains(next)) setOpen(false);
            }}
        >
            <MagnifyingGlass
                className="pointer-events-none absolute start-3 top-5 size-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
            />
            <MyInput
                inputType="text"
                input={text}
                onChangeFunction={(e) => {
                    setText(e.target.value);
                    setOpen(true);
                }}
                inputPlaceholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                className="w-full ps-9 sm:w-full"
                size="large"
            />
            {showPanel && (
                <div
                    className={cn(
                        'absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-auto rounded-lg border border-border bg-card shadow-lg transition-opacity',
                        isFetching && q === typed && 'opacity-70'
                    )}
                    aria-live="polite"
                >
                    {renderPanel()}
                </div>
            )}
        </div>
    );
}
