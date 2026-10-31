import { createFileRoute } from '@tanstack/react-router';

// Route definition only — the component is lazy loaded from index.lazy.tsx.
export const Route = createFileRoute('/erp/people/staff-bridge/')({
    component: () => null,
});
