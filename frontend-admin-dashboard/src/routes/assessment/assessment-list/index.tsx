import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

export const assessmentListParamsSchema = z.object({
    selectedTab: z.string().optional(),
    /** Assessment folder id, or 'unfiled'; absent = all assessments. */
    folderId: z.string().optional(),
});

// Route definition only - component is lazy loaded from index.lazy.tsx
export const Route = createFileRoute('/assessment/assessment-list/')({
    validateSearch: assessmentListParamsSchema,
});
