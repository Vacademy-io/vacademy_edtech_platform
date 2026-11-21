import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { LearnerHomePage } from './-components/LearnerHomePage';

export const Route = createLazyFileRoute('/learner-home/')({
    component: () => (
        <LayoutContainer>
            <LearnerHomePage />
        </LayoutContainer>
    ),
});
