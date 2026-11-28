import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Info } from '@phosphor-icons/react';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { useRouter } from '@tanstack/react-router';
import { Dispatch, SetStateAction, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { useSlidesMutations } from '../../-hooks/use-slides';
import { handleDeleteAssessment } from '@/routes/assessment/assessment-list/-services/assessment-services';
import { useLinkedAssessmentSlides } from '@/components/common/assessment/assessment-slide-cascade';

interface DeleteProps {
    openDialog: 'copy' | 'move' | 'delete' | 'drip-conditions' | 'offline-availability' | null;
    setOpenDialog: Dispatch<
        SetStateAction<'copy' | 'move' | 'delete' | 'drip-conditions' | 'offline-availability' | null>
    >;
}

export const DeleteDialog = ({ openDialog, setOpenDialog }: DeleteProps) => {
    const { t } = useTranslation('studyLibraryDeleteDialog');
    const router = useRouter();
    const searchParams = router.state.location.search;
    const chapterId: string = searchParams.chapterId || '';
    const { activeItem } = useContentStore();
    const slideId: string = activeItem?.id || '';
    const { updateSlideStatus } = useSlidesMutations(chapterId);
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];

    // An assessment slide is only a launcher — the assessment itself lives in
    // assessment_service and survives the slide unless we delete it too. Default
    // to taking both, since a slide-created assessment has no other home.
    const linkedAssessmentId =
        activeItem?.source_type === 'ASSESSMENT'
            ? activeItem?.assessment_slide?.assessment_id
            : undefined;
    const [alsoDeleteAssessment, setAlsoDeleteAssessment] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);

    // Copying a chapter/course clones the assessment_slide row but keeps the same
    // assessment id, so one assessment can back slides in several courses.
    // Deleting it here would silently break every other one — say so.
    const { data: linkedSlides = [] } = useLinkedAssessmentSlides(linkedAssessmentId);
    const otherSlideCount = Math.max(0, linkedSlides.length - 1);

    const handleDeleteSlide = async () => {
        if (isDeleting) return;
        setIsDeleting(true);
        try {
            await updateSlideStatus({
                chapterId: chapterId,
                slideId: slideId,
                status: 'DELETED',
                instituteId: INSTITUTE_ID || '',
            });

            // Second, and separately reported: the slide is already gone by this
            // point, so a failure here must not read as "nothing was deleted".
            if (linkedAssessmentId && alsoDeleteAssessment) {
                try {
                    await handleDeleteAssessment(linkedAssessmentId, INSTITUTE_ID || undefined);
                    toast.success(t('slideAndAssessmentDeleted'));
                } catch (assessmentError) {
                    console.error('Error deleting linked assessment:', assessmentError);
                    toast.warning(t('assessmentDeleteFailed'));
                }
            } else {
                toast.success(t('slideDeleted'));
            }
            setOpenDialog(null);
        } catch (error) {
            console.error('Error deleting slide:', error);
            toast.error(t('slideDeleteFailed'));
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <MyDialog
            heading={t('delete')}
            dialogWidth="w-[400px]"
            open={openDialog == 'delete'}
            onOpenChange={() => setOpenDialog(null)}
        >
            <div className="flex w-full flex-col gap-6">
                <p>{t('confirmDelete')}</p>

                {linkedAssessmentId && (
                    <div className="flex flex-col gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                        <div className="flex items-start gap-2">
                            <Checkbox
                                id="delete-linked-assessment"
                                checked={alsoDeleteAssessment}
                                onCheckedChange={(value) => setAlsoDeleteAssessment(value === true)}
                                className="mt-0.5"
                            />
                            <label
                                htmlFor="delete-linked-assessment"
                                className="cursor-pointer text-sm"
                            >
                                {t('alsoDeleteAssessmentPrefix')}{' '}
                                <span className="font-semibold">{t('assessmentsTab')}</span>
                            </label>
                        </div>
                        {alsoDeleteAssessment && otherSlideCount > 0 && (
                            <p className="flex items-start gap-1.5 ps-6 text-caption text-warning-700">
                                <Info size={14} className="mt-0.5 shrink-0" />
                                {t('otherSlidesWarning', { count: otherSlideCount })}
                            </p>
                        )}
                        {!alsoDeleteAssessment && (
                            <p className="flex items-start gap-1.5 ps-6 text-caption text-warning-700">
                                <Info size={14} className="mt-0.5 shrink-0" />
                                {t('assessmentStaysLive')}
                            </p>
                        )}
                    </div>
                )}

                <MyButton onClick={handleDeleteSlide} disable={isDeleting}>
                    {isDeleting ? t('deletingEllipsis') : t('delete')}
                </MyButton>
            </div>
        </MyDialog>
    );
};
