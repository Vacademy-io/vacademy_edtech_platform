import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { ReactNode, useState } from 'react';
import { AddCourseForm } from './add-course-form';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '../../layout-container/sidebar/utils';

export interface AddCourseButtonProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Replaces the default "Create Course" button. */
    trigger?: ReactNode;
}

export const AddCourseButton = ({ open, onOpenChange, trigger }: AddCourseButtonProps) => {
    const [internalOpen, setInternalOpen] = useState(false);

    const isControlled = open !== undefined && onOpenChange !== undefined;
    const isOpen = isControlled ? open : internalOpen;
    const setIsOpen = isControlled ? onOpenChange : setInternalOpen;

    const handleOpenChange = (newOpen: boolean) => {
        setIsOpen(newOpen);
    };

    return (
        <MyDialog
            trigger={
                trigger ?? (
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="font-medium"
                    >
                        Create {getTerminology(ContentTerms.Course, SystemTerms.Course)}
                    </MyButton>
                )
            }
            heading={`Add ${getTerminology(ContentTerms.Course, SystemTerms.Course)}`}
            dialogWidth="w-[500px]" // design-lint-ignore: pre-existing width, untouched here
            open={isOpen}
            onOpenChange={handleOpenChange}
            isTour
        >
            <AddCourseForm isEdit={false} />
        </MyDialog>
    );
};
