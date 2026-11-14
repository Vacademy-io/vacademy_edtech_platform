import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CertificateStudentDataSection } from './-components/certificate-student-data-section';
import { Helmet } from 'react-helmet';

export const Route = createLazyFileRoute('/certificate-generation/student-data/')({
  component: CertificateStudentData,
});

export function CertificateStudentData() {
  const { t } = useTranslation('certificateGenerationStudentDataIndex');
  console.log('🚀 CertificateStudentData component rendering');

  try {
    return (
      <LayoutContainer>
        <Helmet>
          <title>{t('meta.title')}</title>
          <meta name="description" content={t('meta.description')} />
        </Helmet>
        <CertificateStudentDataSection />
      </LayoutContainer>
    );
  } catch (error) {
    console.error('❌ Error rendering CertificateStudentData:', error);
    throw error;
  }
}
