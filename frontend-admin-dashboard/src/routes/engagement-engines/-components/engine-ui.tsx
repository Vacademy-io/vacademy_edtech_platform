import type { Icon } from '@phosphor-icons/react';
import { Bell, EnvelopeSimple, PhoneCall, Robot, WhatsappLogo } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { ChannelKey, EngineStatus } from '../-types';

/* Small presentational pieces shared by the engagement engine pages. */

export const CHANNEL_ICON: Record<ChannelKey, Icon> = {
    WHATSAPP: WhatsappLogo,
    EMAIL: EnvelopeSimple,
    IN_APP: Bell,
    AI_CALL: PhoneCall,
};

export const CHANNEL_TINT: Record<ChannelKey, string> = {
    WHATSAPP: 'bg-success-50 text-success-700',
    EMAIL: 'bg-info-50 text-info-700',
    IN_APP: 'bg-primary-50 text-primary-600',
    AI_CALL: 'bg-warning-50 text-warning-700',
};

const STATUS_TILE: Record<EngineStatus, string> = {
    ACTIVE: 'bg-success-50 text-success-600',
    DRY_RUN: 'bg-info-50 text-info-600',
    TEMPLATES_PENDING: 'bg-warning-50 text-warning-600',
    PAUSED: 'bg-warning-50 text-warning-600',
    DRAFT: 'bg-primary-50 text-primary-500',
    ARCHIVED: 'bg-neutral-100 text-neutral-500',
};

/** A rounded icon tile; tinted by engine status when `status` is given. */
export function IconTile({
    icon: I = Robot,
    status,
    tint,
    size = 'md',
}: {
    icon?: Icon;
    status?: EngineStatus;
    tint?: string;
    size?: 'sm' | 'md' | 'lg';
}) {
    return (
        <span
            className={cn(
                'flex shrink-0 items-center justify-center rounded-lg',
                size === 'sm' && 'size-8',
                size === 'md' && 'size-10',
                size === 'lg' && 'size-11',
                tint ?? (status ? STATUS_TILE[status] : 'bg-primary-50 text-primary-500')
            )}
        >
            <I size={size === 'sm' ? 16 : 20} weight="duotone" />
        </span>
    );
}

/** A small pill. `className` carries the tint; the text size stays on the inner span. */
export function Chip({
    icon: I,
    label,
    className,
}: {
    icon?: Icon;
    label: string;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex w-fit items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600',
                className
            )}
        >
            {I && <I size={12} weight="bold" />}
            <span className="text-caption">{label}</span>
        </span>
    );
}

export function ChannelChip({ channel, label }: { channel: ChannelKey; label: string }) {
    return <Chip icon={CHANNEL_ICON[channel]} label={label} className={CHANNEL_TINT[channel]} />;
}

/** One label / value row of a key-value list. */
export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1 border-b border-neutral-100 py-2.5 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
            <span className="shrink-0 text-neutral-500 sm:w-40">
                <span className="text-caption">{label}</span>
            </span>
            <span className="min-w-0 flex-1 text-neutral-800">
                <span className="text-body">{children}</span>
            </span>
        </div>
    );
}

/** A small heading inside a card. */
export function SubHeading({ children }: { children: React.ReactNode }) {
    return (
        <h4 className="mb-2 mt-4 font-semibold uppercase tracking-wide text-neutral-500">
            <span className="text-caption">{children}</span>
        </h4>
    );
}
