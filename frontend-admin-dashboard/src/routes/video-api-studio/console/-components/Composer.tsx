import { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@tanstack/react-router';
import {
    PaperPlaneRight as Send,
    Sparkle as Sparkles,
    ArrowRight,
    Eye,
    EyeSlash as EyeOff,
    Paperclip,
    CircleNotch as Loader2,
    FileText,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import { getInstituteId } from '@/constants/helper';
import {
    handleStartProcessUploadedFile,
    handleConvertPDFToHTML,
} from '@/routes/ai-center/-services/ai-center-service';
import {
    GenerateVideoRequest,
    ReferenceFile,
    RoutingPlan,
    RoutingOverrides,
    RoutingToolName,
    TtsVoice,
    fetchTtsVoices,
    fetchRoutePreview,
} from '../../-services/video-generation';
import {
    type VideoBrandingConfig,
    type VideoStyleConfig,
    type VideoTemplate,
    DEFAULT_VIDEO_BRANDING,
    DEFAULT_VIDEO_STYLE,
    fetchVideoBranding,
    fetchVideoStyle,
    fetchVideoTemplates,
} from '../../-services/video-style-branding';
import { useAIModelsList } from '@/hooks/useAiModels';
import { useAiCreditsQuery } from '@/services/ai-credits/get-ai-credits';
import { LatexRenderer } from '../../-components/LatexRenderer';
import { CostPreviewInline, CostPreviewModal, useCostPreview } from '../../-components/CostPreview';
import { ContextTray, AttachmentItem, IndexedVideoItem } from './ContextTray';
import { SettingsPopover } from './SettingsPopover';
import { SourceVideoPopover } from './SourceVideoPopover';

interface ComposerProps {
    onGenerate: (request: GenerateVideoRequest) => void;
    isGenerating: boolean;
    disabled?: boolean;
    prompt: string;
    onPromptChange: (value: string) => void;
    options: Omit<GenerateVideoRequest, 'prompt'>;
    onOptionsChange: (options: Omit<GenerateVideoRequest, 'prompt'>) => void;
    reviewModeEnabled?: boolean;
    onReviewModeChange?: (enabled: boolean) => void;
    apiKey?: string | null;
    /** Visual variant: hero (centered, large) or docked (compact, used post-completion). */
    variant?: 'hero' | 'docked';

    // Lifted state — owned by parent so it survives the unmount/remount during
    // generating / reviewing states.
    attachments: AttachmentItem[];
    onAttachmentsChange: React.Dispatch<React.SetStateAction<AttachmentItem[]>>;
    selectedInputVideoIds: string[];
    onSelectedInputVideoIdsChange: React.Dispatch<React.SetStateAction<string[]>>;
    inputVideoAudio: 'original' | 'tts';
    onInputVideoAudioChange: React.Dispatch<React.SetStateAction<'original' | 'tts'>>;
    muteTtsDuringSourceClips: boolean;
    onMuteTtsDuringSourceClipsChange: React.Dispatch<React.SetStateAction<boolean>>;
    ignoredUrls: Set<string>;
    onIgnoredUrlsChange: React.Dispatch<React.SetStateAction<Set<string>>>;
    routingOverrides: RoutingOverrides;
    onRoutingOverridesChange: React.Dispatch<React.SetStateAction<RoutingOverrides>>;
    /**
     * When true, the SettingsPopover swaps its free-form Style/Branding and
     * face-upload UI for vim-only saved-Brand-Kit and saved-Avatar pickers.
     * The submit guard also blocks generation when host is enabled without a
     * saved_avatar_id and links the user to the Avatars tab.
     */
    vimMode?: boolean;
}

// Set once the model saved by the retired tier auto-select has been cleared.
const MODEL_AUTOPICK_CLEARED_KEY = 'video-studio-model-autopick-cleared-v1';

export function Composer({
    onGenerate,
    isGenerating,
    disabled,
    prompt,
    onPromptChange,
    options,
    onOptionsChange,
    reviewModeEnabled,
    onReviewModeChange,
    apiKey,
    variant = 'hero',
    attachments,
    onAttachmentsChange,
    selectedInputVideoIds,
    onSelectedInputVideoIdsChange,
    inputVideoAudio,
    onInputVideoAudioChange,
    muteTtsDuringSourceClips,
    onMuteTtsDuringSourceClipsChange,
    ignoredUrls,
    onIgnoredUrlsChange,
    routingOverrides,
    onRoutingOverridesChange,
    vimMode = false,
}: ComposerProps) {
    const { t } = useTranslation('videoApiStudioComposer');
    const isDocked = variant === 'docked';
    const [showPreview, setShowPreview] = useState(false);
    const [isPdfProcessing, setIsPdfProcessing] = useState(false);
    const [confirmModalOpen, setConfirmModalOpen] = useState(false);
    const [pendingRequest, setPendingRequest] = useState<GenerateVideoRequest | null>(null);

    // TTS voice selection — local because the audio preview ref must not be lost
    // mid-playback and the voice list is keyed off (language, gender, provider).
    const [availableVoices, setAvailableVoices] = useState<TtsVoice[]>([]);
    const [isLoadingVoices, setIsLoadingVoices] = useState(false);
    const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);

    // Institute-wide style + branding. Initialized with defaults so the Settings
    // sheet always has a valid editing target, even before fetch resolves.
    const [videoStyle, setVideoStyle] = useState<VideoStyleConfig>(DEFAULT_VIDEO_STYLE);
    const [videoBranding, setVideoBranding] = useState<VideoBrandingConfig>(DEFAULT_VIDEO_BRANDING);
    const [videoTemplates, setVideoTemplates] = useState<VideoTemplate[]>([]);

    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

    // Smart Plan derived state — re-fetched on mount from prompt + overrides.
    const [routerPlan, setRouterPlan] = useState<RoutingPlan | null>(null);
    const [routerLoading, setRouterLoading] = useState(false);
    const [routerExplanationOpen, setRouterExplanationOpen] = useState(false);

    // Indexed input videos (catalog of completed source videos) — local because
    // it's just a server fetch tied to apiKey, not user-edited state.
    const [indexedVideos, setIndexedVideos] = useState<IndexedVideoItem[]>([]);
    const [processingVideos, setProcessingVideos] = useState<IndexedVideoItem[]>([]);

    // Track which video IDs were already complete so we can auto-add freshly
    // completed ones to the selection without re-adding existing ones.
    const prevCompletedIds = useRef<Set<string>>(new Set());

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    // LLMs tagged for the 'video' use-case only. Both filters are AND-ed
    // server-side so avatar/video-render providers (Kling, VEED Fabric, HeyGen, …)
    // — which share the 'video' use-case tag but live in non-'general' categories —
    // never reach the dropdown.
    const { data: modelsList } = useAIModelsList({ category: 'general', use_case: 'video' });
    const { uploadFile, getPublicUrl: getFilePublicUrl } = useFileUpload();
    const { data: credits } = useAiCreditsQuery();

    // Auto-grow textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
        }
    }, [prompt, showPreview]);

    // Refresh both completed + in-progress source videos.
    // Held in a ref so the polling effect can call the latest version without
    // re-creating its interval on every state update.
    const refreshInputVideos = useRef<() => void>();
    refreshInputVideos.current = () => {
        if (!apiKey) return;
        import('../../-services/input-asset').then(({ listInputAssets }) => {
            listInputAssets(apiKey)
                .then((assets) => {
                    const toItem = (a: {
                        id: string;
                        name: string;
                        kind: 'video' | 'image';
                        mode: string;
                        duration_seconds: number | null;
                        status: string;
                        progress: number;
                    }) => ({
                        id: a.id,
                        name: a.name,
                        kind: a.kind,
                        mode: a.mode,
                        duration_seconds: a.duration_seconds,
                        status: a.status,
                        progress: a.progress,
                    });
                    setIndexedVideos(assets.filter((a) => a.status === 'COMPLETED').map(toItem));
                    setProcessingVideos(
                        assets
                            .filter(
                                (a) =>
                                    a.status === 'QUEUED' ||
                                    a.status === 'PROCESSING' ||
                                    a.status === 'PENDING'
                            )
                            .map(toItem)
                    );
                })
                .catch(() => {});
        });
    };

    useEffect(() => {
        refreshInputVideos.current?.();
    }, [apiKey]);

    // Poll while indexing is in progress so the user sees status updates.
    useEffect(() => {
        if (processingVideos.length === 0) return;
        const timer = setInterval(() => {
            refreshInputVideos.current?.();
        }, 5000);
        return () => clearInterval(timer);
    }, [processingVideos.length]);

    // Auto-add newly completed assets to the selection (up to 10 max).
    useEffect(() => {
        const currentIds = new Set(indexedVideos.map((v) => v.id));
        for (const id of currentIds) {
            if (!prevCompletedIds.current.has(id) && prevCompletedIds.current.size > 0) {
                onSelectedInputVideoIdsChange((prev) => {
                    if (prev.includes(id) || prev.length >= MAX_INPUT_ASSETS) return prev;
                    const next = [...prev, id];
                    // Multi-source auto-forces TTS — original audio is single-clip only.
                    if (next.length > 1) onInputVideoAudioChange('tts');
                    return next;
                });
            }
        }
        prevCompletedIds.current = currentIds;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [indexedVideos]);

    // No model auto-select. `options.model` is a whole-run override, so it is
    // only sent when the user picks one in Settings; left empty, the BE
    // resolves every stage from the stage matrix (`ai_model_stage_assignments`)
    // for the chosen `quality_tier`. This used to pin the first model of the
    // tier, which overrode the matrix on every console video.
    //
    // Clean-up for options persisted by that old auto-select: a saved model is
    // cleared once per browser (a marker key records it, on the first render
    // whether or not a model is saved, so a later explicit pick survives), and
    // a model the registry no longer lists is dropped so a retired id is never
    // sent. vimMode never carries a model (VideoConsoleWorkspace strips it, P2-12).
    useEffect(() => {
        if (vimMode) return;
        let staleAutoPick = false;
        try {
            if (!localStorage.getItem(MODEL_AUTOPICK_CLEARED_KEY)) {
                localStorage.setItem(MODEL_AUTOPICK_CLEARED_KEY, '1');
                staleAutoPick = true;
            }
        } catch {
            // Storage blocked: skip the one-time clean-up.
        }
        if (!options.model) return;
        const available = modelsList?.models ?? [];
        const retired =
            available.length > 0 && !available.some((m) => m.model_id === options.model);
        if (staleAutoPick || retired) {
            onOptionsChange({ ...options, model: '' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modelsList, vimMode]);

    // Fetch video style + branding + templates (institute-wide config).
    useEffect(() => {
        const instituteId = getInstituteId();
        if (!instituteId) return;
        fetchVideoStyle(instituteId)
            .then(setVideoStyle)
            .catch((err) => console.error('Fetch video style failed', err));
        fetchVideoBranding(instituteId)
            .then(setVideoBranding)
            .catch((err) => console.error('Fetch video branding failed', err));
        fetchVideoTemplates()
            .then(setVideoTemplates)
            .catch((err) => console.error('Fetch video templates failed', err));
    }, []);

    // Fetch TTS voices when language/gender/provider changes
    useEffect(() => {
        setIsLoadingVoices(true);
        fetchTtsVoices(options.language, options.voice_gender, options.tts_provider)
            .then((res) => {
                setAvailableVoices(res.voices);
                if (options.voice_id && !res.voices.some((v) => v.id === options.voice_id)) {
                    onOptionsChange({ ...options, voice_id: undefined });
                }
            })
            .catch(() => setAvailableVoices([]))
            .finally(() => setIsLoadingVoices(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options.language, options.voice_gender, options.tts_provider]);

    // Cleanup audio preview on unmount
    useEffect(() => {
        return () => {
            if (previewAudioRef.current) {
                previewAudioRef.current.pause();
                previewAudioRef.current = null;
            }
        };
    }, []);

    const handlePlayPreview = (voice: TtsVoice) => {
        if (previewAudioRef.current) {
            previewAudioRef.current.pause();
            previewAudioRef.current = null;
        }
        if (playingVoiceId === voice.id) {
            setPlayingVoiceId(null);
            return;
        }
        const audio = new Audio(voice.sample_url);
        audio.onended = () => setPlayingVoiceId(null);
        audio.onerror = () => {
            setPlayingVoiceId(null);
            toast.error(t('toasts.sampleAudioUnavailable'));
        };
        audio.play().catch(() => {
            setPlayingVoiceId(null);
            toast.error(t('toasts.sampleAudioUnavailable'));
        });
        previewAudioRef.current = audio;
        setPlayingVoiceId(voice.id);
    };

    // Smart Plan: debounced fetch from /route-preview
    const trimmedPromptForRouting = prompt.trim();
    const inputVideoCount = selectedInputVideoIds.length;
    const attachedFileCount = attachments.length;
    useEffect(() => {
        if (!apiKey || trimmedPromptForRouting.length < 10) {
            setRouterPlan(null);
            setRouterLoading(false);
            return;
        }
        let cancelled = false;
        const handle = window.setTimeout(async () => {
            try {
                setRouterLoading(true);
                const plan = await fetchRoutePreview(apiKey, {
                    prompt: trimmedPromptForRouting,
                    input_video_count: inputVideoCount,
                    attached_file_count: attachedFileCount,
                    orientation: options.orientation,
                    content_type: options.content_type,
                });
                if (!cancelled) setRouterPlan(plan);
            } catch (err) {
                if (!cancelled) setRouterPlan(null);
                console.debug('[RoutePreview] failed', err);
            } finally {
                if (!cancelled) setRouterLoading(false);
            }
        }, 600);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [
        apiKey,
        trimmedPromptForRouting,
        inputVideoCount,
        attachedFileCount,
        options.orientation,
        options.content_type,
    ]);

    // Resolved view of router decisions + user overrides
    const isToolEnabled = (name: RoutingToolName): boolean => {
        const ovr = routingOverrides.tools?.[name];
        if (typeof ovr === 'boolean') return ovr;
        const plan = routerPlan?.tools?.find((tool) => tool.name === name);
        return !!plan?.enabled;
    };
    const isToolOverridden = (name: RoutingToolName): boolean =>
        typeof routingOverrides.tools?.[name] === 'boolean';
    const cfgValue = <K extends keyof RoutingPlan['config']>(
        key: K
    ): RoutingPlan['config'][K] | undefined => {
        const ovr = routingOverrides.config?.[key];
        if (ovr !== undefined) return ovr as RoutingPlan['config'][K];
        return routerPlan?.config?.[key];
    };
    const isCfgOverridden = (key: keyof RoutingPlan['config']): boolean =>
        routingOverrides.config?.[key] !== undefined;

    const toggleTool = (name: RoutingToolName) => {
        onRoutingOverridesChange((prev) => {
            const currentResolved = isToolEnabled(name);
            const newVal = !currentResolved;
            const planEnabled = !!routerPlan?.tools?.find((tool) => tool.name === name)?.enabled;
            const next = { ...prev, tools: { ...(prev.tools || {}) } };
            if (newVal === planEnabled) {
                delete next.tools![name];
            } else {
                next.tools![name] = newVal;
            }
            return next;
        });
    };
    const toggleMuteTtsCfg = () => {
        onRoutingOverridesChange((prev) => {
            const planVal = !!routerPlan?.config?.mute_tts_on_source_clips;
            const currentVal = cfgValue('mute_tts_on_source_clips');
            const newVal = !(currentVal ?? false);
            const next = { ...prev, config: { ...(prev.config || {}) } };
            if (newVal === planVal) {
                delete next.config!.mute_tts_on_source_clips;
            } else {
                next.config!.mute_tts_on_source_clips = newVal;
            }
            return next;
        });
    };
    const toggleOverlayCfg = () => {
        onRoutingOverridesChange((prev) => {
            const planVal = routerPlan?.config?.infographic_mode || 'side';
            const currentVal = cfgValue('infographic_mode') ?? 'side';
            const newVal: RoutingPlan['config']['infographic_mode'] =
                currentVal === 'overlay' ? 'side' : 'overlay';
            const next = { ...prev, config: { ...(prev.config || {}) } };
            if (newVal === planVal) {
                delete next.config!.infographic_mode;
            } else {
                next.config!.infographic_mode = newVal;
            }
            return next;
        });
    };

    // Detect URLs in the prompt — backend captures up to 2 of these as references
    const URL_REGEX = /https?:\/\/[^\s<>"'`)]+/g;
    const detectedUrls = useMemo<string[]>(() => {
        if (!prompt) return [];
        const found = prompt.match(URL_REGEX) || [];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const raw of found) {
            const u = raw.replace(/[.,;:!?)]+$/, '');
            if (!seen.has(u)) {
                seen.add(u);
                out.push(u);
            }
            if (out.length >= 2) break;
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prompt]);

    const buildRequest = (): GenerateVideoRequest => {
        const referenceFiles: ReferenceFile[] = attachments.map((a) => ({
            url: a.url,
            name: a.fileName,
            type: a.fileType,
        }));
        let outboundPrompt = prompt.trim();
        if (ignoredUrls.size > 0) {
            for (const u of ignoredUrls) {
                outboundPrompt = outboundPrompt
                    .split(u)
                    .join('')
                    .replace(/\s{2,}/g, ' ')
                    .trim();
            }
        }
        const hasRoutingOverrides =
            (routingOverrides.tools && Object.keys(routingOverrides.tools).length > 0) ||
            (routingOverrides.config && Object.keys(routingOverrides.config).length > 0);
        return {
            prompt: outboundPrompt,
            ...options,
            ...(referenceFiles.length > 0 ? { reference_files: referenceFiles } : {}),
            ...(selectedInputVideoIds.length > 0
                ? {
                      input_video_ids: selectedInputVideoIds,
                      input_video_audio: inputVideoAudio,
                      ...(inputVideoAudio === 'tts' && muteTtsDuringSourceClips
                          ? { mute_tts_on_source_clips: true }
                          : {}),
                  }
                : {}),
            ...(hasRoutingOverrides ? { routing_overrides: routingOverrides } : {}),
        };
    };

    // Vim contract: when host is enabled, the user must pick a saved avatar.
    // Vim has no free-form face-upload escape hatch — that's admin-only.
    // Surfaced as a disabled-state on the Send button (no toast-validate),
    // and as a backstop early-return inside handleSubmit for any code path
    // that bypasses the disabled button (e.g. keyboard shortcut races).
    const vimAvatarMissing =
        !!vimMode && options.host?.type === 'avatar' && !options.host?.avatar?.saved_avatar_id;

    const handleSubmit = () => {
        if (!prompt.trim() || isGenerating || disabled) return;
        if (vimAvatarMissing) {
            toast.error(t('toasts.hostMissingTitle'), {
                description: t('toasts.hostMissingDescription'),
            });
            return;
        }
        setPendingRequest(buildRequest());
        setConfirmModalOpen(true);
    };

    const costPreview = useCostPreview({
        apiKey,
        options,
        reviewMode: !!reviewModeEnabled,
        attachmentsCount: attachments.length,
    });

    const handleConfirmGenerate = () => {
        if (!pendingRequest) return;
        setConfirmModalOpen(false);
        const req = pendingRequest;
        setPendingRequest(null);
        onGenerate(req);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';

        setIsPdfProcessing(true);
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: getUserId(),
            });
            if (!fileId) throw new Error('Failed to upload PDF');

            const processResult = await handleStartProcessUploadedFile(fileId);
            const pdfId = processResult?.pdf_id;
            if (!pdfId) throw new Error('Failed to process PDF');

            const taskName = `Task_${new Date().toLocaleDateString('en-GB')}_${new Date().toLocaleTimeString('en-GB')}`;
            const htmlResult = await handleConvertPDFToHTML(pdfId, taskName);
            const html = htmlResult?.html;
            if (!html) throw new Error('Failed to extract content from PDF');

            onPromptChange(html);
            toast.success(t('toasts.pdfExtractSuccess'));
        } catch (error) {
            console.error('PDF upload error:', error);
            toast.error(t('toasts.pdfExtractFailed'));
        } finally {
            setIsPdfProcessing(false);
        }
    };

    const MAX_ATTACHMENTS = 10;
    // Mirrors the server caps (MAX_INPUT_ASSETS / MAX_INPUT_VIDEOS). Videos are
    // the expensive kind — a large download plus an index job each — while
    // images cost one metadata JSON, so a screenshot-led walkthrough is allowed
    // the wider ceiling. A flat cap of 5 here silently truncated exactly that.
    const MAX_INPUT_ASSETS = 20;
    const MAX_INPUT_VIDEOS = 5;
    const MAX_FILE_SIZE_MB = 50;
    const ACCEPTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
    const [isDraggingOver, setIsDraggingOver] = useState(false);

    const processFiles = async (fileList: File[]) => {
        if (fileList.length === 0) return;
        const validFiles = fileList.filter((f) => {
            const ext = f.name.split('.').pop()?.toLowerCase() || '';
            return ACCEPTED_EXTENSIONS.includes(ext);
        });
        if (validFiles.length < fileList.length) {
            const rejected = fileList.length - validFiles.length;
            toast.warning(t('toasts.filesSkipped', { count: rejected }));
        }
        if (validFiles.length === 0) return;

        const remaining = MAX_ATTACHMENTS - attachments.length;
        if (remaining <= 0) {
            toast.error(t('toasts.maxFilesAllowed', { count: MAX_ATTACHMENTS }));
            return;
        }

        const filesToProcess = validFiles.slice(0, remaining);
        setIsUploadingAttachment(true);
        let successCount = 0;
        let failCount = 0;

        try {
            for (const file of filesToProcess) {
                if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
                    toast.error(
                        t('toasts.fileSizeExceeded', {
                            fileName: file.name,
                            maxSizeMb: MAX_FILE_SIZE_MB,
                        })
                    );
                    failCount++;
                    continue;
                }
                const ext = file.name.split('.').pop()?.toLowerCase() || '';
                const fileType: 'image' | 'pdf' = ext === 'pdf' ? 'pdf' : 'image';
                try {
                    const fileId = await uploadFile({
                        file,
                        setIsUploading: () => {},
                        userId: getUserId(),
                        source: 'AI_VIDEO_REFERENCE',
                        sourceId: 'ADMIN',
                        publicUrl: true,
                    });
                    if (!fileId) {
                        failCount++;
                        continue;
                    }
                    const url = await getFilePublicUrl(fileId);
                    if (!url) {
                        failCount++;
                        continue;
                    }
                    const previewUrl = fileType === 'image' ? URL.createObjectURL(file) : undefined;
                    onAttachmentsChange((prev) => [
                        ...prev,
                        { fileId, fileName: file.name, fileType, url, previewUrl },
                    ]);
                    successCount++;
                } catch {
                    failCount++;
                }
            }

            if (successCount > 0 && failCount === 0) {
                toast.success(t('toasts.filesAttached', { count: successCount }));
            } else if (successCount > 0 && failCount > 0) {
                toast.warning(
                    t('toasts.filesAttachedPartial', { success: successCount, failed: failCount })
                );
            } else if (failCount > 0) {
                toast.error(t('toasts.filesUploadFailed', { count: failCount }));
            }
        } catch (error) {
            console.error('Attachment upload error:', error);
            toast.error(t('toasts.attachmentsUploadFailed'));
        } finally {
            setIsUploadingAttachment(false);
        }
    };

    const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (files.length === 0) return;
        await processFiles(files);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            setIsDraggingOver(true);
        }
    };
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
    };
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        if (isGenerating || disabled || isUploadingAttachment) return;
        const files = Array.from(e.dataTransfer.files);
        await processFiles(files);
    };

    const removeAttachment = (fileId: string) => {
        onAttachmentsChange((prev) => {
            const removed = prev.find((a) => a.fileId === fileId);
            if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
            return prev.filter((a) => a.fileId !== fileId);
        });
    };

    const removeInputVideo = (id: string) => {
        onSelectedInputVideoIdsChange((prev) => prev.filter((x) => x !== id));
    };

    const setUrlIgnored = (url: string, ignored: boolean) => {
        onIgnoredUrlsChange((prev) => {
            const next = new Set(prev);
            if (ignored) next.add(url);
            else next.delete(url);
            return next;
        });
    };

    const models = modelsList?.models ?? [];

    return (
        <div className="w-full">
            {/* Outer card — slimmer in docked variant (no big footer below) */}
            <div
                className={`relative space-y-1.5 border bg-background transition-all focus-within:border-ring/40 focus-within:shadow-md ${
                    isDocked ? 'rounded-xl p-1.5 shadow-none' : 'rounded-2xl p-2 shadow-sm'
                } ${isDraggingOver ? 'border-blue-400 bg-blue-50/40 ring-1 ring-blue-300' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {/* Drag overlay */}
                {isDraggingOver && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50/80">
                        <div className="flex flex-col items-center gap-1 text-blue-600">
                            <Paperclip className="size-5" />
                            <span className="text-xs font-medium">{t('dropzone.hint')}</span>
                        </div>
                    </div>
                )}

                {/* Context tray (compact strip; hidden when nothing active) */}
                <ContextTray
                    attachments={attachments}
                    onRemoveAttachment={removeAttachment}
                    selectedInputVideoIds={selectedInputVideoIds}
                    indexedVideos={indexedVideos}
                    onRemoveInputVideo={removeInputVideo}
                    inputVideoAudio={inputVideoAudio}
                    onInputVideoAudioChange={(mode) => {
                        // With multiple sources, original audio isn't meaningful;
                        // keep TTS to avoid an inconsistent submit payload.
                        if (mode === 'original' && selectedInputVideoIds.length > 1) return;
                        onInputVideoAudioChange(mode);
                    }}
                    muteTtsDuringSourceClips={muteTtsDuringSourceClips}
                    onMuteTtsDuringSourceClipsChange={onMuteTtsDuringSourceClipsChange}
                    routerPlan={routerPlan}
                    routerLoading={routerLoading}
                    isToolEnabled={isToolEnabled}
                    isToolOverridden={isToolOverridden}
                    onToggleTool={toggleTool}
                    cfgValue={(key) => {
                        const v = cfgValue(key);
                        if (key === 'infographic_mode') {
                            return (v === 'overlay' ? 'overlay' : 'side') as never;
                        }
                        return (v ?? false) as never;
                    }}
                    isCfgOverridden={isCfgOverridden}
                    onToggleMuteTtsCfg={toggleMuteTtsCfg}
                    onToggleOverlayCfg={toggleOverlayCfg}
                    routerExplanationOpen={routerExplanationOpen}
                    onToggleRouterExplanation={() => setRouterExplanationOpen((v) => !v)}
                    detectedUrls={detectedUrls}
                    ignoredUrls={ignoredUrls}
                    onSetUrlIgnored={setUrlIgnored}
                />

                {/* Textarea / preview row */}
                <div data-tour="vim-composer-prompt" className="px-1.5">
                    {showPreview ? (
                        <div className="max-h-60 min-h-11 overflow-y-auto py-2">
                            {prompt ? (
                                <LatexRenderer
                                    text={prompt}
                                    className="whitespace-pre-wrap text-sm leading-relaxed"
                                />
                            ) : (
                                <span className="italic text-muted-foreground">
                                    {t('preview.empty')}
                                </span>
                            )}
                        </div>
                    ) : (
                        <Textarea
                            ref={textareaRef}
                            value={prompt}
                            onChange={(e) => onPromptChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('textarea.placeholder')}
                            className="max-h-60 min-h-11 resize-none border-0 bg-transparent p-0 text-sm placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
                            disabled={isGenerating || disabled}
                            rows={1}
                        />
                    )}
                </div>

                {/* Bottom action row */}
                <div className="flex items-center gap-1.5 px-1">
                    {/* Hidden file inputs */}
                    <input
                        ref={pdfInputRef}
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={handlePdfUpload}
                        disabled={isPdfProcessing || isGenerating || disabled}
                    />
                    <input
                        ref={attachmentInputRef}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        multiple
                        className="hidden"
                        onChange={handleAttachmentUpload}
                        disabled={isUploadingAttachment || isGenerating || disabled}
                    />

                    {/* Attach */}
                    <Button
                        variant="ghost"
                        size="icon"
                        data-tour="vim-composer-attach"
                        className="size-8 text-muted-foreground hover:text-blue-600"
                        onClick={() => attachmentInputRef.current?.click()}
                        disabled={isUploadingAttachment || isGenerating || disabled}
                        title={t('attach.title')}
                        aria-label={t('attach.ariaLabel')}
                    >
                        {isUploadingAttachment ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Paperclip className="size-4" />
                        )}
                    </Button>

                    {/* PDF → prompt */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-orange-600"
                        onClick={() => pdfInputRef.current?.click()}
                        disabled={isPdfProcessing || isGenerating || disabled}
                        title={t('pdfExtract.title')}
                        aria-label={t('pdfExtract.ariaLabel')}
                    >
                        {isPdfProcessing ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <FileText className="size-4" />
                        )}
                    </Button>

                    {/* Source video clips — separate popover with upload + selection. */}
                    <div data-tour="vim-composer-source-video" className="relative">
                        <SourceVideoPopover
                            apiKey={apiKey}
                            indexedVideos={indexedVideos}
                            processingVideos={processingVideos}
                            selectedIds={selectedInputVideoIds}
                            onAddVideo={(id) => {
                                onSelectedInputVideoIdsChange((prev) => {
                                    if (prev.includes(id) || prev.length >= MAX_INPUT_ASSETS)
                                        return prev;
                                    const isVideo =
                                        indexedVideos.find((v) => v.id === id)?.kind !== 'image';
                                    if (isVideo) {
                                        const videoCount = prev.filter(
                                            (p) =>
                                                indexedVideos.find((v) => v.id === p)?.kind !==
                                                'image'
                                        ).length;
                                        if (videoCount >= MAX_INPUT_VIDEOS) return prev;
                                    }
                                    const next = [...prev, id];
                                    if (next.length > 1) onInputVideoAudioChange('tts');
                                    return next;
                                });
                            }}
                            onRefresh={() => refreshInputVideos.current?.()}
                            disabled={isGenerating || disabled}
                        />
                    </div>

                    {/* Preview toggle */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-violet-600"
                        onClick={() => setShowPreview(!showPreview)}
                        title={t('previewToggle.title')}
                        aria-label={t('previewToggle.ariaLabel')}
                    >
                        {showPreview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>

                    <div className="ml-auto flex items-center gap-1.5">
                        {/* Active-settings chips — settings silently reset (new browser,
                            "Reuse settings" handoff) have shipped wrong requests before;
                            surface the load-bearing ones right next to Send. */}
                        {(options.dialogue_scenes_enabled || options.target_duration) && (
                            <div className="hidden items-center gap-1 sm:flex">
                                {options.dialogue_scenes_enabled && (
                                    <span
                                        className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700"
                                        title={t('dialogueChip.title')}
                                    >
                                        {(options.dialogue_mode ?? 'storybook') === 'drama'
                                            ? t('dialogueChip.modeDrama')
                                            : t('dialogueChip.modeStorybook')}
                                        {' · '}
                                        {(options.dialogue_clip_model ?? 'seedance-2.0') ===
                                        'omni-flash'
                                            ? t('dialogueChip.modelOmni')
                                            : t('dialogueChip.modelSeedance')}
                                    </span>
                                )}
                                {options.target_duration && (
                                    <span
                                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                                        title={t('durationChip.title')}
                                    >
                                        {options.target_duration}
                                    </span>
                                )}
                            </div>
                        )}
                        {/* Settings popover */}
                        <div data-tour="vim-composer-settings">
                            <SettingsPopover
                                apiKey={apiKey}
                                options={options}
                                onOptionsChange={onOptionsChange}
                                reviewModeEnabled={reviewModeEnabled}
                                onReviewModeChange={onReviewModeChange}
                                availableVoices={availableVoices}
                                isLoadingVoices={isLoadingVoices}
                                playingVoiceId={playingVoiceId}
                                onPlayPreview={handlePlayPreview}
                                videoStyle={videoStyle}
                                onVideoStyleChange={setVideoStyle}
                                videoBranding={videoBranding}
                                onVideoBrandingChange={setVideoBranding}
                                videoTemplates={videoTemplates}
                                models={models}
                                vimMode={vimMode}
                            />
                        </div>

                        {/* Send */}
                        <Button
                            onClick={handleSubmit}
                            disabled={
                                !prompt.trim() ||
                                isGenerating ||
                                disabled ||
                                showPreview ||
                                vimAvatarMissing
                            }
                            size="icon"
                            data-tour="vim-composer-send"
                            className="size-9 rounded-md shadow-sm"
                            title={
                                vimAvatarMissing
                                    ? t('send.titleAvatarMissing')
                                    : t('send.titleReady')
                            }
                            aria-label={
                                vimAvatarMissing ? t('send.ariaAvatarMissing') : t('send.ariaReady')
                            }
                        >
                            <Send className="size-4" />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Footer: course CTA + cost preview share one line.
                In the docked variant the composer sits under VideoResult, so
                we suppress the upsell link and only keep the cost summary. */}
            {isDocked ? (
                (costPreview.data || costPreview.loading) && (
                    <div className="mt-1 flex justify-end px-2 pb-0.5">
                        <CostPreviewInline data={costPreview.data} loading={costPreview.loading} />
                    </div>
                )
            ) : (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-2 pb-1">
                    <Link
                        to="/study-library/ai-copilot"
                        className="group flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-violet-600"
                    >
                        <Sparkles className="size-3 transition-colors group-hover:text-violet-600" />
                        <span>{t('footer.courseCta')}</span>
                        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                    <div className="flex items-center gap-2">
                        {credits && (
                            <span className="text-2xs tabular-nums text-muted-foreground">
                                {t('footer.credits', {
                                    count: parseFloat(credits.current_balance),
                                    value: parseFloat(credits.current_balance).toFixed(1),
                                })}
                            </span>
                        )}
                        <CostPreviewInline data={costPreview.data} loading={costPreview.loading} />
                    </div>
                </div>
            )}

            <CostPreviewModal
                open={confirmModalOpen}
                onOpenChange={(v) => {
                    setConfirmModalOpen(v);
                    if (!v) setPendingRequest(null);
                }}
                data={costPreview.data}
                loading={costPreview.loading}
                error={costPreview.error}
                onConfirm={handleConfirmGenerate}
                savedAvatarId={options.host?.avatar?.saved_avatar_id}
            />
        </div>
    );
}
