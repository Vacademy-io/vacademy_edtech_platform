import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { DotsThree } from '@phosphor-icons/react';
import { AddCourseDetailsForm, AddLevelData } from './add-course-details-form';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { LevelWithDetailsType } from '@/stores/study-library/use-study-library-store';

interface LevelMenuOptionsProps {
    onDelete: (levelId: string) => void;
    onEdit: ({ requestData }: { requestData: AddLevelData }) => void;
    levelId: string;
    level: LevelWithDetailsType;
}

export const LevelMenuOptions = ({ onDelete, onEdit, levelId, level }: LevelMenuOptionsProps) => {
    const { t } = useTranslation('studyLibraryCourseDetailsLevelMenuOptions');
    const [openEditDialog, setOpenEditDialog] = useState(false);
    const editLevelLabel = t('editLevel');
    const deleteLevelLabel = t('deleteLevel');
    const DropdownList = [editLevelLabel, deleteLevelLabel];

    const handleMenuOptionsChange = (value: string) => {
        if (value === deleteLevelLabel) {
            onDelete(levelId);
        } else if (value === editLevelLabel) {
            setOpenEditDialog(true);
        }
    };

    const handleOpenChange = () => {
        setOpenEditDialog(!openEditDialog);
    };

    const formSubmitRef = useRef(() => {});

    const levelSubmitButton = (
        <div className="flex w-full items-center justify-center">
            <MyButton
                type="submit"
                buttonType="primary"
                layoutVariant="default"
                scale="large"
                onClick={() => formSubmitRef.current()}
            >
                {t('saveChanges')}
            </MyButton>
        </div>
    );

    return (
        <>
            <MyDropdown dropdownList={DropdownList} onSelect={handleMenuOptionsChange}>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="icon"
                    className="flex items-center justify-center"
                >
                    <DotsThree />
                </MyButton>
            </MyDropdown>
            <MyDialog
                heading={editLevelLabel}
                dialogWidth="w-[430px]"
                open={openEditDialog}
                onOpenChange={handleOpenChange}
                footer={levelSubmitButton}
            >
                <AddCourseDetailsForm
                    initialValues={{
                        id: level.id,
                        level_name: level.name,
                        thumbnail_file_id: '',
                        duration_in_days: 0,
                        new_level: false,
                        sessions: [],
                    }}
                    onSubmitSuccess={onEdit}
                    setOpenDialog={setOpenEditDialog}
                    submitForm={(submitFn) => {
                        formSubmitRef.current = submitFn;
                    }}
                />
            </MyDialog>
        </>
    );
};
