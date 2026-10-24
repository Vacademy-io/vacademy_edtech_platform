import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useRef } from 'react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getUserId } from '@/constants/getUserId';
import { getInstituteId } from '@/constants/helper';
import { urlInstituteDetails } from '@/constants/urls';
import { checkAdminAccess, AdminMappings } from '@/services/sub-organization-learner-management';
import { toast } from 'sonner';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/types/naming-settings';
import { SubOrgLearnersComponent } from './-components/SubOrgLearnersComponent';

export const Route = createFileRoute('/sub-org-learners/')({
  component: () => (
    <LayoutContainer>
      <SubOrgLearnersPage />
    </LayoutContainer>
  ),
});

function SubOrgLearnersPage() {
  const { t } = useTranslation('registrationB');
  const admin = getTerminology(RoleTerms.Admin, SystemTerms.Admin);
  const { setNavHeading } = useNavHeadingStore();
  const [hasAccess, setHasAccess] = useState<boolean>(false);
  const [adminMappings, setAdminMappings] = useState<AdminMappings[]>([]);
  const [instituteDetails, setInstituteDetails] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasCheckedAccess = useRef(false);

  useEffect(() => {
    setNavHeading(t('subOrgLearners.page.navHeading'));
  }, [setNavHeading, t]);

  useEffect(() => {
    const checkAccess = async () => {
      if (hasCheckedAccess.current) return;
      hasCheckedAccess.current = true;

      try {
        const userId = await getUserId();

        if (!userId) {
          toast.error(t('subOrgLearners.page.toast.notAuthenticated'));
          setHasAccess(false);
          setIsLoading(false);
          return;
        }

        // Get current user's institute ID
        const currentInstituteId = await getInstituteId();
        if (!currentInstituteId) {
          toast.error(t('subOrgLearners.page.toast.instituteNotFound'));
          setHasAccess(false);
          setIsLoading(false);
          return;
        }

        // Check admin access
        const response = await checkAdminAccess(userId);
        const allMappings = response.admin_mappings || [];

        // Filter mappings by current user's institute ID
        const filteredMappings = allMappings.filter(
          (mapping) => mapping.institute_id === currentInstituteId
        );

        if (filteredMappings.length === 0) {
          setHasAccess(false);
          setIsLoading(false);
          return;
        }

        // Fetch institute details to get package session names
        try {
          const instituteResponse = await axios.get(`${urlInstituteDetails}/${currentInstituteId}`);
          setInstituteDetails(instituteResponse.data);
        } catch (error) {
          console.error('Error fetching institute details:', error);
          // Continue even if institute details fetch fails
        }

        setAdminMappings(filteredMappings);
        setHasAccess(true);
      } catch (error) {
        console.error('Error checking admin access:', error);
        toast.error(t('subOrgLearners.page.toast.accessCheckFailed'));
        setHasAccess(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAccess();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
          <p className="text-gray-600">
            {t('subOrgLearners.page.checkingPermissions')}
          </p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {t('subOrgLearners.page.accessDeniedTitle')}
          </h2>
          <p className="text-gray-600">
            {t('subOrgLearners.page.accessDeniedDescription', { admin })}
          </p>
        </div>
      </div>
    );
  }

  return <SubOrgLearnersComponent adminMappings={adminMappings} instituteDetails={instituteDetails} />;
}
