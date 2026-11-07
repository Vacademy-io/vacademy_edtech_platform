import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { WorkflowDetailsPage } from './-components/workflow-details-page';

export const Route = createLazyFileRoute('/workflow/$workflowId/')({
  component: WorkflowDetails,
});

export function WorkflowDetails() {
  const { workflowId } = Route.useParams();
  const { t } = useTranslation('workflowIdIndex');

  return (
    <LayoutContainer>
      <Helmet>
        <title>{t('pageTitle')}</title>
        <meta name="description" content={t('pageDescription')} />
      </Helmet>
      <WorkflowDetailsPage workflowId={workflowId} />
    </LayoutContainer>
  );
}
