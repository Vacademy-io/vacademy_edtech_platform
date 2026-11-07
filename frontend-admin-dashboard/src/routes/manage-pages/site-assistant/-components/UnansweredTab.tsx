import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChatCircleDots, Plus } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { formatRelative } from '@/lib/formatters';
import {
    SITE_ASSISTANT_QUERY_KEY,
    fetchUnanswered,
    type UnansweredGroup,
} from '../-services/site-assistant-service';
import { KnowledgeDialog, emptyKnowledgeInput } from './KnowledgeDialog';
import { EmptyState, ErrorState } from './TabStates';

export const UNANSWERED_DAY_OPTIONS = [7, 30, 90] as const;

/**
 * Questions the assistant could not answer, grouped by similar wording, most
 * asked first. "Add as FAQ" opens the FAQ form with the question filled in:
 * write the answer once and the assistant knows it from then on.
 */
export const UnansweredTab = ({ siteTag, siteLabel }: { siteTag: string; siteLabel: string }) => {
    const [days, setDays] = useState<number>(30);
    const [draft, setDraft] = useState<{ key: number; group: UnansweredGroup } | null>(null);

    const query = useQuery({
        queryKey: [SITE_ASSISTANT_QUERY_KEY, 'unanswered', siteTag, days],
        queryFn: () => fetchUnanswered(siteTag, days),
        enabled: !!siteTag,
        staleTime: 60_000,
    });

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-2xl text-body text-neutral-600">
                    Questions the assistant didn&rsquo;t have an answer for. Add the common ones as
                    FAQs and it will answer them next time.
                </p>
                <div className="flex gap-1" role="group" aria-label="Period">
                    {UNANSWERED_DAY_OPTIONS.map((d) => (
                        <MyButton
                            key={d}
                            buttonType={d === days ? 'primary' : 'secondary'}
                            scale="small"
                            aria-pressed={d === days}
                            onClick={() => setDays(d)}
                        >
                            {d} days
                        </MyButton>
                    ))}
                </div>
            </div>

            {query.isLoading && (
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            )}
            {query.isError && (
                <ErrorState
                    message="Could not load unanswered questions."
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.isSuccess && query.data.length === 0 && (
                <EmptyState
                    icon={<ChatCircleDots className="size-8 text-success-500" />}
                    title="Nothing unanswered"
                >
                    Every question in the last {days} days got an answer.
                </EmptyState>
            )}
            {query.isSuccess && query.data.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {query.data.map((g, i) => (
                        <li
                            key={`${g.question}-${i}`}
                            className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center"
                        >
                            <div className="min-w-0 flex-1 space-y-1">
                                <p className="text-subtitle font-medium text-neutral-800">
                                    &ldquo;{g.question}&rdquo;
                                </p>
                                <p className="text-caption text-neutral-500">
                                    Asked {g.count === 1 ? 'once' : `${g.count} times`}
                                    {g.lastAskedAt
                                        ? ` · last ${formatRelative(g.lastAskedAt)}`
                                        : ''}
                                </p>
                                {g.examples.length > 0 && (
                                    <p className="text-caption text-neutral-400">
                                        Also asked as: {g.examples.slice(0, 3).join(' · ')}
                                    </p>
                                )}
                            </div>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setDraft({ key: Date.now(), group: g })}
                            >
                                <Plus className="size-4" />
                                Add as FAQ
                            </MyButton>
                        </li>
                    ))}
                </ul>
            )}

            {draft && (
                <KnowledgeDialog
                    key={draft.key}
                    open
                    onOpenChange={(o) => !o && setDraft(null)}
                    siteTag={siteTag}
                    siteLabel={siteLabel}
                    initial={emptyKnowledgeInput('FAQ', { title: draft.group.question })}
                />
            )}
        </div>
    );
};
