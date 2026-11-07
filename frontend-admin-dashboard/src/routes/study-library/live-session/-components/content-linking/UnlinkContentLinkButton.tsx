// Shared "Added to {chapter}" chip + rename + unlink-with-confirm controls, used by both
// the per-recording "Add to course" panel and the ClassMaterialsCard so the
// two surfaces (Track B) stay visually and behaviorally identical.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, FilePdf, PencilSimple, Trash, VideoCamera } from '@phosphor-icons/react';
import { toast } from 'sonner';

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
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import {
    extractContentLinkErrorMessage,
    useRenameSessionContent,
    useUnlinkSessionContent,
    type ContentLinkContentType,
} from '../../-services/content-link-service';

const CONTENT_TYPE_ICONS: Partial<Record<ContentLinkContentType, typeof FilePdf>> = {
    MATERIAL_PDF: FilePdf,
    MATERIAL_VIDEO: VideoCamera,
    RECORDING: VideoCamera,
};

export function UnlinkContentLinkButton({
    linkId,
    chapterName,
    slideTitle,
    contentType,
    batchName,
}: {
    linkId: string;
    chapterName: string;
    /** The linked slide's title — shown so the chip says WHAT was added, not just where. */
    slideTitle?: string;
    contentType?: ContentLinkContentType;
    /** Destination batch display name — disambiguates same-named chapters across batches. */
    batchName?: string;
}) {
    const { t } = useTranslation('studyLibraryUnlinkContentLinkButton');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const unlinkMutation = useUnlinkSessionContent();
    const [renameOpen, setRenameOpen] = useState(false);
    const [draftTitle, setDraftTitle] = useState('');
    const renameMutation = useRenameSessionContent();

    const openRename = () => {
        setDraftTitle(slideTitle ?? '');
        setRenameOpen(true);
    };

    const trimmedDraft = draftTitle.trim();
    const canSaveRename =
        !!trimmedDraft && trimmedDraft !== (slideTitle ?? '').trim() && !renameMutation.isPending;

    const handleRename = async () => {
        if (!canSaveRename) return;
        try {
            await renameMutation.mutateAsync({ linkId, title: trimmedDraft });
            toast.success(t('renamed'));
            setRenameOpen(false);
        } catch (err) {
            toast.error(extractContentLinkErrorMessage(err) || t('couldNotRename'));
        }
    };

    const handleConfirm = async () => {
        try {
            await unlinkMutation.mutateAsync(linkId);
            toast.success(t('removedFrom', { chapterName }));
        } catch {
            toast.error(t('couldNotRemove'));
        } finally {
            setConfirmOpen(false);
        }
    };

    return (
        <>
            <div className="flex items-center gap-2 rounded-md border border-success-200 bg-success-50 px-3 py-1.5">
                {(() => {
                    const TypeIcon = contentType ? CONTENT_TYPE_ICONS[contentType] : undefined;
                    return TypeIcon ? (
                        <TypeIcon className="size-4 shrink-0 text-success-600" />
                    ) : (
                        <CheckCircle weight="fill" className="size-4 shrink-0 text-success-600" />
                    );
                })()}
                <span className="min-w-0 truncate text-caption text-neutral-700">
                    {slideTitle?.trim() ? (
                        <>
                            <span className="font-medium">{slideTitle}</span>
                            {' · '}
                        </>
                    ) : null}
                    {t('addedTo')} <span className="font-medium">{chapterName}</span>
                    {batchName ? (
                        <span className="text-neutral-500"> · {batchName}</span>
                    ) : null}
                </span>
                <button
                    type="button"
                    onClick={openRename}
                    className="ml-1 shrink-0 text-neutral-400 transition-colors hover:text-primary-600"
                    aria-label={t('renameAriaLabel', { chapterName })}
                    title={t('rename')}
                >
                    <PencilSimple className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    className="shrink-0 text-neutral-400 transition-colors hover:text-danger-600"
                    aria-label={t('removeFromAriaLabel', { chapterName })}
                    title={t('remove')}
                >
                    <Trash className="size-3.5" />
                </button>
            </div>

            <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('renameTitle')}</DialogTitle>
                    </DialogHeader>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            // Portaled, but React still bubbles submit up the component
                            // tree — keep it from reaching any form the chip sits in.
                            e.stopPropagation();
                            void handleRename();
                        }}
                        className="flex flex-col gap-4"
                    >
                        <MyInput
                            inputType="text"
                            label={t('nameLabel')}
                            input={draftTitle}
                            onChangeFunction={(e) => setDraftTitle(e.target.value)}
                            size="large"
                            className="w-full sm:w-full"
                            maxLength={255}
                            required
                        />
                        <DialogFooter className="gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setRenameOpen(false)}
                            >
                                {t('cancel')}
                            </MyButton>
                            <MyButton
                                type="submit"
                                buttonType="primary"
                                scale="medium"
                                disable={!canSaveRename}
                            >
                                {renameMutation.isPending ? t('savingEllipsis') : t('save')}
                            </MyButton>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('removeThisSlideTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('removeThisSlideDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirm}
                            disabled={unlinkMutation.isPending}
                            className="bg-danger-600 text-white hover:bg-danger-700"
                        >
                            {unlinkMutation.isPending ? t('removingEllipsis') : t('remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
