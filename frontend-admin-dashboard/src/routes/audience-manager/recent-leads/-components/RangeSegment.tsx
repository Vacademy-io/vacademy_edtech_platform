import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * Submitted-date window as a segmented control: 24h · 7d · 15d ·
 * 30d · All · Custom. Same values and handler as the dropdown it replaces.
 */
export function RangeSegment({
    value,
    options,
    onChange,
    disabled,
}: {
    value: string;
    options: string[];
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation('crmPages');
    return (
        <div
            className={cn(
                'flex h-10 items-center rounded-lg border border-neutral-200 bg-white p-0.5',
                disabled && 'opacity-60'
            )}
        >
            {options.map((o) => (
                <button
                    key={o}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(o)}
                    className={cn(
                        'h-full rounded-md px-3 font-medium transition-colors',
                        value === o
                            ? 'bg-primary-500 text-white'
                            : 'text-neutral-600 hover:bg-neutral-100'
                    )}
                >
                    <span className="text-caption">{t(`range.${o}`, { defaultValue: o })}</span>
                </button>
            ))}
        </div>
    );
}
