import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface SubOrgRemoveMemberDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    memberName: string;
    isPending: boolean;
    onConfirm: (mode: 'SOFT' | 'HARD', accessTillDate: string | null) => void;
}

/**
 * Remove a sub-org team member with a choice of SOFT (keep access until a chosen
 * last-access date, then a nightly sweep deactivates them) or HARD (deactivate
 * immediately). Mirrors the "Remove from course" soft/hard model.
 */
export const SubOrgRemoveMemberDialog = ({
    open,
    onOpenChange,
    memberName,
    isPending,
    onConfirm,
}: SubOrgRemoveMemberDialogProps) => {
    const { t } = useTranslation('manageCustomTeamsSubOrgRemoveMemberDialog');
    const [mode, setMode] = useState<'SOFT' | 'HARD'>('HARD');
    const [accessTillDate, setAccessTillDate] = useState<string>('');

    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen) {
            setMode('HARD');
            setAccessTillDate('');
        }
        onOpenChange(isOpen);
    };

    // SOFT needs a future last-access date; without it the removal wouldn't do anything.
    const softMissingDate = mode === 'SOFT' && !accessTillDate;

    const footer = (
        <div className="flex w-full items-center justify-between">
            <MyButton buttonType="secondary" scale="small" onClick={() => handleOpenChange(false)}>
                {t('cancel')}
            </MyButton>
            <MyButton
                buttonType="primary"
                scale="small"
                disable={isPending || softMissingDate}
                onClick={() => onConfirm(mode, mode === 'SOFT' ? accessTillDate : null)}
                className="!bg-red-500 hover:!bg-red-600"
            >
                {isPending ? t('removing') : t('remove')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            heading={t('heading', {
                term: getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg).toLowerCase(),
            })}
            open={open}
            onOpenChange={handleOpenChange}
            dialogWidth="max-w-md"
            footer={footer}
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm text-neutral-600">
                    {t('descriptionPrefix')} <strong>{memberName}</strong>{' '}
                    {t('descriptionSuffix', {
                        term: getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg).toLowerCase(),
                        termPlural: getTerminologyPlural(
                            OtherTerms.SubOrg,
                            SystemTerms.SubOrg
                        ).toLowerCase(),
                    })}
                </p>

                <div className="flex flex-col gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                    <p className="text-xs font-medium text-neutral-600">{t('removalMode.label')}</p>
                    <label className="flex items-start gap-2">
                        <input
                            type="radio"
                            name="suborg-remove-mode"
                            checked={mode === 'HARD'}
                            onChange={() => setMode('HARD')}
                            className="mt-0.5 text-red-500"
                        />
                        <span className="text-xs text-neutral-700">
                            <strong>{t('removalMode.hardTitle')}</strong>{' '}
                            {t('removalMode.hardDescription')}
                        </span>
                    </label>
                    <label className="flex items-start gap-2">
                        <input
                            type="radio"
                            name="suborg-remove-mode"
                            checked={mode === 'SOFT'}
                            onChange={() => setMode('SOFT')}
                            className="mt-0.5 text-primary-500"
                        />
                        <span className="text-xs text-neutral-700">
                            <strong>{t('removalMode.softTitle')}</strong>{' '}
                            {t('removalMode.softDescription')}
                        </span>
                    </label>

                    {mode === 'SOFT' && (
                        <div className="ml-6 mt-1 flex flex-col gap-1.5">
                            <p className="text-[11px] font-medium text-neutral-600">
                                {t('lastAccessDate.label')}
                            </p>
                            <input
                                type="date"
                                value={accessTillDate}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={(e) => setAccessTillDate(e.target.value)}
                                className="w-fit rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800 focus:border-primary-300 focus:outline-none"
                            />
                            {softMissingDate && (
                                <p className="text-[10px] text-red-500">
                                    {t('lastAccessDate.missing')}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </MyDialog>
    );
};
