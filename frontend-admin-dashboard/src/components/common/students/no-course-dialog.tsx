import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { useNavigate } from '@tanstack/react-router';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '../layout-container/sidebar/utils';

export const NoCourseDialog = ({
    isOpen,
    setIsOpen,
    type,
    content,
    trigger,
}: {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    type: string;
    content?: string;
    trigger?: React.ReactNode;
}) => {
    const navigate = useNavigate();
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="p-0 font-normal">
                <DialogHeader>
                    <div className="rounded-md bg-primary-50 px-6 py-4 text-base font-semibold text-primary-500">
                        Create {getTerminology(ContentTerms.Course, SystemTerms.Course)} First
                    </div>
                    <p className="mt-2 p-2 text-sm text-gray-500">
                        {`${content || `You need to create a ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} and add a subject in it before`} ${type.toLocaleLowerCase()}.`}
                    </p>
                </DialogHeader>
                <div className="my-4 flex w-full justify-end gap-2 px-2">
                    <MyButton
                        buttonType="primary"
                        onClick={() => {
                            navigate({
                                to: '/study-library/courses',
                            });
                        }}
                    >
                        Create {getTerminology(ContentTerms.Course, SystemTerms.Course)}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};
