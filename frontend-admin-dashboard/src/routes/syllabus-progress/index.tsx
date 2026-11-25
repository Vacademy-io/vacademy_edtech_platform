import { createFileRoute } from '@tanstack/react-router';

// Route definition only — the page is lazy loaded from index.lazy.tsx.
export const Route = createFileRoute('/syllabus-progress/')({
    validateSearch: (search: Record<string, unknown>): { packageSessionId?: string } => ({
        packageSessionId:
            typeof search.packageSessionId === 'string' && search.packageSessionId
                ? search.packageSessionId
                : undefined,
    }),
});
