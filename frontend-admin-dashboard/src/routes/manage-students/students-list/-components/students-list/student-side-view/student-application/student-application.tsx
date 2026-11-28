import { ClipboardText } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ApplicationDetails } from '../application-details';
import { ProfileEmpty } from '../profile-ui';

interface StudentApplicationProps {
    applicantId?: string | null;
}

export const StudentApplication = ({ applicantId }: StudentApplicationProps) => {
    const { t } = useTranslation('manageStudentsStudentApplication');

    if (!applicantId) {
        return (
            <ProfileEmpty
                icon={ClipboardText}
                title={t('empty.title')}
                hint={t('empty.hint')}
            />
        );
    }

    return <ApplicationDetails applicantId={applicantId} />;
};
