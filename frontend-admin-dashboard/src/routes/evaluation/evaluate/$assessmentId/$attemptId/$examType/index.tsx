import { createFileRoute } from '@tanstack/react-router';

// Route definition only - component is lazy loaded from index.lazy.tsx
export const Route = createFileRoute('/evaluation/evaluate/$assessmentId/$attemptId/$examType/')({
    // `aiMarks`: opened with Edit on an evaluated copy — put the latest AI check's
    // marks on the sheet as editable objects once it loads (skipped when a saved
    // draft is restored instead). Optional, so every other link is unchanged.
    validateSearch: (search: Record<string, unknown>): { aiMarks?: boolean } =>
        search.aiMarks === true || search.aiMarks === 'true' ? { aiMarks: true } : {},
    // Component is defined in index.lazy.tsx
});
