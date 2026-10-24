import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { BookOpenText } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StudyMaterialDetailsForm } from './study-material-details-form';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useDialogStore } from '@/routes/study-library/courses/-stores/slide-add-dialogs-store';

export const UploadStudyMaterialButton = () => {
    const { t } = useTranslation('studyLibraryUploadStudyMaterialButton');
    const [openDialog, setOpenDialog] = useState(false);
    const navigate = useNavigate();
    const { openDocUploadDialog, openPdfDialog, openVideoDialog } = useDialogStore();
    const router = useRouter();
    const { sessionId } = router.state.location.search;

    const handleOpenChange = () => {
        setOpenDialog(!openDialog);
    };

    const triggerButton = (
        <MyButton buttonType="secondary" scale="large" layoutVariant="default">
            <div className="flex items-center gap-2">
                <BookOpenText className="size-6" />
                <div>{t('title')}</div>
            </div>
        </MyButton>
    );

    const handleSubmitForm = (data: {
        [x: string]:
            | {
                  id: string;
                  name: string;
              }
            | undefined;
    }) => {
        navigate({
            to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
            search: {
                courseId: data.course?.id || '',
                levelId: data.level?.id || '',
                subjectId: data.subject?.id || '',
                moduleId: data.module?.id || '',
                chapterId: data.chapter?.id || '',
                slideId: '',
                sessionId: sessionId || '',
            },
        });

        if (data.file_type?.id === 'PDF') openPdfDialog();
        else if (data.file_type?.id === 'DOC') openDocUploadDialog();
        else openVideoDialog();
    };

    return (
        <MyDialog
            trigger={triggerButton}
            heading={t('title')}
            dialogWidth="min-w-[400px]"
            open={openDialog}
            onOpenChange={handleOpenChange}
        >
            <StudyMaterialDetailsForm
                fields={['course', 'session', 'level', 'subject', 'module', 'chapter', 'file_type']}
                onFormSubmit={handleSubmitForm}
                submitButtonName={t('submit')}
            />
        </MyDialog>
    );
};
