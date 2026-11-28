import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

export const questionPapersParamsSchema = z.object({
    /** Question paper folder id, or 'unfiled'; absent = top level. Used only when folders are on. */
    folderId: z.string().optional(),
});

// Route definition only - component is lazy loaded from index.lazy.tsx
export const Route = createFileRoute('/assessment/question-papers/')({
    validateSearch: questionPapersParamsSchema,
});
