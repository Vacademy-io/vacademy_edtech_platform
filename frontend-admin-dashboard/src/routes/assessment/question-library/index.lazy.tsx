import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { QuestionLibraryPage } from './-components/QuestionLibraryPage';

export const Route = createLazyFileRoute('/assessment/question-library/')({
    component: () => (
        <LayoutContainer>
            <QuestionLibraryPage />
        </LayoutContainer>
    ),
});
