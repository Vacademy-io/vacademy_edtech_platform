import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import type { LeadFollowup } from '@/components/shared/leads';
import { useFollowUpNotesRequired } from '@/components/shared/leads/follow-up-fields';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { invalidateLeadCaches } from '@/hooks/use-invalidate-lead-caches';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { UPDATE_LEAD_FOLLOWUP } from '@/constants/urls';
import { parseHtmlToString } from '@/lib/utils';

interface EditFollowUpDialogProps {
    followup: LeadFollowup | null;
    userId: string;
    onOpenChange: (open: boolean) => void;
}

/**
 * Correct what was written on a follow-up — its note, the closing note (once
 * closed) and the interest level. Works on closed follow-ups too: that is the
 * point, a counsellor fixing a note after the call. The schedule is not here;
 * an open follow-up is rescheduled from the reminder, a closed one keeps the
 * time it was due. The previous text is kept in the activity log.
 */
export function EditFollowUpDialog({ followup, userId, onOpenChange }: EditFollowUpDialogProps) {
    const { t } = useTranslation('manageStudentsFollowUpsWidget');
    const { followUpFields } = useLeadSettings();
    const notesRequired = useFollowUpNotesRequired();
    const queryClient = useQueryClient();

    const [content, setContent] = useState('');
    const [closerReason, setCloserReason] = useState('');
    const [interestLevel, setInterestLevel] = useState('');

    useEffect(() => {
        if (!followup) return;
        setContent(followup.content ?? '');
        setCloserReason(followup.closer_reason ?? '');
        setInterestLevel(followup.interest_level ?? '');
    }, [followup]);

    const isClosed = !!followup?.is_closed;
    // Offer the saved value even if the institute has since dropped it from the list.
    const levelOptions = [
        ...followUpFields.interestLevels,
        ...(followup?.interest_level &&
        !followUpFields.interestLevels.includes(followup.interest_level)
            ? [followup.interest_level]
            : []),
    ];
    const showInterest = followUpFields.enabled && levelOptions.length > 0;

    // Closing needs a note, so an edit must not empty one. Older (migrated) rows
    // closed without a note stay editable without being forced to add one.
    const reasonMissing = isClosed && !!followup?.closer_reason && !closerReason.trim();

    // Send only what changed, so an untouched field keeps its stored value
    // (a null note must not turn into an empty string just by opening this).
    // The editor may re-wrap a plain note in <p>, so compare the text for those.
    const originalContent = followup?.content ?? '';
    // Whitespace is ignored for plain notes: the editor turns line breaks into
    // paragraphs, which is not an edit.
    const squash = (text: string) => text.replace(/\s+/g, '');
    const contentChanged = /<\/?[a-z][^>]*>/i.test(originalContent)
        ? content !== originalContent
        : squash(parseHtmlToString(content)) !== squash(originalContent);
    // Only a note being edited has to satisfy "notes required" — an old row
    // without one can still get its interest level corrected.
    const contentMissing = notesRequired && contentChanged && !parseHtmlToString(content).trim();
    const reasonChanged =
        isClosed &&
        !!closerReason.trim() &&
        closerReason.trim() !== (followup?.closer_reason ?? '');
    const interestChanged = showInterest && interestLevel !== (followup?.interest_level ?? '');
    const hasChanges = contentChanged || reasonChanged || interestChanged;

    const saveMutation = useMutation({
        mutationFn: () =>
            authenticatedAxiosInstance.put(UPDATE_LEAD_FOLLOWUP(followup?.id ?? ''), {
                ...(contentChanged ? { content: content.trim() } : {}),
                ...(reasonChanged ? { closer_reason: closerReason.trim() } : {}),
                ...(interestChanged ? { interest_level: interestLevel } : {}),
            }),
        onSuccess: () => {
            toast.success(t('edit.saved'));
            if (followup) {
                queryClient.invalidateQueries({
                    queryKey: ['lead-followups', followup.audience_response_id],
                });
            }
            invalidateLeadCaches(queryClient, userId);
            queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
            queryClient.invalidateQueries({ queryKey: ['my-pending-followups'] });
            onOpenChange(false);
        },
        onError: () => toast.error(t('edit.failed')),
    });

    const canSave =
        !!followup && hasChanges && !saveMutation.isPending && !contentMissing && !reasonMissing;

    return (
        <Dialog
            open={!!followup}
            onOpenChange={(o) => {
                if (!o && !saveMutation.isPending) onOpenChange(false);
            }}
        >
            <DialogContent
                className="flex w-full flex-col overflow-hidden p-0 sm:max-w-lg"
                style={{ maxHeight: '90vh' }}
                // Only X / Cancel close it — a stray click must not drop the edit.
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                <DialogHeader className="border-b border-neutral-100 px-6 py-4 text-left">
                    <DialogTitle>{t('edit.title')}</DialogTitle>
                    <DialogDescription>{t('edit.description')}</DialogDescription>
                </DialogHeader>

                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    {showInterest && (
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">{t('edit.interestLevel')}</Label>
                            <SearchableSelect
                                options={levelOptions.map((o) => ({ label: o, value: o }))}
                                value={interestLevel}
                                // Picking the chosen option again clears it.
                                onChange={(v) => setInterestLevel(v === interestLevel ? '' : v)}
                                placeholder={t('edit.interestPlaceholder')}
                                searchPlaceholder={t('edit.search')}
                                portal={false}
                                triggerClassName="h-9"
                            />
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium">
                            {t('edit.comment')}
                            {notesRequired && <span className="ml-0.5 text-danger-500">*</span>}
                        </Label>
                        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white text-sm text-neutral-800 focus-within:border-primary-300 focus-within:ring-1 focus-within:ring-primary-300 [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2">
                            {followup && (
                                <RichTextEditor
                                    key={followup.id}
                                    value={content}
                                    onChange={setContent}
                                    placeholder={t('edit.commentPlaceholder')}
                                    minHeight={100}
                                    minimalToolbar
                                />
                            )}
                        </div>
                        {contentMissing && (
                            <p className="text-xs text-danger-600">{t('edit.commentRequired')}</p>
                        )}
                    </div>

                    {isClosed && (
                        <div className="space-y-1.5">
                            <Label
                                htmlFor="edit-followup-closing-note"
                                className="text-sm font-medium"
                            >
                                {t('edit.closingNote')}
                                {followup?.closer_reason && (
                                    <span className="ml-0.5 text-danger-500">*</span>
                                )}
                            </Label>
                            <Textarea
                                id="edit-followup-closing-note"
                                value={closerReason}
                                onChange={(e) => setCloserReason(e.target.value)}
                                rows={3}
                                className="resize-none text-sm"
                            />
                            {reasonMissing && (
                                <p className="text-xs text-danger-600">
                                    {t('edit.closingNoteRequired')}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-neutral-100 px-6 py-4">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={saveMutation.isPending}
                    >
                        {t('edit.cancel')}
                    </Button>
                    <Button onClick={() => saveMutation.mutate()} disabled={!canSave}>
                        {saveMutation.isPending ? t('edit.saving') : t('edit.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
