import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Copy, LinkSimple } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { DashboardLoader } from '@/components/core/dashboard-loader';
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
import { BookingPageForm } from '@/routes/meetings/-components/BookingPageForm';
import {
    useBookingPages,
    useDeleteBookingPage,
    useUpdateBookingPage,
} from '@/routes/meetings/-hooks/use-meetings';
import { publicBookingLink } from '@/routes/meetings/-utils/meetings-utils';

interface BookingSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    audienceId: string;
    audienceName: string;
    instituteId: string;
}

/**
 * Booking Settings for an audience list — enable a public booking page for the
 * list, or edit / deactivate / delete the one that already exists.
 */
export const BookingSettingsDialog = ({
    open,
    onOpenChange,
    audienceId,
    audienceName,
    instituteId,
}: BookingSettingsDialogProps) => {
    const { t } = useTranslation('audienceManagerBookingSettingsDialog');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const {
        data: pages,
        isLoading,
        error,
    } = useBookingPages({ instituteId, audienceId, enabled: open });

    const page = pages?.[0];
    const updatePage = useUpdateBookingPage();
    const deletePage = useDeleteBookingPage();

    const link = publicBookingLink(page?.slug);
    const isInactive = (page?.status ?? '').toUpperCase() === 'INACTIVE';

    const handleCopyLink = async () => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            toast.success(t('toast.copySuccess'));
        } catch {
            toast.error(t('toast.copyError'));
        }
    };

    const handleToggleStatus = () => {
        if (!page?.id) return;
        const nextStatus = isInactive ? 'ACTIVE' : 'INACTIVE';
        updatePage.mutate(
            {
                id: page.id,
                instituteId,
                data: { institute_id: instituteId, title: page.title, status: nextStatus },
            },
            {
                onSuccess: () =>
                    toast.success(
                        nextStatus === 'INACTIVE'
                            ? t('toast.deactivateSuccess')
                            : t('toast.activateSuccess')
                    ),
                onError: () => toast.error(t('toast.statusUpdateError')),
            }
        );
    };

    const handleDelete = () => {
        if (!page?.id) return;
        deletePage.mutate({ id: page.id, instituteId }, {
            onSuccess: () => {
                toast.success(t('toast.deleteSuccess'));
                setConfirmDelete(false);
            },
            onError: () => toast.error(t('toast.deleteError')),
        });
    };

    let body: React.ReactNode;
    if (isLoading) {
        body = (
            <div className="flex min-h-32 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    } else if (error) {
        body = (
            <p className="py-8 text-center text-body text-neutral-500">
                {t('states.loadError')}
            </p>
        );
    } else if (!page) {
        body = (
            <div className="flex flex-col gap-3">
                <p className="text-body text-neutral-500">
                    {t('empty.description', { audienceName })}
                </p>
                <BookingPageForm
                    instituteId={instituteId}
                    fixedAudienceId={audienceId}
                    defaultTitle={t('empty.defaultTitle', { audienceName })}
                    onSaved={() => toast.success(t('toast.enableSuccess'))}
                />
            </div>
        );
    } else {
        body = (
            <div className="flex flex-col gap-4">
                {/* Public link + status + lifecycle actions */}
                <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <LinkSimple className="size-4 text-neutral-500" />
                            <p className="text-body font-semibold text-neutral-600">
                                {t('active.linkLabel')}
                            </p>
                        </div>
                        <StatusChip
                            text={isInactive ? t('active.statusInactive') : t('active.statusActive')}
                            status={isInactive ? 'WARNING' : 'SUCCESS'}
                            textSize="text-caption"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-md bg-neutral-100 px-2 py-1.5 text-caption text-neutral-600">
                            {link ?? t('active.linkPlaceholder')}
                        </code>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="sm:min-w-0"
                            disable={!link}
                            onClick={handleCopyLink}
                        >
                            <Copy className="mr-1 size-3.5" />
                            {t('active.copy')}
                        </MyButton>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="sm:min-w-0"
                            disable={updatePage.isPending}
                            onClick={handleToggleStatus}
                        >
                            {isInactive ? t('active.activate') : t('active.deactivate')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="text-danger-600 sm:min-w-0"
                            onClick={() => setConfirmDelete(true)}
                        >
                            {t('active.delete')}
                        </MyButton>
                    </div>
                </div>

                <BookingPageForm
                    key={page.id}
                    instituteId={instituteId}
                    initialPage={page}
                    fixedAudienceId={audienceId}
                />
            </div>
        );
    }

    return (
        <>
            <MyDialog
                heading={t('dialog.heading')}
                open={open}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-3xl"
            >
                {body}
            </MyDialog>

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('deleteDialog.description', { audienceName })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deletePage.isPending}>
                            {t('deleteDialog.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                handleDelete();
                            }}
                            disabled={deletePage.isPending}
                            className="bg-danger-600 hover:bg-danger-700"
                        >
                            {deletePage.isPending ? t('deleteDialog.deleting') : t('deleteDialog.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
