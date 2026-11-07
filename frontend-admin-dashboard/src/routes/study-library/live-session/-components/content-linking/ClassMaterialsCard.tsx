// Track B — "Class Materials" card on the session view page: lets the teacher
// upload a PDF or a video (file upload or YouTube link) and push it straight
// into one or more course chapters, always visible (not tied to a recording).
// See docs/LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md, "Track B".

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import {
    FilePdf,
    VideoCamera as Video,
    UploadSimple,
    YoutubeLogo,
    Notebook,
} from '@phosphor-icons/react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';

import { getInstituteId } from '@/constants/helper';
import { UploadFileInS3 } from '@/services/upload_file';
import {
    useLinkSessionContent,
    useSessionContentLinks,
    summarizeContentLinkOutcomes,
    extractContentLinkErrorMessage,
    type ContentLinkSourceKind,
} from '../../-services/content-link-service';
import {
    SessionContentDestinationPicker,
    type DestinationBatch,
    type DestinationPickerSubmitPayload,
} from './SessionContentDestinationPicker';
import { UnlinkContentLinkButton } from './UnlinkContentLinkButton';

interface Props {
    sessionId: string;
    scheduleId?: string;
    sessionTitle?: string;
    batches: DestinationBatch[];
}

type PanelMode = null | 'PDF' | 'VIDEO';
type VideoTab = 'UPLOAD' | 'YOUTUBE';

const isLikelyYoutubeUrl = (url: string) =>
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url.trim());

