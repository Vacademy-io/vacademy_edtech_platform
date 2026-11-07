import { useEffect, useRef, useState } from 'react';
import type { TodayClass, TodayScope } from '@/classroom-shared/apiTypes';
import { classroomToday } from '../lib/api';
import { cn } from '@/lib/utils';
import { useStrings } from '../strings';
import { StartClass } from './StartClass';
import { ActionButton } from './ui';

type View = { kind: 'loading' } | { kind: 'ready'; classes: TodayClass[] } | { kind: 'failed' };

/** Today on the remote. Mine first, and all classes when mine is empty, like the panel. */
export function TodayList({ instituteId }: { instituteId: string }) {
    const s = useStrings();
    const [scope, setScope] = useState<TodayScope>('mine');
    const [autoAll, setAutoAll] = useState(false);
    const [view, setView] = useState<View>({ kind: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const teacherChose = useRef(false);

    useEffect(() => {
        let live = true;
        setView({ kind: 'loading' });
        classroomToday(instituteId, scope)
            .then((response) => {
                if (!live) return;
                if (scope === 'mine' && response.classes.length === 0 && !teacherChose.current) {
                    setAutoAll(true);
                    setScope('all');
                    return;
                }
                setView({ kind: 'ready', classes: response.classes });
            })
            .catch(() => {
                if (live) setView({ kind: 'failed' });
            });
        return () => {
            live = false;
        };
    }, [instituteId, scope, attempt]);

    const pick = (next: TodayScope) => {
        teacherChose.current = true;
        setAutoAll(false);
        setScope(next);
    };

    return (
        <section className="flex flex-col gap-3" data-state="today">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-title text-foreground">
                    {autoAll ? s.allClassesToday : s.todayTitle}
                </h2>
                <div className="flex gap-1">
                    {(['mine', 'all'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={scope === value}
                            onClick={() => pick(value)}
                            className={cn(
                                'h-10 rounded-md px-3 text-body',
                                scope === value
                                    ? 'bg-primary-100 text-neutral-700'
                                    : 'text-muted-foreground'
                            )}
                        >
                            {value === 'mine' ? s.mine : s.allClasses}
                        </button>
                    ))}
                </div>
            </div>

            {view.kind === 'loading' && (
                <div className="h-24 animate-pulse rounded-lg bg-muted" role="status" />
            )}

            {view.kind === 'failed' && (
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                    <p className="text-body text-muted-foreground">{s.todayError}</p>
                    <ActionButton secondary onClick={() => setAttempt((n) => n + 1)}>
                        {s.retry}
                    </ActionButton>
                </div>
            )}

            {view.kind === 'ready' && view.classes.length === 0 && (
                <p className="rounded-lg border p-3 text-body text-muted-foreground">
                    {s.noClassesToday}
                </p>
            )}

            {view.kind === 'ready' &&
                view.classes.map((item) => (
                    <article
                        key={item.schedule_id}
                        data-schedule={item.schedule_id}
                        className="flex flex-col gap-2 rounded-lg border bg-card p-3"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="truncate text-subtitle text-foreground">
                                    {item.title ?? s.startTitle}
                                </p>
                                <p className="text-body text-muted-foreground">
                                    {[item.time_label, item.subject].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                            {item.live_now && (
                                <span className="rounded-md bg-success-100 px-2 text-caption text-neutral-700">
                                    {s.liveNow}
                                </span>
                            )}
                        </div>
                        <StartClass
                            item={item}
                            instituteId={instituteId}
                            secondary={!item.live_now}
                        />
                    </article>
                ))}
        </section>
    );
}
