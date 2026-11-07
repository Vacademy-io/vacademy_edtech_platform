/**
 * One class. The whole card is the button, so a touch anywhere or OK on a remote starts
 * it. Time and day come from the server; nothing here reads this panel's clock on its own.
 */
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CircleNotch, DeviceMobile, Prohibit, type Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { TodayClass } from '@/classroom-shared/apiTypes';
import type { ClassCapability } from './capability';
import type { HostProvider } from '@/classroom-shared/hostActions';
import type { ClassStatus } from './todayStatus';

export interface TodayCardProps {
    item: TodayClass;
    status: ClassStatus;
    provider: HostProvider | 'external' | null;
    capability: ClassCapability;
    busy: boolean;
    onStart: () => void;
}

const ACTION_ICONS: Record<ClassCapability, Icon> = {
    here: ArrowRight,
    device: DeviceMobile,
    external: ArrowRight,
    none: Prohibit,
};

export const TodayCard = forwardRef<HTMLButtonElement, TodayCardProps>(function TodayCard(
    { item, status, provider, capability, busy, onStart },
    ref
) {
    const { t } = useTranslation('classes');
    const done = status.kind === 'done';
    const ActionIcon = busy ? CircleNotch : ACTION_ICONS[capability];
    const details = [item.subject, (item.batches ?? []).join(', ')].filter(Boolean).join(' · ');
    const names = (item.instructors ?? []).map((i) => i.name).filter(Boolean);
    const people =
        names.length > 2
            ? t('card.moreInstructors', {
                  names: names.slice(0, 2).join(', '),
                  more: names.length - 2,
              })
            : names.join(', ');
    return (
        <button
            ref={ref}
            type="button"
            data-class-card={item.schedule_id}
            disabled={capability === 'none'}
            aria-busy={busy}
            onClick={onStart}
            className={cn(
                'block min-h-48 w-96 shrink-0 rounded-lg border bg-card p-4 text-start shadow-sm transition-colors',
                'active:border-primary-500 active:bg-primary-50 disabled:cursor-not-allowed',
                'focus:outline-none focus:ring-4 focus:ring-primary-300',
                status.kind === 'now' ? 'border-primary-500' : 'border-border',
                done && 'opacity-75'
            )}
        >
            {/* A <button> cannot be a flex container before Chrome 83, so its child is. */}
            <span className="flex min-h-40 w-full flex-col justify-between">
                <span className="block w-full">
                    <span className="flex items-center justify-between">
                        <span className="text-h3 font-semibold tabular-nums text-neutral-800">
                            {item.time_label}
                        </span>
                        {status.kind === 'now' && (
                            <span className="rounded-md bg-primary-500 px-2 text-subtitle font-semibold text-neutral-50">
                                {t('status.now')}
                            </span>
                        )}
                        {status.kind === 'soon' && (
                            <span className="rounded-md bg-primary-50 px-2 text-subtitle text-primary-500">
                                {t('status.soon', { minutes: status.minutes })}
                            </span>
                        )}
                        {done && (
                            <span className="rounded-md bg-neutral-100 px-2 text-subtitle text-neutral-500">
                                {t('status.done')}
                            </span>
                        )}
                    </span>
                    <span className="block truncate pt-1 text-title font-semibold text-neutral-800">
                        {item.title || t('card.untitled')}
                    </span>
                    {details && (
                        <span className="block truncate text-body text-neutral-600">{details}</span>
                    )}
                    {people && (
                        <span className="block truncate text-body text-neutral-500">{people}</span>
                    )}
                </span>
                <span className="flex w-full items-center justify-between pt-2">
                    <span className="truncate text-body text-neutral-500">
                        {provider ? t(`provider.${provider}`) : ''}
                    </span>
                    <span
                        className={cn(
                            'flex shrink-0 items-center space-x-2 pl-2 text-subtitle font-semibold',
                            capability === 'none' ? 'text-neutral-400' : 'text-primary-500'
                        )}
                    >
                        <span>{busy ? t('action.starting') : t(`action.${capability}`)}</span>
                        <ActionIcon size={24} className={cn(busy && 'animate-spin')} aria-hidden />
                    </span>
                </span>
            </span>
        </button>
    );
});
