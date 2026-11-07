/**
 * Presenter-connection status for the live views. Tapping it while the stream is
 * down forces an immediate reconnect. `compact` swaps the chip for an icon below
 * the xl breakpoint (Android TV / 960 CSS px footers).
 */
import { useTranslation } from 'react-i18next';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import type { PresenterSseStatus } from './presenterSse';

export function SseStatusChip({
    status,
    onReconnect,
    compact = false,
}: {
    status: PresenterSseStatus;
    onReconnect?: () => void;
    compact?: boolean;
}) {
    const { t } = useTranslation('volt');
    const connected = status === 'connected';
    const label = connected ? t('sse.connected') : t('sse.reconnecting');
    const chip = (
        <>
            <span className={cn(compact && 'hidden xl:inline-flex')}>
                <StatusChip
                    text={label}
                    textSize="text-subtitle"
                    status={connected ? 'SUCCESS' : 'WARNING'}
                />
            </span>
            {compact &&
                (connected ? (
                    <CheckCircle
                        size={32}
                        className="text-success-600 xl:hidden"
                        aria-label={label}
                    />
                ) : (
                    <WarningCircle
                        size={32}
                        className="text-warning-600 xl:hidden"
                        aria-label={label}
                    />
                ))}
        </>
    );
    if (connected || !onReconnect) return <span className="flex items-center">{chip}</span>;
    return (
        <MyButton
            buttonType="text"
            scale="large"
            className="h-16 px-2 sm:min-w-0"
            onClick={onReconnect}
            aria-label={t('sse.reconnectNow')}
            title={t('sse.reconnectNow')}
        >
            {chip}
        </MyButton>
    );
}
