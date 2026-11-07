/**
 * Course-level unsaved-changes banner (the ONE course-scope signal).
 *
 * Amber strip in the editor sidebar — under the breadcrumb, above the chapter
 * navigator — so it reads as "about the course", not the open slide. Renders
 * nothing while the course has no local unsaved drafts; clicking opens the
 * grouped drafts dialog (subject → module → chapter → slide, jump links).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Warning, CaretRight } from '@phosphor-icons/react';
import { getDraftUserId, useSlideDrafts } from '../-hooks/use-slide-drafts';
import { UnsavedDraftsDialog } from './unsaved-drafts-dialog';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const CourseUnsavedBanner = ({ courseId }: { courseId: string }) => {
    const { t } = useTranslation('studyLibraryCourseUnsavedBanner');
    const [userId] = useState<string>(() => getDraftUserId());
    const { drafts } = useSlideDrafts(userId, courseId);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Old-format drafts without course metadata aren't counted here — they
    // self-place (metadata backfill in slide-material) once their chapter is
    // opened, and age out in ≤14 days otherwise. Deliberately no special UI.
    if (drafts.length === 0) return null;

    return (
        <div className="w-full px-2 pb-1">
            <button
                type="button"
                onClick={() => setIsDialogOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-left transition-colors hover:bg-warning-100"
            >
                <Warning weight="fill" className="size-4 shrink-0 text-warning-600" />
                <span className="flex-1 text-xs font-semibold text-neutral-700">
                    {t('unsavedInCourse', {
                        count: drafts.length,
                        course: getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                    })}
                </span>
                <span className="flex items-center gap-0.5 text-xs font-bold text-warning-600">
                    {t('review')}
                    <CaretRight className="size-3" weight="bold" />
                </span>
            </button>
            <UnsavedDraftsDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                mode="review"
                drafts={drafts}
            />
        </div>
    );
};
