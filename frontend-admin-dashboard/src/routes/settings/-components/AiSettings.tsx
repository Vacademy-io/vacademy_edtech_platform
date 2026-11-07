import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';

import {
    Sparkle,
    FloppyDisk,
    ShieldCheck,
    Trash,
    Plus,
    Info,
    FilmStrip,
    ChartLineUp,
    Palette,
    TextT,
    BookOpen,
    Student,
    Books,
    Article,
    Gauge,
    SealCheck,
    Brain,
} from '@phosphor-icons/react';
import {
    SettingsPageShell,
    SettingsSectionsLayout,
    type SettingsSectionGroup,
} from '@/components/settings/shell';
import { AiUsageSection } from './ai-usage/AiUsageSection';
import { AiLimitsSection } from './ai-limits/AiLimitsSection';
import { AiPlanSection } from './ai-plan/AiPlanSection';
import { AiPlanBilling } from './ai-plan/AiPlanBilling';
import { isPlanInEffect, useAiPlanQuery } from '@/components/common/ai-credits/aiPlan';
import { useStorefrontQuery } from '@/services/ai-plans/storefront';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    AI_SERVICE_BASE_URL,
    BASE_URL,
    GET_INSITITUTE_SETTINGS,
    GET_INSTITUTE_AI_SETTINGS,
    UPDATE_INSTITUTE_AI_SETTINGS,
} from '@/constants/urls';
import {
    type VideoBrandingConfig,
    type VideoStyleConfig,
    type VideoTemplate,
    DEFAULT_VIDEO_BRANDING,
    DEFAULT_VIDEO_STYLE,
    FONT_OPTIONS,
    buildWatermarkPositions,
    fetchVideoBranding,
    fetchVideoStyle,
    fetchVideoTemplates,
    updateVideoBranding,
    updateVideoStyle,
} from '@/routes/video-api-studio/-services/video-style-branding';
import { ColorPicker } from '@/components/ui/color-picker';
import { getInstituteId } from '@/constants/helper';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '@/components/ui/pagination';

interface AiSettingsProps {
    isTab?: boolean;
}

interface KeysStatus {
    hasKeys: boolean;
    hasOpenAI: boolean;
    hasGemini: boolean;
    defaultModel?: string;
    isActive?: boolean;
}

interface ActivityLogRecord {
    id: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_price: number;
    request_type: string;
    created_at: string;
}

interface ActivityLogResponse {
    records: ActivityLogRecord[];
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
}

import { useAIModelsList } from '@/hooks/useAiModels';
import KnowledgeBase from './KnowledgeBase';
import { StudentAiSettingsSection } from './StudentAiSettingsSection';
import { AiInsightsSettingsSection } from './AiInsightsSettingsSection';
import { CourseKnowledgeSettingsSection } from './CourseKnowledgeSettingsSection';
import { useCourseKnowledgeStatus } from '@/services/course-knowledge-settings';
import { noAutofillProps } from '@/lib/no-autofill';

const LIMITS_SECTION_ID = 'grp-limits';
/**
 * Shown only to admins of an institute with an AI plan in effect, or — as
 * "Plan & billing" — when the self-serve storefront is on for the institute.
 * Neither = no change here.
 */
const PLAN_SECTION_ID = 'grp-plan';
/**
 * Course knowledge (student AI answers from lessons). Present only when the
 * platform has made the feature available to this institute.
 */
const COURSE_KNOWLEDGE_SECTION_ID = 'grp-course-knowledge';

/** `?aiSection=grp-limits` deep-links a tab (the usage-limit modal links here). */
const readAiSectionParam = (): string | undefined => {
    try {
        return new URLSearchParams(window.location.search).get('aiSection') ?? undefined;
    } catch {
        return undefined;
    }
};

const getAiSettingsSections = (
    t: (key: string) => string,
    showLimits: boolean,
    showPlan = false,
    planLabel?: string,
    showCourseKnowledge = false
): SettingsSectionGroup[] => [
    {
        sections: [
            { id: 'grp-providers', label: t('sections.providers'), icon: Sparkle },
            { id: 'grp-course-ai', label: t('sections.courseAi'), icon: BookOpen },
            ...(showCourseKnowledge
                ? [
                      {
                          id: COURSE_KNOWLEDGE_SECTION_ID,
                          label: t('sections.courseKnowledge'),
                          icon: Brain,
                      },
                  ]
                : []),
            { id: 'grp-student-ai', label: t('sections.studentAi'), icon: Student },
            { id: 'grp-learner-insights', label: t('sections.learnerInsights'), icon: ChartLineUp },
            { id: 'grp-knowledge', label: t('sections.knowledgeBase'), icon: Books },
            { id: 'grp-prompt', label: t('sections.coursePrompt'), icon: Article },
            { id: 'grp-video', label: t('sections.video'), icon: FilmStrip },
            { id: 'grp-usage', label: t('sections.usage'), icon: ChartLineUp },
            // Usage limits are admin-only (the API re-checks the role).
            ...(showLimits
                ? [{ id: LIMITS_SECTION_ID, label: t('sections.limits'), icon: Gauge }]
                : []),
            ...(showPlan
                ? [{ id: PLAN_SECTION_ID, label: planLabel ?? t('sections.plan'), icon: SealCheck }]
                : []),
        ],
    },
];

