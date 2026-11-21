import i18next from 'i18next';
import { Check, Checks, WarningCircle } from '@phosphor-icons/react';

/**
 * What WhatsApp says happened to an outgoing message, read the way WhatsApp itself shows it:
 * one grey tick sent, two grey ticks delivered to the handset, two blue ticks read.
 *
 * Shared by the thread and the conversation list so the two can never disagree about the same
 * message — the list used to draw a hard-coded single tick on every outgoing row, which said
 * "sent, nothing more" about messages that had been read hours earlier.
 */
export type DeliveryState = 'READ' | 'DELIVERED' | 'SENT' | 'FAILED';

/**
 * @param deliveryStatus the provider's own verdict from its status webhook (SENT / DELIVERED /
 *                       READ / FAILED), or the send-time SUCCESS marker.
 * @param logType the notification_log row type, e.g. "WHATSAPP_MESSAGE_OUTGOING". It never carries
 *                READ or DELIVERED, which is exactly why deliveryStatus has to be consulted first,
 *                but it is checked too so no pre-existing case is lost.
 *
 * A message nothing has been reported about keeps the single tick: we did send it, and silence
 * from WhatsApp is not the same as a refusal.
 */
export function deliveryState(deliveryStatus?: string, logType?: string): DeliveryState {
    const says = (needle: string) => (value?: string) => !!value && value.includes(needle);
    const read = says('READ');
    const delivered = says('DELIVERED');

    if (says('FAILED')(deliveryStatus)) return 'FAILED';
    if (read(deliveryStatus) || read(logType)) return 'READ';
    if (delivered(deliveryStatus) || delivered(logType)) return 'DELIVERED';
    return 'SENT';
}

export function deliveryLabel(state: DeliveryState): string {
    switch (state) {
        case 'READ':
            return i18next.t('communicationDeliveryTicks:read');
        case 'DELIVERED':
            return i18next.t('communicationDeliveryTicks:delivered');
        case 'FAILED':
            return i18next.t('communicationDeliveryTicks:notDelivered');
        default:
            return i18next.t('communicationDeliveryTicks:sent');
    }
}

export function DeliveryTicks({
    state,
    size = 13,
    // Ticks trail the timestamp in a bubble and lead the preview in a list row, so the gap side
    // belongs to the caller.
    className = 'ml-1',
}: {
    state: DeliveryState;
    size?: number;
    className?: string;
}) {
    return (
        <span className={`${className} inline-flex align-middle`} title={deliveryLabel(state)}>
            {state === 'FAILED' ? (
                <WarningCircle size={size} className="text-red-500" />
            ) : state === 'SENT' ? (
                <Check size={size} className="text-gray-400" />
            ) : (
                <Checks
                    size={size}
                    weight="bold"
                    className={state === 'READ' ? 'text-sky-500' : 'text-gray-400'}
                />
            )}
        </span>
    );
}
