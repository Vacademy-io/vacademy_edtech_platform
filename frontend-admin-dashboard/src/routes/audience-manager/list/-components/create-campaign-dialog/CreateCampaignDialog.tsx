import React from 'react';
import { useTranslation } from 'react-i18next';
import { CreateCampaignForm } from './CreateCampaignForm';
import { CampaignItem } from '../../-services/get-campaigns-list';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface CreateCampaignDialogProps {
    isOpen: boolean;
    onClose: () => void;
    campaign?: CampaignItem | null;
    /** Wizard step to open on (0 = Basics). */
    initialStep?: number;
}

export const CreateCampaignDialog: React.FC<CreateCampaignDialogProps> = ({
    isOpen,
    onClose,
    campaign,
    initialStep,
}) => {
    const { t } = useTranslation('audienceManagerCreateCampaignDialog');
    const audienceListLabel = getTerminology(OtherTerms.AudienceList, SystemTerms.AudienceList);
    const heading = campaign
        ? t('editHeading', { label: audienceListLabel })
        : t('createHeading', { label: audienceListLabel });

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="w-dialog-lg max-h-dialog-tall overflow-y-auto overflow-x-hidden">
                <DialogHeader>
                    <DialogTitle>{heading}</DialogTitle>
                    <DialogDescription>
                        {campaign ? campaign.campaign_name : t('createDescription')}
                    </DialogDescription>
                </DialogHeader>
                <div className="min-w-0 overflow-hidden">
                    <CreateCampaignForm
                        onSuccess={onClose}
                        campaign={campaign}
                        initialStep={initialStep}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
};
