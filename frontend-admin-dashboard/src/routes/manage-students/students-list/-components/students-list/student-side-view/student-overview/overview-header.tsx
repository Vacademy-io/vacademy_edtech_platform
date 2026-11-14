import { SquaresFour } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileSectionCard } from '../profile-ui';

/** The card at the top of the Overview tab. It holds the learner's remarks. */
export const OverviewHeader = ({ children }: { children: ReactNode }) => {
    const { t } = useTranslation('manageStudentsOverviewHeader');

    return (
        <ProfileSectionCard icon={SquaresFour} heading={t('heading')} bodyClassName="pt-1">
            {children}
        </ProfileSectionCard>
    );
};