const AiSettings: React.FC<AiSettingsProps> = ({ isTab }) => {
    const { t } = useTranslation(['settingsAi', 'videoApiStudioVideoStyleBranding']);
    const instituteIdForLimits = getInstituteId();
    const showLimits = isAdminForInstitute(instituteIdForLimits);
    const aiPlanQuery = useAiPlanQuery(instituteIdForLimits, showLimits);
    // Self-serve plans: visible only when the facade answers for this admin.
    const storefrontQuery = useStorefrontQuery(instituteIdForLimits, showLimits);
    const { t: tPlans } = useTranslation('aiPlans');
    const storefrontVisible = showLimits && !!storefrontQuery.data;
    const showPlan = showLimits && (isPlanInEffect(aiPlanQuery.data) || storefrontVisible);
    // available=false (the default for every institute) leaves this page unchanged.
    const courseKnowledgeStatusQuery = useCourseKnowledgeStatus();
    const showCourseKnowledge = !!courseKnowledgeStatusQuery.data?.available;
    const AI_SETTINGS_SECTIONS = getAiSettingsSections(
        t,
        showLimits,
        showPlan,
        storefrontVisible ? tPlans('tab') : undefined,
        showCourseKnowledge
    );
    const [initialSection] = useState(readAiSectionParam);
    const watermarkPositions = buildWatermarkPositions(t);
    const [openaiKey, setOpenaiKey] = useState('');
    const [geminiKey, setGeminiKey] = useState('');
    const [defaultModel, setDefaultModel] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [keysStatus, setKeysStatus] = useState<KeysStatus>({
        hasKeys: false,
        hasOpenAI: false,
        hasGemini: false,
    });
    const [activityLogs, setActivityLogs] = useState<ActivityLogResponse | null>(null);
    const { data: modelsList } = useAIModelsList({ category: 'general' });
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(20);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showKeysInfo, setShowKeysInfo] = useState(false);
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const [aiCoursePrompt, setAiCoursePrompt] = useState('');
    const [hasCustomPrompt, setHasCustomPrompt] = useState(false);
    const [isSavingAiPrompt, setIsSavingAiPrompt] = useState(false);
    const [isLoadingAiPrompt, setIsLoadingAiPrompt] = useState(false);

    // Video branding state
    const [videoBranding, setVideoBranding] = useState<VideoBrandingConfig>(DEFAULT_VIDEO_BRANDING);
    const [isSavingBranding, setIsSavingBranding] = useState(false);
    const [isLoadingBranding, setIsLoadingBranding] = useState(false);

    // Video style state
    const [videoStyle, setVideoStyle] = useState<VideoStyleConfig>(DEFAULT_VIDEO_STYLE);
    const [isSavingStyle, setIsSavingStyle] = useState(false);
    const [isLoadingStyle, setIsLoadingStyle] = useState(false);

    // Template gallery state
    const [videoTemplates, setVideoTemplates] = useState<VideoTemplate[]>([]);
    const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

    // AI Copilot (Course Creator) settings
    const [courseCreatorName, setCourseCreatorName] = useState('');
    const [isSavingCopilot, setIsSavingCopilot] = useState(false);

    const instituteId = getInstituteId();

    // Check if keys exist
    const checkKeys = useCallback(async () => {
        if (!instituteId) return;
        try {
            const response = await authenticatedAxiosInstance.get(
                `${AI_SERVICE_BASE_URL}/api-keys/v1/institute/${instituteId}`
            );
            setKeysStatus({
                hasKeys: true,
                hasOpenAI: response.data.has_openai_key || false,
                hasGemini: response.data.has_gemini_key || false,
                defaultModel: response.data.default_model,
                isActive: response.data.is_active,
            });
            if (response.data.default_model) {
                setDefaultModel(response.data.default_model);
            }
        } catch (error: any) {
            if (error.response?.status === 404) {
                setKeysStatus({
                    hasKeys: false,
                    hasOpenAI: false,
                    hasGemini: false,
                });
            } else {
                console.error('Error checking keys:', error);
            }
        }
    }, [instituteId]);

    // Fetch activity logs
    const fetchActivityLogs = useCallback(
        async (page: number = 1) => {
            if (!instituteId) return;
            setIsLoadingLogs(true);
            try {
                const response = await authenticatedAxiosInstance.get<ActivityLogResponse>(
                    `${AI_SERVICE_BASE_URL}/token-usage/v1/institute/${instituteId}/activity-log`,
                    {
                        params: {
                            page: page,
                            page_size: pageSize,
                        },
                    }
                );
                setActivityLogs(response.data);
            } catch (error) {
                console.error('Error fetching activity logs:', error);
            } finally {
                setIsLoadingLogs(false);
            }
        },
        [instituteId, pageSize]
    );

    // Fetch AI Copilot settings
    const fetchCopilotSettings = useCallback(async () => {
        if (!instituteId) return;
        try {
            const response = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
                params: { instituteId, settingKey: 'AI_COPILOT_SETTING' },
            });
            if (response.data?.data) {
                const data = response.data.data;
                setCourseCreatorName(data.course_creator_name || '');
                // Cache in localStorage for fast access by AI copilot pages
                localStorage.setItem('ai_copilot_setting', JSON.stringify(data));
            }
        } catch {
            /* no settings yet */
        }
    }, [instituteId]);

    const handleSaveCopilotSettings = async () => {
        if (!instituteId) return;
        setIsSavingCopilot(true);
        try {
            const settingData = { course_creator_name: courseCreatorName.trim() || '' };
            await authenticatedAxiosInstance.post(
                `${BASE_URL}/admin-core-service/institute/setting/v1/save-setting`,
                { setting_name: 'AI Copilot Configuration', setting_data: settingData },
                { params: { instituteId, settingKey: 'AI_COPILOT_SETTING' } }
            );
            // Update localStorage cache
            localStorage.setItem('ai_copilot_setting', JSON.stringify(settingData));
            toast.success(t('courseAi.toastSaved'));
        } catch {
            toast.error(t('courseAi.toastSaveFailed'));
        } finally {
            setIsSavingCopilot(false);
        }
    };

    // Fetch Institute AI Settings
    const fetchInstituteAiSettings = useCallback(async () => {
        if (!instituteId) return;
        setIsLoadingAiPrompt(true);
        try {
            const response = await authenticatedAxiosInstance.get(
                GET_INSTITUTE_AI_SETTINGS(instituteId)
            );
            if (response.data) {
                setAiCoursePrompt(response.data.ai_settings?.AI_COURSE_PROMPT || '');
                setHasCustomPrompt(response.data.has_custom_prompt || false);
            }
        } catch (error: any) {
            if (error.response?.status === 404) {
                // Institute not found or no settings - set defaults
                setAiCoursePrompt('');
                setHasCustomPrompt(false);
            } else {
                console.error('Error fetching institute AI settings:', error);
            }
        } finally {
            setIsLoadingAiPrompt(false);
        }
    }, [instituteId]);

    // Fetch Video Branding
    const loadVideoBranding = useCallback(async () => {
        if (!instituteId) return;
        setIsLoadingBranding(true);
        try {
            setVideoBranding(await fetchVideoBranding(instituteId));
        } catch (error) {
            console.error('Error fetching video branding:', error);
        } finally {
            setIsLoadingBranding(false);
        }
    }, [instituteId]);

    // Save Video Branding
    const HTML_SIZE_WARN_BYTES = 50 * 1024; // 50KB

    const handleSaveVideoBranding = async () => {
        if (!instituteId) return;

        // Warn about large HTML that may cause render timeouts
        const fields = [
            { name: t('videoBranding.fieldNames.intro'), html: videoBranding.intro.html },
            { name: t('videoBranding.fieldNames.outro'), html: videoBranding.outro.html },
            { name: t('videoBranding.fieldNames.watermark'), html: videoBranding.watermark.html },
        ];
        for (const f of fields) {
            if (f.html && new Blob([f.html]).size > HTML_SIZE_WARN_BYTES) {
                toast.warning(
                    t('videoBranding.htmlSizeWarning', {
                        field: f.name,
                        kb: Math.round(HTML_SIZE_WARN_BYTES / 1024),
                    })
                );
            }
        }

        setIsSavingBranding(true);
        try {
            await updateVideoBranding(instituteId, videoBranding);
            toast.success(t('videoBranding.toastSaved'));
        } catch (error) {
            console.error('Error saving video branding:', error);
            toast.error(t('videoBranding.toastSaveFailed'));
        } finally {
            setIsSavingBranding(false);
        }
    };

    // Fetch Video Style
    const loadVideoStyle = useCallback(async () => {
        if (!instituteId) return;
        setIsLoadingStyle(true);
        try {
            setVideoStyle(await fetchVideoStyle(instituteId));
        } catch (error) {
            console.error('Error fetching video style:', error);
        } finally {
            setIsLoadingStyle(false);
        }
    }, [instituteId]);

    const loadVideoTemplates = useCallback(async () => {
        setIsLoadingTemplates(true);
        try {
            setVideoTemplates(await fetchVideoTemplates());
        } catch (error) {
            console.error('Error fetching video templates:', error);
        } finally {
            setIsLoadingTemplates(false);
        }
    }, []);

    // Save Video Style
    const handleSaveVideoStyle = async () => {
        if (!instituteId) return;
        setIsSavingStyle(true);
        try {
            await updateVideoStyle(instituteId, videoStyle);
            toast.success(t('videoStyle.toastSaved'));
        } catch (error) {
            console.error('Error saving video style:', error);
            toast.error(t('videoStyle.toastSaveFailed'));
        } finally {
            setIsSavingStyle(false);
        }
    };

    // Update Institute AI Settings
    const handleSaveAiPrompt = async () => {
        if (!instituteId) return;
        setIsSavingAiPrompt(true);
        try {
            const response = await authenticatedAxiosInstance.post(
                UPDATE_INSTITUTE_AI_SETTINGS(instituteId),
                {
                    ai_settings: {
                        AI_COURSE_PROMPT: aiCoursePrompt.trim() || null,
                    },
                }
            );
            if (response.data) {
                setHasCustomPrompt(response.data.has_custom_prompt || false);
                toast.success(t('coursePrompt.toastSaved'));
            }
        } catch (error: any) {
            console.error('Error updating institute AI settings:', error);
            if (error.response?.status === 404) {
                toast.error(t('coursePrompt.toastInstituteNotFound'));
            } else {
                toast.error(t('coursePrompt.toastSaveFailed'));
            }
        } finally {
            setIsSavingAiPrompt(false);
        }
    };

    useEffect(() => {
        const initialize = async () => {
            setIsLoading(true);
            await Promise.all([
                checkKeys(),
                fetchCopilotSettings(),
                fetchInstituteAiSettings(),
                loadVideoBranding(),
                loadVideoStyle(),
                loadVideoTemplates(),
            ]);
            setIsLoading(false);
        };
        initialize();
    }, [
        checkKeys,
        fetchCopilotSettings,
        fetchInstituteAiSettings,
        loadVideoBranding,
        loadVideoStyle,
        loadVideoTemplates,
    ]);

    // Fetch activity logs when page changes
    useEffect(() => {
        if (instituteId) {
            fetchActivityLogs(currentPage);
        }
    }, [currentPage, instituteId, fetchActivityLogs]);

    const handleSave = async () => {
        if (!instituteId) return;
        setIsSaving(true);
        try {
            await authenticatedAxiosInstance.post(
                `${AI_SERVICE_BASE_URL}/api-keys/v1/institute/${instituteId}`,
                {
                    openai_key: openaiKey || undefined,
                    gemini_key: geminiKey || undefined,
                    default_model: defaultModel || undefined,
                }
            );
            toast.success(t('providers.toastKeysSaved'));
            setOpenaiKey('');
            setGeminiKey('');
            await checkKeys();
        } catch (error) {
            console.error('Error saving AI keys:', error);
            toast.error(t('providers.toastKeysSaveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!instituteId) return;
        if (!confirm(t('providers.confirmDeleteAllKeys'))) return;

        setIsDeleting(true);
        try {
            await authenticatedAxiosInstance.delete(
                `${AI_SERVICE_BASE_URL}/api-keys/v1/institute/${instituteId}/delete`
            );
            toast.success(t('providers.toastKeysDeleted'));
            setKeysStatus({
                hasKeys: false,
                hasOpenAI: false,
                hasGemini: false,
            });
            setDefaultModel('');
        } catch (error: any) {
            console.error('Error deleting keys:', error);
            if (error.response?.status === 404) {
                toast.error(t('providers.toastNoKeysToDelete'));
            } else {
                toast.error(t('providers.toastKeysDeleteFailed'));
            }
        } finally {
            setIsDeleting(false);
        }
    };

    const handlePartialSave = async (type: 'openai' | 'gemini') => {
        if (!instituteId) return;
        const payload: any = {};
        if (type === 'openai') payload.openai_key = openaiKey;
        else payload.gemini_key = geminiKey;

        try {
            await authenticatedAxiosInstance.post(
                `${AI_SERVICE_BASE_URL}/api-keys/v1/institute/${instituteId}`,
                payload
            );
            toast.success(
                t('providers.toastKeySaved', {
                    provider: type === 'openai' ? 'OpenRouter' : 'Gemini',
                })
            );
            if (type === 'openai') setOpenaiKey('');
            else setGeminiKey('');
            await checkKeys();
        } catch (error) {
            toast.error(t('providers.toastKeySaveFailed'));
        }
    };

    const handleDeleteKey = async (type: 'openai' | 'gemini') => {
        if (!instituteId) return;
        if (
            !confirm(
                t('providers.confirmDeleteKey', {
                    provider: type === 'openai' ? 'OpenRouter' : 'Gemini',
                })
            )
        )
            return;

        try {
            // Delete all keys and re-add the one we want to keep
            await authenticatedAxiosInstance.delete(
                `${AI_SERVICE_BASE_URL}/api-keys/v1/institute/${instituteId}/delete`
            );

            // Re-add the key we want to keep
            const payload: any = {};
            if (type === 'gemini' && keysStatus.hasGemini) {
                // If deleting openai, keep gemini (but we can't re-add without the key value)
                // So we just delete and let user re-add
            } else if (type === 'openai' && keysStatus.hasOpenAI) {
                // If deleting gemini, keep openai (but we can't re-add without the key value)
                // So we just delete and let user re-add
            }

            toast.success(
                t('providers.toastKeyDeleted', {
                    provider: type === 'openai' ? 'OpenRouter' : 'Gemini',
                })
            );
            await checkKeys();
        } catch (error) {
            toast.error(t('providers.toastKeyDeleteFailed'));
        }
    };

    // Calculate totals
    const totalTokens =
        activityLogs?.records?.reduce((sum, record) => sum + (record.total_tokens || 0), 0) || 0;
    const totalPrice =
        activityLogs?.records?.reduce((sum, record) => sum + (record.total_price || 0), 0) || 0;

    // Get unique models from activity logs
    const uniqueModels = Array.from(
        new Set(activityLogs?.records.map((record) => record.model) || [])
    );

    if (isLoading) {
        return (
            <div className={isTab ? 'p-0' : 'p-6'}>
                <div className="flex h-64 items-center justify-center">
                    <div className="size-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"></div>
                </div>
            </div>
        );
    }

    return (
        <SettingsPageShell
            title={t('page.title')}
            description={t('page.description')}
            maxWidth="max-w-7xl"
        >
            <SettingsSectionsLayout
                // The plan tab appears only after its queries resolve; re-mount once
                // when it does so a ?aiSection=grp-plan deep link (e.g. the return
                // from a plan payment) still opens it. Other visits are unaffected.
                key={
                    initialSection === PLAN_SECTION_ID && showPlan
                        ? 'plan-ready'
                        : initialSection === COURSE_KNOWLEDGE_SECTION_ID && showCourseKnowledge
                          ? 'course-knowledge-ready'
                          : 'default'
                }
                groups={AI_SETTINGS_SECTIONS}
                defaultActiveId={initialSection}
            >
                <section id="grp-providers" className="space-y-6">
                    {/* AI Configuration Card */}
                    <Card className="border-indigo-100 shadow-sm">
                        <CardHeader className="border-b border-indigo-50 bg-indigo-50/30">
                            <div className="flex items-center gap-2">
                                <div className="rounded-lg bg-indigo-500 p-2 text-white">
                                    <Sparkle className="size-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">
                                        {t('providers.cardTitle')}
                                    </CardTitle>
                                    <CardDescription>{t('providers.cardDescription')}</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label
                                        htmlFor="openaiKey"
                                        className="flex items-center gap-2 text-sm font-medium"
                                    >
                                        {t('providers.openrouterLabel')}
                                        <ShieldCheck className="size-3.5 text-green-500" />
                                        <button
                                            type="button"
                                            onClick={() => setShowKeysInfo(true)}
                                            className="text-indigo-500 hover:text-indigo-700"
                                        >
                                            <Info className="size-4" />
                                        </button>
                                    </Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="openaiKey"
                                            type="password"
                                            {...noAutofillProps('password')}
                                            value={openaiKey}
                                            onChange={(e) => setOpenaiKey(e.target.value)}
                                            placeholder={t('providers.openrouterPlaceholder')}
                                            className="border-indigo-100 focus:border-indigo-300 focus:ring-indigo-100"
                                            disabled={keysStatus.hasOpenAI}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="default"
                                            onClick={() => handlePartialSave('openai')}
                                            disabled={!openaiKey || keysStatus.hasOpenAI}
                                            className="border-indigo-100 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
                                        >
                                            <Plus className="mr-1 size-4" />
                                            {t('providers.addButton')}
                                        </Button>
                                        {keysStatus.hasOpenAI && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="default"
                                                onClick={() => handleDeleteKey('openai')}
                                                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                            >
                                                <Trash className="size-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <p className="text-2xs text-gray-500">
                                        {keysStatus.hasOpenAI
                                            ? t('providers.hasKeyHint')
                                            : t('providers.noKeyHint')}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label
                                        htmlFor="geminiKey"
                                        className="flex items-center gap-2 text-sm font-medium"
                                    >
                                        {t('providers.geminiLabel')}
                                        <ShieldCheck className="size-3.5 text-green-500" />
                                    </Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="geminiKey"
                                            type="password"
                                            {...noAutofillProps('password')}
                                            value={geminiKey}
                                            onChange={(e) => setGeminiKey(e.target.value)}
                                            placeholder={t('providers.geminiPlaceholder')}
                                            className="border-indigo-100 focus:border-indigo-300 focus:ring-indigo-100"
                                            disabled={keysStatus.hasGemini}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="default"
                                            onClick={() => handlePartialSave('gemini')}
                                            disabled={!geminiKey || keysStatus.hasGemini}
                                            className="border-indigo-100 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
                                        >
                                            <Plus className="mr-1 size-4" />
                                            {t('providers.addButton')}
                                        </Button>
                                        {keysStatus.hasGemini && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="default"
                                                onClick={() => handleDeleteKey('gemini')}
                                                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                            >
                                                <Trash className="size-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <p className="text-2xs text-gray-500">
                                        {keysStatus.hasGemini
                                            ? t('providers.hasKeyHint')
                                            : t('providers.noKeyHint')}
                                    </p>
                                </div>
                            </div>

                            {keysStatus.hasKeys && (
                                <div className="flex justify-end">
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        onClick={handleDelete}
                                        disabled={isDeleting}
                                        className="border-red-200 text-red-600 hover:bg-red-50"
                                    >
                                        {isDeleting ? (
                                            <>
                                                <span className="mr-2 size-4 animate-spin rounded-full border-2 border-red-600 border-t-transparent"></span>
                                                {t('providers.deletingButton')}
                                            </>
                                        ) : (
                                            <>
                                                <Trash className="mr-2 size-4" />
                                                {t('providers.deleteAllButton')}
                                            </>
                                        )}
                                    </MyButton>
                                </div>
                            )}

                            <div className="space-y-4">
                                <div className="max-w-sm space-y-2">
                                    <Label htmlFor="defaultModel" className="text-sm font-medium">
                                        {t('providers.defaultModelLabel')}
                                    </Label>
                                    <Select value={defaultModel} onValueChange={setDefaultModel}>
                                        <SelectTrigger
                                            id="defaultModel"
                                            className="border-indigo-100 focus:border-indigo-300"
                                        >
                                            <SelectValue
                                                placeholder={t('providers.defaultModelPlaceholder')}
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {modelsList && modelsList.models.length > 0 ? (
                                                modelsList.models.map((model) => (
                                                    <SelectItem
                                                        key={model.model_id}
                                                        value={model.model_id}
                                                    >
                                                        {model.name}
                                                    </SelectItem>
                                                ))
                                            ) : (
                                                <>
                                                    <SelectItem value="openai/gpt-4o">
                                                        {t('providers.modelGpt4o')}
                                                    </SelectItem>
                                                    <SelectItem value="openai/gpt-4o-mini">
                                                        {t('providers.modelGpt4oMini')}
                                                    </SelectItem>
                                                    <SelectItem value="google/gemini-1.5-pro">
                                                        {t('providers.modelGeminiPro')}
                                                    </SelectItem>
                                                    <SelectItem value="google/gemini-1.5-flash">
                                                        {t('providers.modelGeminiFlash')}
                                                    </SelectItem>
                                                </>
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-2xs text-gray-500">
                                        {t('providers.defaultModelHint')}
                                    </p>
                                </div>
                            </div>

                            {/* Activity Logs Section */}
                            <div className="space-y-4">
                                <div className="border-t border-indigo-100 pt-6">
                                    <h3 className="mb-4 text-lg font-semibold text-neutral-900">
                                        {t('providers.activityLogsHeading')}
                                    </h3>

                                    {/* Summary Cards */}
                                    <div className="mb-6 grid grid-cols-2 gap-4">
                                        <Card className="border-indigo-100">
                                            <CardContent className="pt-4">
                                                <div className="flex flex-col">
                                                    <span className="mb-1 text-2xs font-bold uppercase tracking-wider text-indigo-500">
                                                        {t('providers.totalTokensLabel')}
                                                    </span>
                                                    <span className="text-2xl font-bold text-indigo-900">
                                                        {totalTokens.toLocaleString()}
                                                    </span>
                                                </div>
                                            </CardContent>
                                        </Card>
                                        <Card className="border-indigo-100">
                                            <CardContent className="pt-4">
                                                <div className="flex flex-col">
                                                    <span className="mb-1 text-2xs font-bold uppercase tracking-wider text-indigo-500">
                                                        {t('providers.totalPriceLabel')}
                                                    </span>
                                                    <span className="text-2xl font-bold text-indigo-900">
                                                        ${totalPrice.toFixed(4)}
                                                    </span>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {/* Models List */}
                                    {uniqueModels.length > 0 && (
                                        <div className="mb-6">
                                            <Label className="mb-2 block text-sm font-medium">
                                                {t('providers.modelsUsedLabel')}
                                            </Label>
                                            <div className="flex flex-wrap gap-2">
                                                {uniqueModels.map((modelId) => {
                                                    const model = modelsList?.models.find(
                                                        (m) => m.model_id === modelId
                                                    );
                                                    return (
                                                        <span
                                                            key={modelId}
                                                            className="rounded-md bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700"
                                                        >
                                                            {model?.name || modelId}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Activity Logs Table */}
                                    {isLoadingLogs ? (
                                        <div className="flex h-32 items-center justify-center">
                                            <div className="size-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600"></div>
                                        </div>
                                    ) : activityLogs && activityLogs.records.length > 0 ? (
                                        <div className="overflow-hidden rounded-lg border border-indigo-100">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow className="bg-indigo-50/50">
                                                        <TableHead className="text-xs font-semibold">
                                                            {t('providers.tableDate')}
                                                        </TableHead>
                                                        <TableHead className="text-xs font-semibold">
                                                            {t('providers.tableModel')}
                                                        </TableHead>
                                                        <TableHead className="text-xs font-semibold">
                                                            {t('providers.tableType')}
                                                        </TableHead>
                                                        <TableHead className="text-right text-xs font-semibold">
                                                            {t('providers.tableTokens')}
                                                        </TableHead>
                                                        <TableHead className="text-right text-xs font-semibold">
                                                            {t('providers.tablePrice')}
                                                        </TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {activityLogs.records.map((record) => {
                                                        const model = modelsList?.models.find(
                                                            (m) => m.model_id === record.model
                                                        );
                                                        return (
                                                            <TableRow key={record.id}>
                                                                <TableCell className="text-xs">
                                                                    {new Date(
                                                                        record.created_at
                                                                    ).toLocaleDateString()}
                                                                </TableCell>
                                                                <TableCell className="text-xs">
                                                                    {model?.name || record.model}
                                                                </TableCell>
                                                                <TableCell className="text-xs capitalize">
                                                                    {record.request_type}
                                                                </TableCell>
                                                                <TableCell className="text-right text-xs">
                                                                    {record.total_tokens.toLocaleString()}
                                                                </TableCell>
                                                                <TableCell className="text-right text-xs">
                                                                    $
                                                                    {(
                                                                        record.total_price || 0
                                                                    ).toFixed(4)}
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    ) : (
                                        <div className="py-8 text-center text-sm text-gray-500">
                                            {t('providers.noActivityLogs')}
                                        </div>
                                    )}

                                    {/* Pagination */}
                                    {activityLogs && activityLogs.total_pages > 1 && (
                                        <div className="mt-6 flex items-center justify-between">
                                            <div className="text-sm text-gray-600">
                                                {t('providers.paginationSummary', {
                                                    page: activityLogs.page,
                                                    totalPages: activityLogs.total_pages,
                                                    totalCount: activityLogs.total_count,
                                                })}
                                            </div>
                                            <Pagination>
                                                <PaginationContent>
                                                    <PaginationItem>
                                                        <PaginationPrevious
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                if (currentPage > 1) {
                                                                    setCurrentPage(currentPage - 1);
                                                                }
                                                            }}
                                                            className={
                                                                currentPage <= 1
                                                                    ? 'pointer-events-none opacity-50'
                                                                    : 'cursor-pointer'
                                                            }
                                                        />
                                                    </PaginationItem>

                                                    {/* Page Numbers */}
                                                    {(() => {
                                                        const pages: React.ReactNode[] = [];
                                                        const totalPages = activityLogs.total_pages;
                                                        let lastPage = 0;

                                                        for (
                                                            let pageNum = 1;
                                                            pageNum <= totalPages;
                                                            pageNum++
                                                        ) {
                                                            // Show first page, last page, current page, and pages around current
                                                            const showPage =
                                                                pageNum === 1 ||
                                                                pageNum === totalPages ||
                                                                (pageNum >= currentPage - 1 &&
                                                                    pageNum <= currentPage + 1);

                                                            if (showPage) {
                                                                // Add ellipsis if there's a gap
                                                                if (pageNum - lastPage > 1) {
                                                                    pages.push(
                                                                        <PaginationItem
                                                                            key={`ellipsis-${lastPage + 1}`}
                                                                        >
                                                                            <PaginationEllipsis />
                                                                        </PaginationItem>
                                                                    );
                                                                }

                                                                pages.push(
                                                                    <PaginationItem key={pageNum}>
                                                                        <PaginationLink
                                                                            href="#"
                                                                            onClick={(e) => {
                                                                                e.preventDefault();
                                                                                setCurrentPage(
                                                                                    pageNum
                                                                                );
                                                                            }}
                                                                            isActive={
                                                                                currentPage ===
                                                                                pageNum
                                                                            }
                                                                            className="cursor-pointer"
                                                                        >
                                                                            {pageNum}
                                                                        </PaginationLink>
                                                                    </PaginationItem>
                                                                );
                                                                lastPage = pageNum;
                                                            }
                                                        }

                                                        return pages;
                                                    })()}

                                                    <PaginationItem>
                                                        <PaginationNext
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                if (
                                                                    currentPage <
                                                                    activityLogs.total_pages
                                                                ) {
                                                                    setCurrentPage(currentPage + 1);
                                                                }
                                                            }}
                                                            className={
                                                                currentPage >=
                                                                activityLogs.total_pages
                                                                    ? 'pointer-events-none opacity-50'
                                                                    : 'cursor-pointer'
                                                            }
                                                        />
                                                    </PaginationItem>
                                                </PaginationContent>
                                            </Pagination>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
                                <div className="flex items-start gap-3">
                                    <div className="rounded-full bg-amber-100 p-1 text-amber-600">
                                        <ShieldCheck className="size-4" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-medium text-amber-900">
                                            {t('providers.securityNoteHeading')}
                                        </h4>
                                        <p className="mt-1 text-xs text-amber-700">
                                            {t('providers.securityNoteText')}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4">
                                <MyButton
                                    disabled={isSaving}
                                    onClick={handleSave}
                                    className="min-w-32 bg-indigo-600 text-white hover:bg-indigo-700"
                                >
                                    {isSaving ? (
                                        <>
                                            <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                                            {t('common.saving')}
                                        </>
                                    ) : (
                                        <>
                                            <FloppyDisk className="mr-2 size-4" />
                                            {t('providers.saveKeysButton')}
                                        </>
                                    )}
                                </MyButton>
                            </div>
                        </CardContent>
                    </Card>
                </section>

                <section id="grp-course-ai" className="space-y-6">
                    {/* AI Course Creator Configuration Card */}
                    <Card className="border-indigo-100 shadow-sm">
                        <CardHeader className="border-b border-indigo-50 bg-indigo-50/30">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="rounded-lg bg-indigo-500 p-2 text-white">
                                        <Sparkle className="size-5" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">
                                            {t('courseAi.cardTitle')}
                                        </CardTitle>
                                        <CardDescription>
                                            {t('courseAi.cardDescription')}
                                        </CardDescription>
                                    </div>
                                </div>
                                <MyButton
                                    buttonType="primary"
                                    scale="small"
                                    onClick={handleSaveCopilotSettings}
                                    disabled={isSavingCopilot}
                                >
                                    <FloppyDisk className="mr-1 size-4" />
                                    {isSavingCopilot ? t('common.saving') : t('courseAi.saveButton')}
                                </MyButton>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-4">
                            <div className="space-y-1.5">
                                <Label>{t('courseAi.productNameLabel')}</Label>
                                <Input
                                    value={courseCreatorName}
                                    onChange={(e) => setCourseCreatorName(e.target.value)}
                                    placeholder={t('courseAi.productNamePlaceholder')}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('courseAi.productNameHint')}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </section>

                {showCourseKnowledge && (
                    <section id={COURSE_KNOWLEDGE_SECTION_ID} className="space-y-6">
                        {/* Course knowledge: student AI answers from lessons */}
                        <CourseKnowledgeSettingsSection />
                    </section>
                )}

                <section id="grp-student-ai" className="space-y-6">
                    {/* Student AI Configuration Card */}
                    <StudentAiSettingsSection />
                </section>

                <section id="grp-learner-insights" className="space-y-6">
                    {/* Who can see the per-attempt AI insight reports */}
                    <AiInsightsSettingsSection />
                </section>

                <section id="grp-knowledge" className="space-y-6">
                    {/* Knowledge Base */}
                    <KnowledgeBase />
                </section>

                <section id="grp-prompt" className="space-y-6">
                    {/* Institute AI Settings Card */}
                    <Card className="border-indigo-100 shadow-sm">
                        <CardHeader className="border-b border-indigo-50 bg-indigo-50/30">
                            <div className="flex items-center gap-2">
                                <div className="rounded-lg bg-indigo-500 p-2 text-white">
                                    <Sparkle className="size-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">
                                        {t('coursePrompt.cardTitle')}
                                    </CardTitle>
                                    <CardDescription>
                                        {t('coursePrompt.cardDescription')}
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            {isLoadingAiPrompt ? (
                                <div className="flex h-32 items-center justify-center">
                                    <div className="size-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600"></div>
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        <Label
                                            htmlFor="aiCoursePrompt"
                                            className="text-sm font-medium"
                                        >
                                            {t('coursePrompt.promptLabel')}
                                        </Label>
                                        <textarea
                                            id="aiCoursePrompt"
                                            value={aiCoursePrompt}
                                            onChange={(e) => setAiCoursePrompt(e.target.value)}
                                            placeholder={t('coursePrompt.promptPlaceholder')}
                                            rows={6}
                                            className="w-full rounded-md border border-indigo-100 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-100"
                                        />
                                        <p className="text-2xs text-gray-500">
                                            {t('coursePrompt.promptHint')}
                                        </p>
                                        {hasCustomPrompt && (
                                            <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2">
                                                <ShieldCheck className="size-4 text-green-600" />
                                                <span className="text-xs text-green-700">
                                                    {t('coursePrompt.customPromptActive')}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-full bg-blue-100 p-1 text-blue-600">
                                                <Info className="size-4" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-medium text-blue-900">
                                                    {t('coursePrompt.bestPracticesHeading')}
                                                </h4>
                                                <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-blue-700">
                                                    <li>{t('coursePrompt.bestPractice1')}</li>
                                                    <li>{t('coursePrompt.bestPractice2')}</li>
                                                    <li>{t('coursePrompt.bestPractice3')}</li>
                                                    <li>{t('coursePrompt.bestPractice4')}</li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end pt-4">
                                        <MyButton
                                            disabled={isSavingAiPrompt}
                                            onClick={handleSaveAiPrompt}
                                            className="min-w-32 bg-indigo-600 text-white hover:bg-indigo-700"
                                        >
                                            {isSavingAiPrompt ? (
                                                <>
                                                    <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                                                    {t('common.saving')}
                                                </>
                                            ) : (
                                                <>
                                                    <FloppyDisk className="mr-2 size-4" />
                                                    {t('coursePrompt.saveButton')}
                                                </>
                                            )}
                                        </MyButton>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </section>

                <section id="grp-video" className="space-y-6">
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* VIDEO BRANDING CARD                                        */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    <Card className="border-indigo-100 shadow-sm">
                        <CardHeader className="border-b border-indigo-50 bg-indigo-50/30">
                            <div className="flex items-center gap-2">
                                <div className="rounded-lg bg-indigo-500 p-2 text-white">
                                    <FilmStrip className="size-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">
                                        {t('videoBranding.cardTitle')}
                                    </CardTitle>
                                    <CardDescription>
                                        {t('videoBranding.cardDescription')}
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            {isLoadingBranding ? (
                                <div className="flex h-32 items-center justify-center">
                                    <div className="size-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                                </div>
                            ) : (
                                <>
                                    {/* ── Intro ────────────────────────────────── */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-sm font-semibold">
                                                {t('videoBranding.introHeading')}
                                            </Label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500">
                                                    {videoBranding.intro.enabled
                                                        ? t('common.enabled')
                                                        : t('common.disabled')}
                                                </span>
                                                <Switch
                                                    checked={videoBranding.intro.enabled}
                                                    onCheckedChange={(v) =>
                                                        setVideoBranding((b) => ({
                                                            ...b,
                                                            intro: { ...b.intro, enabled: v },
                                                        }))
                                                    }
                                                />
                                            </div>
                                        </div>
                                        {videoBranding.intro.enabled && (
                                            <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/20 p-4">
                                                <div className="flex items-center gap-4">
                                                    <Label className="w-32 shrink-0 text-xs font-medium text-gray-600">
                                                        {t('videoBranding.durationLabel')}
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={10}
                                                        step={0.5}
                                                        value={videoBranding.intro.duration_seconds}
                                                        onChange={(e) =>
                                                            setVideoBranding((b) => ({
                                                                ...b,
                                                                intro: {
                                                                    ...b.intro,
                                                                    duration_seconds:
                                                                        parseFloat(
                                                                            e.target.value
                                                                        ) || 3,
                                                                },
                                                            }))
                                                        }
                                                        className="w-24 border-indigo-100 text-sm"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {t('videoBranding.htmlLabel')}
                                                        </Label>
                                                        <textarea
                                                            value={videoBranding.intro.html}
                                                            onChange={(e) =>
                                                                setVideoBranding((b) => ({
                                                                    ...b,
                                                                    intro: {
                                                                        ...b.intro,
                                                                        html: e.target.value,
                                                                    },
                                                                }))
                                                            }
                                                            rows={6}
                                                            placeholder={t(
                                                                'videoBranding.introPlaceholder',
                                                                {
                                                                    brand: t(
                                                                        'videoBranding.yourBrandPlaceholder'
                                                                    ),
                                                                }
                                                            )}
                                                            className="w-full rounded-md border border-indigo-100 px-3 py-2 font-mono text-xs focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-100"
                                                        />
                                                        <p
                                                            className={`text-2xs ${videoBranding.intro.html.length > HTML_SIZE_WARN_BYTES ? 'text-amber-500' : 'text-gray-400'}`}
                                                        >
                                                            {t('videoBranding.kbSize', {
                                                                size: (
                                                                    videoBranding.intro.html
                                                                        .length / 1024
                                                                ).toFixed(1),
                                                            })}
                                                        </p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {t(
                                                                'videoBranding.livePreviewScaledLabel'
                                                            )}
                                                        </Label>
                                                        <div
                                                            style={{
                                                                width: '100%',
                                                                aspectRatio: '16/9',
                                                                maxWidth: '320px',
                                                                height: '180px',
                                                                overflow: 'hidden',
                                                                borderRadius: '6px',
                                                                border: '1px solid hsl(var(--border))',
                                                                position: 'relative',
                                                            }}
                                                        >
                                                            <iframe
                                                                srcDoc={
                                                                    videoBranding.intro.html ||
                                                                    `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:rgb(249,250,251);color:rgb(156,163,175);font-family:sans-serif;font-size:12px">${t('videoBranding.introPreviewFallback')}</div>`
                                                                }
                                                                style={{
                                                                    width: '1920px',
                                                                    height: '1080px',
                                                                    border: 'none',
                                                                    transformOrigin: 'top left',
                                                                    transform: 'scale(0.1667)',
                                                                    pointerEvents: 'none',
                                                                }}
                                                                sandbox="allow-scripts"
                                                                title={t(
                                                                    'videoBranding.introPreviewFallback'
                                                                )}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="border-t border-indigo-50" />

                                    {/* ── Outro ────────────────────────────────── */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-sm font-semibold">
                                                {t('videoBranding.outroHeading')}
                                            </Label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500">
                                                    {videoBranding.outro.enabled
                                                        ? t('common.enabled')
                                                        : t('common.disabled')}
                                                </span>
                                                <Switch
                                                    checked={videoBranding.outro.enabled}
                                                    onCheckedChange={(v) =>
                                                        setVideoBranding((b) => ({
                                                            ...b,
                                                            outro: { ...b.outro, enabled: v },
                                                        }))
                                                    }
                                                />
                                            </div>
                                        </div>
                                        {videoBranding.outro.enabled && (
                                            <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/20 p-4">
                                                <div className="flex items-center gap-4">
                                                    <Label className="w-32 shrink-0 text-xs font-medium text-gray-600">
                                                        {t('videoBranding.durationLabel')}
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={10}
                                                        step={0.5}
                                                        value={videoBranding.outro.duration_seconds}
                                                        onChange={(e) =>
                                                            setVideoBranding((b) => ({
                                                                ...b,
                                                                outro: {
                                                                    ...b.outro,
                                                                    duration_seconds:
                                                                        parseFloat(
                                                                            e.target.value
                                                                        ) || 4,
                                                                },
                                                            }))
                                                        }
                                                        className="w-24 border-indigo-100 text-sm"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {t('videoBranding.htmlLabel')}
                                                        </Label>
                                                        <textarea
                                                            value={videoBranding.outro.html}
                                                            onChange={(e) =>
                                                                setVideoBranding((b) => ({
                                                                    ...b,
                                                                    outro: {
                                                                        ...b.outro,
                                                                        html: e.target.value,
                                                                    },
                                                                }))
                                                            }
                                                            rows={6}
                                                            placeholder={t(
                                                                'videoBranding.outroPlaceholder',
                                                                {
                                                                    message: t(
                                                                        'videoBranding.thankYouForWatching'
                                                                    ),
                                                                }
                                                            )}
                                                            className="w-full rounded-md border border-indigo-100 px-3 py-2 font-mono text-xs focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-100"
                                                        />
                                                        <p
                                                            className={`text-2xs ${videoBranding.outro.html.length > HTML_SIZE_WARN_BYTES ? 'text-amber-500' : 'text-gray-400'}`}
                                                        >
                                                            {t('videoBranding.kbSize', {
                                                                size: (
                                                                    videoBranding.outro.html
                                                                        .length / 1024
                                                                ).toFixed(1),
                                                            })}
                                                        </p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {t(
                                                                'videoBranding.livePreviewScaledLabel'
                                                            )}
                                                        </Label>
                                                        <div
                                                            style={{
                                                                width: '100%',
                                                                aspectRatio: '16/9',
                                                                maxWidth: '320px',
                                                                height: '180px',
                                                                overflow: 'hidden',
                                                                borderRadius: '6px',
                                                                border: '1px solid hsl(var(--border))',
                                                                position: 'relative',
                                                            }}
                                                        >
                                                            <iframe
                                                                srcDoc={
                                                                    videoBranding.outro.html ||
                                                                    `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:rgb(249,250,251);color:rgb(156,163,175);font-family:sans-serif;font-size:12px">${t('videoBranding.outroPreviewFallback')}</div>`
                                                                }
                                                                style={{
                                                                    width: '1920px',
                                                                    height: '1080px',
                                                                    border: 'none',
                                                                    transformOrigin: 'top left',
                                                                    transform: 'scale(0.1667)',
                                                                    pointerEvents: 'none',
                                                                }}
                                                                sandbox="allow-scripts"
                                                                title={t(
                                                                    'videoBranding.outroPreviewFallback'
                                                                )}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="border-t border-indigo-50" />

                                    {/* ── Watermark ────────────────────────────── */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-sm font-semibold">
                                                {t('videoBranding.watermarkHeading')}
                                            </Label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500">
                                                    {videoBranding.watermark.enabled
                                                        ? t('common.enabled')
                                                        : t('common.disabled')}
                                                </span>
                                                <Switch
                                                    checked={videoBranding.watermark.enabled}
                                                    onCheckedChange={(v) =>
                                                        setVideoBranding((b) => ({
                                                            ...b,
                                                            watermark: {
                                                                ...b.watermark,
                                                                enabled: v,
                                                            },
                                                        }))
                                                    }
                                                />
                                            </div>
                                        </div>
                                        {videoBranding.watermark.enabled && (
                                            <div className="space-y-4 rounded-lg border border-indigo-100 bg-indigo-50/20 p-4">
                                                <div className="grid gap-4 md:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {t('videoBranding.positionLabel')}
                                                        </Label>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {watermarkPositions.map((pos) => (
                                                                <button
                                                                    key={pos.value}
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setVideoBranding((b) => ({
                                                                            ...b,
                                                                            watermark: {
                                                                                ...b.watermark,
                                                                                position: pos.value,
                                                                            },
                                                                        }))
                                                                    }
                                                                    className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                                                                        videoBranding.watermark
                                                                            .position === pos.value
                                                                            ? 'border-indigo-400 bg-indigo-100 text-indigo-700'
                                                                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                                                    }`}
                                                                >
                                                                    {pos.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {t('videoBranding.opacityLabel', {
                                                                value: videoBranding.watermark.opacity.toFixed(
                                                                    2
                                                                ),
                                                            })}
                                                        </Label>
                                                        <input
                                                            type="range"
                                                            min={0}
                                                            max={1}
                                                            step={0.05}
                                                            value={videoBranding.watermark.opacity}
                                                            onChange={(e) =>
                                                                setVideoBranding((b) => ({
                                                                    ...b,
                                                                    watermark: {
                                                                        ...b.watermark,
                                                                        opacity: parseFloat(
                                                                            e.target.value
                                                                        ),
                                                                    },
                                                                }))
                                                            }
                                                            className="w-full"
                                                        />
                                                        <p className="text-2xs text-gray-400">
                                                            {t('videoBranding.opacityHint')}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {t('videoBranding.watermarkHtmlLabel')}
                                                        </Label>
                                                        <textarea
                                                            value={videoBranding.watermark.html}
                                                            onChange={(e) =>
                                                                setVideoBranding((b) => ({
                                                                    ...b,
                                                                    watermark: {
                                                                        ...b.watermark,
                                                                        html: e.target.value,
                                                                    },
                                                                }))
                                                            }
                                                            rows={3}
                                                            placeholder={t(
                                                                'videoBranding.watermarkPlaceholder',
                                                                {
                                                                    brand: t(
                                                                        'videoBranding.yourBrandPlaceholder'
                                                                    ),
                                                                }
                                                            )}
                                                            className="w-full rounded-md border border-indigo-100 px-3 py-2 font-mono text-xs focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-100"
                                                        />
                                                        <p
                                                            className={`text-2xs ${videoBranding.watermark.html.length > HTML_SIZE_WARN_BYTES ? 'text-amber-500' : 'text-gray-400'}`}
                                                        >
                                                            {t('videoBranding.kbSize', {
                                                                size: (
                                                                    videoBranding.watermark.html
                                                                        .length / 1024
                                                                ).toFixed(1),
                                                            })}
                                                        </p>
                                                        <p className="text-2xs text-gray-500">
                                                            {t('videoBranding.watermarkHtmlHint')}
                                                        </p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {t('videoBranding.livePreviewLabel')}
                                                        </Label>
                                                        <div
                                                            style={{
                                                                width: '200px',
                                                                height: '120px',
                                                                overflow: 'hidden',
                                                                borderRadius: '6px',
                                                                border: '1px solid hsl(var(--border))',
                                                                position: 'relative',
                                                                background: 'hsl(var(--muted))',
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    position: 'absolute',
                                                                    ...(videoBranding.watermark.position?.includes(
                                                                        'top'
                                                                    )
                                                                        ? { top: '8px' }
                                                                        : { bottom: '8px' }),
                                                                    ...(videoBranding.watermark.position?.includes(
                                                                        'left'
                                                                    )
                                                                        ? { left: '8px' }
                                                                        : { right: '8px' }),
                                                                    opacity:
                                                                        videoBranding.watermark
                                                                            .opacity,
                                                                }}
                                                                dangerouslySetInnerHTML={{
                                                                    __html:
                                                                        videoBranding.watermark
                                                                            .html ||
                                                                        `<span style="color:hsl(var(--muted-foreground));font-family:sans-serif;font-size:10px">${t('videoBranding.watermarkPreviewFallback')}</span>`,
                                                                }}
                                                            />
                                                            <span
                                                                className="text-2xs text-gray-300"
                                                                style={{
                                                                    position: 'absolute',
                                                                    top: '50%',
                                                                    left: '50%',
                                                                    transform:
                                                                        'translate(-50%, -50%)',
                                                                }}
                                                            >
                                                                {videoBranding.watermark.position?.replace(
                                                                    '-',
                                                                    ' '
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex justify-end pt-2">
                                        <MyButton
                                            disabled={isSavingBranding}
                                            onClick={handleSaveVideoBranding}
                                            className="min-w-36 bg-indigo-600 text-white hover:bg-indigo-700"
                                        >
                                            {isSavingBranding ? (
                                                <>
                                                    <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                                    {t('common.saving')}
                                                </>
                                            ) : (
                                                <>
                                                    <FloppyDisk className="mr-2 size-4" />
                                                    {t('videoBranding.saveButton')}
                                                </>
                                            )}
                                        </MyButton>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* VIDEO STYLE CARD                                            */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    <Card className="border-indigo-100 shadow-sm">
                        <CardHeader className="border-b border-indigo-50 bg-indigo-50/30">
                            <div className="flex items-center gap-2">
                                <div className="rounded-lg bg-indigo-500 p-2 text-white">
                                    <Palette className="size-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">
                                        {t('videoStyle.cardTitle')}
                                    </CardTitle>
                                    <CardDescription>
                                        {t('videoStyle.cardDescription')}
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            {isLoadingStyle ? (
                                <div className="flex h-32 items-center justify-center">
                                    <div className="size-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                                </div>
                            ) : (
                                <>
                                    {/* ── Background Theme ─────────────────────── */}
                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold">
                                            {t('videoStyle.backgroundThemeLabel')}
                                        </Label>
                                        <div className="flex gap-3">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setVideoStyle((s) => ({
                                                        ...s,
                                                        background_type: 'white',
                                                    }))
                                                }
                                                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                                                    videoStyle.background_type === 'white'
                                                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                <span className="size-3 rounded-full border border-gray-300 bg-white" />
                                                {t('videoStyle.lightButton')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setVideoStyle((s) => ({
                                                        ...s,
                                                        background_type: 'black',
                                                    }))
                                                }
                                                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                                                    videoStyle.background_type === 'black'
                                                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                <span className="size-3 rounded-full border border-gray-600 bg-gray-900" />
                                                {t('videoStyle.darkButton')}
                                            </button>
                                        </div>
                                    </div>

                                    {/* ── Template Gallery ─────────────────────── */}
                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold">
                                            {t('videoStyle.templateGalleryLabel')}
                                        </Label>
                                        <p className="text-2xs text-gray-500">
                                            {t('videoStyle.templateGalleryHint')}
                                        </p>
                                        {isLoadingTemplates ? (
                                            <p className="py-4 text-center text-sm text-gray-400">
                                                {t('videoStyle.loadingTemplates')}
                                            </p>
                                        ) : videoTemplates.length === 0 ? (
                                            <p className="py-4 text-center text-sm text-gray-400">
                                                {t('videoStyle.noTemplates')}
                                            </p>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-3">
                                                {videoTemplates.map((template) => {
                                                    const isSelected =
                                                        videoStyle.layout_theme === template.id;
                                                    return (
                                                        <div
                                                            key={template.id}
                                                            onClick={() =>
                                                                setVideoStyle((s) => ({
                                                                    ...s,
                                                                    layout_theme: template.id,
                                                                    background_type:
                                                                        template.background_type,
                                                                }))
                                                            }
                                                            className={`cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
                                                                isSelected
                                                                    ? 'border-indigo-500 ring-2 ring-indigo-200'
                                                                    : 'border-gray-200 hover:border-gray-300'
                                                            }`}
                                                        >
                                                            {/* iframe preview: 1920×1080 scaled to 240×135 */}
                                                            <div
                                                                style={{
                                                                    width: '100%',
                                                                    height: '135px',
                                                                    overflow: 'hidden',
                                                                    position: 'relative',
                                                                    background: 'hsl(var(--muted))',
                                                                }}
                                                            >
                                                                <iframe
                                                                    srcDoc={`<style>:root{--primary-color:${videoStyle.primary_color};--accent-color:${videoStyle.primary_color}}</style>${template.preview_html}`}
                                                                    style={{
                                                                        width: '1920px',
                                                                        height: '1080px',
                                                                        border: 'none',
                                                                        transformOrigin: 'top left',
                                                                        transform: 'scale(0.125)',
                                                                        pointerEvents: 'none',
                                                                    }}
                                                                    sandbox="allow-scripts"
                                                                    title={template.name}
                                                                />
                                                            </div>
                                                            <div className="bg-white px-2 py-1.5">
                                                                <p
                                                                    className={`text-xs font-semibold ${
                                                                        isSelected
                                                                            ? 'text-indigo-700'
                                                                            : 'text-gray-800'
                                                                    }`}
                                                                >
                                                                    {template.name}
                                                                </p>
                                                                <p className="truncate text-2xs text-gray-400">
                                                                    {template.description}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* ── Primary / Accent Color ───────────────── */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-sm font-semibold">
                                                {t('videoStyle.primaryColorLabel')}
                                            </Label>
                                            {videoStyle.layout_theme && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setVideoStyle((s) => ({
                                                            ...s,
                                                            primary_color:
                                                                DEFAULT_VIDEO_STYLE.primary_color,
                                                        }))
                                                    }
                                                    className="text-2xs text-indigo-500 hover:text-indigo-700 hover:underline"
                                                >
                                                    {t('videoStyle.resetToDefault')}
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-2xs text-gray-500">
                                            {t('videoStyle.primaryColorHint')}
                                        </p>
                                        <div className="flex items-center gap-3">
                                            <ColorPicker
                                                value={videoStyle.primary_color}
                                                onChange={(color) =>
                                                    setVideoStyle((s) => ({
                                                        ...s,
                                                        primary_color: color,
                                                    }))
                                                }
                                            />
                                            <div
                                                className="size-8 rounded-full border border-gray-200 shadow-sm"
                                                style={{ background: videoStyle.primary_color }}
                                            />
                                            <span className="font-mono text-sm text-gray-600">
                                                {videoStyle.primary_color}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="border-t border-indigo-50" />

                                    {/* ── Typography ───────────────────────────── */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <TextT className="size-4 text-indigo-500" />
                                            <Label className="text-sm font-semibold">
                                                {t('videoStyle.typographyLabel')}
                                            </Label>
                                        </div>
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="space-y-1.5">
                                                <Label className="text-xs font-medium text-gray-600">
                                                    {t('videoStyle.headingFontLabel')}
                                                </Label>
                                                <Select
                                                    value={videoStyle.heading_font}
                                                    onValueChange={(v) =>
                                                        setVideoStyle((s) => ({
                                                            ...s,
                                                            heading_font: v,
                                                        }))
                                                    }
                                                >
                                                    <SelectTrigger className="border-indigo-100 focus:border-indigo-300">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {FONT_OPTIONS.map((f) => (
                                                            <SelectItem key={f} value={f}>
                                                                {f}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs font-medium text-gray-600">
                                                    {t('videoStyle.bodyFontLabel')}
                                                </Label>
                                                <Select
                                                    value={videoStyle.body_font}
                                                    onValueChange={(v) =>
                                                        setVideoStyle((s) => ({
                                                            ...s,
                                                            body_font: v,
                                                        }))
                                                    }
                                                >
                                                    <SelectTrigger className="border-indigo-100 focus:border-indigo-300">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {FONT_OPTIONS.map((f) => (
                                                            <SelectItem key={f} value={f}>
                                                                {f}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end pt-2">
                                        <MyButton
                                            disabled={isSavingStyle}
                                            onClick={handleSaveVideoStyle}
                                            className="min-w-36 bg-indigo-600 text-white hover:bg-indigo-700"
                                        >
                                            {isSavingStyle ? (
                                                <>
                                                    <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                                    {t('common.saving')}
                                                </>
                                            ) : (
                                                <>
                                                    <FloppyDisk className="mr-2 size-4" />
                                                    {t('videoStyle.saveButton')}
                                                </>
                                            )}
                                        </MyButton>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </section>

                <section id="grp-usage" className="space-y-6">
                    <AiUsageSection />
                </section>

                {showLimits && (
                    <section id={LIMITS_SECTION_ID} className="space-y-6">
                        <AiLimitsSection />
                    </section>
                )}

                {showPlan && (
                    <section id={PLAN_SECTION_ID} className="space-y-6">
                        {storefrontVisible ? <AiPlanBilling /> : <AiPlanSection />}
                    </section>
                )}
            </SettingsSectionsLayout>

            {/* API Keys Info Dialog */}
            <Dialog open={showKeysInfo} onOpenChange={setShowKeysInfo}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Info className="size-5 text-indigo-600" />
                            {t('keysInfoDialog.title')}
                        </DialogTitle>
                        <DialogDescription>{t('keysInfoDialog.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <h4 className="mb-2 text-sm font-semibold">
                                {t('keysInfoDialog.openrouterHeading')}
                            </h4>
                            <ol className="list-inside list-decimal space-y-2 text-sm text-gray-600">
                                <li>
                                    {t('keysInfoDialog.visitText')}{' '}
                                    <a
                                        href="https://openrouter.ai"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-600 hover:underline"
                                    >
                                        openrouter.ai
                                    </a>
                                </li>
                                <li>{t('keysInfoDialog.step2SignUp')}</li>
                                <li>{t('keysInfoDialog.step3Keys')}</li>
                                <li>{t('keysInfoDialog.step4CreateKey')}</li>
                                <li>{t('keysInfoDialog.step5CopyKey')}</li>
                            </ol>
                        </div>
                        <div>
                            <h4 className="mb-2 text-sm font-semibold">
                                {t('keysInfoDialog.geminiHeading')}
                            </h4>
                            <ol className="list-inside list-decimal space-y-2 text-sm text-gray-600">
                                <li>
                                    {t('keysInfoDialog.visitText')}{' '}
                                    <a
                                        href="https://aistudio.google.com/app/apikey"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-600 hover:underline"
                                    >
                                        Google AI Studio
                                    </a>{' '}
                                    {t('keysInfoDialog.orText')}{' '}
                                    <a
                                        href="https://console.cloud.google.com/apis/credentials"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-600 hover:underline"
                                    >
                                        Google Cloud Console
                                    </a>
                                </li>
                                <li>{t('keysInfoDialog.step2SignIn')}</li>
                                <li>{t('keysInfoDialog.step3CreateApiKey')}</li>
                                <li>{t('keysInfoDialog.step4SelectProject')}</li>
                                <li>{t('keysInfoDialog.step5CopyApiKey')}</li>
                            </ol>
                        </div>
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                            <p className="text-xs text-indigo-700">
                                <strong>{t('keysInfoDialog.noteLabel')}</strong>{' '}
                                {t('keysInfoDialog.noteText')}
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowKeysInfo(false)}>
                            {t('keysInfoDialog.gotIt')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </SettingsPageShell>
    );
};

export default AiSettings;
