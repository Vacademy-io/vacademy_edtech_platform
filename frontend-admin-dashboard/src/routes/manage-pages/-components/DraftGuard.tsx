/**
 * Guards around the open draft: the red "older than the live site" banner,
 * and the confirmations for discarding a draft and publishing a stale one.
 * See -utils/draft-staleness.ts for how "stale" is decided.
 */
import { useTranslation } from 'react-i18next';
import { Warning } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
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
import { formatDateTime } from '@/lib/formatters';
import type { DraftStaleness } from '../-utils/draft-staleness';

const NS = 'managePagesCatalogueEditor';

export const StaleDraftBanner = ({
    staleness,
    busy,
    onUseLive,
    onKeepDraft,
}: {
    staleness: DraftStaleness;
    busy: boolean;
    onUseLive: () => void;
    onKeepDraft: () => void;
}) => {
    const { t } = useTranslation(NS);
    const changed = [
        staleness.liveRevisionNo ? t('draft.version', { n: staleness.liveRevisionNo }) : '',
        staleness.liveUpdatedAt ? formatDateTime(staleness.liveUpdatedAt) : '',
    ]
        .filter(Boolean)
        .join(', ');

    return (
        <div
            role="alert"
            className="flex shrink-0 flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
        >
            <Warning className="size-5 shrink-0 text-red-600" weight="fill" />
            <p className="min-w-0 flex-1">
                {staleness.sinceOpened ? (
                    changed ? (
                        t('draft.staleSinceOpenedAt', { when: changed })
                    ) : (
                        t('draft.staleSinceOpened')
                    )
                ) : (
                    <>
                        {staleness.draftStartedAt
                            ? `${t('draft.staleStarted', { date: formatDateTime(staleness.draftStartedAt) })} `
                            : ''}
                        {changed
                            ? t('draft.staleLiveChangedAt', { when: changed })
                            : t('draft.staleLiveChanged')}
                    </>
                )}{' '}
                {t('draft.staleUndoWarning')}
            </p>
            <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="destructive" onClick={onUseLive} disabled={busy}>
                    {t('draft.useLive')}
                </Button>
                <Button size="sm" variant="outline" onClick={onKeepDraft} disabled={busy}>
                    {t('draft.keepDraft')}
                </Button>
            </div>
        </div>
    );
};

const ConfirmDialog = ({
    open,
    onOpenChange,
    title,
    body,
    confirmLabel,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
}) => {
    const { t } = useTranslation(NS);
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{body}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t('draft.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm} className="bg-red-600 hover:bg-red-700">
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export const DiscardDraftDialog = (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
}) => {
    const { t } = useTranslation(NS);
    return (
        <ConfirmDialog
            {...props}
            title={t('draft.discardTitle')}
            body={t('draft.discardBody')}
            confirmLabel={t('draft.discard')}
        />
    );
};

export const StalePublishDialog = (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
}) => {
    const { t } = useTranslation(NS);
    return (
        <ConfirmDialog
            {...props}
            title={t('draft.stalePublishTitle')}
            body={t('draft.stalePublishBody')}
            confirmLabel={t('draft.stalePublishConfirm')}
        />
    );
};
