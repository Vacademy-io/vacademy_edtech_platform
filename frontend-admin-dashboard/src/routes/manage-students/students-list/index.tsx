import { createFileRoute } from '@tanstack/react-router';

interface StudentListSearchParams {
    session?: string;
    batch?: string | string[];
    batchName?: string | string[];
    package_session_id?: string;
    role?: string | string[];
    gender?: string | string[];
    status?: string | string[];
    sessionExpiry?: number | number[];
    name?: string;
    action?: string;
}

// Route definition only - component is lazy loaded from index.lazy.tsx
export const Route = createFileRoute('/manage-students/students-list/')({
    validateSearch: (search): StudentListSearchParams => ({
        session: search.session as string | undefined,
        batch: search.batch as string | string[] | undefined,
        batchName: search.batchName as string | string[] | undefined,
        package_session_id: search.package_session_id as string | undefined,
        role: search.role as string | string[] | undefined,
        gender: search.gender as string | string[] | undefined,
        status: search.status as string | string[] | undefined,
        sessionExpiry: search.sessionExpiry as number | number[] | undefined,
        // The router JSON-parses search values, so ?name=7348816962 (a phone
        // search) arrives as a number and crashed the list on .trim().
        name: search.name == null ? undefined : String(search.name),
        action: search.action as string | undefined,
    }),
});
