import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { SYLLABUS_STATUSES, type SyllabusStatus } from '@/services/syllabus-progress';
import { STATUS_META } from './status-meta';

/** The four statuses as large tap targets (2×2 on phones, one row from sm up). */
export function StatusPicker({
    value,
    onChange,
}: {
    value: SyllabusStatus | '';
    onChange: (status: SyllabusStatus) => void;
}) {
    const { t } = useTranslation('syllabusProgress');
    const baseId = useId();
    return (
        <RadioGroup
            value={value}
            onValueChange={(v) => onChange(v as SyllabusStatus)}
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            aria-label={t('dialog.status')}
        >
            {SYLLABUS_STATUSES.map((status) => {
                const meta = STATUS_META[status];
                const Icon = meta.icon;
                const id = `${baseId}-${status}`;
                const checked = value === status;
                return (
                    <Label
                        key={status}
                        htmlFor={id}
                        className={cn(
                            'flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-body font-regular transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                            checked
                                ? cn(meta.chip, 'ring-1 ring-current')
                                : 'border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                        )}
                    >
                        <RadioGroupItem id={id} value={status} className="sr-only" />
                        <Icon
                            className={cn('size-4 shrink-0', meta.text)}
                            weight={checked ? 'fill' : 'regular'}
                            aria-hidden
                        />
                        <span className="min-w-0 truncate">{t(meta.labelKey)}</span>
                    </Label>
                );
            })}
        </RadioGroup>
    );
}
