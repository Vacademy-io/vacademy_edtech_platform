import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from '@phosphor-icons/react';
import { AddCourseDetailsForm, AddLevelData } from './add-course-details-form';

interface AddLevelButtonProps {
    onSubmit: ({
        requestData,
        packageId,
        sessionId,
    }: {
        requestData: AddLevelData;
        packageId?: string;
        sessionId?: string;
        levelId?: string;
    }) => void;
    trigger?: ReactNode;
    packageId?: string;
}

export const AddCourseDetailsButton = ({ onSubmit, trigger, packageId }: AddLevelButtonProps) => {
    const { t } = useTranslation('studyLibraryCourseDetailsAddCourseDetailsButton');
    const [openDialog, setOpenDialog] = useState(false);

    const triggerButton = (
        <MyButton buttonType="primary" scale="large" layoutVariant="default" id="assign-year">
            <Plus /> {t('addLevel')}
        </MyButton>
    );

    const handleOpenChange = () => {
        setOpenDialog(!openDialog);
    };

    const formSubmitRef = useRef(() => {});

    const levelSubmitButton = (
        <div className="flex w-full items-center justify-center">
            <MyButton
                type="button"
                buttonType="primary"
                layoutVariant="default"
                scale="large"
                onClick={() => formSubmitRef.current()}
            >
                {t('add')}
            </MyButton>
        </div>
    );

    const submitFormFn = (submitFn: () => void) => {
        formSubmitRef.current = submitFn;
    };

    return (
        <MyDialog
            trigger={trigger ? trigger : triggerButton}
            heading={t('addLevel')}
            dialogWidth="w-[430px]"
            open={openDialog}
            onOpenChange={handleOpenChange}
            footer={levelSubmitButton}
            className="z-[99999]"
        >
            {packageId ? (
                <AddCourseDetailsForm
                    onSubmitSuccess={onSubmit}
                    setOpenDialog={setOpenDialog}
                    submitForm={submitFormFn}
                    packageId={packageId}
                />
            ) : (
                <AddCourseDetailsForm
                    onSubmitSuccess={onSubmit}
                    setOpenDialog={setOpenDialog}
                    submitForm={submitFormFn}
                />
            )}
        </MyDialog>
    );
};
