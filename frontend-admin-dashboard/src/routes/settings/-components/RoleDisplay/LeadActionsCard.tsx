import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import type { LeadActionSettings } from '@/types/display-settings';

interface LeadActionsCardProps {
    settings: LeadActionSettings | undefined;
    onChange: (next: LeadActionSettings) => void;
}

export const LeadActionsCard = ({ settings, onChange }: LeadActionsCardProps) => {
    const { t } = useTranslation('settingsLeadActionsCard');
    const showAddLead = settings?.showAddLead === true;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('header.title')}</CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-4 py-3.5">
                    <div>
                        <div className="text-sm font-medium text-neutral-800">
                            {t('rows.showAddLead.label')}
                        </div>
                        <div className="mt-0.5 text-caption text-neutral-500">
                            {t('rows.showAddLead.hint')}
                        </div>
                    </div>
                    <Switch
                        checked={showAddLead}
                        onCheckedChange={(checked) =>
                            onChange({ ...settings, showAddLead: checked })
                        }
                    />
                </div>
            </CardContent>
        </Card>
    );
};

export default LeadActionsCard;
