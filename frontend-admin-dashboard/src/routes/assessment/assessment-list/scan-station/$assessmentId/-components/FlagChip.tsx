import { useTranslation } from 'react-i18next';
import { CheckCircle, Info, Warning, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { flagCopy, TONE_CHIP_CLASS } from '../-lib/flag-copy';

/** One flag in plain words, coloured by how much it matters; help on hover. */
export const FlagChip = ({
    code,
    severity,
    accepted = false,
    className,
}: {
    code: string;
    severity?: string | null;
    accepted?: boolean;
    className?: string;
}) => {
    const { t } = useTranslation('scanStation');
    const copy = flagCopy(code, severity);
    const Icon = accepted
        ? CheckCircle
        : copy.tone === 'danger'
          ? WarningCircle
          : copy.tone === 'warning'
            ? Warning
            : Info;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-caption',
                accepted
                    ? 'border-success-200 bg-success-50 text-success-700'
                    : TONE_CHIP_CLASS[copy.tone],
                className
            )}
            title={t(copy.helpKey)}
        >
            <Icon size={14} className="shrink-0" />
            {t(copy.titleKey)}
        </span>
    );
};

export default FlagChip;
