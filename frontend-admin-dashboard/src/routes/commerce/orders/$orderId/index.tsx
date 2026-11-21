import { createFileRoute } from '@tanstack/react-router';

/** `action`: a dialog the desk asks to open (e.g. RTO_RECEIVE), only if the server offers it. */
export const Route = createFileRoute('/commerce/orders/$orderId/')({
    validateSearch: (search: Record<string, unknown>): { action?: string } => ({
        action: typeof search.action === 'string' ? search.action : undefined,
    }),
});
