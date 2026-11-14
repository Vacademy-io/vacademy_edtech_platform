import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadSimple, UsersThree } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

type Choice = 'MAP' | 'CHECK_ONLY';

const OPTIONS: { value: Choice; icon: typeof UsersThree }[] = [
    { value: 'MAP', icon: UsersThree },
    { value: 'CHECK_ONLY', icon: DownloadSimple },
];

/**
 * Asked when a bulk AI check is started: match each copy to a student (the
 * copies land on the students' records and show in Submissions), or only check
 * them - nothing is matched, nothing waits for a person, and the checked copies
 * come back as a zip. Used by the Bulk AI check dialog and the Evalezy app.
 */
export const MapStudentsChoiceDialog = ({
    open,
    onOpenChange,
    copies,
    onConfirm,
    canMap = true,
    defaultChoice = 'MAP',
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Copies about to be sent; shown on the confirm button. */
    copies: number;
    onConfirm: (mapStudents: boolean) => void;
    /** False when the assessment has no students to map to: only "just check" is offered. */
    canMap?: boolean;
    /** Preselected option (the institute's Settings default); both stay selectable. */
    defaultChoice?: Choice;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const initialChoice: Choice = canMap ? defaultChoice : 'CHECK_ONLY';
    const [choice, setChoice] = useState<Choice>(initialChoice);
    // One start per opening: a fast double tap must not start (and charge for) two batches.
    const [confirmed, setConfirmed] = useState(false);

    // Every time it opens, start from the usual flow (or the only one there is).
    useEffect(() => {
        if (open) {
            setChoice(initialChoice);
            setConfirmed(false);
        }
    }, [open, initialChoice]);

    return (
        <MyDialog
            heading={t('mapChoice.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={confirmed}
                        onClick={() => {
                            if (confirmed) return;
                            setConfirmed(true);
                            onConfirm(choice === 'MAP');
                        }}
                    >
                        {t(
                            choice === 'MAP'
                                ? 'mapChoice.confirmMap'
                                : 'mapChoice.confirmCheckOnly',
                            {
                                count: copies,
                            }
                        )}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-3 p-4 sm:p-6">
                <p className="text-sm text-neutral-600">{t('mapChoice.intro')}</p>
                <RadioGroup
                    value={choice}
                    onValueChange={(v) => setChoice(v as Choice)}
                    className="flex flex-col gap-3"
                >
                    {OPTIONS.map(({ value, icon: Icon }) => {
                        const id = `map-students-${value}`;
                        const disabled = value === 'MAP' && !canMap;
                        return (
                            <label
                                key={value}
                                htmlFor={id}
                                className={cn(
                                    'flex items-start gap-3 rounded-md border p-3 transition-colors',
                                    disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                                    choice === value
                                        ? 'border-primary-500 bg-primary-50'
                                        : 'border-neutral-200 hover:border-neutral-300'
                                )}
                            >
                                <RadioGroupItem
                                    id={id}
                                    value={value}
                                    disabled={disabled}
                                    className="mt-1"
                                />
                                <Icon size={22} className="mt-0.5 shrink-0 text-primary-500" />
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="text-body font-medium text-neutral-800">
                                        {t(`mapChoice.${value}.title`)}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {disabled
                                            ? t('mapChoice.noStudents')
                                            : t(`mapChoice.${value}.description`)}
                                    </span>
                                </span>
                            </label>
                        );
                    })}
                </RadioGroup>
            </div>
        </MyDialog>
    );
};

export default MapStudentsChoiceDialog;
