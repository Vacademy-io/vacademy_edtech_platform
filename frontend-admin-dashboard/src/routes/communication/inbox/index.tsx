import { createFileRoute } from '@tanstack/react-router';
import { parseInboxSearch } from './-utils/inbox-search';

export const Route = createFileRoute('/communication/inbox/')({
    validateSearch: parseInboxSearch,
});
