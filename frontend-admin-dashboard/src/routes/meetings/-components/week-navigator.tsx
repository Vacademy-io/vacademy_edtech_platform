import { addWeeks, endOfWeek, format, startOfWeek, type Locale } from 'date-fns';
import { ar, enUS, fr, hi } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';

const DATE_FNS_LOCALES: Record<string, Locale> = { en: enUS, ar, fr, hi };

export const weekBoundsFor = (anchor: Date) => {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    return { start, end };
};

interface WeekNavigatorProps {
    weekStart: Date;
    onChange: (newAnchor: Date) => void;
}

export const WeekNavigator = ({ weekStart, onChange }: WeekNavigatorProps) => {
    const { t, i18n } = useTranslation('meetingsWeekNavigator');
    const dateFnsLocale = DATE_FNS_LOCALES[i18n.language] ?? enUS;
    const { start, end } = weekBoundsFor(weekStart);
    const sameYear = start.getFullYear() === end.getFullYear();
    const label = `${format(start, sameYear ? 'MMM d' : 'MMM d, yyyy', { locale: dateFnsLocale })} – ${format(end, 'MMM d, yyyy', { locale: dateFnsLocale })}`;

    return (
        <div className="flex flex-wrap items-center gap-2">
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                layoutVariant="icon"
                title={t('previousWeek')}
                onClick={() => onChange(addWeeks(start, -1))}
            >
                <CaretLeft className="size-3.5" />
            </MyButton>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                className="sm:min-w-0"
                onClick={() => onChange(new Date())}
            >
                {t('today')}
            </MyButton>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                layoutVariant="icon"
                title={t('nextWeek')}
                onClick={() => onChange(addWeeks(start, 1))}
            >
                <CaretRight className="size-3.5" />
            </MyButton>
            <span className="text-body font-semibold text-neutral-600">{label}</span>
        </div>
    );
};
