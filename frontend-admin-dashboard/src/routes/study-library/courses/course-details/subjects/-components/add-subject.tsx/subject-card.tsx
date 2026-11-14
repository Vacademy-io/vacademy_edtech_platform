// subject-card.tsx
import { DotsSixVertical } from '@phosphor-icons/react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AddSubjectForm } from './add-subject-form';
import { MyDialog } from '@/components/design-system/dialog';
import { useRouter } from '@tanstack/react-router';
import { MenuOptions } from './subject-menu-options';
import { SubjectDefaultImage } from '@/assets/svgs';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useSidebar } from '@/components/ui/sidebar';
import { SortableDragHandle } from '@/components/ui/sortable';
import { SubjectType } from '@/stores/study-library/use-study-library-store';
import { getModuleFlags } from '@/components/common/layout-container/sidebar/helper';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useSuspenseQuery } from '@tanstack/react-query';
import { DropdownItemType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { OfflineAvailabilityDialog } from '@/routes/study-library/courses/course-details/-components/OfflineAvailabilityDialog';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useOfflineAccessEnabled } from '@/routes/settings/-hooks/use-offline-access-enabled';

interface SubjectCardProps {
    subject: SubjectType;
    onDelete: () => void;
    onEdit: (updatedSubject: SubjectType) => void;
    currentSession?: DropdownItemType;
}

export const SubjectCard = ({ subject, onDelete, onEdit, currentSession }: SubjectCardProps) => {
    const { t } = useTranslation('studyLibrarySubjectCard');
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isOfflineDialogOpen, setIsOfflineDialogOpen] = useState(false);
    // No Offline Availability action while the institute master switch is off —
    // the resolver denies every node then, so the rule would be dead config.
    const offlineAccessEnabled = useOfflineAccessEnabled();
    const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
    const { getPublicUrl } = useFileUpload();
    const router = useRouter();
    const { open } = useSidebar();
    const { data } = useSuspenseQuery(useInstituteQuery());
    const { getPackageSessionId } = useInstituteDetailsStore();
    const searchParams = router.state.location.search;
    const packageSessionId =
        getPackageSessionId({
            courseId: searchParams.courseId ?? '',
            sessionId: currentSession?.id ?? '',
            levelId: searchParams.levelId ?? '',
        }) ?? '';

    const handleCardClick = (e: React.MouseEvent) => {
        if (
            e.target instanceof Element &&
            (e.target.closest('.menu-options-container') ||
                e.target.closest('.drag-handle-container') ||
                e.target.closest('[role="menu"]') ||
                e.target.closest('[role="dialog"]'))
        ) {
            return;
        }

        if (!getModuleFlags(data?.sub_modules).lms) return;

        const currentPath = router.state.location.pathname;
        const searchParams = router.state.location.search;
        router.navigate({
            to: `${currentPath}/modules`,
            search: {
                courseId: searchParams.courseId,
                levelId: searchParams.levelId,
                subjectId: subject.id,
                sessionId: currentSession?.id,
            },
        });
    };

    const handleMenuOptionClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };
    useEffect(() => {
        const fetchImageUrl = async () => {
            if (subject.thumbnail_id) {
                try {
                    const url = await getPublicUrl(subject.thumbnail_id);
                    setImageUrl(url);
                } catch (error) {
                    console.error('Failed to fetch image URL:', error);
                }
            }
        };

        fetchImageUrl();
    }, [subject.thumbnail_id]);

    return (
        <div className="relative">
            <div
                onClick={handleCardClick}
                className={`relative flex w-full ${
                    open ? 'h-[260px]' : 'h-[300px]'
                } cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border border-neutral-100 p-4 shadow-md`}
            >
                <div className="drag-handle-container absolute right-0 top-2 z-10 rounded-lg bg-white">
                    <SortableDragHandle
                        variant="ghost"
                        size="icon"
                        className="cursor-grab hover:bg-neutral-100"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <DotsSixVertical className="size-6" />
                    </SortableDragHandle>
                </div>
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={subject.subject_name}
                        className={`size-full h-[85%] rounded-lg object-cover`}
                    />
                ) : (
                    <SubjectDefaultImage className={`size-full h-[85%] rounded-lg object-cover`} />
                )}
                <div className="flex items-center justify-between gap-5">
                    <div className="text-h2 font-semibold">{subject.subject_name}</div>
                    <div onClick={handleMenuOptionClick} className="menu-options-container">
                        <MenuOptions
                            onDelete={onDelete}
                            onEdit={() => setIsEditDialogOpen(true)}
                            onOfflineAvailability={
                                packageSessionId && offlineAccessEnabled
                                    ? () => setIsOfflineDialogOpen(true)
                                    : undefined
                            }
                        />
                    </div>
                </div>
            </div>

            <MyDialog
                trigger={<></>}
                heading={t('editHeading', {
                    term: getTerminology(ContentTerms.Subject, SystemTerms.Subject),
                })}
                dialogWidth="w-[400px]"
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
            >
                <AddSubjectForm
                    initialValues={subject}
                    onSubmitSuccess={(updatedSubject) => {
                        onEdit(updatedSubject);
                        setIsEditDialogOpen(false);
                    }}
                />
            </MyDialog>

            {isOfflineDialogOpen && packageSessionId && (
                <OfflineAvailabilityDialog
                    open={isOfflineDialogOpen}
                    onClose={() => setIsOfflineDialogOpen(false)}
                    sourceType="SUBJECT"
                    sourceId={subject.id}
                    packageSessionId={packageSessionId}
                    nodeName={subject.subject_name}
                />
            )}
        </div>
    );
};
