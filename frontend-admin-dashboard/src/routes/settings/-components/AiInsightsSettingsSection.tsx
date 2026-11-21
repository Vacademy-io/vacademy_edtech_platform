import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { FloppyDisk, ChartBar } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    getAiInsightsSettings,
    saveAiInsightsSettings,
    DEFAULT_AI_INSIGHTS_SETTINGS,
    type AiInsightsSettingsData,
} from '@/services/ai-insights-settings';

/**
 * Who may see the per-attempt AI insight reports the LLM-analytics pipeline already
 * produces (`activity_log.processed_json`).
 *
 * Lives here rather than under Student Display or Learner Activity because those
 * configure the learner app — its widgets and its tracking thresholds — whereas this
 * decides who is shown an existing AI artefact. Keeping it beside AI Usage also puts
 * the toggle next to the credit spend it drives.
 */
export const AiInsightsSettingsSection = () => {
    const { t } = useTranslation('settingsAiInsightsSection');
    const queryClient = useQueryClient();
    const [form, setForm] = useState<AiInsightsSettingsData>(DEFAULT_AI_INSIGHTS_SETTINGS);
    const [isSaving, setIsSaving] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['ai-insights-settings'],
        queryFn: getAiInsightsSettings,
    });

    const isDirty = !!data && data.adminActivityInsightsEnabled !== form.adminActivityInsightsEnabled;

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveAiInsightsSettings(form);
            // The activity-log dialog reads the same key — refresh it so the panel
            // appears or disappears without a reload.
            await queryClient.invalidateQueries({ queryKey: ['ai-insights-settings'] });
            toast.success(t('toasts.saveSuccess'));
        } catch {
            toast.error(t('toasts.saveError'));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="border-violet-100 shadow-sm">
            <CardHeader className="border-b border-violet-50 bg-violet-50/30">
                <div className="flex items-center gap-2">
                    <ChartBar size={18} className="text-violet-500" />
                    <CardTitle className="text-base">{t('title')}</CardTitle>
                </div>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
                <div className="flex items-start justify-between gap-6 rounded-lg border border-neutral-200 p-4">
                    <div className="space-y-1">
                        <Label htmlFor="admin-activity-insights" className="text-sm font-medium">
                            {t('adminActivityToggle.label')}
                        </Label>
                        <p className="text-xs text-neutral-500">
                            {t('adminActivityToggle.hint')}
                        </p>
                    </div>
                    <Switch
                        id="admin-activity-insights"
                        checked={form.adminActivityInsightsEnabled}
                        disabled={isLoading}
                        onCheckedChange={(checked) =>
                            setForm((prev) => ({ ...prev, adminActivityInsightsEnabled: checked }))
                        }
                    />
                </div>

                <p className="text-xs text-neutral-500">{t('reviewNotice')}</p>

                <div className="flex justify-end">
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!isDirty || isSaving || isLoading}
                        onClick={handleSave}
                    >
                        <FloppyDisk size={16} />
                        {isSaving ? t('saving') : t('save')}
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
};
