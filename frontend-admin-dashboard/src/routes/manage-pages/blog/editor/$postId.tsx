import { createFileRoute, redirect } from '@tanstack/react-router';

/** Old post-editor URL (still handed out by older MCP links) → the builder with that post open. */
export const Route = createFileRoute('/manage-pages/blog/editor/$postId')({
    beforeLoad: ({ params }) => {
        throw redirect({ to: '/manage-pages', search: { blog: params.postId } });
    },
});
