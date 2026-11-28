// Track B — per-recording "Add to course" inline panel, rendered inside the
// existing Recordings card row on the session view page. Lets the teacher
// pick destination chapter(s) for a recording in ≤3 clicks without leaving
// the page. See docs/LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md.

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CaretDown, CaretUp, FolderPlus } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';

import {
    useLinkSessionContent,
    useSessionContentLinks,
    summarizeContentLinkOutcomes,
    extractContentLinkErrorMessage,
} from '../../-services/content-link-service';
import {
    SessionContentDestinationPicker,
    type DestinationBatch,
    type DestinationPickerSubmitPayload,
} from './SessionContentDestinationPicker';
import { UnlinkContentLinkButton } from './UnlinkContentLinkButton';
import type { MeetingRecording } from '../../-services/utils';

interface Props {
    sessionId: string;
    scheduleId?: string;
    sessionTitle?: string;
    /** The recording row this panel is attached to (allRecordings entry). */
    recording: MeetingRecording & { date: string; scheduleId: string };
    batches: DestinationBatch[];
    /** True when this recording has no fileId/youtubeVideoUrl and is Zoom-cloud-only. */
    needsSaveToLibraryFirst: boolean;
    /** Save-to-S3 + refetch, reused from the page's existing handler. Resolves once the recording has a fileId. */
    onSaveToLibrary: () => Promise<void>;
    /**
     * When false, only the linked-chapter chips (with unlink) are rendered —
     * no manual "Add to course" action. Used when the institute has
     * auto-upload on but the manual add-to-course feature off.
     */
    showAddAction?: boolean;
}

export function AddRecordingToCourseCard({
    sessionId,
    scheduleId,
    sessionTitle,
    recording,
    batches,
    needsSaveToLibraryFirst,
    onSaveToLibrary,
    showAddAction = true,
}: Props) {
    const { t, i18n } = useTranslation('studyLibraryAddRecordingToCourseCard');
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState(() =>
        buildDefaultTitle(t, i18n.language, sessionTitle, recording.date)
    );
    const [isSyncing, setIsSyncing] = useState(false);

    const linksQuery = useSessionContentLinks(sessionId);
    const linkMutation = useLinkSessionContent();

    const linkedChapters = useMemo(
        () => (linksQuery.data ?? []).filter((l) => l.recording_id === recording.recordingId),
        [linksQuery.data, recording.recordingId]
    );

    const handleSubmit = async (payload: DestinationPickerSubmitPayload) => {
        try {
            let syncedFirst = false;
            if (needsSaveToLibraryFirst) {
                setIsSyncing(true);
                try {
                    await onSaveToLibrary();
                    syncedFirst = true;
                } finally {
                    setIsSyncing(false);
                }
            }

            const outcomes = await linkMutation.mutateAsync({
                session_id: sessionId,
                schedule_id: scheduleId,
                source: { kind: 'RECORDING', recording_id: recording.recordingId },
                title:
                    title.trim() ||
                    buildDefaultTitle(t, i18n.language, sessionTitle, recording.date),
                slide_status: payload.slideStatus,
                notify: payload.notify,
                position: payload.position,
                destinations: payload.destinations,
            });
            toast.success(summarizeContentLinkOutcomes(outcomes));
            setOpen(false);
            void syncedFirst; // informational only — no separate toast needed
        } catch (err) {
            const message = extractContentLinkErrorMessage(err);
            if (message?.toLowerCase().includes('save recording to library')) {
                toast.error(t('saveRecordingFirst'));
            } else {
                toast.error(message || t('couldNotAdd'));
            }
        }
    };

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="w-full">
            <div className="flex flex-wrap items-center gap-2">
                {showAddAction && (
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                            <FolderPlus className="size-3" />
                            {t('addToCourse')}
                            {open ? (
                                <CaretUp className="size-3" />
                            ) : (
                                <CaretDown className="size-3" />
                            )}
                        </button>
                    </CollapsibleTrigger>
                )}
                {linkedChapters.map((link) => (
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

            <CollapsibleContent className="mt-3 w-full">
                <div className={cn('flex flex-col gap-3 rounded-lg border bg-muted/20 p-3')}>
                    <MyInput
                        inputType="text"
                        label={t('titleLabel')}
                        input={title}
                        onChangeFunction={(e) => setTitle(e.target.value)}
                        size="large"
                        className="w-full sm:w-full"
                        required
                    />
                    <SessionContentDestinationPicker
                        batches={batches}
                        existingLinks={linksQuery.data}
                        onSubmit={handleSubmit}
                        isSubmitting={linkMutation.isPending || isSyncing}
                        submitDisabled={!title.trim()}
                        submitLabel={
                            isSyncing
                                ? t('savingEllipsis')
                                : needsSaveToLibraryFirst
                                  ? t('saveToLibraryAndAdd')
                                  : t('add')
                        }
                    />
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function buildDefaultTitle(
    t: TFunction,
    language: string,
    sessionTitle: string | undefined,
    date: string
): string {
    const label = sessionTitle?.trim() || t('sessionFallback');
    try {
        const formatted = new Date(date).toLocaleDateString(language, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
        return t('defaultTitle', { label, formatted });
    } catch {
        return t('defaultTitleNoDate', { label });
    }
}
