import { ClipboardText } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { EnquiryDetails } from '@/routes/admissions/enquiries/-components/enquiry-side-view/enquiry-details';
import { ProfileEmpty } from '../profile-ui';

interface StudentEnquiryProps {
    enquiryId?: string | null;
}

export const StudentEnquiry = ({ enquiryId }: StudentEnquiryProps) => {
    const { t } = useTranslation('manageStudentsStudentEnquiry');

    if (!enquiryId) {
        return (
            <ProfileEmpty
                icon={ClipboardText}
                title={t('noEnquiryFound.title')}
                hint={t('noEnquiryFound.hint')}
            />
        );
    }

    return <EnquiryDetails enquiryId={enquiryId} />;
};