export function ClassMaterialsCard({ sessionId, scheduleId, sessionTitle, batches }: Props) {
    const { t, i18n } = useTranslation('studyLibraryClassMaterialsCard');
    const [panel, setPanel] = useState<PanelMode>(null);
    const [videoTab, setVideoTab] = useState<VideoTab>('UPLOAD');
    const [title, setTitle] = useState(() =>
        buildDefaultTitle(t, i18n.language, sessionTitle)
    );
    const [youtubeUrl, setYoutubeUrl] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const linksQuery = useSessionContentLinks(sessionId);
    const linkMutation = useLinkSessionContent();

    const materialLinks = useMemo(
        () =>
            (linksQuery.data ?? []).filter(
                (l) => l.content_type === 'MATERIAL_PDF' || l.content_type === 'MATERIAL_VIDEO'
            ),
        [linksQuery.data]
    );

    const openPanel = (mode: PanelMode) => {
        setPanel(mode);
        setTitle(buildDefaultTitle(t, i18n.language, sessionTitle));
        setYoutubeUrl('');
        setSelectedFile(null);
        setVideoTab('UPLOAD');
    };

    const acceptType = panel === 'PDF' ? 'application/pdf' : 'video/*';
    const youtubeValid = videoTab === 'YOUTUBE' ? isLikelyYoutubeUrl(youtubeUrl) : true;
    const fileReady = panel === 'PDF' ? !!selectedFile : videoTab === 'UPLOAD' ? !!selectedFile : true;
    const canSubmitContent = !!title.trim() && fileReady && youtubeValid;

    const handleSubmit = async (payload: DestinationPickerSubmitPayload) => {
        const instituteId = getInstituteId();
        if (!instituteId) {
            toast.error(t('couldNotResolveInstitute'));
            return;
        }

        try {
            let sourceKind: ContentLinkSourceKind;
            let fileId: string | undefined;
            let url: string | undefined;

            if (panel === 'PDF') {
                sourceKind = 'UPLOAD_PDF';
                setIsUploading(true);
                fileId = await UploadFileInS3(
                    selectedFile ?? undefined,
                    setIsUploading,
                    instituteId,
                    'PDF_DOCUMENTS',
                    undefined,
                    false
                );
                if (!fileId) throw new Error(t('couldNotUploadPdf'));
            } else if (videoTab === 'UPLOAD') {
                sourceKind = 'UPLOAD_VIDEO';
                setIsUploading(true);
                fileId = await UploadFileInS3(
                    selectedFile ?? undefined,
                    setIsUploading,
                    instituteId,
                    'VIDEO_DOCUMENTS',
                    undefined,
                    false
                );
                if (!fileId) throw new Error(t('couldNotUploadVideo'));
            } else {
                sourceKind = 'YOUTUBE';
                url = youtubeUrl.trim();
            }

            const outcomes = await linkMutation.mutateAsync({
                session_id: sessionId,
                schedule_id: scheduleId,
                source: { kind: sourceKind, file_id: fileId, url },
                title: title.trim() || buildDefaultTitle(t, i18n.language, sessionTitle),
                slide_status: payload.slideStatus,
                notify: payload.notify,
                position: payload.position,
                destinations: payload.destinations,
            });
            toast.success(summarizeContentLinkOutcomes(outcomes));
            openPanel(null);
        } catch (err) {
            const message = extractContentLinkErrorMessage(err);
            toast.error(message || (err instanceof Error ? err.message : t('couldNotAddMaterial')));
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Card className="flex flex-col overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="bg-muted/40 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex min-w-0 items-center gap-3 text-lg font-semibold">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 shadow-sm">
                            <Notebook className="size-5" />
                        </div>
                        {/* Wraps rather than truncates: at a 1280px window this
                            card is ~225px and the heading needs every pixel of
                            it — "Class Materials" clipped to "Class Materia…"
                            reads as a bug, two lines does not. */}
                        <span className="break-words">{t('classMaterials')}</span>
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => openPanel(panel === 'PDF' ? null : 'PDF')}
                            className={cn(
                                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted',
                                panel === 'PDF' && 'border-primary-400 bg-primary-50 text-primary-700'
                            )}
                        >
                            <FilePdf className="size-3" />
                            {t('uploadPdf')}
                        </button>
                        <button
                            type="button"
                            onClick={() => openPanel(panel === 'VIDEO' ? null : 'VIDEO')}
                            className={cn(
                                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted',
                                panel === 'VIDEO' && 'border-primary-400 bg-primary-50 text-primary-700'
                            )}
                        >
                            <Video className="size-3" />
                            {t('addVideo')}
                        </button>
                    </div>
                </div>
            </CardHeader>
            <Separator />
            <CardContent className="flex flex-1 flex-col gap-3 p-4 sm:p-6">
                {materialLinks.length === 0 && !panel && (
                    <p className="flex flex-1 items-center justify-center text-center text-xs text-muted-foreground">
                        {t('noMaterialsYet')}
                    </p>
                )}

                {materialLinks.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {materialLinks.map((link) => (
                            <UnlinkContentLinkButton
                                key={link.id}
                                linkId={link.id}
                                chapterName={link.chapter_name}
                                slideTitle={link.slide_title}
                                contentType={link.content_type}
                                batchName={
                                    batches.find(
                                        (b) => b.packageSessionId === link.package_session_id
                                    )?.displayName
                                }
                            />
                        ))}
                    </div>
                )}

                {panel && (
                    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
                        <MyInput
                            inputType="text"
                            label={t('titleLabel')}
                            input={title}
                            onChangeFunction={(e) => setTitle(e.target.value)}
                            size="large"
                            className="w-full sm:w-full"
                            required
                        />

                        {panel === 'VIDEO' && (
                            <div className="flex gap-2">
                                <TabButton
                                    active={videoTab === 'UPLOAD'}
                                    label={t('uploadFile')}
                                    icon={<UploadSimple className="size-3.5" />}
                                    onClick={() => setVideoTab('UPLOAD')}
                                />
                                <TabButton
                                    active={videoTab === 'YOUTUBE'}
                                    label={t('youtubeUrl')}
                                    icon={<YoutubeLogo className="size-3.5" />}
                                    onClick={() => setVideoTab('YOUTUBE')}
                                />
                            </div>
                        )}

                        {(panel === 'PDF' || (panel === 'VIDEO' && videoTab === 'UPLOAD')) && (
                            <div className="flex flex-col gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={acceptType}
                                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                                    className="text-xs text-neutral-600 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-medium"
                                />
                                {selectedFile && (
                                    <p className="text-xs text-neutral-500">
                                        {selectedFile.name} · {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                                    </p>
                                )}
                            </div>
                        )}

                        {panel === 'VIDEO' && videoTab === 'YOUTUBE' && (
                            <MyInput
                                inputType="text"
                                label={t('youtubeUrl')}
                                inputPlaceholder="https://www.youtube.com/watch?v=..."
                                input={youtubeUrl}
                                onChangeFunction={(e) => setYoutubeUrl(e.target.value)}
                                size="large"
                                className="w-full sm:w-full"
                                error={youtubeUrl.trim() && !youtubeValid ? t('invalidYoutubeUrl') : undefined}
                                required
                            />
                        )}

                        <SessionContentDestinationPicker
                            batches={batches}
                            existingLinks={linksQuery.data}
                            onSubmit={handleSubmit}
                            isSubmitting={linkMutation.isPending || isUploading}
                            submitDisabled={!canSubmitContent}
                            submitLabel={isUploading ? t('uploadingEllipsis') : t('add')}
                        />

                        <div className="flex justify-end">
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={() => openPanel(null)}
                            >
                                {t('cancel')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function TabButton({
    active,
    label,
    icon,
    onClick,
}: {
    active: boolean;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                active
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-300'
            )}
        >
            {icon}
            {label}
        </button>
    );
}

function buildDefaultTitle(t: TFunction, language: string, sessionTitle: string | undefined): string {
    const label = sessionTitle?.trim() || t('sessionFallback');
    const formatted = new Date().toLocaleDateString(language, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
    return t('defaultTitle', { label, formatted });
}
