import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import type { LiveClassActionSettings } from '@/types/display-settings';

interface LiveClassActionsCardProps {
    settings: LiveClassActionSettings | undefined;
    onChange: (next: LiveClassActionSettings) => void;
    /** The role's default when the flag is absent — true for admin, false otherwise. */
    defaultAllowDeletePastSessions: boolean;
}

export const LiveClassActionsCard = ({
    settings,
    onChange,
    defaultAllowDeletePastSessions,
}: LiveClassActionsCardProps) => {
    const { t } = useTranslation('settingsLiveClassActionsCard');
    const allowDeletePastSessions =
        settings?.allowDeletePastSessions ?? defaultAllowDeletePastSessions;

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
                            {t('rows.allowDeletePastSessions.label')}
                        </div>
                        <div className="mt-0.5 text-caption text-neutral-500">
                            {t('rows.allowDeletePastSessions.hint')}
                        </div>
                    </div>
                    <Switch
                        checked={allowDeletePastSessions}
                        onCheckedChange={(checked) =>
                            onChange({ ...settings, allowDeletePastSessions: checked })
                        }
                    />
                </div>
            </CardContent>
        </Card>
    );
};

export default LiveClassActionsCard;
