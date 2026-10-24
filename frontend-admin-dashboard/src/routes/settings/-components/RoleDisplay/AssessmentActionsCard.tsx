import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AssessmentActionSettings } from '@/types/display-settings';

interface AssessmentActionsCardProps {
    settings: AssessmentActionSettings | undefined;
    onChange: (next: AssessmentActionSettings) => void;
}

const buildRows = (
    t: TFunction
): {
    key: keyof AssessmentActionSettings;
    label: string;
    hint: string;
}[] => [
    {
        key: 'showCreateAssessment',
        label: t('rows.showCreateAssessment.label'),
        hint: t('rows.showCreateAssessment.hint'),
    },
    {
        key: 'showEditAssessment',
        label: t('rows.showEditAssessment.label'),
        hint: t('rows.showEditAssessment.hint'),
    },
    {
        key: 'showDeleteAssessment',
        label: t('rows.showDeleteAssessment.label'),
        hint: t('rows.showDeleteAssessment.hint'),
    },
    {
        key: 'showManageFolders',
        label: t('rows.showManageFolders.label'),
        hint: t('rows.showManageFolders.hint'),
    },
];

export const AssessmentActionsCard = ({ settings, onChange }: AssessmentActionsCardProps) => {
    const { t } = useTranslation('settingsAssessmentActionsCard');
    const rows = buildRows(t);

    // Always emit the full object so no flag this card owns is dropped on save.
    const patch = (partial: Partial<AssessmentActionSettings>) =>
        onChange({
            showCreateAssessment: settings?.showCreateAssessment !== false,
            showEditAssessment: settings?.showEditAssessment !== false,
            showDeleteAssessment: settings?.showDeleteAssessment !== false,
            showManageFolders: settings?.showManageFolders !== false,
            ...partial,
        });

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('header.title')}</CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                {rows.map(({ key, label, hint }) => (
                    <div
                        key={key}
                        className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
                    >
                        <div>
                            <div className="text-sm font-medium text-neutral-800">{label}</div>
                            <div className="mt-0.5 text-caption text-neutral-500">{hint}</div>
                        </div>
                        <Switch
                            checked={settings?.[key] !== false}
                            onCheckedChange={(checked) => patch({ [key]: checked })}
                        />
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};

export default AssessmentActionsCard;
