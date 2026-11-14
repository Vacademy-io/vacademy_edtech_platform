// unpublish-dialog.tsx
import { MyButton } from '@/components/design-system/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Dispatch, ReactNode, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

interface UnpublishDialogProps {
    isOpen: boolean;
    setIsOpen: Dispatch<SetStateAction<boolean>>;
    handlePublishUnpublishSlide: (
        setIsOpen: Dispatch<SetStateAction<boolean>>,
        notify: boolean
    ) => void;
    /** The button the confirm popover anchors to (rendered by the caller so it
        keeps its exact styling / responsive labels). */
    trigger?: ReactNode;
}

export const UnpublishDialog = ({
    isOpen,
    setIsOpen,
    handlePublishUnpublishSlide,
    trigger,
}: UnpublishDialogProps) => {
    const { t } = useTranslation('studyLibraryUnpublishSlideDialog');
    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            {trigger && <PopoverAnchor asChild>{trigger}</PopoverAnchor>}
            <PopoverContent align="end" sideOffset={8} className="w-72 p-4">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <p className="text-subtitle font-semibold text-neutral-700">
                            {t('confirmTitle')}
                        </p>
                        <p className="text-caption text-neutral-500">{t('confirmBody')}</p>
                    </div>
                    <div className="flex justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            className="min-w-0 sm:min-w-0"
                            onClick={() => setIsOpen(false)}
                        >
                            {t('cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            className="min-w-0 sm:min-w-0"
                            onClick={() => handlePublishUnpublishSlide(setIsOpen, false)}
                        >
                            {t('unpublish')}
                        </MyButton>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};
