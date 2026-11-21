import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { SocialPostsPage } from './-components/social-posts-page';

export const Route = createLazyFileRoute('/audience-manager/social-posts/')({
    component: SocialPostsRoute,
});

function SocialPostsRoute() {
    return (
        <LayoutContainer>
            <SocialPostsPage />
        </LayoutContainer>
    );
}
