import { createFileRoute } from '@tanstack/react-router';
import { INBOX_FILTER_KEYS, type InboxFilterKey } from '../-constants';

/** ?filter=failed (or sent, handled, dryRun) opens the inbox on that tab. */
export const Route = createFileRoute('/engagement-engines/inbox/')({
    validateSearch: (search: Record<string, unknown>): { filter?: InboxFilterKey } => ({
        filter: (INBOX_FILTER_KEYS as readonly string[]).includes(search.filter as string)
            ? (search.filter as InboxFilterKey)
            : undefined,
    }),
});
