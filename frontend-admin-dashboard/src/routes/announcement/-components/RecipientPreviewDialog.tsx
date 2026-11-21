import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { UsersThree } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AnnouncementService,
    type CreateAnnouncementRequest,
    type RecipientPreviewUser,
} from '@/services/announcement';
import { EmptyState, LoadFailure } from '../create/-components/primitives';
import { NameAvatar } from '../history/-components/primitives';

const PAGE_SIZE = 20;

/**
 * What to resolve: the recipients a form would submit (unsaved), or a saved announcement by id.
 * Both resolve on the server exactly as delivery will, exclusions and filters included.
 */
export type RecipientPreviewSource =
    | { kind: 'draft'; recipients: CreateAnnouncementRequest['recipients'] }
    | { kind: 'saved'; announcementId: string };

type Row = RecipientPreviewUser & { index: number };

export function RecipientPreviewDialog({
    open,
    onOpenChange,
    source,
    title,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    source: RecipientPreviewSource | null;
    /** Announcement title, shown under the heading so it is clear whose audience this is. */
    title?: string;
}) {
    const { t } = useTranslation('announcementCampaignTools');
    return (
        <MyDialog
            heading={t('recipientPreview.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-4xl"
        >
            {open && source && (
                <PreviewBody
                    // A changed audience is a different list — start again from page one.
                    key={source.kind === 'saved' ? source.announcementId : JSON.stringify(source)}
                    source={source}
                    title={title}
                />
            )}
        </MyDialog>
    );
}

function PreviewBody({ source, title }: { source: RecipientPreviewSource; title?: string }) {
    const { t } = useTranslation('announcementCampaignTools');
    const [page, setPage] = useState(0);
    const empty = source.kind === 'draft' && source.recipients.length === 0;

    const q = useQuery({
        queryKey: [
            'announcementRecipientPreview',
            source.kind === 'saved' ? source.announcementId : source.recipients,
            page,
        ],
        queryFn: () =>
            source.kind === 'saved'
                ? AnnouncementService.previewAnnouncementRecipients(source.announcementId, {
                      page,
                      size: PAGE_SIZE,
                  })
                : AnnouncementService.previewRecipients({
                      recipients: source.recipients,
                      page,
                      size: PAGE_SIZE,
                  }),
        enabled: !empty,
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
    });

    const tableData = useMemo(() => {
        const users = q.data?.users ?? [];
        return {
            content: users.map((u, i) => ({ ...u, index: page * PAGE_SIZE + i + 1 })),
            total_pages: q.data?.totalPages ?? 0,
            page_no: page,
            page_size: PAGE_SIZE,
            total_elements: q.data?.totalCount ?? 0,
            last: page + 1 >= (q.data?.totalPages ?? 0),
        };
    }, [q.data, page]);

    const columns = useMemo<ColumnDef<Row>[]>(
        () => [
            {
                id: 'index',
                header: '#',
                size: 48,
                cell: ({ row }) => <span className="text-neutral-500">{row.original.index}</span>,
            },
            {
                id: 'name',
                header: t('recipientPreview.table.name'),
                size: 220,
                cell: ({ row }) => {
                    const name = row.original.fullName?.trim() || t('recipientPreview.unknownUser');
                    return (
                        <div className="flex items-center gap-2">
                            <NameAvatar name={name} muted={!row.original.fullName} />
                            <span className="truncate text-neutral-800">{name}</span>
                        </div>
                    );
                },
            },
            {
                id: 'email',
                header: t('recipientPreview.table.email'),
                size: 240,
                cell: ({ row }) =>
                    row.original.email ? (
                        <span className="truncate text-neutral-700">{row.original.email}</span>
                    ) : (
                        <span className="text-caption text-warning-600">
                            {t('recipientPreview.noEmail')}
                        </span>
                    ),
            },
            {
                id: 'phone',
                header: t('recipientPreview.table.phone'),
                size: 150,
                cell: ({ row }) => (
                    <span className="text-neutral-700">{row.original.mobileNumber || '-'}</span>
                ),
            },
        ],
        [t]
    );

    if (empty) {
        return (
            <EmptyState
                Icon={UsersThree}
                title={t('recipientPreview.noAudienceTitle')}
                description={t('recipientPreview.noAudienceBody')}
            />
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                    {title && (
                        <p className="truncate text-subtitle font-semibold text-neutral-900">
                            {title}
                        </p>
                    )}
                    {q.isLoading ? (
                        <Skeleton className="mt-1 h-5 w-48 rounded-md" />
                    ) : q.data ? (
                        <p className="text-body text-neutral-700">
                            {t('recipientPreview.count', { count: q.data.totalCount })}
                        </p>
                    ) : null}
                </div>
                <p className="text-caption text-muted-foreground">
                    {t('recipientPreview.resolvedNow')}
                </p>
            </div>

            {q.isError ? (
                <LoadFailure
                    message={t('recipientPreview.loadFailed')}
                    onRetry={() => q.refetch()}
                />
            ) : !q.isLoading && (q.data?.totalCount ?? 0) === 0 ? (
                <EmptyState
                    Icon={UsersThree}
                    title={t('recipientPreview.noMatchesTitle')}
                    description={t('recipientPreview.noMatchesBody')}
                />
            ) : (
                <MyTable<Row>
                    data={tableData}
                    columns={columns}
                    isLoading={q.isLoading}
                    error={q.error}
                    currentPage={page}
                    enableColumnResizing={false}
                />
            )}

            {tableData.total_pages > 1 && (
                <MyPagination
                    currentPage={page}
                    totalPages={tableData.total_pages}
                    totalElements={tableData.total_elements}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                />
            )}
        </div>
    );
}
