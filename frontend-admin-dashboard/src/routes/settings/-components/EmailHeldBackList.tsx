import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { ArrowClockwise, Info, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    discardBlockedEmails,
    emailBillingKeys,
    parseBlockedAt,
    resendBlockedEmails,
    useBlockedEmails,
    type BlockedEmail,
} from '@/services/email-billing-service';
import { getActiveLocale } from '@/lib/formatters';

const PAGE_SIZE = 20;

function errorText(err: unknown, fallback: string): string {
    const data = (err as { response?: { data?: { message?: string; ex?: string } } })?.response
        ?.data;
    return data?.message || data?.ex || fallback;
}

/**
 * Emails that were not sent because the institute had no free emails or credits left. They are
 * kept so the admin can resend them after adding credits, or discard them.
 */
export function EmailHeldBackList({ instituteId }: { instituteId: string }) {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(0);
    const [lastMessage, setLastMessage] = useState<string | null>(null);
    const [discardTarget, setDiscardTarget] = useState<BlockedEmail | null>(null);
    const { data, isLoading, isError, error, refetch } = useBlockedEmails(
        instituteId,
        page,
        PAGE_SIZE
    );

    const total = data?.total ?? 0;
    const totalPages = Math.ceil(total / PAGE_SIZE);

    // Usage numbers (held-back count, free emails left) move with every resend or discard.
    const refresh = useCallback(
        () => queryClient.invalidateQueries({ queryKey: emailBillingKeys.all }),
        [queryClient]
    );

    const resend = useCallback(
        async (ids?: string[]) => {
            try {
                const result = await resendBlockedEmails(instituteId, ids);
                setLastMessage(result.message);
                if (result.resent > 0) toast.success(result.message);
                else toast.info(result.message);
            } catch (err) {
                toast.error(errorText(err, 'Could not resend. Please try again.'));
            } finally {
                await refresh();
            }
        },
        [instituteId, refresh]
    );

    const discard = async (item: BlockedEmail) => {
        try {
            const result = await discardBlockedEmails(instituteId, [item.id]);
            const message =
                result.discarded > 0
                    ? `Discarded the email to ${item.to}.`
                    : 'Nothing was discarded.';
            setLastMessage(message);
            toast.success(message);
        } catch (err) {
            toast.error(errorText(err, 'Could not discard. Please try again.'));
        } finally {
            setDiscardTarget(null);
            await refresh();
        }
    };

    const columns = useMemo<ColumnDef<BlockedEmail>[]>(
        () => [
            {
                id: 'to',
                header: 'To',
                size: 220,
                cell: ({ row }) => (
                    <span className="truncate text-neutral-800">{row.original.to}</span>
                ),
            },
            {
                id: 'subject',
                header: 'Subject',
                size: 280,
                cell: ({ row }) => (
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate text-neutral-700">
                            {row.original.subject || '(no subject)'}
                        </span>
                        {row.original.attachmentsTooLargeToKeep && (
                            <span className="text-caption text-warning-600">
                                The attachments were too large to keep, so this email can&apos;t be
                                resent.
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'when',
                header: 'When',
                size: 170,
                cell: ({ row }) => {
                    const at = parseBlockedAt(row.original.createdAt);
                    return (
                        <span className="text-neutral-600">
                            {at
                                ? at.toLocaleString(getActiveLocale(), {
                                      day: 'numeric',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                  })
                                : '—'}
                        </span>
                    );
                },
            },
            {
                id: 'units',
                header: 'Counts as',
                size: 110,
                cell: ({ row }) => (
                    <span className="text-neutral-600">
                        {row.original.units} {row.original.units === 1 ? 'email' : 'emails'}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: '',
                size: 180,
                cell: ({ row }) => (
                    <div className="flex items-center justify-end gap-1">
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            disable={row.original.attachmentsTooLargeToKeep}
                            onAsyncClick={() => resend([row.original.id])}
                            loadingText="Resending…"
                        >
                            Resend
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() => setDiscardTarget(row.original)}
                        >
                            Discard
                        </MyButton>
                    </div>
                ),
            },
        ],
        [resend]
    );

    const tableData = useMemo(
        () => ({
            content: data?.items ?? [],
            total_pages: totalPages,
            page_no: page,
            page_size: PAGE_SIZE,
            total_elements: total,
            last: page + 1 >= totalPages,
        }),
        [data, page, total, totalPages]
    );

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                <div className="flex flex-col gap-1">
                    <CardTitle className="text-subtitle font-semibold">
                        Emails held back (no credits)
                    </CardTitle>
                    <CardDescription>
                        These emails were not sent because there were no free emails or credits
                        left. Add credits, then resend them.
                    </CardDescription>
                </div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable={total === 0}
                    onAsyncClick={() => resend()}
                    loadingText="Resending…"
                    className="shrink-0"
                >
                    <ArrowClockwise className="me-1 size-4" />
                    Resend all
                </MyButton>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {lastMessage && (
                    <Alert>
                        <Info className="size-4" />
                        <AlertDescription>{lastMessage}</AlertDescription>
                    </Alert>
                )}
                {isError ? (
                    <Alert variant="destructive">
                        <AlertDescription className="flex flex-wrap items-center gap-2">
                            {errorText(error, 'Could not load the emails held back.')}
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={() => void refetch()}
                            >
                                Try again
                            </MyButton>
                        </AlertDescription>
                    </Alert>
                ) : !isLoading && total === 0 ? (
                    <p className="text-body text-muted-foreground">Nothing is held back.</p>
                ) : (
                    <>
                        {total > 200 && (
                            <p className="text-caption text-muted-foreground">
                                Resend all sends up to 200 at a time.
                            </p>
                        )}
                        <MyTable<BlockedEmail>
                            data={tableData}
                            columns={columns}
                            isLoading={isLoading}
                            error={error}
                            currentPage={page}
                            enableColumnResizing={false}
                        />
                        {totalPages > 1 && (
                            <MyPagination
                                currentPage={page}
                                totalPages={totalPages}
                                totalElements={total}
                                pageSize={PAGE_SIZE}
                                onPageChange={setPage}
                                compactOnPhone
                            />
                        )}
                    </>
                )}
            </CardContent>

            <AlertDialog
                open={discardTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDiscardTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Discard this email?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The email to {discardTarget?.to} will not be sent and can&apos;t be
                            brought back.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-700"
                            onClick={(event) => {
                                event.preventDefault();
                                if (discardTarget) void discard(discardTarget);
                            }}
                        >
                            <Trash className="me-1 size-4" />
                            Discard
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
