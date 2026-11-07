import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavigate, createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useSidebar } from '@/components/ui/sidebar';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { getCourseSettings } from '@/services/course-settings';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { KbGroundingCard } from './shared/components/KbGroundingCard';
import type { KbGroundingValue } from './shared/components/KbGroundingCard';
import { AI_SERVICE_BASE_URL, GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { toast } from 'sonner';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { ToolCostBadge } from '@/components/common/ai-credits/ToolCostBadge';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import {
    AiVideoSettingsCard,
    DEFAULT_AI_VIDEO_SETTINGS,
    type AiVideoSettings,
} from './shared/components/AiVideoSettingsCard';
import { useFileUpload } from '@/hooks/use-file-upload';
import {
    X,
    FileText,
    Sparkles,
    Link,
    AlertTriangle,
    Plus,
    Trash2,
    Info,
    Key,
    CheckCircle,
    BookOpen,
    Clock,
    Layers,
    Code,
    Video,
    HelpCircle,
    FileQuestion,
    Lightbulb,
    Upload,
    ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scrapeUrlContent } from '@/services/aiCourseApi';
import { Loader2 } from 'lucide-react';
import { useAIModelsList } from '@/hooks/useAiModels';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getAiProductName } from '@/config/branding';
import { noAutofillProps } from '@/lib/no-autofill';

export const Route = createLazyFileRoute('/study-library/ai-copilot/')({
    component: RouteComponent,
});

function buildExamplePrompts(t: TFunction): string[] {
    return [
        t('examplePrompts.python'),
        t('examplePrompts.ml'),
        t('examplePrompts.cloud'),
        t('examplePrompts.dataEngineering'),
    ];
}

interface PrerequisiteFile {
    file: File;
    id: string;
}

interface PrerequisiteUrl {
    url: string;
    id: string;
    title?: string;
    content?: string;
}

// Bubble Button Component
const BubbleButton = ({
    icon: Icon,
    label,
    value,
    onClick,
    isActive = false,
    status,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value?: string;
    onClick: () => void;
    isActive?: boolean;
    status?: 'success' | 'warning' | 'default';
}) => {
    const statusColors = {
        success: 'border-green-300 bg-green-50 text-green-700',
        warning: 'border-amber-300 bg-amber-50 text-amber-700',
        default:
            'border-neutral-200 bg-white text-neutral-700 hover:border-indigo-300 hover:bg-indigo-50',
    };

    return (
        <motion.button
            type="button"
            onClick={onClick}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-all',
                isActive
                    ? 'border-indigo-400 bg-indigo-100 text-indigo-700'
                    : statusColors[status || 'default']
            )}
        >
            <Icon className="size-3.5" />
            <span>{label}</span>
            {value && <span className="text-[10px] opacity-70">({value})</span>}
            {status === 'success' && <CheckCircle className="size-3 text-green-600" />}
        </motion.button>
    );
};

