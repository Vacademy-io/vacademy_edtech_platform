import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useEffect } from 'react';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { InternalSidebar } from './-components/InternalSidebar';
import { QuestionDisplay } from './-components/QuestionDisplay';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/community/question-paper/')({
  component: QuestionPaperLayout,
});

function QuestionPaperLayout() {
  const { id } = Route.useSearch();
  const { t } = useTranslation('communityQuestionPaperIndex');

  const { setNavHeading } = useNavHeadingStore();
  useEffect(() => {
    setNavHeading(<h1 className="text-lg">{t('community')}</h1>);
  }, [t]);

  return (
    <LayoutContainer intrnalMargin={false} className="flex-1">
      <div className="flex h-full flex-1 flex-row">
        <InternalSidebar id={id} />
        <QuestionDisplay id={id} />
      </div>
    </LayoutContainer>
  );
}
