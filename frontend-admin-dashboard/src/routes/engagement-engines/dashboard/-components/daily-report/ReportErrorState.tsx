import { WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { rangeT } from '../../-utils/report-range-t';

interface ReportErrorStateProps {
    /** HTTP status of the failure: 400 bad date or range, 403 no access, 404 unknown engine. */
    status: number | null;
    /** The page covers more than one day, so the copy says "days" and "period". */
    range: boolean;
    /** The request is being sent again: the button is disabled. */
    isFetching: boolean;
    onRetry: () => void;
    onResetEngine: () => void;
    onResetDate: () => void;
}

/** A failed report request with nothing to show: each cause gets its own words and its own way out. */
export function ReportErrorState({
    status,
    range,
    isFetching,
    onRetry,
    onResetEngine,
    onResetDate,
}: ReportErrorStateProps) {
    const { t: plainT } = useTranslation('engagementDailyReport');
    const t = rangeT(plainT, range);
    const kind =
        status === 400
            ? 'badDate'
            : status === 404
              ? 'noEngine'
              : status === 403
                ? 'noAccess'
                : 'generic';
    const action =
        kind === 'badDate'
            ? { label: t('error.resetDate'), run: onResetDate }
            : kind === 'noEngine'
              ? { label: t('error.resetEngine'), run: onResetEngine }
              : kind === 'generic'
                ? { label: t('retry'), run: onRetry }
                : null;
    return (
        <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-xl border border-danger-200 bg-danger-50 p-8 text-center"
        >
            <WarningCircle size={28} weight="fill" className="text-danger-600" />
            <p className="font-semibold text-neutral-900">
                <span className="text-subtitle">{t(`error.${kind}.title`)}</span>
            </p>
            <p className="max-w-md text-neutral-600">
                <span className="text-body">{t(`error.${kind}.text`)}</span>
            </p>
            {action && (
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    disable={isFetching}
                    onClick={action.run}
                >
                    {action.label}
                </MyButton>
            )}
        </div>
    );
}
