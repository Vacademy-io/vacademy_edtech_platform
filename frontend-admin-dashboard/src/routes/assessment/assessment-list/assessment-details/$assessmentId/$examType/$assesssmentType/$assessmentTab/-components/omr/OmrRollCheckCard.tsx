import { useTranslation } from 'react-i18next';
import { ArrowsClockwise, CheckCircle, CircleNotch, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type { OmrRollCheck } from '../../-services/omr-services';
import { OmrCard } from './OmrCard';

/**
 * Every learner's roll number on the sheet is their enrollment number, so a
 * missing, non-numeric or duplicate one would make sheets impossible to match.
 * The sheets cannot be downloaded until this is clean.
 */
export const OmrRollCheckCard = ({
    rollCheck,
    isLoading,
    isFetching,
    error,
    onRecheck,
}: {
    rollCheck: OmrRollCheck | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: string | null;
    onRecheck: () => void;
}) => {
    const { t } = useTranslation('assessmentOmr');
    return (
        <OmrCard
            title={t('roll.title')}
            subtitle={t('roll.subtitle')}
            actions={
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    disabled={isFetching}
                    onClick={onRecheck}
                >
                    {isFetching ? (
                        <CircleNotch size={14} className="animate-spin" />
                    ) : (
                        <ArrowsClockwise size={14} />
                    )}
                    {t('roll.recheck')}
                </MyButton>
            }
        >
            {isLoading ? (
                <p className="text-sm text-neutral-500">{t('roll.checking')}</p>
            ) : error ? (
                <p className="text-sm text-danger-600">{error}</p>
            ) : rollCheck ? (
                <>
                    <div className="flex flex-wrap gap-4 text-sm text-neutral-700">
                        <span>
                            {t('roll.participants', { count: rollCheck.participant_count })}
                        </span>
                        {rollCheck.roll_digits != null && (
                            <span>{t('roll.digits', { count: rollCheck.roll_digits })}</span>
                        )}
                    </div>
                    {rollCheck.ok ? (
                        <p className="flex items-center gap-2 rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
                            <CheckCircle size={18} className="shrink-0" />
                            {t('roll.ok')}
                        </p>
                    ) : (
                        <>
                            <p className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                                <WarningCircle size={18} className="mt-px shrink-0" />
                                {t('roll.fixHint')}
                            </p>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-table-sm text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 text-start text-caption uppercase tracking-wide text-neutral-500">
                                            <th className="py-2 pe-3">{t('roll.table.name')}</th>
                                            <th className="py-2 pe-3">
                                                {t('roll.table.enrollment')}
                                            </th>
                                            <th className="py-2 pe-3">{t('roll.table.problem')}</th>
                                            <th className="py-2">{t('roll.table.detail')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-100">
                                        {rollCheck.issues.map((issue, i) => (
                                            <tr
                                                key={`${issue.user_id ?? 'x'}-${issue.problem}-${i}`}
                                            >
                                                <td className="py-2 pe-3 text-neutral-800">
                                                    {issue.name || '—'}
                                                </td>
                                                <td className="py-2 pe-3 font-mono text-neutral-700">
                                                    {issue.enrollment_number || '—'}
                                                </td>
                                                <td className="py-2 pe-3 text-danger-600">
                                                    {t(`roll.problem.${issue.problem}`, {
                                                        defaultValue: issue.problem,
                                                    })}
                                                </td>
                                                <td className="py-2 text-caption text-neutral-500">
                                                    {issue.detail || ''}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </>
            ) : null}
        </OmrCard>
    );
};

export default OmrRollCheckCard;
