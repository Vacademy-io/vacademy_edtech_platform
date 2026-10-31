import { createFileRoute, redirect } from '@tanstack/react-router';

/** Blog posts are managed inside the Website Builder; this old URL just opens it there. */
export const Route = createFileRoute('/manage-pages/blog/')({
    beforeLoad: () => {
        throw redirect({ to: '/manage-pages', search: { blog: 'list' } });
    },
});
