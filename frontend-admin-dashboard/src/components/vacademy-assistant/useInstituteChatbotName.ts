import { useTranslation } from 'react-i18next';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

/** Keep the dashboard and chat panel branded to the active institute. */
export function useInstituteChatbotName() {
    const { t } = useTranslation('dashboardIndex');
    const instituteName = useInstituteDetailsStore((state) =>
        state.instituteDetails?.institute_name?.trim()
    );

    return instituteName ? t('assistant.instituteName', { instituteName }) : t('assistant.name');
}
