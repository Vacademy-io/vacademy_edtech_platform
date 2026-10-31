import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { FloppyDisk } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    AssessmentSettingsData,
    DEFAULT_ASSESSMENT_SETTINGS,
    DEFAULT_REPORT_BRANDING,
    ReportBrandingSettings,
} from '@/types/assessment-settings';
import { getAssessmentSettings, saveAssessmentSettings } from '@/services/assessment-settings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import ReportBrandingSettingsSection from './ReportBrandingSettings';
import ResultNotificationRecipientsCard from './ResultNotificationRecipientsCard';
import ResultNotificationTemplatesCard from './ResultNotificationTemplatesCard';
import ExamExperienceSettingsCard from './ExamExperienceSettingsCard';
import { CommentPlacementPicker } from '@/components/common/ai-copy-check/CommentPlacementPicker';
import {
    CopyCheckSettingsFields,
    EMPTY_COPY_CHECK_SETTINGS,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';

const DEFAULT_HEADER_HTML = `<div style="text-align:center; font-size:16px; font-weight:bold;">{{assessment_name}}</div>
<div style="text-align:center; font-size:11px; color:rgb(102,102,102);">Student Performance Analysis</div>`;

const DEFAULT_FOOTER_HTML = `<div style="text-align:center; font-size:10px; color:rgb(153,153,153);">This report is auto-generated. For queries, contact your institute administrator.</div>`;

const AssessmentSettings = () => {
    const { t } = useTranslation('settingsAssessmentSettings');
    const [settings, setSettings] = useState<AssessmentSettingsData>(DEFAULT_ASSESSMENT_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const data = await getAssessmentSettings(true);
                // Pre-fill with institute defaults if branding hasn't been configured yet
                const branding = data.reportBranding;
                const isUnconfigured =
                    branding.primary_color === DEFAULT_REPORT_BRANDING.primary_color &&
                    !branding.watermark_text &&
                    !branding.header_html &&
                    !branding.footer_html &&
                    !branding.logo_file_id;

                if (isUnconfigured && instituteDetails) {
                    const prefilled: ReportBrandingSettings = {
                        ...branding,
                        primary_color:
                            (instituteDetails as any).institute_theme_code ||
                            localStorage.getItem('theme-code') ||
                            branding.primary_color,
                        logo_file_id:
                            (instituteDetails as any).institute_logo_file_id || null,
                        watermark_text:
                            (instituteDetails as any).institute_name || '',
                        header_html: DEFAULT_HEADER_HTML,
                        footer_html: DEFAULT_FOOTER_HTML,
                    };
                    setSettings({ ...data, reportBranding: prefilled });
                } else {
                    setSettings(data);
                }
            } catch {
                toast.error(t('errors.loadSettings'));
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [instituteDetails, t]);

    const handleToggle = (key: keyof AssessmentSettingsData, field: string, value: boolean) => {
        setSettings((prev) => ({
            ...prev,
            [key]: { ...prev[key], [field]: value },
        }));
        setHasChanges(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveAssessmentSettings(settings);
            setHasChanges(false);
            toast.success(t('toasts.settingsSaved'));
        } catch {
            toast.error(t('errors.saveSettings'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <p className="text-sm text-gray-500">{t('loading')}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 p-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{t('header.title')}</h2>
                    <p className="text-sm text-gray-500">
                        {t('header.subtitle')}
                    </p>
                </div>
                <MyButton
                    type="button"
                    scale="small"
                    buttonType="primary"
                    onClick={handleSave}
                    disabled={!hasChanges || saving}
                    className="flex items-center gap-2 font-medium"
                >
                    <FloppyDisk size={16} />
                    {saving ? t('header.saving') : t('header.saveChanges')}
                </MyButton>
            </div>

            {/* Offline Data Entry */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t('offlineEntry.title')}</CardTitle>
                    <CardDescription>
                        {t('offlineEntry.description')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="flex flex-col gap-1">
                            <Label className="text-sm font-medium">
                                {t('offlineEntry.enableLabel')}
                            </Label>
                            <p className="text-xs text-gray-500">
                                {t('offlineEntry.enableHint')}
                            </p>
                        </div>
                        <Switch
                            checked={settings.offlineEntry.enabled}
                            onCheckedChange={(checked) =>
                                handleToggle('offlineEntry', 'enabled', checked)
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Assessment folders (admin rail + learner folder cards) */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t('assessmentFolders.title')}</CardTitle>
                    <CardDescription>{t('assessmentFolders.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="flex flex-col gap-1">
                            <Label className="text-sm font-medium">
                                {t('assessmentFolders.enableLabel')}
                            </Label>
                            <p className="text-xs text-gray-500">
                                {t('assessmentFolders.enableHint')}
                            </p>
                        </div>
                        <Switch
                            checked={settings.assessmentFolders?.enabled === true}
                            onCheckedChange={(checked) =>
                                handleToggle('assessmentFolders', 'enabled', checked)
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Live test experience (tools, palette, mobile chrome) */}
            <ExamExperienceSettingsCard
                settings={settings.examExperience ?? DEFAULT_ASSESSMENT_SETTINGS.examExperience}
                onChange={(examExperience) => {
                    setSettings((prev) => ({ ...prev, examExperience }));
                    setHasChanges(true);
                }}
            />

            {/* AI copy checking template (preselected in the bulk / submitted check dialogs) */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t('aiCopyCheck.title')}</CardTitle>
                    <CardDescription>{t('aiCopyCheck.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-4">
                        <CommentPlacementPicker
                            value={settings.aiCopyCheck?.commentPlacement ?? 'INSIDE'}
                            onChange={(commentPlacement) => {
                                setSettings((prev) => ({
                                    ...prev,
                                    aiCopyCheck: { ...prev.aiCopyCheck, commentPlacement },
                                }));
                                setHasChanges(true);
                            }}
                        />
                        {/* Institute defaults for every assessment that has none of its own */}
                        <CopyCheckSettingsFields
                            withPaper={false}
                            value={{
                                ...EMPTY_COPY_CHECK_SETTINGS,
                                instructions: settings.aiCopyCheck?.instructions ?? '',
                                languageFeedback: settings.aiCopyCheck?.languageFeedback ?? 'OFF',
                            }}
                            onChange={({ instructions, languageFeedback }) => {
                                setSettings((prev) => ({
                                    ...prev,
                                    aiCopyCheck: {
                                        ...prev.aiCopyCheck,
                                        commentPlacement:
                                            prev.aiCopyCheck?.commentPlacement ?? 'INSIDE',
                                        instructions,
                                        languageFeedback,
                                    },
                                }));
                                setHasChanges(true);
                            }}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Result Notification Recipients (role-wise) */}
            <ResultNotificationRecipientsCard
                roles={settings.resultNotifications?.roles ?? {}}
                onChange={(roles) => {
                    setSettings((prev) => ({
                        ...prev,
                        resultNotifications: {
                            version: prev.resultNotifications?.version ?? 1,
                            roles,
                        },
                    }));
                    setHasChanges(true);
                }}
            />

            {/* Result email / WhatsApp templates (saved on change, not with the form) */}
            <ResultNotificationTemplatesCard />

            {/* Report Branding Section */}
            <div>
                <h3 className="mb-3 text-base font-semibold">{t('reportBranding.title')}</h3>
                <p className="mb-4 text-sm text-gray-500">
                    {t('reportBranding.description')}
                </p>
                <ReportBrandingSettingsSection
                    settings={settings.reportBranding}
                    onChange={(branding) => {
                        setSettings((prev) => ({ ...prev, reportBranding: branding }));
                        setHasChanges(true);
                    }}
                />
            </div>
        </div>
    );
};

export default AssessmentSettings;
