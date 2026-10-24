import { createFileRoute } from '@tanstack/react-router';

/**
 * `?blog=list` opens the blog manager over the sites list; `?blog=<postId>`
 * opens it on that post ('new' for a blank one). Deep links from the MCP blog
 * tools and the old /manage-pages/blog routes land here.
 */
export const Route = createFileRoute('/manage-pages/')({
    validateSearch: (search: Record<string, unknown>): { blog?: string } => ({
        blog: typeof search.blog === 'string' && search.blog ? search.blog : undefined,
    }),
    component: () => <div>Loading...</div>, // Will be overridden by lazy
});
