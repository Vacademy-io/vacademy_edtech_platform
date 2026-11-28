import { createFileRoute } from '@tanstack/react-router';

// Route definition only — the page is lazy loaded from index.lazy.tsx.
export const Route = createFileRoute('/syllabus-progress/')({
    validateSearch: (
        search: Record<string, unknown>
    ): { packageSessionId?: string; userId?: string } => ({
        packageSessionId:
            typeof search.packageSessionId === 'string' && search.packageSessionId
                ? search.packageSessionId
                : undefined,
        // A learner picked from the name search: shows that learner across their batches.
        userId: typeof search.userId === 'string' && search.userId ? search.userId : undefined,
    }),
});
