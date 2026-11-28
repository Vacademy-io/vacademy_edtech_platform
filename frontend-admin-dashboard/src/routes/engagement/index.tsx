import { createFileRoute } from '@tanstack/react-router';

// Route definition only — the component is lazy loaded from index.lazy.tsx.
export const Route = createFileRoute('/engagement/')({
    validateSearch: (search: Record<string, unknown>) => {
        return {
            packageSessionId: search.packageSessionId as string | undefined,
        };
    },
});