function RouteComponent() {
    const { t, i18n } = useTranslation('studyLibraryAiCopilotIndex');
    const examplePrompts = buildExamplePrompts(t);
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    const { setOpen } = useSidebar();

    // Collapse sidebar on mount
    useEffect(() => {
        setOpen(false);
    }, [setOpen]);

    // Check for saved draft
    const [savedDraft, setSavedDraft] = useState<{ draftTitle?: string; timestamp: string } | null>(
        null
    );
    useEffect(() => {
        try {
            const raw = localStorage.getItem('aiCourseDraft');
            if (raw) {
                const draft = JSON.parse(raw);
                if (draft?.slides?.length > 0) {
                    setSavedDraft({
                        draftTitle: draft.draftTitle || draft.courseMetadata?.courseTitle,
                        timestamp: draft.timestamp,
                    });
                }
            }
        } catch {
            /* ignore */
        }
    }, []);

    const handleResumeDraft = () => {
        const raw = localStorage.getItem('aiCourseDraft');
        if (!raw) return;
        // Move draft to sessionStorage so the generating view can pick it up
        sessionStorage.setItem('resumeAiCourseDraft', raw);
        // Also set a dummy courseConfig so the route doesn't redirect
        if (!sessionStorage.getItem('courseConfig')) {
            sessionStorage.setItem('courseConfig', JSON.stringify({ resumed: true }));
        }
        navigate({ to: '/study-library/ai-copilot/course-outline/generating' });
    };

    const handleDiscardDraft = () => {
        localStorage.removeItem('aiCourseDraft');
        setSavedDraft(null);
    };

    // Form state - keeping all existing state
    const [ageRange, setAgeRange] = useState('');
    const [skillLevel, setSkillLevel] = useState(''); // Now stores levelId
    const [language, setLanguage] = useState('English');
    const [prerequisiteFiles, setPrerequisiteFiles] = useState<PrerequisiteFile[]>([]);
    const [prerequisiteUrls, setPrerequisiteUrls] = useState<PrerequisiteUrl[]>([]);
    const [newPrerequisiteUrl, setNewPrerequisiteUrl] = useState('');
    const [courseGoal, setCourseGoal] = useState('');
    const [learningOutcome, setLearningOutcome] = useState('');
    const [includeDiagrams, setIncludeDiagrams] = useState(false);
    const [includeCodeSnippets, setIncludeCodeSnippets] = useState(false);
    const [includePracticeProblems, setIncludePracticeProblems] = useState(false);
    const [includeYouTubeVideo, setIncludeYouTubeVideo] = useState(false);
    const [includeAIGeneratedVideo, setIncludeAIGeneratedVideo] = useState(false);
    const [includeAISlides, setIncludeAISlides] = useState(false);
    const [includeAIStorybook, setIncludeAIStorybook] = useState(false);
    const [programmingLanguage, setProgrammingLanguage] = useState('');
    const [numberOfChapters, setNumberOfChapters] = useState('5');
    const [chapterLength, setChapterLength] = useState('60');
    const [customChapterLength, setCustomChapterLength] = useState('');
    const [customChapterCount, setCustomChapterCount] = useState('');
    const [customSlidesPerChapter, setCustomSlidesPerChapter] = useState('');
    const [includeQuizzes, setIncludeQuizzes] = useState(false);
    const [includeHomework, setIncludeHomework] = useState(false);
    const [includeSolutions, setIncludeSolutions] = useState(false);
    const [slidesPerChapter, setSlidesPerChapter] = useState('5');
    const [numberOfSubjects, setNumberOfSubjects] = useState('');
    const [numberOfModules, setNumberOfModules] = useState('');
    const [courseDepth, setCourseDepth] = useState<number>(3);
    // Material the institute already owns. When set, the outline follows its
    // topic tree and each slide is written from the pages about its subject.
    const { kb: kbFromLink } = Route.useSearch();
    // Arriving from a knowledge base page: start already grounded in it, so
    // the teacher does not have to find the same material again.
    // The KB pick must survive wizard remounts (reload, back-navigation): it
    // used to be memory-only state, and losing it silently produced a course
    // with NO source material — the outline LLM invented a generic syllabus.
    // Persisted per selection (write-or-remove below) and always VISIBLE in
    // the KbGroundingCard + the confirm dialog, so a restored pick is never
    // a surprise and a missing source is never silent.
    const [kbGrounding, setKbGrounding] = useState<KbGroundingValue | null>(() => {
        if (kbFromLink) {
            return { knowledge_base_id: kbFromLink, node_ids: [], mode: 'STRICT' };
        }
        try {
            const raw = localStorage.getItem('aiCourseKbGrounding');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed?.knowledge_base_id) return parsed as KbGroundingValue;
            }
        } catch {
            /* ignore */
        }
        return null;
    });
    useEffect(() => {
        try {
            if (kbGrounding?.knowledge_base_id) {
                localStorage.setItem('aiCourseKbGrounding', JSON.stringify(kbGrounding));
            } else {
                localStorage.removeItem('aiCourseKbGrounding');
            }
        } catch {
            /* ignore */
        }
    }, [kbGrounding]);
    // Chapter/slide counts start at '5', so "still empty?" can never detect an
    // untouched control. Track the teacher's own choice explicitly instead.
    const structureChosenByUser = useRef(false);
    // With a knowledge base attached the material decides the structure, so
    // the chapter / slides-per-chapter controls are hidden and never sent.
    const kbBound = !!kbGrounding?.knowledge_base_id;
    const [referenceFiles, setReferenceFiles] = useState<PrerequisiteFile[]>([]);
    const [referenceUrls, setReferenceUrls] = useState<PrerequisiteUrl[]>([]);
    const [newReferenceUrl, setNewReferenceUrl] = useState('');
    const [selectedModel, setSelectedModel] = useState('auto');
    const [aiVideoSettings, setAiVideoSettings] =
        useState<AiVideoSettings>(DEFAULT_AI_VIDEO_SETTINGS);
    // Course-wide enrichments woven into every generated HTML document slide.
    const [documentContentTypes, setDocumentContentTypes] = useState<string[]>(['notes']);
    // Course structure: where quizzes live, chapter deliverables, figure sourcing.
    const [quizPlacement, setQuizPlacement] = useState<'PER_TOPIC' | 'CHAPTER' | 'BOTH' | 'NONE'>(
        'PER_TOPIC'
    );
    // null = let the AI decide from the prompt (legacy keyword detection)
    const [includeChapterAssignment, setIncludeChapterAssignment] = useState<boolean | null>(null);
    const [includeChapterVideo, setIncludeChapterVideo] = useState(false);
    // Live AI Tutor: compile every slide into a teaching plan right after the
    // course is created, and enable tutor mode on the new course.
    const [personalizedTeaching, setPersonalizedTeaching] = useState(true);
    const [figuresPolicy, setFiguresPolicy] = useState<'PREFER' | 'REQUIRE' | 'GENERATED_ONLY'>(
        'PREFER'
    );
    // Second-pass repetition cleanup: after all slides generate, slides that
    // restate material a chapter-mate already covers are regenerated once.
    const [dedupeRepetition, setDedupeRepetition] = useState(false);
    // The client-requested standard per-topic teaching flow, in order.
    const STANDARD_FLOW = [
        'why_it_matters',
        'notes',
        'high_yield',
        'visual_process',
        'application',
        'flashcards',
        'quiz',
        'summary',
    ];
    const usingStandardFlow =
        documentContentTypes.length === STANDARD_FLOW.length &&
        documentContentTypes.every((t, i) => t === STANDARD_FLOW[i]);
    const { uploadFile } = useFileUpload();
    const [isUploadingReferences, setIsUploadingReferences] = useState(false);
    const [openaiKey, setOpenaiKey] = useState('');
    const [geminiKey, setGeminiKey] = useState('');
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [usageData, setUsageData] = useState<any>(null);
    // Parametric cost preview for one outline generation (DB-tunable rate)
    const outlineCost = useToolCostPreview('course_outline', {}, showConfirmDialog);

    // ... (previous code)

    const [userKeysStatus, setUserKeysStatus] = useState<{
        hasKeys: boolean;
        hasOpenAI: boolean;
        hasGemini: boolean;
    }>({
        hasKeys: false,
        hasOpenAI: false,
        hasGemini: false,
    });

    const { data: modelsList, isLoading: isLoadingModels } = useAIModelsList({
        category: 'general',
    });
    const [isScraping, setIsScraping] = useState(false);

    // Dialog states for bubbles
    const [showKeysDialog, setShowKeysDialog] = useState(false);
    const [showStructureDialog, setShowStructureDialog] = useState(false);
    const [showContentDialog, setShowContentDialog] = useState(false);
    const [showReferencesDialog, setShowReferencesDialog] = useState(false);
    const [viewingReference, setViewingReference] = useState<{
        title?: string;
        content?: string;
    } | null>(null);

    const instituteId = getInstituteId();
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const userId = tokenData?.user;

    // Get institute levels
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const instituteLevels = instituteDetails?.levels || [];

    // Set default level when levels are loaded
    useEffect(() => {
        const firstLevel = instituteLevels[0];
        if (firstLevel && !skillLevel) {
            setSkillLevel(firstLevel.id);
        }
    }, [instituteLevels, skillLevel]);

    // Check if user has API keys
    const checkUserKeys = useCallback(async () => {
        if (!userId) return;
        try {
            const url = new URL(`${AI_SERVICE_BASE_URL}/api-keys/v1/user/${userId}`);
            if (instituteId) {
                url.searchParams.append('institute_id', instituteId);
            }
            const response = await authenticatedAxiosInstance.get(url.toString());
            setUserKeysStatus({
                hasKeys: true,
                hasOpenAI: response.data.has_openai_key || false,
                hasGemini: response.data.has_gemini_key || false,
            });
        } catch (error: any) {
            if (error.response?.status === 404) {
                setUserKeysStatus({
                    hasKeys: false,
                    hasOpenAI: false,
                    hasGemini: false,
                });
            } else {
                console.error('Error checking user keys:', error);
            }
        }
    }, [userId, instituteId]);

    useEffect(() => {
        if (userId) {
            checkUserKeys();
        }
    }, [userId, checkUserKeys]);

    const fetchUsage = useCallback(async () => {
        if (!userId) return;
        try {
            const response = await authenticatedAxiosInstance.get(
                `${AI_SERVICE_BASE_URL}/api-usage/v1/user/${userId}`,
                { params: { institute_id: instituteId } }
            );
            setUsageData(response.data);
        } catch (error) {
            console.error('Error fetching usage:', error);
        }
    }, [userId, instituteId]);

    useEffect(() => {
        fetchUsage();
    }, [fetchUsage]);

    const handleSaveUserKey = async (type: 'openai' | 'gemini') => {
        if (!userId) return;
        const payload: any = {};
        if (type === 'openai') payload.openai_key = openaiKey;
        else payload.gemini_key = geminiKey;

        try {
            await authenticatedAxiosInstance.post(
                `${AI_SERVICE_BASE_URL}/api-keys/v1/user/${userId}`,
                payload,
                { params: { institute_id: instituteId } }
            );
            const keyTypeLabel = type === 'openai' ? t('keyTypes.openai') : t('keyTypes.gemini');
            toast.success(t('toasts.keySaved', { keyType: keyTypeLabel }));
            if (type === 'openai') setOpenaiKey('');
            else setGeminiKey('');
            await checkUserKeys();
            fetchUsage();
        } catch (error) {
            toast.error(t('toasts.keySaveFailed'));
        }
    };

    const handleDeleteUserKey = async (type: 'openai' | 'gemini') => {
        if (!userId) return;
        const keyTypeLabel = type === 'openai' ? t('keyTypes.openai') : t('keyTypes.gemini');
        if (!confirm(t('toasts.deleteKeyConfirm', { keyType: keyTypeLabel }))) return;

        try {
            await authenticatedAxiosInstance.delete(
                `${AI_SERVICE_BASE_URL} /api-keys/v1 / user / ${userId}/delete`
            );
            toast.success(t('toasts.keyDeleted', { keyType: keyTypeLabel }));
            await checkUserKeys();
        } catch (error: any) {
            console.error('Error deleting user key:', error);
            if (error.response?.status === 404) {
                toast.error(t('toasts.noKeysFound'));
            } else {
                toast.error(t('toasts.keyDeleteFailed'));
            }
        }
    };

    const [aiName, setAiName] = useState(getAiProductName());

    // Fetch AI copilot setting from API and cache in localStorage
    useEffect(() => {
        const instituteId = getInstituteId();
        if (!instituteId) return;
        authenticatedAxiosInstance
            .get(GET_INSITITUTE_SETTINGS, {
                params: { instituteId, settingKey: 'AI_COPILOT_SETTING' },
            })
            .then((res) => {
                if (res.data?.data) {
                    localStorage.setItem('ai_copilot_setting', JSON.stringify(res.data.data));
                    if (res.data.data.course_creator_name) {
                        setAiName(res.data.data.course_creator_name);
                    }
                }
            })
            .catch(() => {
                /* no settings yet */
            });
    }, []);

    useEffect(() => {
        setNavHeading(aiName);
    }, [setNavHeading, aiName]);

    // Fetch course settings to get default course depth
    useEffect(() => {
        const fetchCourseDepth = async () => {
            try {
                const settings = await getCourseSettings();
                const defaultDepth = settings?.courseStructure?.defaultDepth || 3;
                setCourseDepth(defaultDepth);
            } catch (error) {
                console.error('Error fetching course settings:', error);
                setCourseDepth(3);
            }
        };
        fetchCourseDepth();
    }, []);

    const handleExamplePromptClick = (examplePrompt: string) => {
        setCourseGoal(examplePrompt);
    };

    const handleAddPrerequisiteUrl = () => {
        if (newPrerequisiteUrl.trim()) {
            setPrerequisiteUrls((prev) => [
                ...prev,
                { url: newPrerequisiteUrl.trim(), id: `${Date.now()}-${Math.random()}` },
            ]);
            setNewPrerequisiteUrl('');
        }
    };

    const handleRemovePrerequisiteUrl = (id: string) => {
        setPrerequisiteUrls((prev) => prev.filter((url) => url.id !== id));
    };

    const onPrerequisiteDrop = useCallback(
        (acceptedFiles: File[], rejectedFiles: any[]) => {
            if (rejectedFiles.length > 0) {
                rejectedFiles.forEach((rejection) => {
                    if (rejection.errors) {
                        rejection.errors.forEach((error: any) => {
                            if (error.code === 'file-too-large') {
                                alert(
                                    t('toasts.fileTooLarge', { fileName: rejection.file.name })
                                );
                            } else if (error.code === 'file-invalid-type') {
                                alert(
                                    t('toasts.fileInvalidType', { fileName: rejection.file.name })
                                );
                            } else {
                                alert(
                                    t('toasts.fileError', {
                                        fileName: rejection.file.name,
                                        message: error.message,
                                    })
                                );
                            }
                        });
                    }
                });
            }

            const maxFileSize = 512 * 1024 * 1024;
            const validFiles = acceptedFiles.filter((file) => {
                if (file.size > maxFileSize) {
                    alert(t('toasts.fileTooLarge', { fileName: file.name }));
                    return false;
                }
                return true;
            });

            const currentFileCount = prerequisiteFiles.length;
            const newFileCount = validFiles.length;
            if (currentFileCount + newFileCount > 5) {
                const remainingSlots = 5 - currentFileCount;
                if (remainingSlots > 0) {
                    alert(t('toasts.fileLimitPartial', { remaining: remainingSlots }));
                    validFiles.splice(remainingSlots);
                } else {
                    alert(t('toasts.fileLimitReached'));
                    return;
                }
            }

            const newFiles: PrerequisiteFile[] = validFiles.map((file) => ({
                file,
                id: `${Date.now()}-${Math.random()}`,
            }));
            setPrerequisiteFiles((prev) => [...prev, ...newFiles]);
        },
        [prerequisiteFiles]
    );

    const {
        getRootProps: getPrerequisiteRootProps,
        getInputProps: getPrerequisiteInputProps,
        isDragActive: isPrerequisiteDragActive,
    } = useDropzone({
        onDrop: onPrerequisiteDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'text/csv': ['.csv'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        },
        multiple: true,
        maxSize: 512 * 1024 * 1024,
        maxFiles: 5,
    });

    const handleRemovePrerequisiteFile = (id: string) => {
        setPrerequisiteFiles((prev) => prev.filter((f) => f.id !== id));
    };

    const handleAddReferenceUrl = async () => {
        if (newReferenceUrl.trim()) {
            const urlToAdd = newReferenceUrl.trim();
            setIsScraping(true);
            try {
                // Optimistically add to list with loading state
                const tempId = `${Date.now()}-${Math.random()}`;

                // Fetch content
                const data = await scrapeUrlContent(urlToAdd);

                setReferenceUrls((prev) => [
                    ...prev,
                    {
                        url: urlToAdd,
                        id: tempId,
                        title: data.title,
                        content: data.content,
                    },
                ]);
                toast.success(t('toasts.urlAddedSuccess'));
            } catch (error) {
                console.error('Failed to scrape URL:', error);
                toast.error(t('toasts.urlFetchFailed'));
                // Add without content if scraping fails
                setReferenceUrls((prev) => [
                    ...prev,
                    { url: urlToAdd, id: `${Date.now()}-${Math.random()}` },
                ]);
            } finally {
                setIsScraping(false);
                setNewReferenceUrl('');
            }
        }
    };

    const handleRemoveReferenceUrl = (id: string) => {
        setReferenceUrls((prev) => prev.filter((url) => url.id !== id));
    };

    const onReferenceDrop = useCallback(
        (acceptedFiles: File[], rejectedFiles: any[]) => {
            if (rejectedFiles.length > 0) {
                rejectedFiles.forEach((rejection) => {
                    if (rejection.errors) {
                        rejection.errors.forEach((error: any) => {
                            if (error.code === 'file-too-large') {
                                alert(
                                    t('toasts.fileTooLarge', { fileName: rejection.file.name })
                                );
                            } else if (error.code === 'file-invalid-type') {
                                alert(
                                    t('toasts.fileInvalidType', { fileName: rejection.file.name })
                                );
                            } else {
                                alert(
                                    t('toasts.fileError', {
                                        fileName: rejection.file.name,
                                        message: error.message,
                                    })
                                );
                            }
                        });
                    }
                });
            }

            const maxFileSize = 512 * 1024 * 1024;
            const validFiles = acceptedFiles.filter((file) => {
                if (file.size > maxFileSize) {
                    alert(t('toasts.fileTooLarge', { fileName: file.name }));
                    return false;
                }
                return true;
            });

            const currentFileCount = referenceFiles.length;
            const newFileCount = validFiles.length;
            if (currentFileCount + newFileCount > 5) {
                const remainingSlots = 5 - currentFileCount;
                if (remainingSlots > 0) {
                    alert(t('toasts.fileLimitPartial', { remaining: remainingSlots }));
                    validFiles.splice(remainingSlots);
                } else {
                    alert(t('toasts.fileLimitReached'));
                    return;
                }
            }

            const newFiles: PrerequisiteFile[] = validFiles.map((file) => ({
                file,
                id: `${Date.now()}-${Math.random()}`,
            }));
            setReferenceFiles((prev) => [...prev, ...newFiles]);
        },
        [referenceFiles]
    );

    const {
        getRootProps: getReferenceRootProps,
        getInputProps: getReferenceInputProps,
        isDragActive: isReferenceDragActive,
    } = useDropzone({
        onDrop: onReferenceDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'text/csv': ['.csv'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        },
        multiple: true,
        maxSize: 512 * 1024 * 1024,
        maxFiles: 5,
    });

    const handleRemoveReferenceFile = (id: string) => {
        setReferenceFiles((prev) => prev.filter((f) => f.id !== id));
    };

    const handleSubmitCourseConfig = () => {
        if (!courseGoal.trim()) {
            alert(t('toasts.enterCourseGoal'));
            return;
        }

        if (includeCodeSnippets && !programmingLanguage) {
            alert(t('toasts.selectProgrammingLanguage'));
            return;
        }

        setShowConfirmDialog(true);
    };

    const handleConfirmGenerate = async () => {
        const finalCourseLength = chapterLength === 'custom' ? customChapterLength : chapterLength;
        const finalChapterCount =
            numberOfChapters === 'custom' ? customChapterCount : numberOfChapters;
        const finalSlidesPerChapter =
            slidesPerChapter === 'custom' ? customSlidesPerChapter : slidesPerChapter;

        // Upload reference PDFs to media_service → fileIds, so the backend can
        // extract their text (to ground the course) and figures (to embed real
        // diagrams). Best-effort: a failed upload just drops that document.
        let referenceDocumentFileIds: string[] = [];
        const pdfReferenceFiles = referenceFiles.filter((rf) => rf.file.type === 'application/pdf');
        // Only PDFs are content-ingested (MathPix is PDF-only); tell the user
        // their other reference files won't shape the course.
        if (referenceFiles.length > pdfReferenceFiles.length) {
            toast(t('toasts.onlyPdfUsed'));
        }
        if (pdfReferenceFiles.length > 0 && userId) {
            setIsUploadingReferences(true);
            try {
                const uploaded = await Promise.all(
                    pdfReferenceFiles.map((rf) =>
                        uploadFile({
                            // Batch-level gating is handled by the outer
                            // setIsUploadingReferences; a per-file setter would
                            // flip the button back on the FIRST file to finish.
                            file: rf.file,
                            setIsUploading: () => {},
                            userId,
                            source: instituteId || 'STUDENTS',
                            sourceId: 'STUDENTS',
                        }).catch((e) => {
                            console.error('Reference PDF upload failed:', rf.file.name, e);
                            return undefined;
                        })
                    )
                );
                referenceDocumentFileIds = uploaded.filter((id): id is string => !!id);
                if (referenceDocumentFileIds.length < pdfReferenceFiles.length) {
                    toast.error(t('toasts.somePdfUploadFailed'));
                }
            } finally {
                setIsUploadingReferences(false);
            }
        } else if (pdfReferenceFiles.length > 0) {
            toast.error(t('toasts.pdfUploadMissingUser'));
        }

        // Prepare context from references
        let contextData = '';
        if (referenceUrls.some((u) => u.content)) {
            contextData += '\n\nREFERENCE MATERIALS:\n';
            referenceUrls.forEach((url, idx) => {
                if (url.content) {
                    contextData += `\n--- Source ${idx + 1}: ${url.title || url.url} ---\n${url.content}\n`;
                }
            });
        }

        const courseConfig = {
            prompt: courseGoal + contextData,
            learnerProfile: {
                ageRange: ageRange || undefined,
                skillLevel: skillLevel || undefined,
                prerequisiteFiles: prerequisiteFiles.map((f) => ({
                    name: f.file.name,
                    type: f.file.type,
                    size: f.file.size,
                })),
                prerequisiteUrls: prerequisiteUrls.map((u) => u.url),
            },
            courseGoal,
            learningOutcome: learningOutcome || undefined,
            courseDepthOptions: {
                includeDiagrams,
                includeCodeSnippets,
                includePracticeProblems,
                includeYouTubeVideo,
                includeAIGeneratedVideo,
                includeAISlides,
                includeAIStorybook,
                programmingLanguage: includeCodeSnippets ? programmingLanguage : undefined,
            },
            durationFormatStructure: {
                numberOfSessions:
                    !kbBound && finalChapterCount ? parseInt(finalChapterCount) : undefined,
                sessionLength: finalCourseLength || undefined,
                includeQuizzes,
                includeHomework,
                includeSolutions,
                topicsPerSession:
                    !kbBound && finalSlidesPerChapter ? parseInt(finalSlidesPerChapter) : undefined,
                numberOfSubjects: numberOfSubjects ? parseInt(numberOfSubjects) : undefined,
                numberOfModules: numberOfModules ? parseInt(numberOfModules) : undefined,
            },
            courseDepth: courseDepth,
            language: language || 'English',
            model: selectedModel,
            aiVideoSettings: aiVideoSettings,
            documentContentTypes: documentContentTypes,
            courseStructure: {
                quizPlacement,
                includeChapterAssignment,
                includeChapterVideo,
                figuresPolicy,
                dedupeRepetition,
                personalizedTeaching,
            },
            referenceDocumentFileIds,
            kbGrounding,
            userId: userId,
            instituteId: instituteId,
            references: {
                files: referenceFiles.map((f) => ({
                    name: f.file.name,
                    type: f.file.type,
                    size: f.file.size,
                })),
                urls: referenceUrls.map((u) => u.url),
            },
        };

        console.log('Generating course with config:', courseConfig);
        sessionStorage.setItem('courseConfig', JSON.stringify(courseConfig));
        // The generating page deletes courseConfig once the outline loads;
        // the AI-teacher choice must outlive it (read at course creation).
        sessionStorage.setItem('coursePersonalizedTeaching', personalizedTeaching ? '1' : '0');
        // Clear any previous draft since we're starting fresh
        localStorage.removeItem('aiCourseDraft');
        setShowConfirmDialog(false);
        navigate({
            to: '/study-library/ai-copilot/course-outline/generating',
        });
    };

    // Count active content options
    const activeContentOptions = [
        includeDiagrams,
        includeCodeSnippets,
        includePracticeProblems,
        includeYouTubeVideo,
        includeAIGeneratedVideo,
        includeAISlides,
        includeAIStorybook,
        includeQuizzes,
        includeHomework,
        includeSolutions,
    ].filter(Boolean).length;

    // Count references
    const totalReferences = referenceFiles.length + referenceUrls.length;

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('helmet.title', { aiName })}</title>
                <meta name="description" content={t('helmet.description', { aiName })} />
            </Helmet>
            {/* min-h + my-auto centers the form when it fits and lets the page
                scroll when it's taller than the viewport (e.g. once the AI Video
                Settings are expanded on smaller screens) — a fixed height with
                items-center used to clip the top and the Generate button. */}
            <div className="flex min-h-[calc(100vh-4rem)] justify-center bg-gradient-to-b from-indigo-50 via-white to-purple-50 px-4 py-6 sm:px-6">
                <div className="m-auto w-full max-w-[800px]">
                    {/* Compact Header */}
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="mb-4 text-center"
                    >
                        <div className="mb-2 flex items-center justify-center gap-2">
                            <Sparkles className="size-5 text-indigo-500 sm:size-6" />
                            <h1 className="text-xl font-semibold text-neutral-900 sm:text-2xl">
                                {t('header.title', { aiName })}
                            </h1>
                        </div>
                        <p className="text-sm text-gray-600">{t('header.subtitle', { aiName })}</p>
                    </motion.div>

                    {/* Resume Draft Banner */}
                    {savedDraft && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                            className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100">
                                        <BookOpen className="size-4 text-indigo-600" />
                                    </div>
                                    <div>
                                        <p className="line-clamp-1 text-sm font-medium text-neutral-900">
                                            {savedDraft.draftTitle || t('draftBanner.untitled')}
                                        </p>
                                        <p className="text-xs text-neutral-500">
                                            {t('draftBanner.savedOn', {
                                                date: new Date(
                                                    savedDraft.timestamp
                                                ).toLocaleDateString(i18n.language),
                                            })}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleDiscardDraft}
                                        className="h-8 text-xs text-neutral-500 hover:text-red-600"
                                    >
                                        <Trash2 className="mr-1 size-3" />
                                        {t('draftBanner.discard')}
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={handleResumeDraft}
                                        className="h-8 bg-indigo-600 text-xs text-white hover:bg-indigo-700"
                                    >
                                        {t('draftBanner.resume')}
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Example Prompts - Compact */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.4, delay: 0.1 }}
                        className="mb-3"
                    >
                        <div className="flex flex-wrap justify-center gap-1.5">
                            {examplePrompts.map((prompt, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    onClick={() => handleExamplePromptClick(prompt)}
                                    className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline"
                                >
                                    {prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt}
                                </button>
                            ))}
                        </div>
                    </motion.div>

                    {/* Main Form Card */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.15 }}
                        className="rounded-2xl border border-indigo-100/50 bg-white/80 p-4 shadow-lg shadow-indigo-100/50 backdrop-blur-sm sm:p-5"
                    >
                        {/* Course Goal Textarea */}
                        <div className="mb-4">
                            <Textarea
                                value={courseGoal}
                                onChange={(e) => setCourseGoal(e.target.value)}
                                placeholder={t('form.courseGoalPlaceholder')}
                                className="min-h-[100px] w-full resize-none border-neutral-200 focus:border-indigo-300 focus:ring-indigo-200"
                            />
                        </div>

                        {/* Bubbles Row 1 - Core Settings */}
                        <div className="mb-1">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                                {t('form.courseSettings')}
                            </span>
                        </div>
                        <div className="mb-3 flex flex-wrap gap-2">
                            {/* Skill Level Dropdown */}
                            <Select value={skillLevel} onValueChange={setSkillLevel}>
                                <SelectTrigger className="h-8 w-auto rounded-full border-neutral-200 bg-white px-3 text-xs">
                                    <div className="flex items-center gap-1.5">
                                        <Layers className="size-3.5 text-neutral-500" />
                                        <SelectValue placeholder={t('form.skillLevelPlaceholder')} />
                                    </div>
                                </SelectTrigger>
                                <SelectContent>
                                    {instituteLevels.length > 0 ? (
                                        instituteLevels.map((level) => (
                                            <SelectItem key={level.id} value={level.id}>
                                                {level.level_name}
                                            </SelectItem>
                                        ))
                                    ) : (
                                        <>
                                            <SelectItem value="beginner">
                                                {t('form.skillLevels.beginner')}
                                            </SelectItem>
                                            <SelectItem value="intermediate">
                                                {t('form.skillLevels.intermediate')}
                                            </SelectItem>
                                            <SelectItem value="advanced">
                                                {t('form.skillLevels.advanced')}
                                            </SelectItem>
                                        </>
                                    )}
                                </SelectContent>
                            </Select>

                            {/* AI Model Dropdown */}
                            <Select value={selectedModel} onValueChange={setSelectedModel}>
                                <SelectTrigger className="h-8 w-auto rounded-full border-neutral-200 bg-white px-3 text-xs">
                                    <div className="flex items-center gap-1.5">
                                        <Sparkles className="size-3.5 text-neutral-500" />
                                        <SelectValue placeholder={t('form.aiModelPlaceholder')} />
                                    </div>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto">{t('form.autoSmart')}</SelectItem>
                                    {isLoadingModels ? (
                                        <div className="px-2 py-1.5 text-xs text-gray-500">
                                            {t('form.loading')}
                                        </div>
                                    ) : modelsList && modelsList.models.length > 0 ? (
                                        modelsList.models.map((model) => (
                                            <SelectItem key={model.model_id} value={model.model_id}>
                                                {model.name}
                                            </SelectItem>
                                        ))
                                    ) : (
                                        <>
                                            <SelectItem value="openai/gpt-4o">GPT-4o</SelectItem>
                                            <SelectItem value="openai/gpt-4o-mini">
                                                GPT-4o Mini
                                            </SelectItem>
                                            <SelectItem value="google/gemini-1.5-pro">
                                                Gemini 1.5 Pro
                                            </SelectItem>
                                            <SelectItem value="google/gemini-1.5-flash">
                                                Gemini 1.5 Flash
                                            </SelectItem>
                                        </>
                                    )}
                                </SelectContent>
                            </Select>

                            {kbBound ? (
                                <span className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-600">
                                    {t('form.structureFollowsKb')}
                                </span>
                            ) : (
                                <>
                                    {/* Number of Chapters Dropdown */}
                                    <Select
                                        value={numberOfChapters}
                                        onValueChange={(v) => {
                                            structureChosenByUser.current = true;
                                            setNumberOfChapters(v);
                                            if (v !== 'custom') setCustomChapterCount('');
                                        }}
                                    >
                                        <SelectTrigger className="h-8 w-auto rounded-full border-neutral-200 bg-white px-3 text-xs">
                                            <div className="flex items-center gap-1.5">
                                                <BookOpen className="size-3.5 text-neutral-500" />
                                                {numberOfChapters === 'custom' &&
                                                customChapterCount ? (
                                                    <span>
                                                        {customChapterCount}{' '}
                                                        {getTerminologyPlural(
                                                            ContentTerms.Chapters,
                                                            SystemTerms.Chapters
                                                        )}
                                                    </span>
                                                ) : (
                                                    <SelectValue
                                                        placeholder={getTerminologyPlural(
                                                            ContentTerms.Chapters,
                                                            SystemTerms.Chapters
                                                        )}
                                                    />
                                                )}
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {[3, 4, 5, 6, 7, 8, 10, 12, 15, 20].map((num) => (
                                                <SelectItem key={num} value={num.toString()}>
                                                    {num}{' '}
                                                    {getTerminologyPlural(
                                                        ContentTerms.Chapters,
                                                        SystemTerms.Chapters
                                                    )}
                                                </SelectItem>
                                            ))}
                                            <SelectItem value="custom">
                                                {t('form.custom')}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </>
                            )}

                            {/* Course Length Dropdown */}
                            <Select
                                value={chapterLength}
                                onValueChange={(v) => {
                                    setChapterLength(v);
                                    if (v !== 'custom') setCustomChapterLength('');
                                }}
                            >
                                <SelectTrigger className="h-8 w-auto rounded-full border-neutral-200 bg-white px-3 text-xs">
                                    <div className="flex items-center gap-1.5">
                                        <Clock className="size-3.5 text-neutral-500" />
                                        {chapterLength === 'custom' && customChapterLength ? (
                                            <span>
                                                {t('form.durationCustomMinutes', {
                                                    minutes: customChapterLength,
                                                })}
                                            </span>
                                        ) : (
                                            <SelectValue placeholder={t('form.durationPlaceholder')} />
                                        )}
                                    </div>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="30">
                                        {t('form.durationOptions.min30')}
                                    </SelectItem>
                                    <SelectItem value="45">
                                        {t('form.durationOptions.min45')}
                                    </SelectItem>
                                    <SelectItem value="60">
                                        {t('form.durationOptions.min60')}
                                    </SelectItem>
                                    <SelectItem value="90">
                                        {t('form.durationOptions.min90')}
                                    </SelectItem>
                                    <SelectItem value="120">
                                        {t('form.durationOptions.hours2')}
                                    </SelectItem>
                                    <SelectItem value="custom">Custom...</SelectItem>
                                </SelectContent>
                            </Select>

                            {!kbBound && (
                                <>
                                    {/* Slides per Chapter Dropdown */}
                                    <Select
                                        value={slidesPerChapter}
                                        onValueChange={(v) => {
                                            structureChosenByUser.current = true;
                                            setSlidesPerChapter(v);
                                            if (v !== 'custom') setCustomSlidesPerChapter('');
                                        }}
                                    >
                                        <SelectTrigger className="h-8 w-auto rounded-full border-neutral-200 bg-white px-3 text-xs">
                                            <div className="flex items-center gap-1.5">
                                                <FileText className="size-3.5 text-neutral-500" />
                                                {slidesPerChapter === 'custom' &&
                                                customSlidesPerChapter ? (
                                                    <span>
                                                        {customSlidesPerChapter}{' '}
                                                        {getTerminologyPlural(
                                                            ContentTerms.Slides,
                                                            SystemTerms.Slides
                                                        )}
                                                        /
                                                        {getTerminology(
                                                            ContentTerms.Chapters,
                                                            SystemTerms.Chapters
                                                        )}
                                                    </span>
                                                ) : (
                                                    <SelectValue
                                                        placeholder={`${getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides)}/${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}`}
                                                    />
                                                )}
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {[3, 4, 5, 6, 7, 8, 10].map((num) => (
                                                <SelectItem key={num} value={num.toString()}>
                                                    {num}{' '}
                                                    {getTerminologyPlural(
                                                        ContentTerms.Slides,
                                                        SystemTerms.Slides
                                                    )}
                                                    /
                                                    {getTerminology(
                                                        ContentTerms.Chapters,
                                                        SystemTerms.Chapters
                                                    )}
                                                </SelectItem>
                                            ))}
                                            <SelectItem value="custom">
                                                {t('form.custom')}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </>
                            )}
                        </div>

                        {/* Custom inputs for chapters/duration/slides if needed */}
                        {((!kbBound && numberOfChapters === 'custom') ||
                            chapterLength === 'custom' ||
                            (!kbBound && slidesPerChapter === 'custom')) && (
                            <div className="mb-3 flex gap-2">
                                {!kbBound && numberOfChapters === 'custom' && (
                                    <Input
                                        type="number"
                                        min={1}
                                        value={customChapterCount}
                                        onChange={(e) => setCustomChapterCount(e.target.value)}
                                        placeholder={t('form.numberOfChapters', {
                                            chapters: getTerminologyPlural(
                                                ContentTerms.Chapters,
                                                SystemTerms.Chapters
                                            ).toLowerCase(),
                                        })}
                                        className="h-8 w-40 text-xs"
                                    />
                                )}
                                {chapterLength === 'custom' && (
                                    <Input
                                        type="number"
                                        min={1}
                                        value={customChapterLength}
                                        onChange={(e) => setCustomChapterLength(e.target.value)}
                                        placeholder={t('form.durationInputPlaceholder')}
                                        className="h-8 w-36 text-xs"
                                    />
                                )}
                                {!kbBound && slidesPerChapter === 'custom' && (
                                    <Input
                                        type="number"
                                        min={1}
                                        value={customSlidesPerChapter}
                                        onChange={(e) => setCustomSlidesPerChapter(e.target.value)}
                                        placeholder={t('form.slidesPerChapterInputPlaceholder', {
                                            slides: getTerminologyPlural(
                                                ContentTerms.Slides,
                                                SystemTerms.Slides
                                            ),
                                            chapter: getTerminology(
                                                ContentTerms.Chapters,
                                                SystemTerms.Chapters
                                            ).toLowerCase(),
                                        })}
                                        className="h-8 w-40 text-xs"
                                    />
                                )}
                            </div>
                        )}

                        <KbGroundingCard
                            value={kbGrounding}
                            onChange={setKbGrounding}
                            onStructureSuggested={(chapters, slides) => {
                                // The material's real shape beats an arbitrary
                                // default, but never overrides a number the
                                // teacher set for themselves.
                                // The material's real shape beats an arbitrary
                                // default, but never overrides a choice the
                                // teacher has actually made.
                                if (structureChosenByUser.current) return;
                                setNumberOfChapters(String(chapters));
                                setSlidesPerChapter(String(slides));
                            }}
                        />

                        {/* Bubbles Row 2 - Content Options & Actions */}
                        <div className="mb-1">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                                {t('form.additionalOptions')}
                            </span>
                        </div>
                        <div className="mb-4 flex flex-wrap gap-2">
                            {/* Content Options Bubble */}
                            <BubbleButton
                                icon={Lightbulb}
                                label={t('form.contentOptionsLabel')}
                                value={
                                    activeContentOptions > 0
                                        ? t('form.selectedCount', { count: activeContentOptions })
                                        : undefined
                                }
                                onClick={() => setShowContentDialog(true)}
                                isActive={activeContentOptions > 0}
                            />

                            {/* Structure Bubble (for depth-dependent options) */}
                            {courseDepth > 3 && (
                                <BubbleButton
                                    icon={Layers}
                                    label={t('form.structureLabel')}
                                    value={
                                        numberOfModules || numberOfSubjects
                                            ? t('form.configured')
                                            : undefined
                                    }
                                    onClick={() => setShowStructureDialog(true)}
                                    isActive={!!(numberOfModules || numberOfSubjects)}
                                />
                            )}

                            {/* References Bubble */}
                            <BubbleButton
                                icon={Link}
                                label={t('form.referencesLabel')}
                                value={totalReferences > 0 ? `${totalReferences}` : undefined}
                                onClick={() => setShowReferencesDialog(true)}
                                isActive={totalReferences > 0}
                            />

                            {/* API Keys Bubble */}
                            <BubbleButton
                                icon={Key}
                                label={t('form.apiKeysLabel')}
                                onClick={() => setShowKeysDialog(true)}
                                status={
                                    userKeysStatus.hasOpenAI || userKeysStatus.hasGemini
                                        ? 'success'
                                        : 'default'
                                }
                            />
                        </div>

                        {/* AI Video settings (model / voice / duration / tier) —
                            applied to every AI Video / Slides / Storybook page */}
                        <div className="mb-4">
                            <AiVideoSettingsCard
                                value={aiVideoSettings}
                                onChange={setAiVideoSettings}
                            />

                            {/* Document content — enrichments woven into every
                                generated HTML document slide. */}
                            <div className="rounded-lg border border-neutral-200 bg-white p-3">
                                <div className="mb-1 text-subtitle font-semibold text-neutral-600">
                                    {t('form.documentContent.title')}
                                </div>
                                <p className="mb-2 text-caption text-neutral-400">
                                    {t('form.documentContent.caption')}
                                </p>
                                {/* Flow template: one click applies the standard
                                    per-topic teaching flow, in order. */}
                                <div className="mb-2 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setDocumentContentTypes(['notes'])}
                                        className={cn(
                                            'rounded-full border px-3 py-1 text-caption transition-colors',
                                            !usingStandardFlow
                                                ? 'border-primary-500 bg-primary-50 text-primary-500'
                                                : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                        )}
                                    >
                                        {t('form.documentContent.customButton')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDocumentContentTypes(STANDARD_FLOW)}
                                        className={cn(
                                            'rounded-full border px-3 py-1 text-caption transition-colors',
                                            usingStandardFlow
                                                ? 'border-primary-500 bg-primary-50 text-primary-500'
                                                : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                        )}
                                        title={t('form.documentContent.standardFlowTooltip')}
                                    >
                                        {t('form.documentContent.standardFlowButton')}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        {
                                            key: 'why_it_matters',
                                            label: t('form.documentContent.types.whyItMatters'),
                                        },
                                        { key: 'notes', label: t('form.documentContent.types.notes') },
                                        {
                                            key: 'high_yield',
                                            label: t('form.documentContent.types.highYield'),
                                        },
                                        {
                                            key: 'visual_process',
                                            label: t('form.documentContent.types.visualProcess'),
                                        },
                                        {
                                            key: 'application',
                                            label: t('form.documentContent.types.application'),
                                        },
                                        {
                                            key: 'flashcards',
                                            label: t('form.documentContent.types.flashcards'),
                                        },
                                        { key: 'quiz', label: t('form.documentContent.types.quiz') },
                                        {
                                            key: 'summary',
                                            label: t('form.documentContent.types.summary'),
                                        },
                                        {
                                            key: 'practical_examples',
                                            label: t('form.documentContent.types.practicalExamples'),
                                        },
                                        {
                                            key: 'interactive_games',
                                            label: t('form.documentContent.types.interactiveGames'),
                                        },
                                    ].map((ct) => {
                                        const on = documentContentTypes.includes(ct.key);
                                        return (
                                            <button
                                                key={ct.key}
                                                type="button"
                                                onClick={() =>
                                                    setDocumentContentTypes((prev) =>
                                                        prev.includes(ct.key)
                                                            ? prev.filter((k) => k !== ct.key)
                                                            : [...prev, ct.key]
                                                    )
                                                }
                                                className={cn(
                                                    'rounded-full border px-3 py-1 text-caption transition-colors',
                                                    on
                                                        ? 'border-primary-500 bg-primary-500 text-white'
                                                        : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                                )}
                                            >
                                                {ct.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Course structure — quizzes, chapter deliverables,
                                and how figures are sourced. */}
                            <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-3">
                                <div className="mb-1 text-subtitle font-semibold text-neutral-600">
                                    {t('form.courseStructure.title')}
                                </div>
                                <div className="mb-2">
                                    <p className="mb-1 text-caption text-neutral-400">
                                        {t('form.courseStructure.quizzesCaption')}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {(
                                            [
                                                {
                                                    key: 'PER_TOPIC',
                                                    label: t(
                                                        'form.courseStructure.quizPlacement.perTopic'
                                                    ),
                                                },
                                                {
                                                    key: 'CHAPTER',
                                                    label: t(
                                                        'form.courseStructure.quizPlacement.chapter'
                                                    ),
                                                },
                                                {
                                                    key: 'BOTH',
                                                    label: t('form.courseStructure.quizPlacement.both'),
                                                },
                                                {
                                                    key: 'NONE',
                                                    label: t('form.courseStructure.quizPlacement.none'),
                                                },
                                            ] as const
                                        ).map((opt) => (
                                            <button
                                                key={opt.key}
                                                type="button"
                                                onClick={() => setQuizPlacement(opt.key)}
                                                className={cn(
                                                    'rounded-full border px-3 py-1 text-caption transition-colors',
                                                    quizPlacement === opt.key
                                                        ? 'border-primary-500 bg-primary-500 text-white'
                                                        : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                                )}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="mb-2">
                                    <p className="mb-1 text-caption text-neutral-400">
                                        {t('form.courseStructure.chapterDeliverablesCaption')}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {(
                                            [
                                                {
                                                    key: null,
                                                    label: t(
                                                        'form.courseStructure.chapterAssignment.auto'
                                                    ),
                                                },
                                                {
                                                    key: true,
                                                    label: t(
                                                        'form.courseStructure.chapterAssignment.withSolution'
                                                    ),
                                                },
                                                {
                                                    key: false,
                                                    label: t(
                                                        'form.courseStructure.chapterAssignment.none'
                                                    ),
                                                },
                                            ] as const
                                        ).map((opt) => (
                                            <button
                                                key={String(opt.key)}
                                                type="button"
                                                onClick={() => setIncludeChapterAssignment(opt.key)}
                                                className={cn(
                                                    'rounded-full border px-3 py-1 text-caption transition-colors',
                                                    includeChapterAssignment === opt.key
                                                        ? 'border-primary-500 bg-primary-500 text-white'
                                                        : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                                )}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setIncludeChapterVideo((v) => !v)}
                                            className={cn(
                                                'rounded-full border px-3 py-1 text-caption transition-colors',
                                                includeChapterVideo
                                                    ? 'border-primary-500 bg-primary-500 text-white'
                                                    : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                            )}
                                        >
                                            {t('form.courseStructure.chapterVideo')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPersonalizedTeaching((v) => !v)}
                                            title={t('form.courseStructure.aiTeacherTooltip')}
                                            className={cn(
                                                'rounded-full border px-3 py-1 text-caption transition-colors',
                                                personalizedTeaching
                                                    ? 'border-primary-500 bg-primary-500 text-white'
                                                    : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                            )}
                                        >
                                            {t('form.courseStructure.aiTeacher')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDedupeRepetition((v) => !v)}
                                            title={t('form.courseStructure.reduceRepetitionTooltip')}
                                            className={cn(
                                                'rounded-full border px-3 py-1 text-caption transition-colors',
                                                dedupeRepetition
                                                    ? 'border-primary-500 bg-primary-500 text-white'
                                                    : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                            )}
                                        >
                                            {t('form.courseStructure.reduceRepetition')}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <p className="mb-1 text-caption text-neutral-400">
                                        {t('form.courseStructure.figuresCaption')}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {(
                                            [
                                                {
                                                    key: 'PREFER',
                                                    label: t('form.courseStructure.figuresPolicy.prefer'),
                                                },
                                                {
                                                    key: 'REQUIRE',
                                                    label: t(
                                                        'form.courseStructure.figuresPolicy.require'
                                                    ),
                                                },
                                                {
                                                    key: 'GENERATED_ONLY',
                                                    label: t(
                                                        'form.courseStructure.figuresPolicy.generatedOnly'
                                                    ),
                                                },
                                            ] as const
                                        ).map((opt) => (
                                            <button
                                                key={opt.key}
                                                type="button"
                                                onClick={() => setFiguresPolicy(opt.key)}
                                                className={cn(
                                                    'rounded-full border px-3 py-1 text-caption transition-colors',
                                                    figuresPolicy === opt.key
                                                        ? 'border-primary-500 bg-primary-500 text-white'
                                                        : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                                )}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Generate Button */}
                        <MyButton
                            buttonType="primary"
                            onClick={handleSubmitCourseConfig}
                            disabled={!courseGoal.trim()}
                            className="w-full shadow-lg shadow-indigo-200"
                        >
                            <Sparkles className="mr-2 size-4" />
                            {t('form.generateButton')}
                        </MyButton>
                    </motion.div>
                </div>
            </div>

            {/* Content Options Dialog */}
            <Dialog open={showContentDialog} onOpenChange={setShowContentDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Lightbulb className="size-5 text-indigo-600" />
                            {t('contentDialog.title')}
                        </DialogTitle>
                        <DialogDescription>{t('contentDialog.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-4">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeDiagrams}
                                    onCheckedChange={(checked) =>
                                        setIncludeDiagrams(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.diagrams')}
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeCodeSnippets}
                                    onCheckedChange={(checked) =>
                                        setIncludeCodeSnippets(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.codeSnippets')}
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includePracticeProblems}
                                    onCheckedChange={(checked) =>
                                        setIncludePracticeProblems(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.practiceProblems')}
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeQuizzes}
                                    onCheckedChange={(checked) =>
                                        setIncludeQuizzes(checked === true)
                                    }
                                />
                                <span className="text-sm">{t('contentDialog.options.quizzes')}</span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeHomework}
                                    onCheckedChange={(checked) =>
                                        setIncludeHomework(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.assignments')}
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeSolutions}
                                    onCheckedChange={(checked) =>
                                        setIncludeSolutions(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.solutions')}
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeYouTubeVideo}
                                    onCheckedChange={(checked) =>
                                        setIncludeYouTubeVideo(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.youtubeVideos')}
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeAIGeneratedVideo}
                                    onCheckedChange={(checked) =>
                                        setIncludeAIGeneratedVideo(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.aiVideos')}
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeAISlides}
                                    onCheckedChange={(checked) =>
                                        setIncludeAISlides(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.aiSlides')}
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={includeAIStorybook}
                                    onCheckedChange={(checked) =>
                                        setIncludeAIStorybook(checked === true)
                                    }
                                />
                                <span className="text-sm">
                                    {t('contentDialog.options.aiStorybook')}
                                </span>
                            </label>
                        </div>

                        {includeCodeSnippets && (
                            <div className="border-t pt-2">
                                <Label className="mb-2 block text-sm">
                                    {t('contentDialog.programmingLanguage')}
                                </Label>
                                <Select
                                    value={programmingLanguage}
                                    onValueChange={setProgrammingLanguage}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue
                                            placeholder={t('contentDialog.selectLanguagePlaceholder')}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="python">Python</SelectItem>
                                        <SelectItem value="javascript">JavaScript</SelectItem>
                                        <SelectItem value="java">Java</SelectItem>
                                        <SelectItem value="cpp">C++</SelectItem>
                                        <SelectItem value="csharp">C#</SelectItem>
                                        <SelectItem value="go">Go</SelectItem>
                                        <SelectItem value="rust">Rust</SelectItem>
                                        <SelectItem value="typescript">TypeScript</SelectItem>
                                        <SelectItem value="php">PHP</SelectItem>
                                        <SelectItem value="ruby">Ruby</SelectItem>
                                        <SelectItem value="swift">Swift</SelectItem>
                                        <SelectItem value="kotlin">Kotlin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <MyButton buttonType="primary" onClick={() => setShowContentDialog(false)}>
                            {t('contentDialog.done')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Structure Dialog (for depth > 3) */}
            <Dialog open={showStructureDialog} onOpenChange={setShowStructureDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Layers className="size-5 text-indigo-600" />
                            {t('structureDialog.title')}
                        </DialogTitle>
                        <DialogDescription>{t('structureDialog.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {courseDepth > 4 && (
                            <div>
                                <Label className="mb-2 block text-sm">
                                    {t('structureDialog.numberOf', {
                                        term: getTerminologyPlural(
                                            ContentTerms.Subject,
                                            SystemTerms.Subject
                                        ),
                                    })}
                                </Label>
                                <Select
                                    value={numberOfSubjects}
                                    onValueChange={setNumberOfSubjects}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue
                                            placeholder={t('structureDialog.selectPlaceholder', {
                                                term: getTerminologyPlural(
                                                    ContentTerms.Subject,
                                                    SystemTerms.Subject
                                                ).toLowerCase(),
                                            })}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[1, 2, 3, 4, 5, 6].map((num) => (
                                            <SelectItem key={num} value={num.toString()}>
                                                {num}{' '}
                                                {num > 1
                                                    ? getTerminologyPlural(
                                                          ContentTerms.Subject,
                                                          SystemTerms.Subject
                                                      )
                                                    : getTerminology(
                                                          ContentTerms.Subject,
                                                          SystemTerms.Subject
                                                      )}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        {courseDepth > 3 && (
                            <div>
                                <Label className="mb-2 block text-sm">
                                    {t('structureDialog.numberOf', {
                                        term: getTerminologyPlural(
                                            ContentTerms.Modules,
                                            SystemTerms.Modules
                                        ),
                                    })}
                                </Label>
                                <Select value={numberOfModules} onValueChange={setNumberOfModules}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue
                                            placeholder={t('structureDialog.selectPlaceholder', {
                                                term: getTerminologyPlural(
                                                    ContentTerms.Modules,
                                                    SystemTerms.Modules
                                                ).toLowerCase(),
                                            })}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[2, 3, 4, 5, 6, 8, 10].map((num) => (
                                            <SelectItem key={num} value={num.toString()}>
                                                {num}{' '}
                                                {getTerminologyPlural(
                                                    ContentTerms.Modules,
                                                    SystemTerms.Modules
                                                )}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <MyButton
                            buttonType="primary"
                            onClick={() => setShowStructureDialog(false)}
                        >
                            {t('structureDialog.done')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* References Dialog */}
            <Dialog open={showReferencesDialog} onOpenChange={setShowReferencesDialog}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Link className="size-5 text-indigo-600" />
                            {t('referencesDialog.title')}
                        </DialogTitle>
                        <DialogDescription>{t('referencesDialog.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[400px] space-y-4 overflow-y-auto py-4">
                        {/* URL Input */}
                        <div>
                            <Label className="mb-2 block text-sm">
                                {t('referencesDialog.addUrlLabel')}
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    value={newReferenceUrl}
                                    onChange={(e) => setNewReferenceUrl(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleAddReferenceUrl();
                                        }
                                    }}
                                    placeholder={t('referencesDialog.urlPlaceholder')}
                                    className="flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleAddReferenceUrl}
                                    disabled={!newReferenceUrl.trim() || isScraping}
                                >
                                    {isScraping ? (
                                        <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                        <Plus className="size-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* URL List */}
                        {referenceUrls.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {referenceUrls.map((url) => (
                                    <div
                                        key={url.id}
                                        className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700"
                                    >
                                        <Link className="size-3.5" />
                                        <button
                                            type="button"
                                            className="max-w-[200px] truncate text-left hover:underline"
                                            onClick={() => {
                                                if (url.content) {
                                                    setViewingReference({
                                                        title: url.title || url.url,
                                                        content: url.content,
                                                    });
                                                }
                                            }}
                                            title={
                                                url.content
                                                    ? t('referencesDialog.clickToView')
                                                    : t('referencesDialog.noContentFetched')
                                            }
                                            disabled={!url.content}
                                        >
                                            {url.url}
                                        </button>
                                        {url.content && (
                                            <CheckCircle className="size-3 text-green-500" />
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveReferenceUrl(url.id)}
                                            className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* File Upload */}
                        <div>
                            <Label className="mb-2 block text-sm">
                                {t('referencesDialog.uploadFilesLabel')}
                            </Label>
                            <div
                                {...getReferenceRootProps()}
                                className={cn(
                                    'flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-all duration-200',
                                    isReferenceDragActive
                                        ? 'border-indigo-400 bg-indigo-50'
                                        : 'border-neutral-300 bg-neutral-50 hover:border-indigo-300'
                                )}
                            >
                                <input {...getReferenceInputProps()} />
                                <Upload className="size-5 text-neutral-400" />
                                <span className="text-xs text-neutral-500">
                                    {t('referencesDialog.dropzoneHint')}
                                </span>
                            </div>
                        </div>

                        {/* File List */}
                        {referenceFiles.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {referenceFiles.map((file) => (
                                    <div
                                        key={file.id}
                                        className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700"
                                    >
                                        <FileText className="size-3.5" />
                                        <span className="max-w-[150px] truncate">
                                            {file.file.name}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveReferenceFile(file.id)}
                                            className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <MyButton
                            buttonType="primary"
                            onClick={() => setShowReferencesDialog(false)}
                        >
                            {t('referencesDialog.done')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* View Reference Content Dialog */}
            <Dialog
                open={!!viewingReference}
                onOpenChange={(open) => !open && setViewingReference(null)}
            >
                <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
                    <DialogHeader>
                        <DialogTitle className="truncate pr-8">
                            {viewingReference?.title || t('referenceContentDialog.titleFallback')}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border bg-neutral-50 p-4 font-mono text-sm">
                        {viewingReference?.content}
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setViewingReference(null)}>
                            {t('referenceContentDialog.close')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* API Keys Dialog */}
            <Dialog open={showKeysDialog} onOpenChange={setShowKeysDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Key className="size-5 text-indigo-600" />
                            {t('keysDialog.title')}
                        </DialogTitle>
                        <DialogDescription>{t('keysDialog.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {/* OpenRouter Key */}
                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <Label className="text-sm">{t('keysDialog.openRouterLabel')}</Label>
                                {userKeysStatus.hasOpenAI && (
                                    <span className="flex items-center gap-1 text-xs text-green-600">
                                        <CheckCircle className="size-3" />
                                        {t('keysDialog.added')}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    type="password"
                                    value={openaiKey}
                                    onChange={(e) => setOpenaiKey(e.target.value)}
                                    placeholder={t('keysDialog.openRouterPlaceholder')}
                                    className="flex-1"
                                    disabled={userKeysStatus.hasOpenAI}
                                    {...noAutofillProps('password')}
                                />
                                {!userKeysStatus.hasOpenAI ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => handleSaveUserKey('openai')}
                                        disabled={!openaiKey}
                                    >
                                        <Plus className="size-4" />
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => handleDeleteUserKey('openai')}
                                        className="text-red-600 hover:text-red-700"
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Gemini Key */}
                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <Label className="text-sm">{t('keysDialog.geminiLabel')}</Label>
                                {userKeysStatus.hasGemini && (
                                    <span className="flex items-center gap-1 text-xs text-green-600">
                                        <CheckCircle className="size-3" />
                                        {t('keysDialog.added')}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    type="password"
                                    value={geminiKey}
                                    onChange={(e) => setGeminiKey(e.target.value)}
                                    placeholder={t('keysDialog.geminiPlaceholder')}
                                    className="flex-1"
                                    disabled={userKeysStatus.hasGemini}
                                    {...noAutofillProps('password')}
                                />
                                {!userKeysStatus.hasGemini ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => handleSaveUserKey('gemini')}
                                        disabled={!geminiKey}
                                    >
                                        <Plus className="size-4" />
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => handleDeleteUserKey('gemini')}
                                        className="text-red-600 hover:text-red-700"
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Info Box */}
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                            <p className="text-xs text-indigo-700">
                                <strong>{t('keysDialog.infoHow')}</strong>{' '}
                                {t('keysDialog.infoVisit')}{' '}
                                <a
                                    href="https://openrouter.ai"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                >
                                    openrouter.ai
                                </a>{' '}
                                {t('keysDialog.infoOr')}{' '}
                                <a
                                    href="https://aistudio.google.com/app/apikey"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                >
                                    {t('keysDialog.googleAiStudio')}
                                </a>
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <MyButton buttonType="primary" onClick={() => setShowKeysDialog(false)}>
                            {t('keysDialog.done')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirmation Dialog */}
            <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <DialogContent className="flex max-h-[90vh] w-[90vw] max-w-[900px] flex-col overflow-hidden p-0">
                    <DialogHeader className="shrink-0 border-b border-neutral-200 bg-white px-6 pb-4 pt-6">
                        <div className="mb-2 flex items-center gap-3">
                            <div className="flex size-10 items-center justify-center rounded-full bg-amber-100">
                                <AlertTriangle className="size-5 text-amber-600" />
                            </div>
                            <DialogTitle className="text-xl font-semibold text-neutral-900">
                                {t('confirmDialog.title')}
                            </DialogTitle>
                        </div>
                        <DialogDescription className="pt-2 text-sm text-neutral-600">
                            {t('confirmDialog.description')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="min-h-0 flex-1 overflow-y-auto px-6">
                        <div className="space-y-4 py-4">
                            <div>
                                <h4 className="mb-2 text-sm font-semibold text-neutral-900">
                                    {t('confirmDialog.courseGoal')}
                                </h4>
                                <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
                                    {courseGoal || t('confirmDialog.notProvided')}
                                </p>
                            </div>

                            {/* Source material — a silently missing source has
                                shipped an entirely AI-invented course, so this
                                is always stated, loudly when absent. */}
                            <div>
                                <h4 className="mb-2 text-sm font-semibold text-neutral-900">
                                    {t('confirmDialog.sourceMaterial')}
                                </h4>
                                {kbGrounding?.knowledge_base_id ? (
                                    <p className="rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
                                        {t('confirmDialog.sourceKb')}
                                    </p>
                                ) : referenceFiles.length > 0 ? (
                                    <p className="rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
                                        {t('confirmDialog.sourceFiles', {
                                            count: referenceFiles.length,
                                        })}
                                    </p>
                                ) : (
                                    <p className="rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                                        {t('confirmDialog.sourceNone')}
                                    </p>
                                )}
                            </div>

                            {learningOutcome && (
                                <div>
                                    <h4 className="mb-2 text-sm font-semibold text-neutral-900">
                                        {t('confirmDialog.learningOutcome')}
                                    </h4>
                                    <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
                                        {learningOutcome}
                                    </p>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                {skillLevel && (
                                    <div>
                                        <h4 className="mb-1 text-sm font-semibold text-neutral-900">
                                            {t('confirmDialog.skillLevel')}
                                        </h4>
                                        <p className="text-sm capitalize text-neutral-600">
                                            {instituteLevels.find((l) => l.id === skillLevel)
                                                ?.level_name || skillLevel}
                                        </p>
                                    </div>
                                )}
                                {numberOfSubjects && (
                                    <div>
                                        <h4 className="mb-1 text-sm font-semibold text-neutral-900">
                                            {t('confirmDialog.numberOf', {
                                                term: getTerminologyPlural(
                                                    ContentTerms.Subject,
                                                    SystemTerms.Subject
                                                ),
                                            })}
                                        </h4>
                                        <p className="text-sm text-neutral-600">
                                            {numberOfSubjects}
                                        </p>
                                    </div>
                                )}
                                {numberOfModules && (
                                    <div>
                                        <h4 className="mb-1 text-sm font-semibold text-neutral-900">
                                            {t('confirmDialog.numberOf', {
                                                term: getTerminologyPlural(
                                                    ContentTerms.Modules,
                                                    SystemTerms.Modules
                                                ),
                                            })}
                                        </h4>
                                        <p className="text-sm text-neutral-600">
                                            {numberOfModules}
                                        </p>
                                    </div>
                                )}
                                {kbBound && (
                                    <div>
                                        <h4 className="mb-1 text-sm font-semibold text-neutral-900">
                                            {t('confirmDialog.structure')}
                                        </h4>
                                        <p className="text-sm text-neutral-600">
                                            {t('confirmDialog.structureFollowsKbDetail', {
                                                chapter: getTerminology(
                                                    ContentTerms.Chapters,
                                                    SystemTerms.Chapters
                                                ).toLowerCase(),
                                                slides: getTerminologyPlural(
                                                    ContentTerms.Slides,
                                                    SystemTerms.Slides
                                                ).toLowerCase(),
                                            })}
                                        </p>
                                    </div>
                                )}
                                {!kbBound && numberOfChapters && (
                                    <div>
                                        <h4 className="mb-1 text-sm font-semibold text-neutral-900">
                                            {t('confirmDialog.numberOf', {
                                                term: getTerminologyPlural(
                                                    ContentTerms.Chapters,
                                                    SystemTerms.Chapters
                                                ),
                                            })}
                                        </h4>
                                        <p className="text-sm text-neutral-600">
                                            {numberOfChapters}
                                        </p>
                                    </div>
                                )}
                                {(chapterLength || customChapterLength) && (
                                    <div>
                                        <h4 className="mb-1 text-sm font-semibold text-neutral-900">
                                            {t('confirmDialog.courseLength')}
                                        </h4>
                                        <p className="text-sm text-neutral-600">
                                            {chapterLength === 'custom'
                                                ? t('confirmDialog.minutes', {
                                                      count: Number(customChapterLength) || 0,
                                                  })
                                                : chapterLength
                                                  ? t('confirmDialog.minutes', {
                                                        count: Number(chapterLength) || 0,
                                                    })
                                                  : ''}
                                        </p>
                                    </div>
                                )}
                                {!kbBound && slidesPerChapter && (
                                    <div>
                                        <h4 className="mb-1 text-sm font-semibold text-neutral-900">
                                            {t('confirmDialog.slidesPerChapter', {
                                                slides: getTerminologyPlural(
                                                    ContentTerms.Slides,
                                                    SystemTerms.Slides
                                                ),
                                                chapter: getTerminology(
                                                    ContentTerms.Chapters,
                                                    SystemTerms.Chapters
                                                ),
                                            })}
                                        </h4>
                                        <p className="text-sm text-neutral-600">
                                            {slidesPerChapter}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {activeContentOptions > 0 && (
                                <div>
                                    <h4 className="mb-2 text-sm font-semibold text-neutral-900">
                                        {t('confirmDialog.whatToInclude')}
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {includeDiagrams && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.diagrams')}
                                            </span>
                                        )}
                                        {includeCodeSnippets && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {programmingLanguage
                                                    ? t(
                                                          'confirmDialog.options.codeSnippetsWithLang',
                                                          { language: programmingLanguage }
                                                      )
                                                    : t('confirmDialog.options.codeSnippets')}
                                            </span>
                                        )}
                                        {includePracticeProblems && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.practiceProblems')}
                                            </span>
                                        )}
                                        {includeQuizzes && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.quizzes')}
                                            </span>
                                        )}
                                        {includeHomework && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.assignments')}
                                            </span>
                                        )}
                                        {includeSolutions && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.solutions')}
                                            </span>
                                        )}
                                        {includeYouTubeVideo && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.youtubeVideo')}
                                            </span>
                                        )}
                                        {includeAIGeneratedVideo && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.aiGeneratedVideo')}
                                            </span>
                                        )}
                                        {includeAISlides && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.aiSlides')}
                                            </span>
                                        )}
                                        {includeAIStorybook && (
                                            <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                                                {t('confirmDialog.options.aiStorybook')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {totalReferences > 0 && (
                                <div>
                                    <h4 className="mb-2 text-sm font-semibold text-neutral-900">
                                        {t('confirmDialog.references')}
                                    </h4>
                                    <div className="space-y-2">
                                        {referenceUrls.length > 0 && (
                                            <p className="text-sm text-neutral-600">
                                                {t('confirmDialog.urlsAdded', {
                                                    count: referenceUrls.length,
                                                })}
                                            </p>
                                        )}
                                        {referenceFiles.length > 0 && (
                                            <p className="text-sm text-neutral-600">
                                                {t('confirmDialog.filesUploaded', {
                                                    count: referenceFiles.length,
                                                })}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter className="shrink-0 gap-3 border-t border-neutral-200 bg-white px-6 py-4 sm:items-center">
                        <ToolCostBadge
                            credits={outlineCost.credits}
                            sufficient={outlineCost.sufficient}
                            coverage={outlineCost.coverage}
                            loading={outlineCost.isLoading}
                            className="max-sm:self-start sm:mr-auto"
                        />
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setShowConfirmDialog(false)}
                        >
                            {t('confirmDialog.goBack')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirmGenerate}
                            disabled={isUploadingReferences}
                        >
                            {isUploadingReferences
                                ? t('confirmDialog.uploadingReferences')
                                : t('confirmDialog.continue')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </LayoutContainer>
    );
}
