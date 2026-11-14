// publish-dialog.tsx
import { MyButton } from '@/components/design-system/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Dispatch, ReactNode, SetStateAction, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PublishDialogProps {
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

export const PublishDialog = ({
    isOpen,
    setIsOpen,
    handlePublishUnpublishSlide,
    trigger,
}: PublishDialogProps) => {
    const { t } = useTranslation('studyLibraryPublishSlideDialog');
    // Two-step compact confirm: publish? → notify? — same call flow as before,
    // just rendered inline in a single anchored popover instead of two modals.
    const [notify, setNotify] = useState(false);
    const [step, setStep] = useState<'confirm' | 'notify'>('confirm');

    const handleNotify = (notify: boolean) => {
        setNotify(notify);
        setStep('confirm');
        setIsOpen(false);
        handlePublishUnpublishSlide(setIsOpen, notify);
    };

    return (
        <Popover
            open={isOpen}
            onOpenChange={(open) => {
                setIsOpen(open);
                // Reset to the first step whenever the popover closes.
                if (!open) setStep('confirm');
            }}
        >
            {trigger && <PopoverAnchor asChild>{trigger}</PopoverAnchor>}
            <PopoverContent align="end" sideOffset={8} className="w-72 p-4">
                {step === 'confirm' ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <p className="text-subtitle font-semibold text-neutral-700">
                                {t('confirm.title')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('confirm.description')}
                            </p>
                        </div>
                        <div className="flex justify-end gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                className="min-w-0 sm:min-w-0"
                                onClick={() => setIsOpen(false)}
                            >
                                {t('confirm.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                className="min-w-0 sm:min-w-0"
                                onClick={() => setStep('notify')}
                            >
                                {t('confirm.publish')}
                            </MyButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <p className="text-subtitle font-semibold text-neutral-700">
                                {t('notify.title')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('notify.description')}
                            </p>
                        </div>
                        <div className="flex justify-end gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                className="min-w-0 sm:min-w-0"
                                onClick={() => handleNotify(false)}
                            >
                                {t('notify.skip')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                className="min-w-0 sm:min-w-0"
                                onClick={() => handleNotify(true)}
                            >
                                {t('notify.notify')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};
