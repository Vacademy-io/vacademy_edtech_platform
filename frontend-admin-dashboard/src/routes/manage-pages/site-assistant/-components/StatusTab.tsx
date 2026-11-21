import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowsClockwise, Coins, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatNumber } from '@/lib/formatters';
import {
    SITE_ASSISTANT_QUERY_KEY,
    fetchStatus,
    reindexSite,
    type IndexStatus,
} from '../-services/site-assistant-service';
import { ErrorState } from './TabStates';

const INDEX_LABEL: Record<IndexStatus, { text: string; status: StatusType; hint: string }> = {
    READY: {
        text: 'Up to date',
        status: 'SUCCESS',
        hint: 'The assistant has read the published pages of this site.',
    },
    INDEXING: {
        text: 'Reading your pages…',
        status: 'WARNING',
        hint: 'This takes a minute or two after you publish.',
    },
    FAILED: {
        text: 'Could not read the pages',
        status: 'DANGER',
        hint: 'Try “Read pages again”. If it keeps failing, contact support.',
    },
    NOT_INDEXED: {
        text: 'Not read yet',
        status: 'INFO',
        hint: 'The pages are read the first time someone chats, or when you press “Read pages again”.',
    },
};

/** Is the assistant ready: page reading, today's answers against the cap, credits. */
export const StatusTab = ({ siteTag }: { siteTag: string }) => {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: [SITE_ASSISTANT_QUERY_KEY, 'status', siteTag],
        queryFn: () => fetchStatus(siteTag),
        enabled: !!siteTag,
        // While pages are being read, check back on its own.
        refetchInterval: (q) => (q.state.data?.index.status === 'INDEXING' ? 10_000 : false),
    });

    const reindex = async () => {
        try {
            await reindexSite(siteTag);
            toast.success('Reading the pages again. This takes a minute or two.');
            await queryClient.invalidateQueries({
                queryKey: [SITE_ASSISTANT_QUERY_KEY, 'status', siteTag],
            });
        } catch {
            toast.error('Could not start. Try again in a moment.');
        }
    };

    if (query.isLoading) {
        return (
            <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-36 w-full" />
            </div>
        );
    }
    if (query.isError || !query.data) {
        return (
            <ErrorState
                message="Could not load the assistant’s status."
                onRetry={() => void query.refetch()}
            />
        );
    }

    const s = query.data;
    const label = INDEX_LABEL[s.index.status];
    const cap = s.dailyCap;
    const pct = cap ? Math.min(100, Math.round((s.answersToday / cap) * 100)) : 0;
    const capReached = !!cap && s.answersToday >= cap;

    return (
        <div className="flex flex-col gap-4">
            {s.creditsLow && (
                <Alert variant="destructive">
                    <Coins className="size-4" />
                    <AlertTitle>AI credits are running low</AlertTitle>
                    <AlertDescription>
                        {s.creditsWarning ??
                            'When credits run out, visitors see your contact details instead of answers.'}{' '}
                        Top up from Settings → AI credits.
                    </AlertDescription>
                </Alert>
            )}
            {s.enabled === false && (
                <Alert>
                    <WarningCircle className="size-4" />
                    <AlertTitle>Visitors can&rsquo;t see the assistant yet</AlertTitle>
                    <AlertDescription>
                        It is switched off in this site&rsquo;s Global Settings. You can still try
                        it in the &ldquo;Try it&rdquo; tab.
                    </AlertDescription>
                </Alert>
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-subtitle">Your pages</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <StatusChip
                            text={label.text}
                            status={label.status}
                            textSize="text-caption"
                        />
                        <p className="text-body text-neutral-600">{label.hint}</p>
                        {s.index.chunks !== null && s.index.status === 'READY' && (
                            <p className="text-caption text-neutral-500">
                                {formatNumber(s.index.chunks)} pieces of text
                                {s.index.updatedAt
                                    ? ` · read ${formatDateTime(s.index.updatedAt)}`
                                    : ''}
                            </p>
                        )}
                        {s.index.status === 'FAILED' && s.index.error && (
                            <p className="text-caption text-danger-600">{s.index.error}</p>
                        )}
                        <div>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onAsyncClick={reindex}
                                loadingText="Starting…"
                                disable={s.index.status === 'INDEXING'}
                            >
                                <ArrowsClockwise className="size-4" />
                                Read pages again
                            </MyButton>
                        </div>
                        <p className="text-caption text-neutral-400">
                            Pages are read again by themselves after you publish changes.
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-subtitle">Answers today</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <p className="text-h3 font-semibold text-neutral-800">
                            {formatNumber(s.answersToday)}
                            {cap ? (
                                <span className="text-body font-normal text-neutral-500">
                                    {' '}
                                    of {formatNumber(cap)}
                                </span>
                            ) : null}
                        </p>
                        {cap ? <Progress value={pct} aria-label="Answers used today" /> : null}
                        <p
                            className={
                                capReached
                                    ? 'text-caption text-danger-600'
                                    : 'text-caption text-neutral-500'
                            }
                        >
                            {capReached
                                ? 'Today’s limit is reached: visitors now see your contact details. It resets at midnight, or raise it in Global Settings → Site Assistant.'
                                : 'Each answer uses 1 AI credit. Change the daily limit in Global Settings → Site Assistant.'}
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
