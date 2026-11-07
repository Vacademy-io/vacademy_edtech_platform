import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ChatsCircle, ThumbsDown, ThumbsUp } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable, type TableData } from '@/components/design-system/table';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/formatters';
import {
    SITE_ASSISTANT_QUERY_KEY,
    fetchConversations,
    type ConversationSummary,
    type LeadFilter,
} from '../-services/site-assistant-service';
import { LeadBadge } from './LeadBadge';
import { EmptyState, ErrorState } from './TabStates';
import { TranscriptDrawer } from './TranscriptDrawer';

const PAGE_SIZE = 20;

const LEAD_FILTERS: { value: LeadFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'SALES', label: 'Sales enquiries' },
    { value: 'SUPPORT', label: 'Support requests' },
];

const CHANNEL_LABEL: Record<ConversationSummary['channel'], string> = {
    HOSTED: 'This site',
    EMBED: 'Your website',
    PREVIEW: 'Preview',
};

export const ConversationsTab = ({ siteTag }: { siteTag: string }) => {
    const [page, setPage] = useState(0);
    const [lead, setLead] = useState<LeadFilter>('ALL');
    const [openId, setOpenId] = useState<string | null>(null);

    const query = useQuery({
        queryKey: [SITE_ASSISTANT_QUERY_KEY, 'conversations', siteTag, lead, page],
        queryFn: () => fetchConversations({ siteTag, lead, page, size: PAGE_SIZE }),
        enabled: !!siteTag,
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    });

    const columns = useMemo<ColumnDef<ConversationSummary>[]>(
        () => [
            {
                id: 'started',
                header: 'Started',
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body text-neutral-800">
                            {row.original.startedAt ? formatDateTime(row.original.startedAt) : '—'}
                        </span>
                        {row.original.channel !== 'HOSTED' && (
                            <span className="text-caption text-neutral-400">
                                {CHANNEL_LABEL[row.original.channel]}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'page',
                header: 'Page',
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="line-clamp-1 text-body text-neutral-700">
                            {row.original.startedPage ?? '—'}
                        </span>
                        {row.original.preview && (
                            <span className="line-clamp-1 text-caption text-neutral-400">
                                &ldquo;{row.original.preview}&rdquo;
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'messages',
                header: 'Messages',
                cell: ({ row }) => (
                    <span className="text-body text-neutral-700">{row.original.messageCount}</span>
                ),
            },
            {
                id: 'lead',
                header: 'Enquiry',
                cell: ({ row }) =>
                    row.original.leadStatus ? (
                        <LeadBadge lead={row.original.leadStatus} />
                    ) : (
                        <span className="text-caption text-neutral-400">—</span>
                    ),
            },
            {
                id: 'feedback',
                header: 'Ratings',
                cell: ({ row }) =>
                    row.original.thumbsUp || row.original.thumbsDown ? (
                        <span className="flex items-center gap-2 text-caption text-neutral-600">
                            <span className="flex items-center gap-0.5">
                                <ThumbsUp className="size-3.5 text-success-600" />
                                {row.original.thumbsUp}
                            </span>
                            <span className="flex items-center gap-0.5">
                                <ThumbsDown className="size-3.5 text-danger-600" />
                                {row.original.thumbsDown}
                            </span>
                        </span>
                    ) : (
                        <span className="text-caption text-neutral-400">—</span>
                    ),
            },
            {
                id: 'open',
                header: '',
                cell: ({ row }) => (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() => setOpenId(row.original.id)}
                    >
                        Read
                    </MyButton>
                ),
            },
        ],
        []
    );

    const data = query.data;
    const tableData: TableData<ConversationSummary> | undefined = data
        ? {
              content: data.items,
              total_pages: data.totalPages,
              page_no: page,
              page_size: data.size,
              total_elements: data.total,
              last: page + 1 >= data.totalPages,
          }
        : undefined;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-body text-neutral-600">
                    Every chat visitors had with the assistant. Open one to read it.
                </p>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
                    {LEAD_FILTERS.map((f) => (
                        <MyButton
                            key={f.value}
                            buttonType={f.value === lead ? 'primary' : 'secondary'}
                            scale="small"
                            aria-pressed={f.value === lead}
                            onClick={() => {
                                setLead(f.value);
                                setPage(0);
                            }}
                        >
                            {f.label}
                        </MyButton>
                    ))}
                </div>
            </div>

            {query.isError && !data ? (
                <ErrorState
                    message="Could not load conversations."
                    onRetry={() => void query.refetch()}
                />
            ) : data && data.items.length === 0 ? (
                <EmptyState
                    icon={<ChatsCircle className="size-8 text-neutral-400" />}
                    title={lead === 'ALL' ? 'No conversations yet' : 'None of these yet'}
                >
                    {lead === 'ALL'
                        ? 'When visitors chat with the assistant, their conversations show up here. Try it yourself in the “Try it” tab.'
                        : 'Try “All” to see every conversation.'}
                </EmptyState>
            ) : (
                <>
                    <MyTable<ConversationSummary>
                        data={tableData}
                        columns={columns}
                        isLoading={query.isLoading}
                        error={query.error}
                        currentPage={page}
                        enableColumnResizing={false}
                        onCellClick={(row) => setOpenId(row.id)}
                    />
                    {data && data.totalPages > 1 && (
                        <MyPagination
                            currentPage={page}
                            totalPages={data.totalPages}
                            totalElements={data.total}
                            pageSize={data.size}
                            onPageChange={setPage}
                        />
                    )}
                    {data && (
                        <p className="text-caption text-neutral-400">
                            <Badge variant="outline" className="me-1 text-caption">
                                {data.total}
                            </Badge>
                            conversation{data.total === 1 ? '' : 's'}
                        </p>
                    )}
                </>
            )}

            <TranscriptDrawer conversationId={openId} onClose={() => setOpenId(null)} />
        </div>
    );
};
