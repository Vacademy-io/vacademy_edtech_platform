/* eslint-disable tailwindcss/no-custom-classname */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
import { MyButton } from '@/components/design-system/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { Separator } from '@radix-ui/react-separator';
import { Controller, FieldErrors, FormProvider, useForm, useWatch } from 'react-hook-form';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { z } from 'zod';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { useFilterDataForAssesment } from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { MyRadioButton } from '@/components/design-system/radio';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    RecurringType,
    SessionPlatform,
    SessionType,
    StreamingPlatform,
    WaitingRoomType,
} from '../../-constants/enums';
import { WEEK_DAYS } from '../../-constants/type';
import { sessionFormSchema } from '../-schema/schema';
import { Trash, UploadSimple, X, Plus, Copy, Eye, MusicNote } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
// import { MeetLogo, YoutubeLogo, ZoomLogo } from '@/svgs';
import { transformFormToDTOStep1, timeOptions } from '../../-constants/helper';
import { createLiveSessionStep1 } from '../-services/utils';
import { useNavigate } from '@tanstack/react-router';
import { useLiveSessionStore } from '../-store/sessionIdstore';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { XCircle } from '@phosphor-icons/react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useSessionDetailsStore } from '../../-store/useSessionDetailsStore';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { format } from 'date-fns';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import {
    buildTimezoneOptions,
    buildStreamingOptions,
    buildWaitingRoomOptions,
    buildWaitingRoomTypeOptions,
} from '../-constants/options';
import {
    normalizeTimezone,
    getBrowserTimezone as getNormalizedBrowserTimezone,
    FALLBACK_TIMEZONE,
} from '@/utils/timezone';
import { DefaultClassLinkInput } from './DefaultClassLinkInput';
import { LearnerButtonConfigInput } from './LearnerButtonConfigInput';
import { ScrollArea } from '@radix-ui/react-scroll-area';
import { LiveClassLinkField } from './LiveClassLinkField';
import { ZoomMeetingConfigField } from './ZoomMeetingConfigField';
import { GoogleMeetConfigField } from './GoogleMeetConfigField';
import {
    CalendarBlank,
    Info,
    Clock,
    Globe,
    Link as LinkIcon,
    VideoCamera,
    ChatTeardrop,
    UsersThree,
    ArrowsClockwise,
    CursorClick,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';
import type { PlatformKey } from '@/services/live-session-settings';
import { SectionCard } from './SectionCard';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// Default feedback questions configuration
const buildDefaultFeedbackQuestions = (t: TFunction) => [
    {
        id: 'rating',
        type: 'star_rating',
        label: t('feedback.defaultQuestions.rating'),
        enabled: true,
        mandatory: true,
        max_stars: 5,
        allow_half: true,
    },
    {
        id: 'learnings',
        type: 'free_text',
        label: t('feedback.defaultQuestions.learnings'),
        enabled: true,
        mandatory: false,
    },
    {
        id: 'doubts',
        type: 'free_text',
        label: t('feedback.defaultQuestions.doubts'),
        enabled: true,
        mandatory: false,
    },
    {
        id: 'feedback',
        type: 'free_text',
        label: t('feedback.defaultQuestions.feedback'),
        enabled: true,
        mandatory: false,
    },
];

export default function ScheduleStep1() {
    // Hooks and State
    const { t } = useTranslation(['studyLibraryScheduleStep1', 'studyLibraryOptions']);
    const TIMEZONE_OPTIONS = buildTimezoneOptions(t);
    const STREAMING_OPTIONS = buildStreamingOptions(t);
    const WAITING_ROOM_OPTIONS = buildWaitingRoomOptions(t);
    const WAITING_ROOM_TYPE_OPTIONS = buildWaitingRoomTypeOptions(t);
    const navigate = useNavigate();
    const { setSessionId, step1Data, setStep1Data, sessionId, isEdit, clearBulkSessionIds } =
        useLiveSessionStore();
    // Institute-level live-session feature flags. Defaults are all-on, so
    // existing institutes see no behavioural change until an admin opens the
    // settings tab and turns something off.
    const { settings: liveSessionSettings } = useLiveSessionSettings();

    // Bulk lives on its own route now; clear any stale bulk ids that might
    // remain from a prior bulk run so step 2 from this single-class flow
    // doesn't accidentally fan out.
    useEffect(() => {
        clearBulkSessionIds();
    }, [clearBulkSessionIds]);

    // If single-class scheduling is disabled by settings but bulk is enabled,
    // bounce the admin to the bulk page since they can't use this one.
    useEffect(() => {
        if (
            !liveSessionSettings.singleScheduleEnabled &&
            liveSessionSettings.bulkScheduleEnabled &&
            !isEdit
        ) {
            navigate({ to: '/study-library/live-session/schedule/bulk' });
        }
    }, [
        liveSessionSettings.singleScheduleEnabled,
        liveSessionSettings.bulkScheduleEnabled,
        isEdit,
        navigate,
    ]);

    // Filter the streaming-platform dropdown by institute allow-list. The
    // edit-mode preservation (if a previously-allowed platform got disabled
    // later, keep it in the option list so the existing session's dropdown
    // still reflects its actual value) is applied further down where
    // `sessionPlatformWatch` is in scope.
    const filteredStreamingOptions = useMemo(
        () =>
            STREAMING_OPTIONS.filter(
                (opt) =>
                    liveSessionSettings.allowedPlatforms[opt.value as PlatformKey] !== false
            ),
        [liveSessionSettings.allowedPlatforms, STREAMING_OPTIONS]
    );
    const { sessionDetails } = useSessionDetailsStore();
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedMusicFile, setSelectedMusicFile] = useState<File | null>(null);
    const [existingThumbnailId, setExistingThumbnailId] = useState<string | null>(null);
    // Cover image — rendered as the hero background of the public registration
    // page (and the waiting-room fallback backdrop).
    const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
    const [existingCoverId, setExistingCoverId] = useState<string | null>(null);
    const coverFileInputRef = useRef<HTMLInputElement>(null);
    const [existingMusicId, setExistingMusicId] = useState<string | null>(null);
    const musicFileInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // State for session thumbnails - Map<"dayIndex-sessionIndex", File>
    const [sessionThumbnails, setSessionThumbnails] = useState<Map<string, File>>(new Map());
    const [scheduleType, setScheduleType] = useState<
        'everyday' | 'weekday' | 'exceptSunday' | 'custom' | null
    >(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFormInitialized, setIsFormInitialized] = useState(false);
    const [isLoadingEditData, setIsLoadingEditData] = useState(false);
    // Ref to track if we're in edit mode - this should NEVER change during component lifecycle
    const isEditModeRef = useRef<boolean>(false);
    // State for default link copy dialog
    const [isDefaultLinkDialogOpen, setIsDefaultLinkDialogOpen] = useState(false);
    const [pendingDefaultLink, setPendingDefaultLink] = useState<string>('');
    const [selectedDaysForLink, setSelectedDaysForLink] = useState<string[]>([]);
    // State for copy to days dialog
    const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
    const [copySourceSession, setCopySourceSession] = useState<{
        dayIndex: number;
        sessionIndex: number;
    } | null>(null);
    const [selectedDaysToCopy, setSelectedDaysToCopy] = useState<number[]>([]);
    // State for copy default link dialog
    const [isCopyDefaultLinkDialogOpen, setIsCopyDefaultLinkDialogOpen] = useState(false);
    const [copySourceDefaultLink, setCopySourceDefaultLink] = useState<{
        dayIndex: number;
    } | null>(null);
    const [selectedDaysToCopyDefaultLink, setSelectedDaysToCopyDefaultLink] = useState<number[]>([]);

    // State for link update confirmation
    const [isLinkUpdateDialogOpen, setIsLinkUpdateDialogOpen] = useState(false);
    const [pendingSubmitData, setPendingSubmitData] = useState<z.infer<typeof sessionFormSchema> | null>(null);
    const [changedDayLabel, setChangedDayLabel] = useState<string>('');
    // State to store recurrence scope selected via Apply button (used when Next is clicked)
    const [pendingRecurrenceScope, setPendingRecurrenceScope] = useState<
        'ONLY_THIS' | 'ALL_FUTURE' | 'CURRENT_DAY_ALL_SESSIONS' | 'ALL_FUTURE_ALL_SESSIONS' | null
    >(null);

    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { SubjectFilterData } = useFilterDataForAssesment(instituteDetails);
    const { showForInstitutes } = useInstituteDetailsStore();

    // Browser zone, canonicalised (see `@/utils/timezone`), then narrowed to a zone the
    // dropdown can actually display — a value absent from TIMEZONE_OPTIONS would render as
    // an empty select even though it is a perfectly valid IANA zone.
    const getBrowserTimezone = (): string => {
        // getBrowserTimezone() from the helper keeps the original try/catch around the Intl
        // lookup — calling Intl inline here would throw during render on a runtime without it.
        const detected = getNormalizedBrowserTimezone();
        return TIMEZONE_OPTIONS.some((option) => option.value === detected)
            ? detected
            : FALLBACK_TIMEZONE;
    };

    // Helper function to get current time in selected timezone
    const getCurrentTimeInTimezone = (timezone: string): string => {
        try {
            const now = new Date();
            const zonedTime = toZonedTime(now, timezone);
            return format(zonedTime, "yyyy-MM-dd'T'HH:mm");
        } catch (error) {
            console.error('Error getting current time in timezone:', error);
            return format(new Date(), "yyyy-MM-dd'T'HH:mm");
        }
    };

    // Initialize default values
    const getDefaultValues = useCallback(() => {
        // Honor the institute-level default timezone if an admin set one in
        // settings; otherwise fall back to the admin's browser timezone.
        const defaultTimezone = normalizeTimezone(
            liveSessionSettings.defaultTimeZone,
            getBrowserTimezone()
        );
        const defaultTime = getCurrentTimeInTimezone(defaultTimezone);

        return {
            title: '',
            meetingType: RecurringType.ONCE,
            recurringSchedule: WEEK_DAYS.map((day) => ({
                day: day.label,
                isSelect: false,
                default_class_link: null, // Day-level default link
                default_class_name: null, // Day-level default class name
                learner_button_config: null, // Day-level custom button
                sessions: [
                    {
                        startTime: '00:00',
                        durationHours: '0',
                        durationMinutes: '30',
                        link: '',
                        countAttendanceDaily:
                            liveSessionSettings.defaultDailyAttendanceCounting,
                        thumbnailFileId: '',
                    },
                ],
            })),
            subject: 'none',
            timeZone: defaultTimezone,
            startTime: defaultTime,
            events: '1',
            openWaitingRoomBefore: liveSessionSettings.defaultWaitingRoomTime ?? '15',
            waitingRoomType:
                liveSessionSettings.defaultWaitingRoomType ?? WaitingRoomType.WAITING_ROOM,
            sessionType: SessionType.LIVE,
            streamingType: SessionPlatform.EMBED_IN_APP,
            allowRewind: false,
            allowPause: false,
            showToLearners: false,
            enableWaitingRoom: liveSessionSettings.defaultWaitingRoomEnabled ?? false,
            // Pre-select the institute's default platform (falling back to
            // OTHER when it isn't set or has since been disallowed). Platform
            // enum values match the settings' PlatformKey strings 1:1.
            sessionPlatform:
                liveSessionSettings.defaultPlatform &&
                liveSessionSettings.allowedPlatforms[liveSessionSettings.defaultPlatform] !== false
                    ? (liveSessionSettings.defaultPlatform as StreamingPlatform)
                    : StreamingPlatform.OTHER,
            durationMinutes: '30',
            durationHours: '0',
            defaultLink: '',
            // Feedback defaults to ON, but only when the institute keeps the
            // feedback feature enabled — if the whole feedback card is hidden
            // (feedbackEnabled = false) we must never silently enable it.
            feedbackEnabled:
                (liveSessionSettings.feedbackEnabled ?? true) &&
                (liveSessionSettings.defaultFeedbackEnabled ?? true),
            feedbackCompulsory: liveSessionSettings.defaultFeedbackCompulsory ?? false,
            feedbackQuestions: buildDefaultFeedbackQuestions(t),
            bbbRecord: liveSessionSettings.defaultBbbRecordEnabled ?? true,
            bbbAutoStartRecording: liveSessionSettings.defaultBbbAutoStartRecording ?? false,
            bbbMuteOnStart: liveSessionSettings.defaultBbbMuteOnStart ?? true,
            bbbWebcamsOnlyForModerator:
                liveSessionSettings.defaultBbbWebcamsOnlyForModerator ?? false,
            bbbGuestPolicy: liveSessionSettings.defaultBbbGuestPolicy ?? 'ALWAYS_ACCEPT',
            bbbDisableMic: liveSessionSettings.defaultBbbDisableMic ?? false,
            bbbDisableCam: liveSessionSettings.defaultBbbDisableCam ?? false,
            bbbDisablePrivateChat: liveSessionSettings.defaultBbbDisablePrivateChat ?? false,
            bbbDisablePublicChat: liveSessionSettings.defaultBbbDisablePublicChat ?? false,
            bbbDisableSharedNotes: liveSessionSettings.defaultBbbDisableSharedNotes ?? false,
            bbbHideUserList: liveSessionSettings.defaultBbbHideUserList ?? false,
            bbbEndWhenNoModerator: liveSessionSettings.defaultBbbEndWhenNoModerator ?? false,
            // Per-session opt-in only — no institute default yet.
            bbbActivenessScore: false,
            // Zoom meeting defaults (only used when platform = Zoom with an account).
            // Seeding them here means the Zoom settings panel and the step-2 DTO
            // builder both read the institute defaults without extra wiring.
            zoomWaitingRoom: liveSessionSettings.defaultZoomWaitingRoom ?? true,
            zoomJoinBeforeHost: liveSessionSettings.defaultZoomJoinBeforeHost ?? false,
            zoomMeetingAuthentication:
                liveSessionSettings.defaultZoomMeetingAuthentication ?? false,
            zoomApprovalType: liveSessionSettings.defaultZoomApprovalType ?? '2',
            zoomMuteUponEntry: liveSessionSettings.defaultZoomMuteUponEntry ?? true,
            zoomHostVideo: liveSessionSettings.defaultZoomHostVideo ?? false,
            zoomParticipantVideo: liveSessionSettings.defaultZoomParticipantVideo ?? false,
            zoomAudio: liveSessionSettings.defaultZoomAudio ?? 'both',
            zoomAutoRecording: liveSessionSettings.defaultZoomAutoRecording ?? 'cloud',
            zoomBreakoutRoom: liveSessionSettings.defaultZoomBreakoutRoom ?? false,
            zoomFocusMode: liveSessionSettings.defaultZoomFocusMode ?? false,
            zoomAllowMultipleDevices:
                liveSessionSettings.defaultZoomAllowMultipleDevices ?? false,
            zoomWatermark: liveSessionSettings.defaultZoomWatermark ?? false,
        };
    }, []);

    // Form Setup
    const form = useForm<z.infer<typeof sessionFormSchema>>({
        resolver: zodResolver(sessionFormSchema),
        defaultValues: getDefaultValues(),
        mode: 'onChange',
    });

    // Settings load asynchronously. If they arrive after the form initialised
    // and the admin hasn't manually changed the timezone yet, snap the field
    // to the institute default. We only do this for new sessions (not edit).
    useEffect(() => {
        if (isEdit) return;
        const adminDefault = liveSessionSettings.defaultTimeZone;
        if (!adminDefault) return;
        const tzDirty = form.getFieldState('timeZone').isDirty;
        if (tzDirty) return;
        if (form.getValues('timeZone') !== adminDefault) {
            form.setValue('timeZone', adminDefault);
        }
    }, [liveSessionSettings.defaultTimeZone, isEdit, form]);

    // Settings load asynchronously (react-query). For NEW sessions, once the
    // institute-level live-session defaults arrive, snap the feedback and
    // waiting-room fields to those defaults — but only while the admin hasn't
    // manually touched each field (isDirty guard), so we never overwrite a
    // deliberate choice. Edit mode is left alone: the existing session's saved
    // values are mapped in separately.
    useEffect(() => {
        if (isEdit) return;
        const feedbackDefault =
            (liveSessionSettings.feedbackEnabled ?? true) &&
            (liveSessionSettings.defaultFeedbackEnabled ?? true);
        if (
            !form.getFieldState('feedbackEnabled').isDirty &&
            form.getValues('feedbackEnabled') !== feedbackDefault
        ) {
            form.setValue('feedbackEnabled', feedbackDefault);
        }
        const compulsoryDefault = liveSessionSettings.defaultFeedbackCompulsory ?? false;
        if (
            !form.getFieldState('feedbackCompulsory').isDirty &&
            form.getValues('feedbackCompulsory') !== compulsoryDefault
        ) {
            form.setValue('feedbackCompulsory', compulsoryDefault);
        }
        const waitingEnabledDefault = liveSessionSettings.defaultWaitingRoomEnabled ?? false;
        if (
            !form.getFieldState('enableWaitingRoom').isDirty &&
            form.getValues('enableWaitingRoom') !== waitingEnabledDefault
        ) {
            form.setValue('enableWaitingRoom', waitingEnabledDefault);
        }
        const waitingTypeDefault =
            liveSessionSettings.defaultWaitingRoomType ?? WaitingRoomType.WAITING_ROOM;
        if (
            !form.getFieldState('waitingRoomType').isDirty &&
            form.getValues('waitingRoomType') !== waitingTypeDefault
        ) {
            form.setValue('waitingRoomType', waitingTypeDefault);
        }
        const waitingTimeDefault = liveSessionSettings.defaultWaitingRoomTime ?? '15';
        if (
            !form.getFieldState('openWaitingRoomBefore').isDirty &&
            form.getValues('openWaitingRoomBefore') !== waitingTimeDefault
        ) {
            form.setValue('openWaitingRoomBefore', waitingTimeDefault);
        }
        // Default platform: only pre-fill on a truly fresh form (no link typed
        // and the admin hasn't picked a platform) so we never fight the
        // link-based auto-detection.
        const platformDefault =
            liveSessionSettings.defaultPlatform &&
            liveSessionSettings.allowedPlatforms[liveSessionSettings.defaultPlatform] !== false
                ? (liveSessionSettings.defaultPlatform as StreamingPlatform)
                : StreamingPlatform.OTHER;
        if (
            !form.getFieldState('sessionPlatform').isDirty &&
            !form.getValues('defaultLink') &&
            form.getValues('sessionPlatform') !== platformDefault
        ) {
            form.setValue('sessionPlatform', platformDefault);
        }
        // Vacademy Meet (BBB) recording & control defaults.
        const bbbRecordDefault = liveSessionSettings.defaultBbbRecordEnabled ?? true;
        if (
            !form.getFieldState('bbbRecord').isDirty &&
            form.getValues('bbbRecord') !== bbbRecordDefault
        ) {
            form.setValue('bbbRecord', bbbRecordDefault);
        }
        const bbbAutoStartDefault = liveSessionSettings.defaultBbbAutoStartRecording ?? false;
        if (
            !form.getFieldState('bbbAutoStartRecording').isDirty &&
            form.getValues('bbbAutoStartRecording') !== bbbAutoStartDefault
        ) {
            form.setValue('bbbAutoStartRecording', bbbAutoStartDefault);
        }
        const bbbMuteDefault = liveSessionSettings.defaultBbbMuteOnStart ?? true;
        if (
            !form.getFieldState('bbbMuteOnStart').isDirty &&
            form.getValues('bbbMuteOnStart') !== bbbMuteDefault
        ) {
            form.setValue('bbbMuteOnStart', bbbMuteDefault);
        }
        const bbbWebcamDefault = liveSessionSettings.defaultBbbWebcamsOnlyForModerator ?? false;
        if (
            !form.getFieldState('bbbWebcamsOnlyForModerator').isDirty &&
            form.getValues('bbbWebcamsOnlyForModerator') !== bbbWebcamDefault
        ) {
            form.setValue('bbbWebcamsOnlyForModerator', bbbWebcamDefault);
        }
        const bbbGuestDefault = liveSessionSettings.defaultBbbGuestPolicy ?? 'ALWAYS_ACCEPT';
        if (
            !form.getFieldState('bbbGuestPolicy').isDirty &&
            form.getValues('bbbGuestPolicy') !== bbbGuestDefault
        ) {
            form.setValue('bbbGuestPolicy', bbbGuestDefault);
        }
        const snapBbbLockBool = (
            name:
                | 'bbbDisableMic'
                | 'bbbDisableCam'
                | 'bbbDisablePrivateChat'
                | 'bbbDisablePublicChat'
                | 'bbbDisableSharedNotes'
                | 'bbbHideUserList'
                | 'bbbEndWhenNoModerator',
            def: boolean
        ) => {
            if (!form.getFieldState(name).isDirty && form.getValues(name) !== def) {
                form.setValue(name, def);
            }
        };
        snapBbbLockBool('bbbDisableMic', liveSessionSettings.defaultBbbDisableMic ?? false);
        snapBbbLockBool('bbbDisableCam', liveSessionSettings.defaultBbbDisableCam ?? false);
        snapBbbLockBool(
            'bbbDisablePrivateChat',
            liveSessionSettings.defaultBbbDisablePrivateChat ?? false
        );
        snapBbbLockBool(
            'bbbDisablePublicChat',
            liveSessionSettings.defaultBbbDisablePublicChat ?? false
        );
        snapBbbLockBool(
            'bbbDisableSharedNotes',
            liveSessionSettings.defaultBbbDisableSharedNotes ?? false
        );
        snapBbbLockBool('bbbHideUserList', liveSessionSettings.defaultBbbHideUserList ?? false);
        snapBbbLockBool(
            'bbbEndWhenNoModerator',
            liveSessionSettings.defaultBbbEndWhenNoModerator ?? false
        );
    }, [
        liveSessionSettings.feedbackEnabled,
        liveSessionSettings.defaultFeedbackEnabled,
        liveSessionSettings.defaultFeedbackCompulsory,
        liveSessionSettings.defaultWaitingRoomEnabled,
        liveSessionSettings.defaultWaitingRoomType,
        liveSessionSettings.defaultWaitingRoomTime,
        liveSessionSettings.defaultPlatform,
        liveSessionSettings.allowedPlatforms,
        liveSessionSettings.defaultBbbRecordEnabled,
        liveSessionSettings.defaultBbbAutoStartRecording,
        liveSessionSettings.defaultBbbMuteOnStart,
        liveSessionSettings.defaultBbbWebcamsOnlyForModerator,
        liveSessionSettings.defaultBbbGuestPolicy,
        liveSessionSettings.defaultBbbDisableMic,
        liveSessionSettings.defaultBbbDisableCam,
        liveSessionSettings.defaultBbbDisablePrivateChat,
        liveSessionSettings.defaultBbbDisablePublicChat,
        liveSessionSettings.defaultBbbDisableSharedNotes,
        liveSessionSettings.defaultBbbHideUserList,
        liveSessionSettings.defaultBbbEndWhenNoModerator,
        isEdit,
        form,
    ]);

    // Zoom control defaults — kept in a separate effect because there are many
    // fields. New sessions only, and only while each field is untouched. The
    // seeded values feed both the Zoom settings panel and the step-2 provision.
    useEffect(() => {
        if (isEdit) return;
        const snapZoomBool = (
            name:
                | 'zoomWaitingRoom'
                | 'zoomJoinBeforeHost'
                | 'zoomMeetingAuthentication'
                | 'zoomMuteUponEntry'
                | 'zoomHostVideo'
                | 'zoomParticipantVideo'
                | 'zoomBreakoutRoom'
                | 'zoomFocusMode'
                | 'zoomAllowMultipleDevices'
                | 'zoomWatermark',
            next: boolean
        ) => {
            if (!form.getFieldState(name).isDirty && form.getValues(name) !== next) {
                form.setValue(name, next);
            }
        };
        snapZoomBool('zoomWaitingRoom', liveSessionSettings.defaultZoomWaitingRoom ?? true);
        snapZoomBool(
            'zoomJoinBeforeHost',
            liveSessionSettings.defaultZoomJoinBeforeHost ?? false
        );
        snapZoomBool(
            'zoomMeetingAuthentication',
            liveSessionSettings.defaultZoomMeetingAuthentication ?? false
        );
        snapZoomBool('zoomMuteUponEntry', liveSessionSettings.defaultZoomMuteUponEntry ?? true);
        snapZoomBool('zoomHostVideo', liveSessionSettings.defaultZoomHostVideo ?? false);
        snapZoomBool(
            'zoomParticipantVideo',
            liveSessionSettings.defaultZoomParticipantVideo ?? false
        );
        snapZoomBool('zoomBreakoutRoom', liveSessionSettings.defaultZoomBreakoutRoom ?? false);
        snapZoomBool('zoomFocusMode', liveSessionSettings.defaultZoomFocusMode ?? false);
        snapZoomBool(
            'zoomAllowMultipleDevices',
            liveSessionSettings.defaultZoomAllowMultipleDevices ?? false
        );
        snapZoomBool('zoomWatermark', liveSessionSettings.defaultZoomWatermark ?? false);
        const approval = liveSessionSettings.defaultZoomApprovalType ?? '2';
        if (
            !form.getFieldState('zoomApprovalType').isDirty &&
            form.getValues('zoomApprovalType') !== approval
        ) {
            form.setValue('zoomApprovalType', approval);
        }
        const audio = liveSessionSettings.defaultZoomAudio ?? 'both';
        if (
            !form.getFieldState('zoomAudio').isDirty &&
            form.getValues('zoomAudio') !== audio
        ) {
            form.setValue('zoomAudio', audio);
        }
        const rec = liveSessionSettings.defaultZoomAutoRecording ?? 'cloud';
        if (
            !form.getFieldState('zoomAutoRecording').isDirty &&
            form.getValues('zoomAutoRecording') !== rec
        ) {
            form.setValue('zoomAutoRecording', rec);
        }
    }, [
        liveSessionSettings.defaultZoomWaitingRoom,
        liveSessionSettings.defaultZoomJoinBeforeHost,
        liveSessionSettings.defaultZoomMeetingAuthentication,
        liveSessionSettings.defaultZoomApprovalType,
        liveSessionSettings.defaultZoomMuteUponEntry,
        liveSessionSettings.defaultZoomHostVideo,
        liveSessionSettings.defaultZoomParticipantVideo,
        liveSessionSettings.defaultZoomAudio,
        liveSessionSettings.defaultZoomAutoRecording,
        liveSessionSettings.defaultZoomBreakoutRoom,
        liveSessionSettings.defaultZoomFocusMode,
        liveSessionSettings.defaultZoomAllowMultipleDevices,
        liveSessionSettings.defaultZoomWatermark,
        isEdit,
        form,
    ]);

    // For NEW sessions only: if the institute disables recurring weekly
    // schedules and the form somehow holds WEEKLY (e.g. defaults loaded before
    // the setting), snap to ONCE. We never touch existing recurring sessions
    // being edited — the renderMeetingTypeSelection still shows the option in
    // edit mode so the data stays intact.
    useEffect(() => {
        if (isEdit) return;
        if (liveSessionSettings.recurringEnabled) return;
        if (form.getValues('meetingType') === RecurringType.WEEKLY) {
            form.setValue('meetingType', RecurringType.ONCE);
        }
    }, [liveSessionSettings.recurringEnabled, isEdit, form]);

    // Auto-update "Select days" dropdown when days are toggled manually
    const recurringSchedule = useWatch({
        control: form.control,
        name: 'recurringSchedule',
    });
    useEffect(() => {
        if (!recurringSchedule) return;
        const selectedDays = recurringSchedule.filter((day) => day.isSelect).map((day) => day.day);
        const allDays = WEEK_DAYS.map((d) => d.label);
        const weekdays = allDays.slice(0, 5);
        const monToSat = allDays.slice(0, 6);
        let newType: 'everyday' | 'weekday' | 'exceptSunday' | 'custom';
        if (selectedDays.length === allDays.length) {
            newType = 'everyday';
        } else if (monToSat.every((day) => selectedDays.includes(day))) {
            newType = 'exceptSunday';
        } else if (weekdays.every((day) => selectedDays.includes(day))) {
            newType = 'weekday';
        } else {
            newType = 'custom';
        }
        if (scheduleType !== newType) {
            setScheduleType(newType);
        }
    }, [recurringSchedule]);
    // Auto-fill link, duration, and start time for newly selected days
    const prevSelectedDaysRef = useRef<string[]>([]);
    useEffect(() => {
        if (!recurringSchedule) return;

        // NEVER auto-fill in edit mode - user's existing session data should be preserved
        if (isEditModeRef.current) return;

        // Skip if form is still being initialized
        if (!isFormInitialized) return;

        const selectedDays = recurringSchedule.filter((d) => d.isSelect).map((d) => d.day);
        const newDays = selectedDays.filter((d) => !prevSelectedDaysRef.current.includes(d));

        if (newDays.length > 0) {
            const currentStartTime = form.getValues('startTime') || '';
            const timeValue = currentStartTime.split('T')[1] || '';
            const currentDurationHours = form.getValues('durationHours') || '0';
            const currentDurationMinutes = form.getValues('durationMinutes') || '30';
            const currentLink = form.getValues('defaultLink') || '';

            newDays.forEach((dayLabel) => {
                const idx = recurringSchedule.findIndex((d) => d.day === dayLabel);
                if (idx !== -1) {
                    form.setValue(`recurringSchedule.${idx}.sessions.0.startTime`, timeValue);
                    form.setValue(
                        `recurringSchedule.${idx}.sessions.0.durationHours`,
                        currentDurationHours
                    );
                    form.setValue(
                        `recurringSchedule.${idx}.sessions.0.durationMinutes`,
                        currentDurationMinutes
                    );
                    form.setValue(`recurringSchedule.${idx}.sessions.0.link`, currentLink);
                    form.setValue(`recurringSchedule.${idx}.sessions.0.thumbnailFileId`, '');
                }
            });
        }
        prevSelectedDaysRef.current = selectedDays;
    }, [recurringSchedule, form, isFormInitialized]);

    // Watch default link
    const defaultLink = form.watch('defaultLink');

    // Auto-detect platform from link
    useEffect(() => {
        const link = defaultLink?.toLowerCase() || '';

        if (!link) return;

        if (link.includes('youtube.com') || link.includes('youtu.be')) {
            form.setValue('sessionPlatform', StreamingPlatform.YOUTUBE);
        } else if (link.includes('meet.google.com')) {
            form.setValue('sessionPlatform', StreamingPlatform.MEET);
        } else if (link.includes('zoom.us')) {
            form.setValue('sessionPlatform', StreamingPlatform.ZOOM);
        } else {
            form.setValue('sessionPlatform', StreamingPlatform.OTHER);
            form.setValue('streamingType', SessionPlatform.REDIRECT_TO_OTHER_PLATFORM);
        }
    }, [defaultLink, form]);

    // Update start time when timezone changes (only for new sessions)
    const selectedTimezone = form.watch('timeZone');
    useEffect(() => {
        // Only update time if NOT in edit mode and timezone changes
        if (!sessionDetails && selectedTimezone && isFormInitialized) {
            const currentTime = getCurrentTimeInTimezone(selectedTimezone);
            form.setValue('startTime', currentTime);
        }
    }, [selectedTimezone, sessionDetails, form, isFormInitialized]);

    // Populate form when sessionDetails is available (edit mode)
    useEffect(() => {
        if (!sessionDetails) {
            if (!isFormInitialized) {
                setIsFormInitialized(true);
            }
            return;
        }

        // Mark that we're in edit mode - this flag will NEVER change once set
        isEditModeRef.current = true;

        // Set loading flag to prevent auto-fill effects from running
        setIsLoadingEditData(true);

        const schedule = sessionDetails.schedule;
        const savedTimezone = schedule.timezone || 'Asia/Kolkata';

        // --- Compute ALL form values BEFORE resetting the form ---

        // Compute startTime
        let computedStartTime: string;
        if (schedule.start_time) {
            if (schedule.start_time.includes('T')) {
                try {
                    const testDate = new Date(schedule.start_time);
                    if (!isNaN(testDate.getTime())) {
                        // Normalize to datetime-local format (YYYY-MM-DDTHH:mm)
                        const normalized = schedule.start_time.substring(0, 16);
                        computedStartTime = normalized;
                    } else {
                        computedStartTime = schedule.start_time;
                    }
                } catch {
                    computedStartTime = schedule.start_time;
                }
            } else if (schedule.meeting_date) {
                computedStartTime = `${schedule.meeting_date}T${schedule.start_time}`;
            } else {
                const today = format(new Date(), 'yyyy-MM-dd');
                computedStartTime = `${today}T${schedule.start_time}`;
            }
        } else {
            computedStartTime = getCurrentTimeInTimezone(savedTimezone);
        }

        // Compute duration
        let computedDurationHours = '0';
        let computedDurationMinutes = '30';
        if (schedule.start_time && schedule.last_entry_time) {
            const start = new Date(schedule.start_time);
            const end = new Date(schedule.last_entry_time);
            if (end > start) {
                const durationMs = end.getTime() - start.getTime();
                computedDurationHours = String(Math.floor(durationMs / 3600000));
                computedDurationMinutes = String(Math.floor((durationMs % 3600000) / 60000));
            }
        }

        // Compute meeting type, endDate, and recurring schedule
        let computedMeetingType = RecurringType.ONCE;
        let computedEndDate: string | undefined = undefined;
        const getDefaultValuesResult = getDefaultValues();
        let computedRecurringSchedule: typeof getDefaultValuesResult.recurringSchedule =
            getDefaultValuesResult.recurringSchedule;

        if (schedule.recurrence_type === 'weekly') {
            computedMeetingType = RecurringType.WEEKLY;

            // Parse session_end_date to YYYY-MM-DD format for <input type="date">
            const rawEndDate = schedule.session_end_date;
            if (rawEndDate) {
                try {
                    const parsedDate = new Date(rawEndDate);
                    if (!isNaN(parsedDate.getTime())) {
                        computedEndDate = format(parsedDate, 'yyyy-MM-dd');
                    } else if (rawEndDate.includes('T')) {
                        computedEndDate = rawEndDate.split('T')[0] || rawEndDate;
                    } else {
                        computedEndDate = rawEndDate;
                    }
                } catch {
                    if (rawEndDate.includes('T')) {
                        computedEndDate = rawEndDate.split('T')[0] || rawEndDate;
                    } else {
                        computedEndDate = rawEndDate;
                    }
                }
            }

            computedRecurringSchedule = WEEK_DAYS.map((day) => {
                const allMatchingSchedules = schedule.added_schedules.filter(
                    (scheduleItem) => scheduleItem.day.toLowerCase() === day.label.toLowerCase()
                );

                const sessionsByTime = new Map<
                    string,
                    Array<(typeof schedule.added_schedules)[0]>
                >();
                allMatchingSchedules.forEach((session) => {
                    if (!sessionsByTime.has(session.startTime)) {
                        sessionsByTime.set(session.startTime, []);
                    }
                    sessionsByTime.get(session.startTime)!.push(session);
                });

                const matchingSchedules = Array.from(sessionsByTime.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([, sessions]) => {
                        const firstSession = sessions[0];
                        const allIds = sessions.map((s) => s.id).join(',');
                        return {
                            ...firstSession,
                            id: allIds,
                        };
                    });

                return {
                    day: day.label as typeof day.label,
                    isSelect: matchingSchedules.length > 0,
                    default_class_link:
                        matchingSchedules.length > 0
                            ? (matchingSchedules[0] as any)?.default_class_link ??
                            (matchingSchedules[0] as any)?.defaultClassLink ??
                            null
                            : null,
                    default_class_name:
                        matchingSchedules.length > 0
                            ? (matchingSchedules[0] as any)?.default_class_name ??
                            (matchingSchedules[0] as any)?.defaultClassName ??
                            null
                            : null,
                    learner_button_config:
                        matchingSchedules.length > 0
                            ? (matchingSchedules[0] as any)?.learner_button_config ??
                            (matchingSchedules[0] as any)?.learnerButtonConfig ??
                            null
                            : null,
                    sessions:
                        matchingSchedules.length > 0
                            ? matchingSchedules.map((matchingSchedule) => {
                                const duration = parseInt(matchingSchedule.duration || '0') || 0;
                                return {
                                    id: matchingSchedule.id,
                                    startTime: matchingSchedule.startTime || '00:00',
                                    durationHours: String(Math.floor(duration / 60)),
                                    durationMinutes: String(duration % 60),
                                    link: matchingSchedule.link || '',
                                    thumbnailFileId: matchingSchedule.thumbnailFileId || '',
                                    countAttendanceDaily:
                                        matchingSchedule.countAttendanceDaily ??
                                        (matchingSchedule as any).dailyAttendance ??
                                        false,
                                };
                            })
                            : [
                                {
                                    startTime: '00:00',
                                    durationHours: '0',
                                    durationMinutes: '30',
                                    link: '',
                                    thumbnailFileId: '',
                                    countAttendanceDaily:
                                        liveSessionSettings.defaultDailyAttendanceCounting,
                                },
                            ],
                };
            });
        }

        // Compute waiting room settings
        let computedEnableWaitingRoom = false;
        let computedOpenWaitingRoomBefore = '15';
        if (schedule.waiting_room_time !== null && schedule.waiting_room_time !== undefined) {
            computedEnableWaitingRoom = schedule.waiting_room_time > 0;
            computedOpenWaitingRoomBefore = String(schedule.waiting_room_time);
        }
        const computedWaitingRoomType =
            (schedule as any).waiting_room_type === WaitingRoomType.PRE_JOINING
                ? WaitingRoomType.PRE_JOINING
                : WaitingRoomType.WAITING_ROOM;

        // Compute learner button config
        const topLevelLearnerButtonConfig =
            (schedule as any)?.learner_button_config ??
            (schedule as any)?.learnerButtonConfig ??
            null;

        // --- Single form.reset with ALL computed values ---
        // This prevents intermediate states where meetingType/endDate/recurringSchedule
        // are at defaults while other fields are already set
        form.reset({
            id: schedule.session_id,
            title: schedule.title || '',
            subject: schedule.subject || 'none',
            description: schedule.description_html || '',
            timeZone: savedTimezone,
            startTime: computedStartTime,
            durationHours: computedDurationHours,
            durationMinutes: computedDurationMinutes,
            meetingType: computedMeetingType,
            endDate: computedEndDate,
            recurringSchedule: computedRecurringSchedule,
            defaultLink: schedule.default_meet_link || '',
            sessionPlatform: schedule.link_type || StreamingPlatform.OTHER,
            streamingType: schedule.session_streaming_service_type || SessionPlatform.EMBED_IN_APP,
            sessionType: SessionType.LIVE,
            enableWaitingRoom: computedEnableWaitingRoom,
            openWaitingRoomBefore: computedOpenWaitingRoomBefore,
            waitingRoomType: computedWaitingRoomType,
            allowRewind: schedule.allow_rewind ?? false,
            allowPause: schedule.allow_play_pause ?? false,
            showToLearners: schedule.show_to_learners ?? false,
            events: '1',
            learner_button_config: topLevelLearnerButtonConfig,
            bbbRecord: schedule.bbb_config?.record ?? true,
            bbbAutoStartRecording: schedule.bbb_config?.auto_start_recording ?? false,
            bbbMuteOnStart: schedule.bbb_config?.mute_on_start ?? true,
            bbbWebcamsOnlyForModerator: schedule.bbb_config?.webcams_only_for_moderator ?? false,
            bbbGuestPolicy: (schedule.bbb_config?.guest_policy as 'ALWAYS_ACCEPT' | 'ASK_MODERATOR' | 'ALWAYS_DENY') ?? 'ALWAYS_ACCEPT',
            bbbDisableMic: schedule.bbb_config?.disable_mic ?? false,
            bbbDisableCam: schedule.bbb_config?.disable_cam ?? false,
            bbbDisablePrivateChat: schedule.bbb_config?.disable_private_chat ?? false,
            bbbDisablePublicChat: schedule.bbb_config?.disable_public_chat ?? false,
            bbbDisableSharedNotes: schedule.bbb_config?.disable_shared_notes ?? false,
            bbbHideUserList: schedule.bbb_config?.hide_user_list ?? false,
            bbbEndWhenNoModerator: schedule.bbb_config?.end_when_no_moderator ?? false,
            bbbActivenessScore: schedule.bbb_config?.activeness_score ?? false,
            feedbackEnabled: schedule.feedback_config?.enabled ?? false,
            feedbackCompulsory: schedule.feedback_config?.allow_skip === false,
            feedbackQuestions: schedule.feedback_config?.questions ?? buildDefaultFeedbackQuestions(t),
        });

        // Set existing file IDs for display
        if (schedule.thumbnail_file_id) {
            setExistingThumbnailId(schedule.thumbnail_file_id);
        }
        if (schedule.background_score_file_id) {
            setExistingMusicId(schedule.background_score_file_id);
        }
        if (schedule.cover_file_id) {
            setExistingCoverId(schedule.cover_file_id);
        }

        setIsFormInitialized(true);

        // Clear loading flag after a small delay to ensure all form values are set
        setTimeout(() => {
            setIsLoadingEditData(false);
        }, 100);
    }, [sessionDetails, form]);

    // Initialize form with step1Data when available (for non-edit flows)
    useEffect(() => {
        // Only run this for non-edit flows
        if (step1Data && !sessionDetails) {
            form.reset(step1Data);
            setIsFormInitialized(true);
        } else if (!step1Data && !sessionDetails && !isFormInitialized) {
            setIsFormInitialized(true);
        }
    }, [step1Data, sessionDetails, form, isFormInitialized]);

    // Set the form's id field when sessionId exists (coming back from step 2)
    useEffect(() => {
        if (sessionId && !sessionDetails && !form.getValues('id')) {
            form.setValue('id', sessionId);
        }
    }, [sessionId, sessionDetails, form]);

    const { control, watch } = form;
    // Watch the selected streaming platform to conditionally render/disable options
    const sessionPlatformWatch = useWatch({ control, name: 'sessionPlatform' });
    const defaultLinkWatch = useWatch({ control, name: 'defaultLink' });

    const detectedPlatform = useMemo(() => {
        const link = (defaultLinkWatch || '').trim();
        const youtubeRegex = /^(https?:\/\/(www\.)?youtube\.com\/(watch\?v=|@.+\/live))/i;
        const meetRegex = /^(https?:\/\/meet\.google\.com\/(new|[a-zA-Z0-9-]+))/i;
        const zoomRegex = /^(https?:\/\/([\w.-]+\.)?zoom\.us\/)/i;
        if (youtubeRegex.test(link)) return 'youtube';
        if (meetRegex.test(link)) return 'meet';
        if (zoomRegex.test(link)) return 'zoom';
        return 'other';
    }, [defaultLinkWatch]);

    // Effect: set form values based on detected platform
    useEffect(() => {
        switch (detectedPlatform) {
            case 'youtube': {
                form.setValue('sessionPlatform', StreamingPlatform.YOUTUBE);
                form.setValue('streamingType', SessionPlatform.EMBED_IN_APP);
                break;
            }
            case 'meet': {
                form.setValue('sessionPlatform', StreamingPlatform.MEET);
                form.setValue('sessionType', SessionType.LIVE);
                form.setValue('streamingType', SessionPlatform.REDIRECT_TO_OTHER_PLATFORM);
                break;
            }
            case 'zoom': {
                form.setValue('sessionPlatform', StreamingPlatform.ZOOM);
                form.setValue('streamingType', SessionPlatform.REDIRECT_TO_OTHER_PLATFORM);
                break;
            }
            case 'other': {
                // Only force OTHER when an unrecognised link is actually
                // present. With an empty link we leave the platform on its
                // default / the admin's selection, so the institute's default
                // platform isn't overwritten on a fresh form.
                if (defaultLinkWatch) {
                    form.setValue('sessionPlatform', StreamingPlatform.OTHER);
                }
                break;
            }
        }
    }, [detectedPlatform, defaultLinkWatch]);

    const isMeetPlatform = sessionPlatformWatch === StreamingPlatform.MEET;
    const isZoomPlatform = sessionPlatformWatch === StreamingPlatform.ZOOM;
    const isZohoPlatform = sessionPlatformWatch === StreamingPlatform.ZOHO;
    const isBbbPlatform = sessionPlatformWatch === StreamingPlatform.BBB;
    // Zoom with a selected account auto-generates the meeting (no manual link
    // needed) — same UX as Zoho/BBB. Zoom without an account falls back to paste.
    const zoomAccountIdWatch = useWatch({ control, name: 'zoomAccountId' });
    const isZoomWithAccount = isZoomPlatform && !!zoomAccountIdWatch;
    // Google Meet with a connected account auto-generates the meeting (like Zoom). Without an
    // account, "Google Meet" stays a paste-a-link option.
    const googleMeetAccountIdWatch = useWatch({ control, name: 'googleMeetAccountId' });
    const isMeetWithAccount = isMeetPlatform && !!googleMeetAccountIdWatch;
    // Platforms that create each occurrence's meeting themselves — a per-session link box
    // there is meaningless (same condition that disables the top-level link field).
    const isAutoLinkPlatform =
        isZohoPlatform || isBbbPlatform || isZoomWithAccount || isMeetWithAccount;

    // In edit mode, if the existing session's platform was later disallowed in
    // settings, splice it back into the option list so the select doesn't
    // appear blank. Saving preserves the value either way — this is a UI fix.
    const editAwareStreamingOptions = useMemo(() => {
        if (
            !isEdit ||
            !sessionPlatformWatch ||
            filteredStreamingOptions.some((o) => o.value === sessionPlatformWatch)
        ) {
            return filteredStreamingOptions;
        }
        const restored = STREAMING_OPTIONS.find((o) => o.value === sessionPlatformWatch);
        return restored ? [...filteredStreamingOptions, restored] : filteredStreamingOptions;
    }, [filteredStreamingOptions, isEdit, sessionPlatformWatch]);

    // Disabled options logic based on current platform selection
    const disabledLiveClassOptions = useMemo(() => {
        if (isMeetPlatform || isZohoPlatform || isBbbPlatform) return [SessionType.PRE_RECORDED];
        return [];
    }, [isMeetPlatform, isZohoPlatform, isBbbPlatform]);

    const sessionTypeWatch = useWatch({ control, name: 'sessionType' });

    const disabledStreamingOptions = useMemo(() => {
        if (isMeetPlatform) {
            return [SessionPlatform.EMBED_IN_APP];
        }
        if (isZoomPlatform && sessionTypeWatch !== SessionType.PRE_RECORDED) {
            return [SessionPlatform.EMBED_IN_APP];
        }
        return [];
    }, [isMeetPlatform, isZoomPlatform, sessionTypeWatch]);

    // Map detectedPlatform string to enum value for comparison
    const detectedEnumPlatform = useMemo(() => {
        switch (detectedPlatform) {
            case 'youtube':
                return StreamingPlatform.YOUTUBE;
            case 'meet':
                return StreamingPlatform.MEET;
            case 'zoom':
                return StreamingPlatform.ZOOM;
            default:
                return StreamingPlatform.OTHER;
        }
    }, [detectedPlatform]);

    const handleSessionPlatformChange = useCallback(
        (value: string) => {
            // If user picks a platform that doesn't match the one inferred from link, clear the link to prevent mismatch
            if (defaultLinkWatch && value !== detectedEnumPlatform) {
                form.setValue('defaultLink', '');
                // Clear dependent selections to avoid inconsistencies
                form.setValue('sessionType', '');
                form.setValue('streamingType', '');
            }
        },
        [defaultLinkWatch, detectedEnumPlatform]
    );

    // When Google Meet, Zoho, or BBB is selected, enforce Live session type
    useEffect(() => {
        if (isMeetPlatform || isZohoPlatform || isBbbPlatform) {
            // Enforce only if not already selected to avoid unnecessary re-renders
            if (form.getValues('sessionType') !== SessionType.LIVE) {
                form.setValue('sessionType', SessionType.LIVE);
            }
            if (isMeetPlatform && form.getValues('streamingType') !== SessionPlatform.REDIRECT_TO_OTHER_PLATFORM) {
                form.setValue('streamingType', SessionPlatform.REDIRECT_TO_OTHER_PLATFORM);
            }
            // BBB uses embed in app (iframe)
            if (isBbbPlatform && form.getValues('streamingType') !== SessionPlatform.EMBED_IN_APP) {
                form.setValue('streamingType', SessionPlatform.EMBED_IN_APP);
            }
        }
    }, [isMeetPlatform, isZohoPlatform, isBbbPlatform]);
    const meetingType = useWatch({ control, name: 'meetingType' });

    // Auth and Institute Data
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = (tokenData?.authorities && Object.keys(tokenData.authorities)[0]) || '';

    // Event Handlers
    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setSelectedFile(file);
        } else {
            toast.error(t('toasts.uploadInvalidImage'));
        }
    };

    const handleRemoveFile = () => {
        setSelectedFile(null);
    };

    const handleRemoveExistingThumbnail = () => {
        setExistingThumbnailId(null);
        toast.success(t('toasts.thumbnailRemoved'));
    };

    const handleRemoveMusicFile = () => {
        setSelectedMusicFile(null);
    };

    const handleRemoveExistingMusic = () => {
        setExistingMusicId(null);
        toast.success(t('toasts.musicRemoved'));
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleCoverFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setSelectedCoverFile(file);
        } else {
            toast.error(t('toasts.uploadInvalidImage'));
        }
    };

    const handleCoverUploadClick = () => {
        coverFileInputRef.current?.click();
    };

    const handleRemoveCoverFile = () => {
        setSelectedCoverFile(null);
    };

    const handleRemoveExistingCover = () => {
        setExistingCoverId(null);
        toast.success(t('toasts.coverRemoved'));
    };

    const handleMusicFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setSelectedMusicFile(file);
        }
    };

    const handleMusicUploadClick = () => {
        musicFileInputRef.current?.click();
    };

    const handleViewFile = async (fileId: string, fileType: 'thumbnail' | 'music') => {
        try {
            const url = await getPublicUrl(fileId);
            if (url) {
                window.open(url, '_blank');
            } else {
                toast.error(t('toasts.getUrlFailed', { fileType: fileType === 'thumbnail' ? t('waiting.thumbnail') : t('waiting.backgroundScore') }));
            }
        } catch (error) {
            console.error(`Error getting ${fileType} URL:`, error);
            toast.error(t('toasts.loadFailed', { fileType: fileType === 'thumbnail' ? t('waiting.thumbnail') : t('waiting.backgroundScore') }));
        }
    };

    // Session thumbnail handlers
    const handleSessionThumbnailSelect = (
        dayIndex: number,
        sessionIndex: number,
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];
        if (file) {
            const key = `${dayIndex}-${sessionIndex}`;
            setSessionThumbnails((prev) => {
                const newMap = new Map(prev);
                newMap.set(key, file);
                return newMap;
            });
        }
    };

    const handleSessionThumbnailRemove = (dayIndex: number, sessionIndex: number) => {
        const key = `${dayIndex}-${sessionIndex}`;
        setSessionThumbnails((prev) => {
            const newMap = new Map(prev);
            newMap.delete(key);
            return newMap;
        });
        // Also clear the form field
        form.setValue(`recurringSchedule.${dayIndex}.sessions.${sessionIndex}.thumbnailFileId`, '');
    };

    const getSessionThumbnail = (dayIndex: number, sessionIndex: number): File | null => {
        const key = `${dayIndex}-${sessionIndex}`;
        return sessionThumbnails.get(key) || null;
    };

    const checkForLinkChanges = (
        newData: z.infer<typeof sessionFormSchema>,
        oldData: z.infer<typeof sessionFormSchema> | null
    ): string | false => {
        if (!isEdit || !oldData) return false;

        // Check top level default link
        if (newData.defaultLink !== oldData.defaultLink) return 'all days';

        // Map old sessions for easy lookup
        const oldSessionsMap = new Map<string, any>();
        if (oldData.recurringSchedule) {
            oldData.recurringSchedule.forEach((d) => {
                if (d.isSelect) {
                    d.sessions.forEach((s) => {
                        if (s.id) oldSessionsMap.set(s.id, { ...s, day: d.day });
                    });
                }
            });
        }

        // Check recurring schedule
        if (newData.recurringSchedule) {
            for (const day of newData.recurringSchedule) {
                if (!day.isSelect) continue;

                // Check day default link
                const oldDay = oldData.recurringSchedule?.find((d) => d.day === day.day);
                if (
                    oldDay &&
                    oldDay.isSelect &&
                    oldDay.default_class_link !== day.default_class_link
                ) {
                    return day.day;
                }

                for (const session of day.sessions) {
                    // Check if existing session (has ID) has changed link
                    if (session.id && oldSessionsMap.has(session.id)) {
                        const oldSession = oldSessionsMap.get(session.id);
                        if (oldSession.link !== session.link) {
                            return day.day;
                        }
                    }
                }
            }
        }

        return false;
    };

    /** Uploads the core session files (background music + thumbnail + cover).
     *  Returns the resulting file IDs, or null if an upload fails. */
    const uploadCoreFiles = async (): Promise<{
        musicFileId: string | undefined;
        thumbnailFileId: string | undefined;
        coverFileId: string | undefined;
    } | null> => {
        let musicFileId = existingMusicId || undefined;
        let thumbnailFileId = existingThumbnailId || undefined;
        let coverFileId = existingCoverId || undefined;

        if (selectedMusicFile) {
            try {
                musicFileId = await UploadFileInS3(selectedMusicFile, () => { }, 'your-user-id');
            } catch (error) {
                console.error('Error uploading music file:', error);
                toast.error(t('toasts.uploadMusicFailed'));
                return null;
            }
        }
        if (selectedFile) {
            try {
                thumbnailFileId = await UploadFileInS3(selectedFile, () => { }, 'your-user-id');
            } catch (error) {
                console.error('Error uploading thumbnail:', error);
                toast.error(t('toasts.uploadThumbnailFailed'));
                return null;
            }
        }
        if (selectedCoverFile) {
            try {
                coverFileId = await UploadFileInS3(selectedCoverFile, () => { }, 'your-user-id');
            } catch (error) {
                console.error('Error uploading cover image:', error);
                toast.error(t('toasts.uploadCoverFailed'));
                return null;
            }
        }
        return { musicFileId, thumbnailFileId, coverFileId };
    };

    /** Merges the latest live form state into the submitted data so that
     *  dynamically added sessions (via form.setValue) are never lost. */
    const buildMergedFormData = (
        data: z.infer<typeof sessionFormSchema>
    ): z.infer<typeof sessionFormSchema> => {
        const updatedData = { ...data };
        // CRITICAL FIX: React Hook Form's handleSubmit resolver may not always
        // include newly-added sessions in its output. Reading from form.getValues()
        // guarantees all dynamic sessions are captured.
        const latestRecurringSchedule = form.getValues('recurringSchedule');
        if (latestRecurringSchedule) {
            updatedData.recurringSchedule = latestRecurringSchedule.map((latestDay, dayIdx) => {
                const resolvedDay = data.recurringSchedule?.[dayIdx];
                if (resolvedDay) {
                    return { ...resolvedDay, sessions: latestDay.sessions };
                }
                return latestDay;
            });
        }
        return updatedData;
    };

    /** Uploads per-session thumbnails for all recurring schedule sessions in-place.
     *  Returns false (and shows a toast) if any upload fails. */
    const uploadRecurringSessionThumbnails = async (
        updatedData: z.infer<typeof sessionFormSchema>
    ): Promise<boolean> => {
        if (!updatedData.recurringSchedule) return true;

        for (let dayIndex = 0; dayIndex < updatedData.recurringSchedule.length; dayIndex++) {
            const day = updatedData.recurringSchedule[dayIndex];
            if (!day?.sessions) continue;

            for (let sessionIndex = 0; sessionIndex < day.sessions.length; sessionIndex++) {
                const sessionThumbnail = getSessionThumbnail(dayIndex, sessionIndex);
                if (!sessionThumbnail) continue;

                try {
                    const sessionThumbnailId = await UploadFileInS3(
                        sessionThumbnail,
                        () => { },
                        'your-user-id'
                    );
                    const target =
                        updatedData.recurringSchedule?.[dayIndex]?.sessions?.[sessionIndex];
                    if (target) {
                        updatedData.recurringSchedule[dayIndex]!.sessions![
                            sessionIndex
                        ]!.thumbnailFileId = sessionThumbnailId;
                    }
                } catch (error) {
                    console.error(
                        `Error uploading thumbnail for ${day.day} session ${sessionIndex + 1}:`,
                        error
                    );
                    toast.error(
                        t('toasts.uploadThumbnailForSessionFailed', {
                            day: day.day,
                            sessionNumber: sessionIndex + 1,
                        })
                    );
                    return false;
                }
            }
        }
        return true;
    };

    const executeSubmission = async (
        data: z.infer<typeof sessionFormSchema>,
        updateRecurrenceScope: 'ONLY_THIS' | 'ALL_FUTURE' | 'CURRENT_DAY_ALL_SESSIONS' | 'ALL_FUTURE_ALL_SESSIONS' | null = null
    ) => {
        if (isSubmitting) return; // Prevent multiple submissions

        setIsSubmitting(true);
        try {
            const uploadedFiles = await uploadCoreFiles();
            if (!uploadedFiles) {
                setIsSubmitting(false);
                return;
            }

            const updatedData = buildMergedFormData(data);

            const thumbnailsUploaded = await uploadRecurringSessionThumbnails(updatedData);
            if (!thumbnailsUploaded) {
                setIsSubmitting(false);
                return;
            }

            // Session IDs already in the form data are sufficient for the backend
            // to determine updates vs new additions — pass an empty originalSchedules array.
            // Cover = the admin-chosen hero image for the public registration
            // page. No more silent institute-logo fallback: no cover means the
            // public page renders its theme gradient instead.
            const body = transformFormToDTOStep1(
                updatedData,
                INSTITUTE_ID,
                [],
                uploadedFiles.musicFileId,
                uploadedFiles.thumbnailFileId,
                uploadedFiles.coverFileId ?? null,
                updateRecurrenceScope
            );
            // Only attendance-only institutes choose learner visibility; for
            // everyone else the request stays exactly as before.
            if (!liveSessionSettings.attendanceOnlyMode) {
                delete body.show_to_learners;
            }

            const response = await createLiveSessionStep1(body);
            setSessionId(response.id);
            setStep1Data(data);
            navigate({ to: '/study-library/live-session/schedule/step2' });
        } catch (error) {
            console.error('Error saving session:', error);
            toast.error(t('toasts.saveSessionFailed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const executeCopySession = () => {
        if (!copySourceSession || selectedDaysToCopy.length === 0) return;

        const { dayIndex: sourceDayIndex, sessionIndex: sourceSessionIndex } = copySourceSession;
        const recurringSchedule = form.getValues('recurringSchedule');
        const sourceSession = recurringSchedule?.[sourceDayIndex]?.sessions?.[sourceSessionIndex];

        if (!sourceSession) return;

        selectedDaysToCopy.forEach((targetDayIndex) => {
            const targetDay = recurringSchedule[targetDayIndex];
            if (!targetDay) return;

            const sessionData = {
                startTime: sourceSession.startTime,
                durationHours: sourceSession.durationHours,
                durationMinutes: sourceSession.durationMinutes,
                link: sourceSession.link,
                countAttendanceDaily: sourceSession.countAttendanceDaily,
                thumbnailFileId: sourceSession.thumbnailFileId,
            };

            const currentSessions = [...(targetDay.sessions || [])];

            if (currentSessions[sourceSessionIndex]) {
                currentSessions[sourceSessionIndex] = {
                    ...currentSessions[sourceSessionIndex],
                    ...sessionData,
                };
            } else {
                currentSessions.push(sessionData);
            }

            form.setValue(`recurringSchedule.${targetDayIndex}.sessions`, currentSessions, {
                shouldDirty: true,
            });

            // Explicitly set individual field paths for any newly added session
            // to ensure React Hook Form properly registers them for handleSubmit
            const lastIdx = currentSessions.length - 1;
            const lastSession = currentSessions[lastIdx];
            if (lastSession && !lastSession.id) {
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.sessions.${lastIdx}.startTime`,
                    lastSession.startTime || '',
                    { shouldDirty: true }
                );
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.sessions.${lastIdx}.durationHours`,
                    lastSession.durationHours || '0',
                    { shouldDirty: true }
                );
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.sessions.${lastIdx}.durationMinutes`,
                    lastSession.durationMinutes || '30',
                    { shouldDirty: true }
                );
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.sessions.${lastIdx}.link`,
                    lastSession.link || '',
                    { shouldDirty: true }
                );
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.sessions.${lastIdx}.countAttendanceDaily`,
                    lastSession.countAttendanceDaily || false,
                    { shouldDirty: true }
                );
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.sessions.${lastIdx}.thumbnailFileId`,
                    lastSession.thumbnailFileId || '',
                    { shouldDirty: true }
                );
            }

            if (!targetDay.isSelect) {
                form.setValue(`recurringSchedule.${targetDayIndex}.isSelect`, true);
            }
        });

        toast.success(t('toasts.sessionCopied'));
        setCopySourceSession(null);
        setSelectedDaysToCopy([]);
    };

    const executeCopyDefaultLink = () => {
        if (!copySourceDefaultLink || selectedDaysToCopyDefaultLink.length === 0) return;

        const { dayIndex: sourceDayIndex } = copySourceDefaultLink;
        const recurringSchedule = form.getValues('recurringSchedule');
        const sourceDay = recurringSchedule?.[sourceDayIndex];

        if (!sourceDay) return;

        selectedDaysToCopyDefaultLink.forEach((targetDayIndex) => {
            const targetDay = recurringSchedule[targetDayIndex];
            if (!targetDay) return;

            form.setValue(
                `recurringSchedule.${targetDayIndex}.default_class_link`,
                sourceDay.default_class_link,
                { shouldDirty: true, shouldTouch: true, shouldValidate: true }
            );
            form.setValue(
                `recurringSchedule.${targetDayIndex}.default_class_name`,
                sourceDay.default_class_name,
                { shouldDirty: true, shouldTouch: true, shouldValidate: true }
            );

            if (!targetDay.isSelect) {
                form.setValue(`recurringSchedule.${targetDayIndex}.isSelect`, true);
            }
        });

        toast.success(t('toasts.defaultLinkCopied'));
        setCopySourceDefaultLink(null);
        setSelectedDaysToCopyDefaultLink([]);
        setIsCopyDefaultLinkDialogOpen(false);
    };

    /**
     * Applies the link from a specific session to other sessions based on the selected scope.
     * This only updates the form on the frontend — no API call or navigation.
     */
    const applyLinkWithScope = (
        scope: 'ONLY_THIS' | 'ALL_FUTURE' | 'CURRENT_DAY_ALL_SESSIONS' | 'ALL_FUTURE_ALL_SESSIONS',
        dayIndex: number,
        sessionIndex: number
    ) => {
        const recurringSchedule = form.getValues('recurringSchedule');
        if (!recurringSchedule) return;

        const currentLink = recurringSchedule[dayIndex]?.sessions?.[sessionIndex]?.link || '';

        switch (scope) {
            case 'ONLY_THIS':
                // Link is already set via field.onChange, nothing else to do
                break;

            case 'CURRENT_DAY_ALL_SESSIONS': {
                // Update all sessions on the current day with this link
                const currentDay = recurringSchedule[dayIndex];
                if (currentDay?.sessions) {
                    currentDay.sessions.forEach((_, idx) => {
                        form.setValue(
                            `recurringSchedule.${dayIndex}.sessions.${idx}.link`,
                            currentLink,
                            { shouldDirty: true }
                        );
                    });
                }
                break;
            }

            case 'ALL_FUTURE': {
                // Update the same session index on the SAME day only (e.g., only Mondays).
                // The scope means "this session on all upcoming occurrences of this day",
                // NOT across all days of the week.
                const currentDay = recurringSchedule[dayIndex];
                if (currentDay?.sessions?.[sessionIndex]) {
                    form.setValue(
                        `recurringSchedule.${dayIndex}.sessions.${sessionIndex}.link`,
                        currentLink,
                        { shouldDirty: true }
                    );
                }
                break;
            }

            case 'ALL_FUTURE_ALL_SESSIONS': {
                // Update all sessions on the SAME day only (e.g., all sessions on Monday).
                // The scope means "all sessions on all upcoming occurrences of this day",
                // NOT all sessions across all days of the week.
                const sameDaySessions = recurringSchedule[dayIndex];
                if (sameDaySessions?.isSelect && sameDaySessions?.sessions) {
                    sameDaySessions.sessions.forEach((_, sIdx) => {
                        form.setValue(
                            `recurringSchedule.${dayIndex}.sessions.${sIdx}.link`,
                            currentLink,
                            { shouldDirty: true }
                        );
                    });
                }
                break;
            }
        }

        // Store the selected scope so it's included in the payload when Next is clicked
        setPendingRecurrenceScope(scope);
        toast.success(t('toasts.linkUpdated'));
    };

    const onSubmit = (data: z.infer<typeof sessionFormSchema>) => {
        // Check if there are genuinely new sessions (without IDs) in the form data.
        // Also check the live form state to catch dynamically added sessions that
        // the resolver might not have included.
        const latestSchedule = form.getValues('recurringSchedule');
        const hasNewSessions =
            (data.recurringSchedule?.some(
                (day) => day.isSelect && day.sessions.some((session) => !session.id)
            ) ??
                false) ||
            (latestSchedule?.some(
                (day) => day.isSelect && day.sessions.some((session) => !session.id)
            ) ??
                false);

        // If scope was already chosen via Apply button, use it directly.
        // Keep the scope even when new sessions are being added so the backend
        // can create recurring instances for the new sessions.
        if (isEdit && pendingRecurrenceScope) {
            executeSubmission(data, pendingRecurrenceScope);
            setPendingRecurrenceScope(null);
            return;
        }

        const changedDay = checkForLinkChanges(data, step1Data);
        if (isEdit && changedDay) {
            setPendingSubmitData(data);
            setChangedDayLabel(changedDay.charAt(0).toUpperCase() + changedDay.slice(1));
            setIsLinkUpdateDialogOpen(true);
        } else if (isEdit && hasNewSessions) {
            // When new sessions are added during editing without any link changes,
            // send ALL_FUTURE_ALL_SESSIONS scope so the backend generates recurring
            // instances for the new sessions across all future occurrences.
            executeSubmission(data, 'ALL_FUTURE_ALL_SESSIONS');
        } else {
            executeSubmission(data);
        }
    };

    const onError = (errors: FieldErrors<typeof sessionFormSchema>) => {
        console.error('Validation errors:', errors);

        const extractErrors = (obj: any): string[] => {
            const messages: string[] = [];
            if (typeof obj !== 'object' || obj === null) return messages;

            // If the object has a 'message' property that is a string, it's likely a FieldError
            if (obj.message && typeof obj.message === 'string') {
                messages.push(obj.message);
                return messages;
            }

            // Recursively search in values (for nested objects/arrays)
            Object.values(obj).forEach((value) => {
                messages.push(...extractErrors(value));
            });

            return messages;
        };

        const allErrors = extractErrors(errors);
        const uniqueErrors = Array.from(new Set(allErrors));

        if (uniqueErrors.length > 0) {
            toast.error(t('toasts.fixErrors'), {
                description: (
                    <div className="mt-2 flex flex-col gap-1 text-slate-800">
                        {uniqueErrors.slice(0, 5).map((error, index) => (
                            <div key={index} className="flex gap-2 text-sm font-medium">
                                <span className="text-red-500">•</span>
                                <span>{error}</span>
                            </div>
                        ))}
                        {uniqueErrors.length > 5 && (
                            <div className="text-sm opacity-80">
                                {t('toasts.moreErrors', { count: uniqueErrors.length - 5 })}
                            </div>
                        )}
                    </div>
                ),
                icon: <XCircle size={20} className="text-red-500" />,
                duration: 5000,
            });
        } else {
            toast.error(t('toasts.fillRequiredFields'), {
                icon: <XCircle size={20} className="text-red-500" />,
            });
        }
    };

    // Recurring Schedule Handlers
    const addSessionToDay = (dayIndex: number) => {
        const schedule = form.getValues('recurringSchedule');
        const daySchedule = schedule?.[dayIndex];
        if (!daySchedule) return;

        // Get the countAttendanceDaily value from the first session of this day
        const firstSessionAttendance = daySchedule.sessions[0]?.countAttendanceDaily || false;

        // Get global defaults to use as fallback for new sessions
        const globalDurationHours = form.getValues('durationHours') || '0';
        const globalDurationMinutes = form.getValues('durationMinutes') || '30';
        const globalLink = form.getValues('defaultLink') || '';

        // Determine session to copy:
        const defaultSession = {
            startTime: '',
            durationHours: globalDurationHours,
            durationMinutes: globalDurationMinutes,
            link: globalLink,
            countAttendanceDaily: firstSessionAttendance, // Use the first session's attendance setting
            thumbnailFileId: '',
        };
        // Pick source session (with optional props)
        const rawSession =
            (dayIndex === 0
                ? daySchedule.sessions[0]
                : (schedule[0]?.sessions || [])[daySchedule.sessions.length]) ||
            (dayIndex === 0 ? defaultSession : schedule[0]?.sessions[0]) ||
            defaultSession;
        // Normalize fields to strings, using global defaults as fallback
        const sessionToCopy = {
            startTime: rawSession.startTime || '',
            durationHours: rawSession.durationHours || globalDurationHours,
            durationMinutes: rawSession.durationMinutes || globalDurationMinutes,
            link: rawSession.link || globalLink,
            countAttendanceDaily: firstSessionAttendance, // Ensure new session uses same attendance setting
            thumbnailFileId: rawSession.thumbnailFileId || '',
        };
        const updatedSessions = [...daySchedule.sessions, sessionToCopy];
        form.setValue(`recurringSchedule.${dayIndex}.sessions`, updatedSessions, {
            shouldDirty: true,
            shouldValidate: true,
        });

        // CRITICAL FIX: Explicitly set individual field paths for the new session.
        // React Hook Form tracks field registrations separately from _formValues.
        // When we set the entire sessions array via setValue above, the new session's
        // individual fields may not be properly registered for handleSubmit.
        // By setting each field individually, we ensure RHF correctly tracks them.
        const newSessionIndex = updatedSessions.length - 1;
        form.setValue(
            `recurringSchedule.${dayIndex}.sessions.${newSessionIndex}.startTime`,
            sessionToCopy.startTime,
            { shouldDirty: true }
        );
        form.setValue(
            `recurringSchedule.${dayIndex}.sessions.${newSessionIndex}.durationHours`,
            sessionToCopy.durationHours,
            { shouldDirty: true }
        );
        form.setValue(
            `recurringSchedule.${dayIndex}.sessions.${newSessionIndex}.durationMinutes`,
            sessionToCopy.durationMinutes,
            { shouldDirty: true }
        );
        form.setValue(
            `recurringSchedule.${dayIndex}.sessions.${newSessionIndex}.link`,
            sessionToCopy.link,
            { shouldDirty: true }
        );
        form.setValue(
            `recurringSchedule.${dayIndex}.sessions.${newSessionIndex}.countAttendanceDaily`,
            sessionToCopy.countAttendanceDaily,
            { shouldDirty: true }
        );
        form.setValue(
            `recurringSchedule.${dayIndex}.sessions.${newSessionIndex}.thumbnailFileId`,
            sessionToCopy.thumbnailFileId,
            { shouldDirty: true }
        );
    };

    const removeSessionFromDay = (dayIndex: number, sessionIndex: number) => {
        const sessions = form.getValues(`recurringSchedule.${dayIndex}.sessions`);
        const updatedSessions = [...(Array.isArray(sessions) ? sessions : [])];
        updatedSessions.splice(sessionIndex, 1);

        form.setValue(`recurringSchedule.${dayIndex}.sessions`, updatedSessions);

        if (updatedSessions.length === 0) {
            form.setValue(`recurringSchedule.${dayIndex}.isSelect`, false);
        }
    };

    const toggleEveryDay = () => {
        const currentSchedule = form.getValues('recurringSchedule');
        if (!currentSchedule) return;

        const allSelected = currentSchedule.every((day) => day.isSelect);
        currentSchedule.forEach((day, index) => {
            const isSelecting = !allSelected;
            form.setValue(`recurringSchedule.${index}.isSelect`, isSelecting);

            const dh = form.getValues('durationHours');
            const dm = form.getValues('durationMinutes');
            const l = form.getValues('defaultLink');

            if (isSelecting && (!day.sessions || day.sessions.length === 0)) {
                form.setValue(`recurringSchedule.${index}.sessions`, [
                    {
                        startTime: '',
                        durationHours: dh,
                        durationMinutes: dm,
                        link: l,
                        countAttendanceDaily:
                            liveSessionSettings.defaultDailyAttendanceCounting,
                        thumbnailFileId: '',
                    },
                ]);
            }
        });
    };

    const toggleMonToFri = () => {
        const currentSchedule = form.getValues('recurringSchedule');
        if (!currentSchedule) return;

        currentSchedule.forEach((day, index) => {
            const weekDay = WEEK_DAYS.find((d) => d.label === day.day);
            const isWeekday = weekDay?.value
                ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekDay.value)
                : false;
            form.setValue(`recurringSchedule.${index}.isSelect`, isWeekday);

            const dh = form.getValues('durationHours');
            const dm = form.getValues('durationMinutes');
            const l = form.getValues('defaultLink');

            if (isWeekday && (!day.sessions || day.sessions.length === 0)) {
                form.setValue(`recurringSchedule.${index}.sessions`, [
                    {
                        startTime: '',
                        durationHours: dh,
                        durationMinutes: dm,
                        link: l,
                        countAttendanceDaily:
                            liveSessionSettings.defaultDailyAttendanceCounting,
                        thumbnailFileId: '',
                    },
                ]);
            }
        });
    };
    const toggleMonToSat = () => {
        const currentSchedule = form.getValues('recurringSchedule');
        if (!currentSchedule) return;

        currentSchedule.forEach((day, index) => {
            const weekDay = WEEK_DAYS.find((d) => d.label === day.day);
            const isWeekday = weekDay?.value
                ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].includes(weekDay.value)
                : false;
            form.setValue(`recurringSchedule.${index}.isSelect`, isWeekday);

            const dh = form.getValues('durationHours');
            const dm = form.getValues('durationMinutes');
            const l = form.getValues('defaultLink');

            if (isWeekday && (!day.sessions || day.sessions.length === 0)) {
                form.setValue(`recurringSchedule.${index}.sessions`, [
                    {
                        startTime: '',
                        durationHours: dh,
                        durationMinutes: dm,
                        link: l,
                        countAttendanceDaily:
                            liveSessionSettings.defaultDailyAttendanceCounting,
                        thumbnailFileId: '',
                    },
                ]);
            }
        });
    };
    const toggleCustom = () => {
        const currentSchedule = form.getValues('recurringSchedule');
        if (!currentSchedule) return;

        currentSchedule.forEach((day, index) => {
            const weekDay = WEEK_DAYS.find((d) => d.label === day.day);
            const isWeekday = weekDay?.value ? [''].includes(weekDay.value) : false;
            form.setValue(`recurringSchedule.${index}.isSelect`, isWeekday);

            const dh = form.getValues('durationHours');
            const dm = form.getValues('durationMinutes');
            const l = form.getValues('defaultLink');

            if (isWeekday && (!day.sessions || day.sessions.length === 0)) {
                form.setValue(`recurringSchedule.${index}.sessions`, [
                    {
                        startTime: '',
                        durationHours: dh,
                        durationMinutes: dm,
                        link: l,
                        countAttendanceDaily:
                            liveSessionSettings.defaultDailyAttendanceCounting,
                        thumbnailFileId: '',
                    },
                ]);
            }
        });
    };

    // Open dialog to select days to copy to
    const openCopyDialog = (dayIndex: number, sessionIndex: number) => {
        setCopySourceSession({ dayIndex, sessionIndex });
        // Pre-select all other days that are enabled
        const schedule = form.getValues('recurringSchedule');
        if (schedule) {
            const otherDaysIndices = schedule
                .map((day, idx) => (idx !== dayIndex && day.isSelect ? idx : -1))
                .filter((idx) => idx !== -1);
            setSelectedDaysToCopy(otherDaysIndices);
        }
        setIsCopyDialogOpen(true);
    };

    // Manual copy function to copy session data to selected days
    const applyDefaultLinkToSelectedDays = () => {
        if (!pendingDefaultLink) return;

        const currentSchedule = form.getValues('recurringSchedule') || [];

        selectedDaysForLink.forEach((dayName) => {
            const dayIndex = currentSchedule.findIndex((d) => d.day === dayName);
            if (dayIndex === -1) return;

            const day = currentSchedule[dayIndex];
            if (!day || !day.sessions) return;

            // Update ALL sessions for this day
            day.sessions.forEach((session, sessionIndex) => {
                form.setValue(
                    `recurringSchedule.${dayIndex}.sessions.${sessionIndex}.link`,
                    pendingDefaultLink
                );
            });
        });

        setIsDefaultLinkDialogOpen(false);
        setSelectedDaysForLink([]);
        setPendingDefaultLink('');
    };

    const handleToggleDayForLink = (dayName: string) => {
        setSelectedDaysForLink((prev) =>
            prev.includes(dayName) ? prev.filter((d) => d !== dayName) : [...prev, dayName]
        );
    };

    const copySessionToSelectedDays = () => {
        if (!copySourceSession) return;

        const { dayIndex: sourceDayIndex, sessionIndex } = copySourceSession;
        const schedule = form.getValues('recurringSchedule');
        if (!schedule) return;

        const sourceSession = schedule[sourceDayIndex]?.sessions[sessionIndex];
        const sourceDay = schedule[sourceDayIndex];
        if (!sourceSession || !sourceDay) return;

        // Copy to selected days
        selectedDaysToCopy.forEach((targetDayIndex) => {
            const targetDay = schedule[targetDayIndex];
            if (targetDay && targetDay.isSelect) {
                // Copy day-level configurations
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.default_class_link`,
                    sourceDay.default_class_link || null,
                    { shouldDirty: true }
                );
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.default_class_name`,
                    sourceDay.default_class_name || null,
                    { shouldDirty: true }
                );
                form.setValue(
                    `recurringSchedule.${targetDayIndex}.learner_button_config`,
                    sourceDay.learner_button_config || null,
                    { shouldDirty: true }
                );

                // If target session doesn't exist, create it
                if (!targetDay.sessions[sessionIndex]) {
                    const currentSessions =
                        form.getValues(`recurringSchedule.${targetDayIndex}.sessions`) || [];
                    form.setValue(`recurringSchedule.${targetDayIndex}.sessions`, [
                        ...currentSessions,
                        {
                            startTime: sourceSession.startTime,
                            durationHours: sourceSession.durationHours,
                            durationMinutes: sourceSession.durationMinutes,
                            link: sourceSession.link || '',
                            thumbnailFileId: '',
                            countAttendanceDaily:
                                targetDay.sessions[0]?.countAttendanceDaily || false,
                        },
                    ]);
                } else {
                    // Update existing session
                    form.setValue(
                        `recurringSchedule.${targetDayIndex}.sessions.${sessionIndex}.startTime`,
                        sourceSession.startTime,
                        { shouldDirty: true }
                    );
                    form.setValue(
                        `recurringSchedule.${targetDayIndex}.sessions.${sessionIndex}.durationHours`,
                        sourceSession.durationHours,
                        { shouldDirty: true }
                    );
                    form.setValue(
                        `recurringSchedule.${targetDayIndex}.sessions.${sessionIndex}.durationMinutes`,
                        sourceSession.durationMinutes,
                        { shouldDirty: true }
                    );
                    form.setValue(
                        `recurringSchedule.${targetDayIndex}.sessions.${sessionIndex}.link`,
                        sourceSession.link || '',
                        { shouldDirty: true }
                    );
                }
            }
        });

        toast.success(
            t('toasts.sessionDetailsCopied', { count: selectedDaysToCopy.length })
        );
        setIsCopyDialogOpen(false);
        setCopySourceSession(null);
        setSelectedDaysToCopy([]);
    };

    // Toggle day selection in copy dialog
    const toggleDaySelection = (dayIndex: number) => {
        setSelectedDaysToCopy((prev) =>
            prev.includes(dayIndex) ? prev.filter((idx) => idx !== dayIndex) : [...prev, dayIndex]
        );
    };

    // Render Functions
    const renderBasicInformation = () => (
        <div className="flex flex-col gap-6">
            <div className="flex w-full flex-col items-start justify-start gap-4 sm:flex-row">
                <FormField
                    control={control}
                    name="title"
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <MyInput
                                    inputType="text"
                                    inputPlaceholder={t('basicInfo.titlePlaceholder')}
                                    input={field.value}
                                    labelStyle="font-thin"
                                    onChangeFunction={field.onChange}
                                    error={form.formState.errors.title?.message}
                                    required
                                    size="large"
                                    label={t('basicInfo.titleLabel')}
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
                <SelectField
                    label={getTerminology(ContentTerms.Subject, SystemTerms.Subject)}
                    name="subject"
                    labelStyle="text-sm font-medium"
                    options={[
                        {
                            value: 'none',
                            label: t('basicInfo.selectSubject', {
                                subject: getTerminology(ContentTerms.Subject, SystemTerms.Subject),
                            }),
                            _id: -1,
                        },
                        ...SubjectFilterData.map((option, index) => ({
                            value: option.name,
                            label: option.name,
                            _id: index,
                        })),
                    ]}
                    control={form.control}
                    className="mt-[8px] w-full font-thin sm:w-56"
                />
            </div>

            {liveSessionSettings.attendanceOnlyMode && (
                <Controller
                    control={control}
                    name="showToLearners"
                    render={({ field }) => (
                        <label className="flex items-center justify-between gap-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                            <div>
                                <div className="text-sm font-medium text-neutral-800">
                                    {t('basicInfo.showToLearnersLabel')}
                                </div>
                                <div className="mt-0.5 text-xs text-neutral-500">
                                    {field.value
                                        ? t('basicInfo.showToLearnersOnHint')
                                        : t('basicInfo.showToLearnersOffHint')}
                                </div>
                            </div>
                            <Switch
                                checked={field.value ?? false}
                                onCheckedChange={field.onChange}
                            />
                        </label>
                    )}
                />
            )}

            {liveSessionSettings.descriptionEnabled && (
            <div className="flex h-full flex-col gap-6">
                <div className="-mb-5 flex flex-col gap-1">
                    <h1 className="text-sm font-medium">{t('basicInfo.descriptionLabel')}</h1>
                    <p className="text-xs font-normal text-neutral-500">
                        {t('basicInfo.descriptionHint')}
                    </p>
                </div>
                <FormField
                    control={control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <RichTextEditor
                                    onChange={field.onChange}
                                    value={field.value || ''}
                                    onBlur={field.onBlur}
                                    minHeight={200}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>
            )}
        </div>
    );

    const renderMeetingTypeSelection = () => {
        // In edit mode keep BOTH options visible regardless of the institute
        // setting — otherwise an existing recurring session being edited would
        // appear to silently lose its recurring data when the radio option
        // disappears. The setting only gates new sessions.
        const showWeeklyOption = liveSessionSettings.recurringEnabled || isEdit;
        const meetingTypeOptions = [
            { label: t('meetingType.oneTime'), value: RecurringType.ONCE },
            ...(showWeeklyOption
                ? [{ label: t('meetingType.recurring'), value: RecurringType.WEEKLY }]
                : []),
        ];
        return (
            <FormField
                control={control}
                name="meetingType"
                render={({ field }) => (
                    <MyRadioButton
                        name="meetingType"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        options={meetingTypeOptions}
                        className="flex flex-col gap-4 sm:flex-row"
                    />
                )}
            />
        );
    };

    const renderTimezoneSelection = () => {
        const selectedTimezone = form.watch('timeZone') || 'Asia/Kolkata';

        // Get current time in selected timezone
        const getCurrentTime = (timezone: string) => {
            try {
                const now = new Date();
                const zonedTime = toZonedTime(now, timezone);
                return formatTZ(zonedTime, 'PPp', { timeZone: timezone });
            } catch {
                return '';
            }
        };

        const currentTime = getCurrentTime(selectedTimezone);

        return (
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <SelectField
                        label={t('timezone.label')}
                        name="timeZone"
                        labelStyle="text-sm font-medium"
                        options={TIMEZONE_OPTIONS}
                        control={form.control}
                        className="mt-[8px] w-full font-thin sm:w-80"
                        required
                    />
                    {currentTime && (
                        <span className="ml-1 text-xs font-medium">
                            {t('timezone.currentTime', { time: currentTime })}
                        </span>
                    )}
                </div>
            </div>
        );
    };

    const renderSessionTiming = () => (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-8">
                <FormField
                    control={control}
                    name="startTime"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-sm font-medium">
                                {t('timing.startDateTime')}
                                <span className="text-danger-600">*</span>
                            </FormLabel>
                            <FormControl>
                                <MyInput
                                    required
                                    inputType="datetime-local"
                                    input={field.value}
                                    onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) => {
                                        field.onChange(e);
                                        const dateTime = e.target.value;
                                        const timeValue = dateTime.split('T')[1] || '';
                                        const schedule = form.getValues('recurringSchedule') || [];
                                        schedule.forEach((day, idx) => {
                                            if (day.isSelect) {
                                                form.setValue(
                                                    `recurringSchedule.${idx}.sessions.0.startTime`,
                                                    timeValue
                                                );
                                            }
                                        });
                                    }}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
                {meetingType !== RecurringType.WEEKLY && (
                    <div>
                        <FormLabel className="text-sm font-medium">
                            {t('timing.duration')}<span className="text-danger-600">*</span>
                        </FormLabel>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <FormField
                                control={control}
                                name="durationHours"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                required
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    if (!/[0-9]/.test(e.key)) {
                                                        e.preventDefault();
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    let inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    );
                                                    const numValue = parseInt(inputValue);
                                                    if (numValue > 24) {
                                                        inputValue = '24';
                                                    }
                                                    field.onChange(inputValue);
                                                }}
                                                className="w-11 p-2"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div>{t('timing.hrs')}</div>
                            <FormField
                                control={control}
                                name="durationMinutes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                required
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    if (!/[0-9]/.test(e.key)) {
                                                        e.preventDefault();
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    let inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    );
                                                    const numValue = parseInt(inputValue);
                                                    if (numValue > 59) {
                                                        inputValue = '59';
                                                    }
                                                    field.onChange(inputValue);
                                                }}
                                                className="w-11 p-2"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div>{t('timing.mins')}</div>
                        </div>
                    </div>
                )}
            </div>
            {meetingType === RecurringType.WEEKLY && (
                <div className="flex flex-row gap-6">
                    <FormField
                        control={control}
                        name="endDate"
                        render={({ field }) => {
                            // Compute min date from startTime (end date must be after start date)
                            const startTimeValue = form.getValues('startTime');
                            const minEndDate = startTimeValue
                                ? startTimeValue.split('T')[0]
                                : undefined;
                            // Ensure end date is after start date to satisfy validation
                            const computedMin = minEndDate
                                ? (() => {
                                    const d = new Date(minEndDate);
                                    d.setDate(d.getDate() + 1);
                                    return format(d, 'yyyy-MM-dd');
                                })()
                                : undefined;
                            return (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium">
                                        {t('timing.endDate')}
                                        <span className="text-danger-600">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="date"
                                            input={field.value}
                                            onChangeFunction={field.onChange}
                                            min={computedMin}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            );
                        }}
                    />
                </div>
            )}
        </div>
    );

    const renderLiveClassLink = () => (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:gap-8">
            <FormField
                control={control}
                name="defaultLink"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel className="text-sm font-medium">
                            {t('link.liveClassLink')}
                            {!isZohoPlatform && !isBbbPlatform && !isZoomWithAccount && !isMeetWithAccount && <span className="text-danger-600">*</span>}
                        </FormLabel>
                        <FormControl>
                            <MyInput
                                inputType="text"
                                inputPlaceholder={isZohoPlatform ? t('link.placeholderZoho') : isBbbPlatform ? t('link.placeholderBbb') : isZoomWithAccount ? t('link.placeholderZoom') : isMeetWithAccount ? t('link.placeholderMeet') : t('link.placeholderDefault')}
                                input={field.value}
                                labelStyle="font-thin"
                                onChangeFunction={field.onChange}
                                error={form.formState.errors.defaultLink?.message}
                                required={!isZohoPlatform && !isBbbPlatform && !isZoomWithAccount && !isMeetWithAccount}
                                disabled={isZohoPlatform || isBbbPlatform || isZoomWithAccount || isMeetWithAccount}
                                size="large"
                                {...field}
                                onBlur={(e) => {
                                    field.onBlur();

                                    // Only in CREATE mode
                                    if (isEditModeRef.current) return;

                                    const newLink = e.target.value;
                                    if (!newLink) return;

                                    const currentSchedule = form.getValues('recurringSchedule');
                                    const activeDays =
                                        currentSchedule?.filter(
                                            (day) => day.isSelect && day.sessions?.length > 0
                                        ) || [];

                                    if (activeDays.length === 0) return;

                                    const needsUpdate = activeDays.some((day) =>
                                        day.sessions.some((session) => session.link !== newLink)
                                    );

                                    if (needsUpdate) {
                                        const dayNames = activeDays.map((day) => day.day);
                                        setSelectedDaysForLink(dayNames);
                                        setPendingDefaultLink(newLink);
                                        setIsDefaultLinkDialogOpen(true);
                                    }
                                }}
                            />
                        </FormControl>
                    </FormItem>
                )}
            />
            <SelectField
                label={t('link.platformLabel')}
                name="sessionPlatform"
                labelStyle="text-sm font-medium"
                options={editAwareStreamingOptions}
                control={form.control}
                className="mt-[8px] w-full font-thin sm:w-56"
                onSelect={handleSessionPlatformChange}
            />
            <div className="flex h-full flex-col items-start justify-around gap-2">
                <div className="text-sm font-medium">{t('link.typeOfLiveClass')}</div>
                <FormField
                    control={control}
                    name="sessionType"
                    render={({ field }) => (
                        <MyRadioButton
                            name="meetingType"
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            options={[
                                { label: t('link.live'), value: SessionType.LIVE },
                                { label: t('link.preRecorded'), value: SessionType.PRE_RECORDED },
                            ]}
                            disabledOptions={disabledLiveClassOptions}
                            className="flex flex-col gap-4 sm:flex-row"
                        />
                    )}
                />
            </div>

            </div>

            {/* BBB Meeting Configuration */}
            {isBbbPlatform && (
                <div className="rounded-lg border border-primary-200 bg-primary-50/30 p-4">
                    <h4 className="text-sm font-semibold">{t('bbb.settingsTitle')}</h4>
                    <p className="mb-3 mt-0.5 text-xs text-neutral-500">
                        {t('bbb.restrictionsHint')}
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField
                            control={control}
                            name="bbbRecord"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? true}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.recordSession')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbAutoStartRecording"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.autoStartRecording')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbMuteOnStart"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? true}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.muteOnJoin')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbWebcamsOnlyForModerator"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.onlyHostWebcam')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbDisableMic"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.listenOnlyMode')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbDisableCam"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.noCamera')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbDisablePrivateChat"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.noPrivateChat')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbDisablePublicChat"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.noPublicChat')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbDisableSharedNotes"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.noSharedNotes')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbHideUserList"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.hideUserList')}</FormLabel>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={control}
                            name="bbbEndWhenNoModerator"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <input
                                            type="checkbox"
                                            checked={field.value ?? false}
                                            onChange={(e) => field.onChange(e.target.checked)}
                                            className="size-4 rounded border-gray-300"
                                        />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">{t('bbb.endWhenNoModerator')}</FormLabel>
                                </FormItem>
                            )}
                        />
                    </div>
                    <FormField
                        control={control}
                        name="bbbActivenessScore"
                        render={({ field }) => (
                            <FormItem className="mt-3 flex items-start justify-between gap-3 space-y-0 rounded-md border border-neutral-200 bg-white px-3 py-2">
                                <div>
                                    <FormLabel className="text-sm font-normal">
                                        {t('bbb.activenessScore')}
                                    </FormLabel>
                                    <p className="mt-0.5 text-xs text-neutral-500">
                                        {t('bbb.activenessScoreHint')}
                                    </p>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={field.value ?? false}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <p className="mt-3 text-xs text-neutral-500">
                        {t('bbb.lectureHintIntro')}{' '}
                        <span className="font-medium">{t('bbb.listenOnlyModeShort')}</span>{' '}
                        {t('bbb.lectureHintAnd')}{' '}
                        <span className="font-medium">
                            {t('bbb.noCameraShort')}
                        </span>
                        {t('bbb.lectureHintOutro')}
                    </p>
                    <div className="mt-3">
                        <FormField
                            control={control}
                            name="bbbGuestPolicy"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-normal">{t('bbb.guestPolicy')}</FormLabel>
                                    <FormControl>
                                        <select
                                            value={field.value ?? 'ALWAYS_ACCEPT'}
                                            onChange={field.onChange}
                                            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-64"
                                        >
                                            <option value="ALWAYS_ACCEPT">{t('bbb.alwaysAccept')}</option>
                                            <option value="ASK_MODERATOR">{t('bbb.askApprove')}</option>
                                            <option value="ALWAYS_DENY">{t('bbb.alwaysDeny')}</option>
                                        </select>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                </div>
            )}

            {/* Zoom Meeting Configuration — account picker + per-meeting settings.
                Falls back to a hint + the manual link field when no accounts exist. */}
            {isZoomPlatform && (
                <ZoomMeetingConfigField control={control} setValue={form.setValue} />
            )}

            {/* Google Meet account picker — auto-generates a Meet space when an account is chosen. */}
            {isMeetPlatform && (
                <GoogleMeetConfigField control={control} setValue={form.setValue} />
            )}
        </div>
    );

    const renderFeedbackSettings = () => (
        <div className="rounded-lg border border-primary-200 bg-primary-50/30 p-4">
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="text-sm font-semibold">📋 {t('feedback.title')}</h4>
                    <p className="mt-0.5 text-xs text-neutral-500">
                        {t('feedback.hint')}
                    </p>
                </div>
                <FormField
                    control={control}
                    name="feedbackEnabled"
                    render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                            <FormControl>
                                <Switch
                                    checked={field.value ?? false}
                                    onCheckedChange={field.onChange}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>

            {form.watch('feedbackEnabled') && (
                <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2">
                        <div>
                            <div className="text-xs font-medium text-neutral-700">
                                {t('feedback.compulsory')}
                            </div>
                            <div className="mt-0.5 text-[11px] text-neutral-500">
                                {t('feedback.compulsoryHint')}
                            </div>
                        </div>
                        <FormField
                            control={control}
                            name="feedbackCompulsory"
                            render={({ field }) => (
                                <FormItem className="flex items-center space-y-0">
                                    <FormControl>
                                        <Switch
                                            checked={field.value ?? false}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                    <div className="text-xs font-medium text-neutral-600">{t('feedback.questions')}</div>
                    {(form.watch('feedbackQuestions') ?? buildDefaultFeedbackQuestions(t)).map((q, idx) => (
                        <div
                            key={q.id}
                            className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="flex items-center gap-2">
                                <Controller
                                    control={control}
                                    name={`feedbackQuestions.${idx}.enabled`}
                                    render={({ field }) => (
                                        <Checkbox
                                            checked={field.value ?? true}
                                            onCheckedChange={field.onChange}
                                        />
                                    )}
                                />
                                <span className="text-sm">
                                    {q.label}
                                    <span className="ml-1 text-xs text-neutral-400">
                                        ({q.type === 'star_rating' ? `⭐ ${t('feedback.ratingType')}` : t('feedback.textType')})
                                    </span>
                                </span>
                            </div>
                            <Controller
                                control={control}
                                name={`feedbackQuestions.${idx}.mandatory`}
                                render={({ field }) => (
                                    <button
                                        type="button"
                                        onClick={() => field.onChange(!field.value)}
                                        className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                                            field.value
                                                ? 'bg-primary-100 text-primary-700'
                                                : 'bg-neutral-100 text-neutral-500'
                                        }`}
                                    >
                                        {field.value ? t('feedback.required') : t('feedback.optional')}
                                    </button>
                                )}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderStreamingChoices = () => (
        <div className="flex flex-col items-start gap-8">
            <div className="flex flex-col items-start gap-4">
                <div className="flex h-full flex-col items-start justify-around gap-2">
                    <div className="text-sm font-medium">
                        {t('streaming.platformLabel')}
                        <span className="ml-1 text-xs font-normal text-neutral-500">
                            {t('streaming.platformHint')}
                        </span>
                    </div>
                    <FormField
                        control={control}
                        name="streamingType"
                        render={({ field }) => (
                            <MyRadioButton
                                name="streamingType"
                                value={field.value ?? ''}
                                onChange={field.onChange}
                                options={[
                                    {
                                        label: t('streaming.embedInApp'),
                                        value: SessionPlatform.EMBED_IN_APP,
                                    },
                                    {
                                        label:
                                            sessionPlatformWatch === StreamingPlatform.YOUTUBE
                                                ? t('streaming.redirectYoutube')
                                                : sessionPlatformWatch === StreamingPlatform.MEET
                                                    ? t('streaming.redirectMeet')
                                                    : sessionPlatformWatch === StreamingPlatform.ZOOM
                                                        ? t('streaming.redirectZoom')
                                                        : t('streaming.redirectOther'),
                                        value: SessionPlatform.REDIRECT_TO_OTHER_PLATFORM,
                                    },
                                ]}
                                disabledOptions={disabledStreamingOptions}
                                className="flex flex-col gap-4 sm:flex-row"
                            />
                        )}
                    />
                </div>
            </div>
        </div>
    );

    const renderWaitingRoomAndUpload = () => {
        const enabled = form.watch('enableWaitingRoom');
        return (
            <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-4">
                    {!isZohoPlatform && (
                        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                {t('waiting.lockPlayback')}
                            </div>
                            <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
                                <Controller
                                    control={control}
                                    name="allowRewind"
                                    render={({ field }) => (
                                        <label className="flex items-center gap-2">
                                            <span className="text-sm">{t('waiting.allowRewind')}</span>
                                            <Switch
                                                disabled={
                                                    watch('streamingType') !==
                                                    SessionPlatform.EMBED_IN_APP
                                                }
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={control}
                                    name="allowPause"
                                    render={({ field }) => (
                                        <label className="flex items-center gap-2">
                                            <span className="text-sm">{t('waiting.allowPlayPause')}</span>
                                            <Switch
                                                disabled={
                                                    watch('streamingType') !==
                                                    SessionPlatform.EMBED_IN_APP
                                                }
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div>
                            <div className="text-sm font-medium text-neutral-800">
                                {t('waiting.enableWaitingRoom')}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                                {watch('waitingRoomType') === WaitingRoomType.PRE_JOINING
                                    ? t('waiting.preJoiningHint')
                                    : t('waiting.waitingRoomHint')}
                            </div>
                        </div>
                        <Controller
                            control={control}
                            name="enableWaitingRoom"
                            render={({ field }) => (
                                <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                />
                            )}
                        />
                    </div>
                </div>
                {enabled && renderWaitingRoomDetails()}
            </div>
        );
    };

    const renderWaitingRoomDetails = () => {
        return (
                <div className="flex flex-col items-start gap-4 sm:flex-row">
                    <SelectField
                        label={t('waiting.waitingRoomTypeLabel')}
                        name="waitingRoomType"
                        labelStyle="text-sm font-medium"
                        options={WAITING_ROOM_TYPE_OPTIONS}
                        control={form.control}
                        className="mt-[8px] w-full font-thin sm:w-56"
                    />
                    <SelectField
                        label={t('waiting.openBeforeLabel')}
                        name="openWaitingRoomBefore"
                        labelStyle="text-sm font-medium"
                        options={WAITING_ROOM_OPTIONS}
                        control={form.control}
                        className="mt-[8px] w-full font-thin sm:w-56"
                    />
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept=".png, .jpg, .jpeg"
                        className="hidden"
                    />
                    <input
                        type="file"
                        ref={musicFileInputRef}
                        onChange={handleMusicFileSelect}
                        accept=".mp3, .wav, .ogg, .m4a, .aac, .flac, .wma, .aiff, .au, .mid, .midi, .mp2, .mp3, .m4a, .aac, .flac, .wma, .aiff, .au, .mid, .midi"
                        className="hidden"
                    />
                    <input
                        type="file"
                        ref={coverFileInputRef}
                        onChange={handleCoverFileSelect}
                        accept=".png, .jpg, .jpeg, .webp"
                        className="hidden"
                    />
                    <div className="flex flex-col items-start gap-2">
                        <div className="flex flex-col gap-2">
                            <div>{t('waiting.coverImage')}</div>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                onClick={handleCoverUploadClick}
                                className="flex items-center gap-2"
                            >
                                <UploadSimple size={20} />
                                {existingCoverId || selectedCoverFile ? t('waiting.replace') : t('waiting.upload')}
                            </MyButton>
                            <p className="text-sm text-neutral-500">
                                {t('waiting.coverHint')}
                            </p>
                        </div>
                        {existingCoverId && !selectedCoverFile && (
                            <div className="mt-2 flex h-fit max-w-52 flex-row items-center justify-between gap-2 rounded-md border border-green-500 bg-green-50 p-2 text-sm">
                                <span className="text-xs font-medium text-green-700">
                                    {t('waiting.existingFile')}
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleViewFile(existingCoverId, 'thumbnail')}
                                        className="text-green-600 hover:text-green-800"
                                        title={t('waiting.viewFile')}
                                    >
                                        <Eye size={18} weight="bold" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRemoveExistingCover}
                                        className="text-red-500 hover:text-red-700"
                                        title={t('waiting.removeFile')}
                                    >
                                        <X size={18} weight="bold" />
                                    </button>
                                </div>
                            </div>
                        )}
                        {selectedCoverFile && (
                            <div className="mt-2 flex h-fit max-w-52 flex-row items-center justify-between gap-2 rounded-md border border-primary-500 p-2 text-sm">
                                <span className="max-w-36 truncate text-xs">
                                    {selectedCoverFile.name}
                                </span>
                                <X
                                    className="shrink-0 cursor-pointer text-red-500 hover:text-red-700"
                                    onClick={handleRemoveCoverFile}
                                    size={18}
                                    weight="bold"
                                />
                            </div>
                        )}
                    </div>
                    {form.watch('waitingRoomType') !== WaitingRoomType.PRE_JOINING && (
                    <>
                    <div className="flex flex-col items-start gap-2">
                        <div className="flex flex-col gap-2">
                            <div>{t('waiting.thumbnail')}</div>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                onClick={handleUploadClick}
                                className="flex items-center gap-2"
                            >
                                <UploadSimple size={20} />
                                {existingThumbnailId || selectedFile ? t('waiting.replace') : t('waiting.upload')}
                            </MyButton>
                        </div>
                        {/* Show existing thumbnail */}
                        {existingThumbnailId && !selectedFile && (
                            <div className="mt-2 flex h-fit max-w-[200px] flex-row items-center justify-between gap-2 rounded-md border border-green-500 bg-green-50 p-2 text-sm">
                                <span className="text-xs font-medium text-green-700">
                                    {t('waiting.existingFile')}
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            handleViewFile(existingThumbnailId, 'thumbnail')
                                        }
                                        className="text-green-600 hover:text-green-800"
                                        title={t('waiting.viewFile')}
                                    >
                                        <Eye size={18} weight="bold" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRemoveExistingThumbnail}
                                        className="text-red-500 hover:text-red-700"
                                        title={t('waiting.removeFile')}
                                    >
                                        <X size={18} weight="bold" />
                                    </button>
                                </div>
                            </div>
                        )}
                        {/* Show newly selected file */}
                        {selectedFile && (
                            <div className="mt-2 flex h-fit max-w-[200px] flex-row items-center justify-between gap-2 rounded-md border border-primary-500 p-2 text-sm">
                                <span className="max-w-[140px] truncate text-xs">
                                    {selectedFile.name}
                                </span>
                                <X
                                    className="shrink-0 cursor-pointer text-red-500 hover:text-red-700"
                                    onClick={handleRemoveFile}
                                    size={18}
                                    weight="bold"
                                />
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col items-start gap-2">
                        <div className="flex flex-col gap-2">
                            <div>{t('waiting.backgroundScore')}</div>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                onClick={handleMusicUploadClick}
                                className="flex items-center gap-2"
                            >
                                <UploadSimple size={20} />
                                {existingMusicId || selectedMusicFile ? t('waiting.replace') : t('waiting.upload')}
                            </MyButton>
                        </div>
                        {/* Show existing music file */}
                        {existingMusicId && !selectedMusicFile && (
                            <div className="mt-2 flex h-fit max-w-[200px] flex-row items-center justify-between gap-2 rounded-md border border-green-500 bg-green-50 p-2 text-sm">
                                <div className="flex items-center gap-2">
                                    <MusicNote size={16} weight="fill" className="text-green-600" />
                                    <span className="text-xs font-medium text-green-700">
                                        {t('waiting.existingFile')}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleViewFile(existingMusicId, 'music')}
                                        className="text-green-600 hover:text-green-800"
                                        title={t('waiting.playAudio')}
                                    >
                                        <Eye size={18} weight="bold" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRemoveExistingMusic}
                                        className="text-red-500 hover:text-red-700"
                                        title={t('waiting.removeFile')}
                                    >
                                        <X size={18} weight="bold" />
                                    </button>
                                </div>
                            </div>
                        )}
                        {/* Show newly selected music file */}
                        {selectedMusicFile && (
                            <div className="mt-2 flex h-fit max-w-[200px] flex-row items-center justify-between gap-2 rounded-md border border-primary-500 p-2 text-sm">
                                <span className="max-w-[140px] truncate text-xs">
                                    {selectedMusicFile.name}
                                </span>
                                <X
                                    className="cursor-pointer text-red-500 hover:text-red-700"
                                    onClick={handleRemoveMusicFile}
                                    size={18}
                                    weight="bold"
                                />
                            </div>
                        )}
                    </div>
                    </>
                    )}
                </div>
            );
    };

    const renderRecurringSchedule = () =>
        meetingType === RecurringType.WEEKLY && (
            <>
                {/* Recurring Schedule header with days selector */}
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xl font-semibold">{t('recurring.title')}</h2>
                    <Select
                        value={scheduleType || ''}
                        onValueChange={(
                            value: 'everyday' | 'weekday' | 'exceptSunday' | 'custom'
                        ) => {
                            setScheduleType(value);
                            if (value === 'everyday') toggleEveryDay();
                            else if (value === 'weekday') toggleMonToFri();
                            else if (value === 'exceptSunday') toggleMonToSat();
                            else if (value === 'custom') toggleCustom();
                        }}
                    >
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder={t('recurring.selectDaysPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="everyday">{t('recurring.everyDay')}</SelectItem>
                            <SelectItem value="weekday">{t('recurring.monFri')}</SelectItem>
                            <SelectItem value="exceptSunday">{t('recurring.monSat')}</SelectItem>
                            <SelectItem value="custom">{t('recurring.custom')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {/* Modern Recurring schedule layout */}
                <div className="space-y-4">
                    {recurringSchedule?.map((dayField, dayIndex) => {
                        const isSelect = watch(`recurringSchedule.${dayIndex}.isSelect`);
                        const dayName =
                            WEEK_DAYS.find((d) => d.label === dayField.day)?.value ?? dayField.day;

                        return (
                            <div key={dayField.day} className="group">
                                {/* Day Header Card */}
                                <div
                                    className={`rounded-xl border-2 transition-all duration-200 ${isSelect
                                        ? 'border-primary-200 bg-primary-50/50 shadow-sm'
                                        : 'border-gray-200 bg-white hover:border-gray-300'
                                        }`}
                                >
                                    {/* Day Toggle Header */}
                                    <div className="flex flex-col items-start gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                form.setValue(
                                                    `recurringSchedule.${dayIndex}.isSelect`,
                                                    !isSelect
                                                )
                                            }
                                            className="flex items-center gap-3 text-left transition-colors duration-200"
                                        >
                                            <div
                                                className={`flex size-5 items-center justify-center rounded-full border-2 transition-all duration-200 ${isSelect
                                                    ? 'border-primary-500 bg-primary-500'
                                                    : 'border-gray-300 bg-white group-hover:border-gray-400'
                                                    }`}
                                            >
                                                {isSelect && (
                                                    <div className="size-2 rounded-full bg-white"></div>
                                                )}
                                            </div>
                                            <div>
                                                <h3
                                                    className={`text-lg font-semibold transition-colors duration-200 ${isSelect
                                                        ? 'text-primary-900'
                                                        : 'text-gray-900'
                                                        }`}
                                                >
                                                    {dayName}
                                                </h3>
                                                <p className="text-sm text-gray-500">
                                                    {isSelect
                                                        ? t('recurring.sessionsScheduled', { count: dayField.sessions.length })
                                                        : t('recurring.clickToSchedule')}
                                                </p>
                                            </div>
                                        </button>

                                        {isSelect && (
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                onClick={() => addSessionToDay(dayIndex)}
                                                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
                                            >
                                                <Plus size={16} />
                                                {t('recurring.addSession')}
                                            </MyButton>
                                        )}
                                    </div>

                                    {/* Daily Attendance Setting */}
                                    {isSelect && (
                                        <div className="bg-primary-25 border-t border-primary-100 px-6 py-2">
                                            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <Label className="text-sm font-medium text-gray-900">
                                                        {t('recurring.countAttendanceDaily')}
                                                    </Label>
                                                </div>
                                                <Controller
                                                    control={control}
                                                    name={`recurringSchedule.${dayIndex}.sessions.0.countAttendanceDaily`}
                                                    render={({ field }) => (
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={(checked) => {
                                                                // Update all sessions for this day
                                                                const currentDay = form.getValues(
                                                                    `recurringSchedule.${dayIndex}`
                                                                );
                                                                if (currentDay?.sessions) {
                                                                    currentDay.sessions.forEach(
                                                                        (_, sessionIdx) => {
                                                                            form.setValue(
                                                                                `recurringSchedule.${dayIndex}.sessions.${sessionIdx}.countAttendanceDaily`,
                                                                                checked
                                                                            );
                                                                        }
                                                                    );
                                                                }
                                                            }}
                                                        />
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Sessions List */}
                                    {isSelect && (
                                        <div className="border-t border-primary-100 bg-white/50">
                                            <div className="space-y-4 p-2">
                                                {dayField.sessions.map((session, sessionIndex) => (
                                                    <div
                                                        key={sessionIndex}
                                                        className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow duration-200 hover:shadow-md"
                                                    >
                                                        <div className="mb-4 flex items-center justify-between">
                                                            <h4 className="text-sm font-semibold text-gray-900">
                                                                {t('recurring.session', { number: sessionIndex + 1 })}
                                                            </h4>
                                                            {sessionIndex > 0 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        removeSessionFromDay(
                                                                            dayIndex,
                                                                            sessionIndex
                                                                        )
                                                                    }
                                                                    className="flex size-8 items-center justify-center rounded-full bg-red-50 text-red-500 transition-colors duration-200 hover:bg-red-100"
                                                                >
                                                                    <Trash size={16} />
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Session Details Grid */}
                                                        <div
                                                            className={cn(
                                                                'grid grid-cols-1 gap-3',
                                                                isAutoLinkPlatform
                                                                    ? 'lg:grid-cols-2'
                                                                    : 'lg:grid-cols-3'
                                                            )}
                                                        >
                                                            {/* Start Time */}
                                                            <div className="space-y-2">
                                                                <Label className="text-sm font-medium text-gray-700">
                                                                    {t('recurring.startTime')}
                                                                </Label>
                                                                <SelectField
                                                                    label=""
                                                                    name={`recurringSchedule.${dayIndex}.sessions.${sessionIndex}.startTime`}
                                                                    labelStyle="font-thin"
                                                                    options={timeOptions?.map(
                                                                        (option, idx) => ({
                                                                            value: option,
                                                                            label: option,
                                                                            _id: idx,
                                                                        })
                                                                    )}
                                                                    control={form.control}
                                                                    className="w-full"
                                                                />
                                                            </div>

                                                            {/* Duration */}
                                                            <div className="space-y-2">
                                                                <Label className="text-sm font-medium text-gray-700">
                                                                    {t('timing.duration')}
                                                                </Label>
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <FormField
                                                                        control={control}
                                                                        name={`recurringSchedule.${dayIndex}.sessions.${sessionIndex}.durationHours`}
                                                                        render={({ field }) => (
                                                                            <FormItem>
                                                                                <FormControl>
                                                                                    <MyInput
                                                                                        inputType="text"
                                                                                        inputPlaceholder="00"
                                                                                        input={
                                                                                            field.value
                                                                                        }
                                                                                        onKeyPress={(
                                                                                            e
                                                                                        ) => {
                                                                                            if (
                                                                                                !/[0-9]/.test(
                                                                                                    e.key
                                                                                                )
                                                                                            )
                                                                                                e.preventDefault();
                                                                                        }}
                                                                                        onChangeFunction={(
                                                                                            e
                                                                                        ) => {
                                                                                            let val =
                                                                                                e.target.value.replace(
                                                                                                    /[^0-9]/g,
                                                                                                    ''
                                                                                                );
                                                                                            const num =
                                                                                                parseInt(
                                                                                                    val
                                                                                                );
                                                                                            if (
                                                                                                num >
                                                                                                24
                                                                                            )
                                                                                                val =
                                                                                                    '24';
                                                                                            field.onChange(
                                                                                                val
                                                                                            );
                                                                                        }}
                                                                                        className="w-16 text-center"
                                                                                    />
                                                                                </FormControl>
                                                                            </FormItem>
                                                                        )}
                                                                    />
                                                                    <span className="text-sm text-gray-500">
                                                                        {t('timing.hrs')}
                                                                    </span>
                                                                    <FormField
                                                                        control={control}
                                                                        name={`recurringSchedule.${dayIndex}.sessions.${sessionIndex}.durationMinutes`}
                                                                        render={({ field }) => (
                                                                            <FormItem>
                                                                                <FormControl>
                                                                                    <MyInput
                                                                                        inputType="text"
                                                                                        inputPlaceholder="00"
                                                                                        input={
                                                                                            field.value
                                                                                        }
                                                                                        onKeyPress={(
                                                                                            e
                                                                                        ) => {
                                                                                            if (
                                                                                                !/[0-9]/.test(
                                                                                                    e.key
                                                                                                )
                                                                                            )
                                                                                                e.preventDefault();
                                                                                        }}
                                                                                        onChangeFunction={(
                                                                                            e
                                                                                        ) => {
                                                                                            let val =
                                                                                                e.target.value.replace(
                                                                                                    /[^0-9]/g,
                                                                                                    ''
                                                                                                );
                                                                                            const num =
                                                                                                parseInt(
                                                                                                    val
                                                                                                );
                                                                                            if (
                                                                                                num >
                                                                                                59
                                                                                            )
                                                                                                val =
                                                                                                    '59';
                                                                                            field.onChange(
                                                                                                val
                                                                                            );
                                                                                        }}
                                                                                        className="w-16 text-center"
                                                                                    />
                                                                                </FormControl>
                                                                            </FormItem>
                                                                        )}
                                                                    />
                                                                    <span className="text-sm text-gray-500">
                                                                        {t('timing.mins')}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {/* Live Class Link — hidden when the platform creates the
                                                                meeting itself. The form value is left untouched so the
                                                                saved payload is unchanged (clearing it would send "" and
                                                                wipe the provisioned links on an edit). */}
                                                            {!isAutoLinkPlatform && (
                                                                <div className="space-y-2">
                                                                    <Label className="text-sm font-medium text-gray-700">
                                                                        {t('link.liveClassLink')}
                                                                    </Label>
                                                                    <FormField
                                                                        control={control}
                                                                        name={`recurringSchedule.${dayIndex}.sessions.${sessionIndex}.link`}
                                                                        render={({ field }) => (
                                                                            <FormItem>
                                                                                <FormControl>
                                                                                    <LiveClassLinkField
                                                                                        value={
                                                                                            field.value ||
                                                                                            ''
                                                                                        }
                                                                                        onChange={
                                                                                            field.onChange
                                                                                        }
                                                                                        onApplyWithScope={(
                                                                                            scope
                                                                                        ) => {
                                                                                            applyLinkWithScope(
                                                                                                scope,
                                                                                                dayIndex,
                                                                                                sessionIndex
                                                                                            );
                                                                                        }}
                                                                                        isEdit={
                                                                                            isEdit ||
                                                                                            false
                                                                                        }
                                                                                        dayName={
                                                                                            dayField.day
                                                                                                .charAt(
                                                                                                    0
                                                                                                )
                                                                                                .toUpperCase() +
                                                                                            dayField.day.slice(
                                                                                                1
                                                                                            )
                                                                                        }
                                                                                    />
                                                                                </FormControl>
                                                                                <FormMessage className="text-sm text-red-500" />
                                                                            </FormItem>
                                                                        )}
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                        {/* Session Options */}
                                                        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-4">
                                                            <div className="flex flex-wrap items-center gap-4">
                                                                {/* Thumbnail Upload */}
                                                                <div className="flex flex-wrap items-center gap-3">
                                                                    <span className="text-sm font-medium text-gray-700">
                                                                        {t('recurring.thumbnailLabel')}
                                                                    </span>
                                                                    <input
                                                                        type="file"
                                                                        accept=".png, .jpg, .jpeg"
                                                                        onChange={(e) =>
                                                                            handleSessionThumbnailSelect(
                                                                                dayIndex,
                                                                                sessionIndex,
                                                                                e
                                                                            )
                                                                        }
                                                                        className="hidden"
                                                                        id={`session-thumbnail-${dayIndex}-${sessionIndex}`}
                                                                    />
                                                                    {getSessionThumbnail(
                                                                        dayIndex,
                                                                        sessionIndex
                                                                    ) ? (
                                                                        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2">
                                                                            <span className="max-w-32 truncate text-nowrap text-sm text-green-700">
                                                                                {
                                                                                    getSessionThumbnail(
                                                                                        dayIndex,
                                                                                        sessionIndex
                                                                                    )?.name
                                                                                }
                                                                            </span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleSessionThumbnailRemove(
                                                                                        dayIndex,
                                                                                        sessionIndex
                                                                                    )
                                                                                }
                                                                                className="text-green-600 hover:text-green-800"
                                                                            >
                                                                                <X size={16} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <MyButton
                                                                            type="button"
                                                                            buttonType="secondary"
                                                                            scale="small"
                                                                            onClick={() => {
                                                                                document
                                                                                    .getElementById(
                                                                                        `session-thumbnail-${dayIndex}-${sessionIndex}`
                                                                                    )
                                                                                    ?.click();
                                                                            }}
                                                                            className="flex items-center gap-2"
                                                                        >
                                                                            <UploadSimple
                                                                                size={16}
                                                                            />
                                                                            {t('waiting.upload')}
                                                                        </MyButton>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Copy to days button */}
                                                            <MyButton
                                                                type="button"
                                                                buttonType="primary"
                                                                scale="small"
                                                                onClick={() =>
                                                                    openCopyDialog(
                                                                        dayIndex,
                                                                        sessionIndex
                                                                    )
                                                                }
                                                                className="flex items-center gap-2"
                                                            >
                                                                <Copy size={16} />
                                                                {t('recurring.copyToDays')}
                                                            </MyButton>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Default Class Link and Custom Button - Day Level */}
                                    {isSelect &&
                                        (liveSessionSettings.defaultDayButtonEnabled || isEdit) && (
                                        <div className="mx-4 mb-4 space-y-6 rounded-lg border border-gray-200 bg-white p-4">
                                            <div className="space-y-4">
                                                <Controller
                                                    control={control}
                                                    name={`recurringSchedule.${dayIndex}.default_class_link`}
                                                    render={({ field }) => (
                                                        <Controller
                                                            control={control}
                                                            name={`recurringSchedule.${dayIndex}.default_class_name`}
                                                            render={({ field: classNameField }) => (
                                                                <DefaultClassLinkInput
                                                                    value={field.value}
                                                                    onChange={field.onChange}
                                                                    classNameValue={
                                                                        classNameField.value
                                                                    }
                                                                    onClassNameChange={
                                                                        classNameField.onChange
                                                                    }
                                                                    onCopy={() => {
                                                                        setCopySourceDefaultLink({
                                                                            dayIndex,
                                                                        });
                                                                        setIsCopyDefaultLinkDialogOpen(
                                                                            true
                                                                        );
                                                                        setSelectedDaysToCopyDefaultLink(
                                                                            []
                                                                        );
                                                                    }}
                                                                />
                                                            )}
                                                        />
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </>
        );

    const renderCustomButtonConfig = () => (
        <div className="flex flex-col gap-2">
            <Controller
                control={control}
                name="learner_button_config"
                render={({ field }) => (
                    <LearnerButtonConfigInput value={field.value} onChange={field.onChange} />
                )}
            />
            <p className="px-1 text-xs text-gray-500">
                {t('recurring.customButtonHint')}
            </p>
        </div>
    );


    return (
        <>
            {!isFormInitialized ? (
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="size-8 animate-spin" />
                </div>
            ) : (
                <FormProvider {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit, onError)}
                        className="flex flex-col gap-5"
                    >
                        <div className="sticky top-0 z-[9] -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3 sm:-mx-0 sm:px-0">
                            <div>
                                <h1 className="text-lg font-semibold text-neutral-800">
                                    {t('header.title', {
                                        term: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession),
                                    })}
                                </h1>
                                <p className="text-xs text-neutral-500">
                                    {t('header.subtitle')}
                                </p>
                            </div>
                            <MyButton
                                type="submit"
                                scale="large"
                                buttonType="primary"
                                disable={isSubmitting}
                                className="w-32"
                            >
                                {isSubmitting ? (
                                    <Loader2 className="animate-spin text-white" />
                                ) : (
                                    t('header.next')
                                )}
                            </MyButton>
                        </div>

                        <div className="flex flex-col gap-5">
                            <SectionCard
                                icon={<Info size={18} />}
                                title={t('sections.basicInfoTitle')}
                                description={t('sections.basicInfoDesc')}
                            >
                                {renderBasicInformation()}
                            </SectionCard>

                            <SectionCard
                                icon={<CalendarBlank size={18} />}
                                title={t('sections.scheduleTitle')}
                                description={t('sections.scheduleDesc')}
                            >
                                <div className="flex flex-col gap-6">
                                    {renderMeetingTypeSelection()}
                                    {renderTimezoneSelection()}
                                    {renderSessionTiming()}
                                </div>
                            </SectionCard>

                            <SectionCard
                                icon={<VideoCamera size={18} />}
                                title={t('sections.streamingTitle')}
                                description={t('sections.streamingDesc')}
                            >
                                <div className="flex flex-col gap-6">
                                    {renderLiveClassLink()}
                                    {renderStreamingChoices()}
                                </div>
                            </SectionCard>

                            <SectionCard
                                icon={<UsersThree size={18} />}
                                title={t('sections.waitingTitle')}
                                description={t('sections.waitingDesc')}
                            >
                                {renderWaitingRoomAndUpload()}
                            </SectionCard>

                            {(liveSessionSettings.feedbackEnabled || isEdit) && (
                                <SectionCard
                                    icon={<ChatTeardrop size={18} />}
                                    title={t('sections.feedbackTitle')}
                                    description={t('sections.feedbackDesc')}
                                >
                                    {renderFeedbackSettings()}
                                </SectionCard>
                            )}

                            {(liveSessionSettings.customActionButtonEnabled || isEdit) && (
                                <SectionCard
                                    icon={<CursorClick size={18} />}
                                    title={t('sections.customButtonTitle')}
                                    description={t('sections.customButtonDesc')}
                                >
                                    {renderCustomButtonConfig()}
                                </SectionCard>
                            )}

                            {/* Render the recurring section whenever the form is
                                in WEEKLY mode. We don't gate on the institute
                                setting here — the radio above already does that
                                for new sessions, and existing recurring
                                sessions opened for edit must remain editable
                                even if the setting was later disabled. */}
                            {meetingType === RecurringType.WEEKLY && (
                                    <SectionCard
                                        icon={<ArrowsClockwise size={18} />}
                                        title={t('sections.recurringTitle')}
                                        description={t('sections.recurringDesc')}
                                    >
                                        {renderRecurringSchedule()}
                                    </SectionCard>
                                )}
                        </div>
                    </form>
                </FormProvider>
            )}

            {/* Default Link Copy Dialog */}
            <MyDialog
                open={isDefaultLinkDialogOpen}
                onOpenChange={setIsDefaultLinkDialogOpen}
                heading={t('dialogs.defaultLinkTitle')}
                className="w-[400px]"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        {t('dialogs.defaultLinkHint')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {form.getValues('recurringSchedule')?.map((day, index) => {
                            if (!day.isSelect) return null;
                            const currentDayOfWeek = WEEK_DAYS.findIndex(
                                (d) => d.label === day.day
                            );
                            return (
                                <button
                                    key={day.day}
                                    type="button"
                                    onClick={() => {
                                        setSelectedDaysForLink((prev) =>
                                            prev.includes(day.day)
                                                ? prev.filter((d) => d !== day.day)
                                                : [...prev, day.day]
                                        );
                                    }}
                                    className={`rounded-md border p-2 text-sm transition-colors ${selectedDaysForLink.includes(day.day)
                                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                                        : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                >
                                    {day.day}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setIsDefaultLinkDialogOpen(false)}
                        >
                            {t('dialogs.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={() => {
                                applyDefaultLinkToSelectedDays();
                                setIsDefaultLinkDialogOpen(false);
                            }}
                            disable={selectedDaysForLink.length === 0}
                        >
                            {t('dialogs.applyLink')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>

            {/* Copy Session Dialog */}
            <MyDialog
                open={isCopyDialogOpen}
                onOpenChange={setIsCopyDialogOpen}
                heading={t('dialogs.copySessionTitle')}
                className="w-[400px]"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        {t('dialogs.copySessionHint')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {form.getValues('recurringSchedule')?.map((day, index) => {
                            if (!day.isSelect || day.day === copySourceSession?.dayIndex.toString())
                                return null;
                            return (
                                <button
                                    key={day.day}
                                    type="button"
                                    onClick={() => {
                                        setSelectedDaysToCopy((prev) =>
                                            prev.includes(index)
                                                ? prev.filter((i) => i !== index)
                                                : [...prev, index]
                                        );
                                    }}
                                    className={`rounded-md border p-2 text-sm transition-colors ${selectedDaysToCopy.includes(index)
                                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                                        : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                >
                                    {day.day}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                        <MyButton buttonType="secondary" onClick={() => setIsCopyDialogOpen(false)}>
                            {t('dialogs.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={() => {
                                executeCopySession();
                                setIsCopyDialogOpen(false);
                            }}
                            disable={selectedDaysToCopy.length === 0}
                        >
                            {t('dialogs.copySession')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>

            {/* Copy Default Link Dialog */}
            <MyDialog
                open={isCopyDefaultLinkDialogOpen}
                onOpenChange={setIsCopyDefaultLinkDialogOpen}
                heading={t('dialogs.copyDefaultLinkTitle')}
                className="w-[400px]"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        {t('dialogs.copyDefaultLinkHint')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {form.getValues('recurringSchedule')?.map((day, index) => {
                            if (!day.isSelect || index === copySourceDefaultLink?.dayIndex)
                                return null;
                            return (
                                <button
                                    key={day.day}
                                    type="button"
                                    onClick={() => {
                                        setSelectedDaysToCopyDefaultLink((prev) =>
                                            prev.includes(index)
                                                ? prev.filter((i) => i !== index)
                                                : [...prev, index]
                                        );
                                    }}
                                    className={`rounded-md border p-2 text-sm transition-colors ${selectedDaysToCopyDefaultLink.includes(index)
                                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                                        : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                >
                                    {day.day}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setIsCopyDefaultLinkDialogOpen(false)}
                        >
                            {t('dialogs.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={executeCopyDefaultLink}
                            disable={selectedDaysToCopyDefaultLink.length === 0}
                        >
                            {t('dialogs.copyDefaultLink')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>

            {/* Link Update Confirmation Dialog */}
            <MyDialog
                open={isLinkUpdateDialogOpen}
                onOpenChange={setIsLinkUpdateDialogOpen}
                heading={t('dialogs.linkChangeTitle')}
                className="w-[500px]"
            >
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-4">
                        {/* Option 1: Only this session */}
                        <button
                            type="button"
                            onClick={() => {
                                setIsLinkUpdateDialogOpen(false);
                                if (pendingSubmitData) {
                                    executeSubmission(pendingSubmitData, 'ONLY_THIS');
                                }
                            }}
                            className="group flex items-start gap-4 rounded-xl border border-gray-200 p-4 text-left transition-all hover:border-primary-500 hover:bg-primary-50"
                        >
                            <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 group-hover:border-primary-600 group-hover:bg-primary-600">
                                <div className="h-2 w-2 rounded-full bg-white opacity-0 group-hover:opacity-100" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900 group-hover:text-primary-700">
                                    {t('dialogs.onlyThisSessionTitle')}
                                </h3>
                                <p className="text-sm text-gray-500 group-hover:text-primary-600/80">
                                    {t('dialogs.onlyThisSessionDesc', { day: changedDayLabel })}
                                </p>
                            </div>
                        </button>

                        {/* Option 2: Current day all sessions */}
                        <button
                            type="button"
                            onClick={() => {
                                setIsLinkUpdateDialogOpen(false);
                                if (pendingSubmitData) {
                                    executeSubmission(pendingSubmitData, 'CURRENT_DAY_ALL_SESSIONS');
                                }
                            }}
                            className="group flex items-start gap-4 rounded-xl border border-gray-200 p-4 text-left transition-all hover:border-primary-500 hover:bg-primary-50"
                        >
                            <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 group-hover:border-primary-600 group-hover:bg-primary-600">
                                <div className="h-2 w-2 rounded-full bg-white opacity-0 group-hover:opacity-100" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900 group-hover:text-primary-700">
                                    {t('dialogs.allSessionsThisDayTitle', { day: changedDayLabel })}
                                </h3>
                                <p className="text-sm text-gray-500 group-hover:text-primary-600/80">
                                    {t('dialogs.allSessionsThisDayDesc', { day: changedDayLabel })}
                                </p>
                            </div>
                        </button>

                        {/* Option 3: This & all upcoming sessions */}
                        <button
                            type="button"
                            onClick={() => {
                                setIsLinkUpdateDialogOpen(false);
                                if (pendingSubmitData) {
                                    executeSubmission(pendingSubmitData, 'ALL_FUTURE');
                                }
                            }}
                            className="group flex items-start gap-4 rounded-xl border border-gray-200 p-4 text-left transition-all hover:border-primary-500 hover:bg-primary-50"
                        >
                            <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 group-hover:border-primary-600 group-hover:bg-primary-600">
                                <div className="h-2 w-2 rounded-full bg-white opacity-0 group-hover:opacity-100" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900 group-hover:text-primary-700">
                                    {t('dialogs.upcomingSessionsTitle', { day: changedDayLabel })}
                                </h3>
                                <p className="text-sm text-gray-500 group-hover:text-primary-600/80">
                                    {t('dialogs.upcomingSessionsDesc', { day: changedDayLabel })}
                                </p>
                            </div>
                        </button>

                        {/* Option 4: All upcoming days – all sessions */}
                        <button
                            type="button"
                            onClick={() => {
                                setIsLinkUpdateDialogOpen(false);
                                if (pendingSubmitData) {
                                    executeSubmission(
                                        pendingSubmitData,
                                        'ALL_FUTURE_ALL_SESSIONS'
                                    );
                                }
                            }}
                            className="group flex items-start gap-4 rounded-xl border border-gray-200 p-4 text-left transition-all hover:border-primary-500 hover:bg-primary-50"
                        >
                            <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 group-hover:border-primary-600 group-hover:bg-primary-600">
                                <div className="h-2 w-2 rounded-full bg-white opacity-0 group-hover:opacity-100" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900 group-hover:text-primary-700">
                                    {t('dialogs.upcomingAllSessionsTitle', { day: changedDayLabel })}
                                </h3>
                                <p className="text-sm text-gray-500 group-hover:text-primary-600/80">
                                    {t('dialogs.upcomingAllSessionsDesc')}
                                    <br />
                                    <span className="italic">{t('dialogs.upcomingAllSessionsExample', { day: changedDayLabel })}</span>
                                </p>
                            </div>
                        </button>
                    </div>

                    <div className="flex justify-end pt-2">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setIsLinkUpdateDialogOpen(false)}
                        >
                            {t('dialogs.cancel')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>
        </>
    );
}
