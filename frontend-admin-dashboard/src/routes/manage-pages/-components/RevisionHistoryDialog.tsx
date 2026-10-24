/**
 * Revision history — list of draft/published versions of a catalogue with
 * one-click restore. Restore loads the old JSON into the editor as an
 * UNSAVED change; the admin then saves (draft) and publishes as usual.
 */
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CircleNotch, ClockCounterClockwise } from '@phosphor-icons/react';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/formatters';
import {
    getRevisionHistory, getRevision, CatalogueRevision,
} from '../-services/catalogue-service';
import { findLiveRevision } from '../-utils/draft-staleness';

const sourceLabel = (source?: string) =>
    source === 'AI_WIZARD' ? 'AI wizard' : source === 'AI_COPILOT' ? 'AI copilot' : 'Manual edit';

export const RevisionHistoryDialog = ({
    open,
    onOpenChange,
    catalogueId,
    onRestore,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    catalogueId?: string;
    onRestore: (catalogueJson: string) => void;
}) => {
    const { toast } = useToast();
    const { t } = useTranslation('managePagesCatalogueEditor');

    const { data: revisions, isLoading } = useQuery({
        queryKey: ['catalogueRevisions', catalogueId],
        queryFn: () => getRevisionHistory(catalogueId!),
        enabled: open && !!catalogueId,
    });

    const restoreMutation = useMutation({
        mutationFn: (revisionId: string) => getRevision(revisionId),
        onSuccess: (revision) => {
            if (!revision.catalogue_json) {
                toast({ title: 'Restore failed', description: 'Revision has no content.', variant: 'destructive' });
                return;
            }
            onRestore(revision.catalogue_json);
            onOpenChange(false);
            toast({
                title: 'Version restored to editor',
                description: 'This is an unsaved change — Save and Publish to make it live.',
            });
        },
        onError: () =>
            toast({ title: 'Restore failed', description: 'Could not load that version.', variant: 'destructive' }),
    });
    const liveRevisionId = findLiveRevision(revisions)?.id;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ClockCounterClockwise className="size-4" />
                        Version history
                    </DialogTitle>
                </DialogHeader>
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <CircleNotch className="size-5 animate-spin text-gray-400" />
                    </div>
                ) : !revisions?.length ? (
                    <p className="py-6 text-center text-sm text-gray-400">
                        No versions yet — versions appear once you save or publish.
                    </p>
                ) : (
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                        {revisions.map((r: CatalogueRevision) => (
                            <div key={r.id} className="flex items-center justify-between rounded border bg-gray-50 px-3 py-2">
                                <div>
                                    <p className="text-xs font-medium text-gray-800">
                                        v{r.revision_no} ·{' '}
                                        <span className={r.status === 'DRAFT' ? 'text-amber-600' : 'text-green-600'}>
                                            {r.status === 'DRAFT' ? 'Draft' : 'Published'}
                                        </span>
                                        {r.id === liveRevisionId && (
                                            <span className="ms-2 rounded-full bg-green-100 px-1.5 py-0.5 text-caption font-semibold text-green-700">
                                                {t('history.liveNow')}
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-caption text-gray-400">
                                        {sourceLabel(r.source)}
                                        {r.updated_at ? ` · ${formatDateTime(r.updated_at)}` : ''}
                                    </p>
                                    {r.status === 'DRAFT' && r.created_at && (
                                        <p className="text-caption text-gray-400">
                                            {t('history.draftStarted', {
                                                date: formatDateTime(r.created_at),
                                            })}
                                        </p>
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={restoreMutation.isPending}
                                    onClick={() => restoreMutation.mutate(r.id)}
                                >
                                    Restore
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
