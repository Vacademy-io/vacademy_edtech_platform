import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Controller,
    useForm,
    useFieldArray,
    useWatch,
    useFormState,
    type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { fromZonedTime, format as formatTZ, toZonedTime } from 'date-fns-tz';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import {
    Copy,
    Plus,
    Trash,
    Warning,
    Lightning,
    Globe,
    Table as TableIcon,
    Article,
    UsersThree,
    ChatTeardrop,
    Record,
    DotsSixVertical,
    TrashSimple, PencilSimple } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import {
    FormFieldRow,
    FormFieldRowHeader,
} from '@/components/common/custom-fields/FormFieldRow';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { MyDialog } from '@/components/design-system/dialog';
import { AddCustomFieldDialog as SharedAddCustomFieldDialog } from '@/components/common/custom-fields/AddCustomFieldDialog';
import {
    isBuiltInRegistrationField,
    withBuiltInRegistrationFields,
} from '@/components/common/custom-fields/builtin-registration-fields';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
import { fetchInstituteDefaultFields } from '@/services/custom-field-mappings';
import { getInstituteId as getInstId } from '@/constants/helper';
import { buildWaitingRoomOptions, buildWaitingRoomTypeOptions } from '../-constants/options';
import { UploadFileInS3 } from '@/services/upload_file';
import { UploadSimple, X as XIcon, MusicNote, MagnifyingGlass, CircleNotch, DownloadSimple, CheckCircle, VideoCamera } from '@phosphor-icons/react';
import {
    SessionContentDestinationPicker,
    type DestinationBatch,
    type DestinationPickerSubmitPayload,
} from '../../-components/content-linking/SessionContentDestinationPicker';
import type { ContentLinkDestination } from '../../-services/content-link-service';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';

import { bulkSessionFormSchema, type BulkSessionForm, type BulkSessionRow } from '../-schema/bulkSchema';
import { buildTimezoneOptions, buildStreamingOptions } from '../-constants/options';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';
import { getBrowserTimezone, normalizeTimezone } from '@/utils/timezone';
import type { PlatformKey } from '@/services/live-session-settings';
import { transformFormToDTOStep1, transformFormToDTOStep2 } from '../../-constants/helper';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { sessionFormSchema } from '../-schema/schema';
import { RecurringType, SessionPlatform, SessionType, WaitingRoomType } from '../../-constants/enums';
import { createLiveSessionsChunked, type BulkLiveSessionRowResult } from '../-services/utils';
import { useLiveSessionStore } from '../-store/sessionIdstore';
import { SectionCard } from './SectionCard';
import { LiveSessionPreviewDialog } from './LiveSessionPreviewDialog';
import { BulkCsvImportDialog } from './BulkCsvImportDialog';
import {
    downloadScheduleTemplate,
    downloadBatchReference,
    downloadResultsCsv,
    downloadTeacherReference,
} from '../-utils/bulkCsv';
import {
    STAFF_DIRECTORY_PAGE_SIZE,
    buildTeacherIndex,
    problemTeacherEntries,
    splitTeacherEntries,
} from '../-utils/teacherDirectory';
import { fetchEligibleOrgUsers } from '@/routes/manage-institute/teams/-services/institute-users-service';
import { RowTeacherPicker, type TeacherDirectory } from './RowTeacherPicker';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useFilterDataForAssesment } from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { useQuery } from '@tanstack/react-query';
import {
    DropdownItemType,
} from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MyRadioButton } from '@/components/design-system/radio';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LockKey, BellRinging, UsersThree as UsersThreeIcon } from '@phosphor-icons/react';
import { AccessType, InputType } from '../../-constants/enums';
import { z } from 'zod';

const buildTimeOptions = (t: TFunction) => [
    { label: t('timeOptions.5m'), value: '5m' },
    { label: t('timeOptions.10m'), value: '10m' },
    { label: t('timeOptions.30m'), value: '30m' },
    { label: t('timeOptions.1h'), value: '1h' },
];

/**
 * Compute today's date and the next 15-minute time slot, in the given IANA
 * timezone. Browsers default `new Date().toISOString()` to UTC which causes
 * "tomorrow's date" / "yesterday's date" surprises near midnight; using
 * date-fns-tz lets the cell match the wall-clock the admin sees.
 */
const getDefaultRowDateTime = (timeZone: string) => {
    let zone: string;
    try {
        // Throws on bad input; fall back to browser zone.
        formatTZ(new Date(), 'HH:mm', { timeZone });
        zone = timeZone;
    } catch {
        zone = getBrowserTimezone();
    }
    const now = toZonedTime(new Date(), zone);
    // Round to next 15-minute slot so the default isn't an awkward 10:07.
    const minutes = now.getMinutes();
    const rounded = Math.ceil(minutes / 15) * 15;
    if (rounded === 60) {
        now.setHours(now.getHours() + 1);
        now.setMinutes(0);
    } else {
        now.setMinutes(rounded);
    }
    const startDate = formatTZ(now, 'yyyy-MM-dd', { timeZone: zone });
    const startTime = formatTZ(now, 'HH:mm', { timeZone: zone });
    return { startDate, startTime };
};

// Only BBB (host iframes the meeting) and YouTube can play inside the app.
// Every other link — Google Meet, Zoom, Zoho, any "other" URL — must
// redirect: the grid has no embed/redirect control, so defaulting those to
// embed left learners on an iframe the provider refuses to load.
const streamingTypeForPlatform = (platform?: string) =>
    platform === 'bbb' || platform === 'youtube'
        ? SessionPlatform.EMBED_IN_APP
        : SessionPlatform.REDIRECT_TO_OTHER_PLATFORM;

const blankRow = (
    defaultPlatform: string = 'other',
    timeZone: string = 'Asia/Kolkata'
) => {
    const { startDate, startTime } = getDefaultRowDateTime(timeZone);
    return {
        title: '',
        subject: '',
        startDate,
        startTime,
        durationHours: '1',
        durationMinutes: '0',
        platform: defaultPlatform,
        link: '',
        description: '',
        selectedLevels: [] as Array<{
            courseId: string;
            sessionId: string;
            levelId: string;
        }>,
    };
};

// Same list the single-class form ships with — keeps the bulk experience in
// lock-step so admins don't get a different feedback form depending on how
// they created the class.
const buildDefaultFeedbackQuestions = (t: TFunction) => [
    {
        id: 'rating',
        type: 'star_rating',
        label: t('defaultFeedbackQuestions.rating'),
        enabled: true,
        mandatory: true,
        max_stars: 5,
        allow_half: true,
    },
    {
        id: 'learnings',
        type: 'free_text',
        label: t('defaultFeedbackQuestions.learnings'),
        enabled: true,
        mandatory: false,
    },
    {
        id: 'doubts',
        type: 'free_text',
        label: t('defaultFeedbackQuestions.doubts'),
        enabled: true,
        mandatory: false,
    },
    {
        id: 'feedback',
        type: 'free_text',
        label: t('defaultFeedbackQuestions.feedback'),
        enabled: true,
        mandatory: false,
    },
];

/**
 * A row is "ready" once it has a title, date, start time, and either a link or
 * a platform that auto-provisions one (Zoho / BBB). Shared by the live header
 * count badge and the preview dialog so both agree on what's submittable.
 */
const isRowReady = (
    r: {
        title?: string;
        startDate?: string;
        startTime?: string;
        platform?: string;
        link?: string;
        selectedLevels?: unknown[];
    },
    accessType?: AccessType
) =>
    Boolean(
        r?.title &&
            r?.startDate &&
            r?.startTime &&
            (r?.platform === 'zoho' || r?.platform === 'bbb' || r?.link) &&
            // Private rows additionally require at least one assigned batch.
            (accessType !== AccessType.PRIVATE || (r?.selectedLevels?.length ?? 0) > 0)
    );

// Stable empty fallback so the memoized RowEditor doesn't see a new `courses`
// array identity on every render while the study-library query is in flight.
const EMPTY_COURSES: RowBatchPickerProps['courses'] = [];


export function BulkScheduleGrid() {
    const { t } = useTranslation(['studyLibraryBulkScheduleGrid', 'studyLibraryOptions']);
    const TimeOptions = useMemo(() => buildTimeOptions(t), [t]);
    const BULK_DEFAULT_FEEDBACK_QUESTIONS = useMemo(
        () => buildDefaultFeedbackQuestions(t),
        [t]
    );
    const TIMEZONE_OPTIONS = useMemo(() => buildTimezoneOptions(t), [t]);
    const STREAMING_OPTIONS = useMemo(() => buildStreamingOptions(t), [t]);
    const WAITING_ROOM_OPTIONS = useMemo(() => buildWaitingRoomOptions(t), [t]);
    const WAITING_ROOM_TYPE_OPTIONS = useMemo(() => buildWaitingRoomTypeOptions(t), [t]);
    const navigate = useNavigate();
    const { setBulkSessionIds, setStep1Data } = useLiveSessionStore();
    const { settings: liveSessionSettings } = useLiveSessionSettings();
    const filteredStreamingOptions = useMemo(
        () =>
            STREAMING_OPTIONS.filter(
                (opt) =>
                    liveSessionSettings.allowedPlatforms[opt.value as PlatformKey] !== false
            ),
        [liveSessionSettings.allowedPlatforms, STREAMING_OPTIONS]
    );

    // Same subject source the single-class form uses, so the bulk grid offers
    // the institute's curated subject list instead of free text.
    // Use plain useQuery (not useSuspenseQuery) so the component doesn't throw
    // a Promise when the institute fetch is still in flight. The route gate
    // only waits for live-session settings, so on a cold load (deep link /
    // refresh) the institute query may still be pending here. With no
    // <Suspense> boundary above this component, a throw would bubble to the
    // route errorComponent and render the "System Crashed" page. Guarding
    // with isLoading + an early return preserves the same behaviour minus
    // the crash.
    const { data: instituteDetails, isLoading: instituteLoading } = useQuery(
        useInstituteQuery()
    );
    const { SubjectFilterData } = useFilterDataForAssesment(
        instituteDetails as never
    );
    const subjectOptions = useMemo(
        () =>
            (SubjectFilterData ?? []).map((s: { name: string }) => ({
                value: s.name,
                label: s.name,
            })),
        [SubjectFilterData]
    );
    const [submitting, setSubmitting] = useState(false);
    const [editingRegFieldIndex, setEditingRegFieldIndex] = useState<number | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [resultDialog, setResultDialog] = useState<{
        open: boolean;
        created: number;
        failed: number;
        results: BulkLiveSessionRowResult[];
    } | null>(null);
    const [csvImportOpen, setCsvImportOpen] = useState(false);
    // Live "Creating X/Y…" progress while the throttled chunks run.
    const [createProgress, setCreateProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);

    const browserTz = useMemo(() => getBrowserTimezone(), []);

    // Normalized, not raw: this value is persisted to `live_session.timezone`, and the backend
    // splices that column into `AT TIME ZONE` — an unresolvable zone (e.g. the legacy
    // `Asia/Calcutta` that older ICU builds still report) aborts the whole query, not just its
    // own row, taking live-session dispatch down for every institute.
    const initialTimeZone = normalizeTimezone(liveSessionSettings.defaultTimeZone, browserTz);
    // Institute default platform, falling back to 'other' when it isn't set or
    // has since been disallowed. Used to stamp the first row and every new row.
    const initialPlatform =
        liveSessionSettings.defaultPlatform &&
        liveSessionSettings.allowedPlatforms[liveSessionSettings.defaultPlatform] !== false
            ? liveSessionSettings.defaultPlatform
            : 'other';

    const form = useForm<BulkSessionForm>({
        resolver: zodResolver(bulkSessionFormSchema),
        mode: 'onChange',
        defaultValues: {
            timeZone: initialTimeZone,
            rows: [blankRow(initialPlatform, initialTimeZone)],
            sharedOptions: {
                enableWaitingRoom: liveSessionSettings.defaultWaitingRoomEnabled ?? false,
                waitingRoomMinutes: liveSessionSettings.defaultWaitingRoomTime ?? '15',
                waitingRoomType:
                    liveSessionSettings.defaultWaitingRoomType ?? WaitingRoomType.WAITING_ROOM,
                waitingRoomThumbnailFileId: undefined,
                waitingRoomMusicFileId: undefined,
                allowRewind: true,
                allowPause: true,
                showToLearners: false,
                // Feedback defaults to ON, but never when the institute has
                // hidden the whole feedback feature (feedbackEnabled = false).
                enableFeedback:
                    (liveSessionSettings.feedbackEnabled ?? true) &&
                    (liveSessionSettings.defaultFeedbackEnabled ?? true),
                feedbackCompulsory: liveSessionSettings.defaultFeedbackCompulsory ?? false,
                feedbackQuestions: BULK_DEFAULT_FEEDBACK_QUESTIONS,
                recordSession: liveSessionSettings.defaultBbbRecordEnabled ?? true,
                autoStartRecording: liveSessionSettings.defaultBbbAutoStartRecording ?? false,
                muteOnStart: liveSessionSettings.defaultBbbMuteOnStart ?? true,
                webcamsOnlyForModerator:
                    liveSessionSettings.defaultBbbWebcamsOnlyForModerator ?? false,
                guestPolicy: liveSessionSettings.defaultBbbGuestPolicy ?? 'ALWAYS_ACCEPT',
                disableMic: liveSessionSettings.defaultBbbDisableMic ?? false,
                disableCam: liveSessionSettings.defaultBbbDisableCam ?? false,
                disablePrivateChat: liveSessionSettings.defaultBbbDisablePrivateChat ?? false,
                disablePublicChat: liveSessionSettings.defaultBbbDisablePublicChat ?? false,
                disableSharedNotes: liveSessionSettings.defaultBbbDisableSharedNotes ?? false,
                hideUserList: liveSessionSettings.defaultBbbHideUserList ?? false,
                endWhenNoModerator: liveSessionSettings.defaultBbbEndWhenNoModerator ?? false,
                defaultPlatform: initialPlatform,
                defaultDescription: '',
            },
            accessType: AccessType.PRIVATE,
            recordingAutoLink: { enabled: false, destinations: [] },
            notifyBy: {
                mail: liveSessionSettings.defaultNotifyByEmail ?? false,
                whatsapp: liveSessionSettings.defaultNotifyByWhatsapp ?? false,
                push_notification: liveSessionSettings.defaultNotifyByPush ?? false,
                system_notification: liveSessionSettings.defaultNotifyBySystem ?? false,
            },
            notifySettings: {
                onCreate: liveSessionSettings.defaultNotifyOnCreate ?? false,
                beforeLive: !!liveSessionSettings.defaultNotifyBeforeReminder,
                beforeLiveTime: liveSessionSettings.defaultNotifyBeforeReminder
                    ? [{ time: liveSessionSettings.defaultNotifyBeforeReminder }]
                    : [],
                onLive: liveSessionSettings.defaultNotifyOnLive ?? true,
                onAttendance: liveSessionSettings.defaultNotifyOnAttendance ?? false,
            },
        },
    });

    const {
        fields: beforeLiveFields,
        append: beforeLiveAppend,
        remove: beforeLiveRemove,
        replace: beforeLiveReplace,
    } = useFieldArray({
        control: form.control,
        name: 'notifySettings.beforeLiveTime',
    });

    // Once the institute notification defaults load, snap the shared channels
    // and triggers (and pre-seed the reminder) to them, while the admin hasn't
    // manually changed each field.
    useEffect(() => {
        const snapBool = (
            name:
                | 'notifyBy.mail'
                | 'notifyBy.whatsapp'
                | 'notifyBy.push_notification'
                | 'notifyBy.system_notification'
                | 'notifySettings.onCreate'
                | 'notifySettings.onLive'
                | 'notifySettings.onAttendance',
            next: boolean
        ) => {
            if (!form.getFieldState(name).isDirty && form.getValues(name) !== next) {
                form.setValue(name, next);
            }
        };
        snapBool('notifyBy.mail', liveSessionSettings.defaultNotifyByEmail ?? false);
        snapBool('notifyBy.whatsapp', liveSessionSettings.defaultNotifyByWhatsapp ?? false);
        snapBool('notifyBy.push_notification', liveSessionSettings.defaultNotifyByPush ?? false);
        snapBool(
            'notifyBy.system_notification',
            liveSessionSettings.defaultNotifyBySystem ?? false
        );
        snapBool('notifySettings.onCreate', liveSessionSettings.defaultNotifyOnCreate ?? false);
        snapBool('notifySettings.onLive', liveSessionSettings.defaultNotifyOnLive ?? true);
        snapBool(
            'notifySettings.onAttendance',
            liveSessionSettings.defaultNotifyOnAttendance ?? false
        );
        const reminder = liveSessionSettings.defaultNotifyBeforeReminder;
        if (
            reminder &&
            !form.getFieldState('notifySettings.beforeLiveTime').isDirty &&
            (form.getValues('notifySettings.beforeLiveTime')?.length ?? 0) === 0
        ) {
            beforeLiveReplace([{ time: reminder }]);
            form.setValue('notifySettings.beforeLive', true);
        }
    }, [
        liveSessionSettings.defaultNotifyByEmail,
        liveSessionSettings.defaultNotifyByWhatsapp,
        liveSessionSettings.defaultNotifyByPush,
        liveSessionSettings.defaultNotifyBySystem,
        liveSessionSettings.defaultNotifyOnCreate,
        liveSessionSettings.defaultNotifyOnLive,
        liveSessionSettings.defaultNotifyOnAttendance,
        liveSessionSettings.defaultNotifyBeforeReminder,
        beforeLiveReplace,
        form,
    ]);

    // Course / session list for the batch picker (same source step 2 uses).
    // Trigger the same query single-class step 2 implicitly relies on so the
    // store is populated even when admins land directly on the schedule page.
    useQuery(useStudyLibraryQuery());
    const { studyLibraryData } = useStudyLibraryStore();
    const sessionList: DropdownItemType[] = useMemo(
        () =>
            Array.from(
                new Map(
                    (
                        studyLibraryData?.flatMap((item) =>
                            item.sessions.map((session) => ({
                                name: session.session_dto.session_name,
                                id: session.session_dto.id,
                            }))
                        ) ?? []
                    ).map((item) => [item.id, item])
                ).values()
            ),
        [studyLibraryData]
    );
    const courses = useMemo(
        () =>
            studyLibraryData?.flatMap((item) =>
                item.sessions.map((session) => ({
                    courseName: item.course.package_name,
                    courseId: item.course.id,
                    sessionId: session.session_dto.id,
                    levels: session.level_with_details.map((level) => ({
                        name: level.name,
                        id: level.id,
                    })),
                }))
            ),
        [studyLibraryData]
    );
    const accessType = form.watch('accessType');

    // === "Auto-add recordings to course" — ONE shared per-batch map ===
    // Destinations are configured per BATCH (not per row): every distinct
    // batch assigned anywhere in the grid gets one subject→module→chapter
    // row in the dialog. At submit time each session only receives the
    // destinations matching its own batches; unmatched rows fall back to
    // the institute default destination. Gated on the institute-level
    // auto-upload setting and PRIVATE access (public rows have no batches).
    const autoUploadConfigurable =
        liveSessionSettings.lmsConnection.autoUploadRecordingsEnabled &&
        accessType === AccessType.PRIVATE;
    // Which row's "Recording" cell opened the dialog (null = closed). The
    // dialog only shows THAT row's batches, but edits write into the shared
    // per-batch map — so configuring a batch once covers every other row
    // that uses the same batch.
    const [recordingDestRowIndex, setRecordingDestRowIndex] = useState<number | null>(null);
    const resolveRowBatches = useCallback(
        (
            selectedLevels: Array<{ courseId: string; sessionId: string; levelId: string }>
        ): DestinationBatch[] => {
            if (!instituteDetails) return [];
            const seen = new Set<string>();
            const result: DestinationBatch[] = [];
            for (const level of selectedLevels) {
                const batch = instituteDetails.batches_for_sessions.find(
                    (b) =>
                        b.package_dto.id === level.courseId &&
                        b.session.id === level.sessionId &&
                        b.level.id === level.levelId
                );
                if (!batch || seen.has(batch.id)) continue;
                seen.add(batch.id);
                result.push({
                    packageSessionId: batch.id,
                    displayName: [
                        batch.package_dto.package_name,
                        batch.level.level_name,
                        batch.session.session_name,
                    ]
                        .filter(Boolean)
                        .join(' · '),
                });
            }
            return result;
        },
        [instituteDetails]
    );
    const recordingDestRowBatches = useMemo<DestinationBatch[]>(() => {
        if (recordingDestRowIndex === null) return [];
        return resolveRowBatches(
            form.getValues(`rows.${recordingDestRowIndex}.selectedLevels` as const) ?? []
        );
    }, [recordingDestRowIndex, resolveRowBatches, form]);
    // Merge the dialog's row-scoped selection back into the shared map:
    // replace entries for this row's batches, keep every other batch's entry.
    const handleRowAutoLinkChange = (payload: DestinationPickerSubmitPayload) => {
        const rowBatchIds = new Set(recordingDestRowBatches.map((b) => b.packageSessionId));
        const others = (form.getValues('recordingAutoLink.destinations') ?? []).filter(
            (d) => !rowBatchIds.has(d.package_session_id)
        );
        const merged = [...others, ...payload.destinations.filter((d) => d.chapter_id)];
        form.setValue(
            'recordingAutoLink',
            { enabled: merged.length > 0, destinations: merged },
            { shouldDirty: true }
        );
    };

    // Public registration form — shared across every bulk-created session.
    // Mirrors single-class step 2: the same builder UI + the same seed from the
    // institute's default fields. Bulk has no edit mode, so only the "fresh"
    // seeding path applies.
    const {
        fields: regFields,
        move: moveRegField,
        append: appendRegField,
        remove: removeRegField,
    } = useFieldArray({
        control: form.control,
        name: 'fields',
    });
    const [regPreviewOpen, setRegPreviewOpen] = useState(false);

    useEffect(() => {
        if (accessType !== AccessType.PUBLIC) {
            form.setValue('fields', []);
            return;
        }
        const SEEDED = ['full name', 'email', 'phone number', 'mobile number'];
        let cancelled = false;
        const loadFields = async () => {
            const instId = getInstId();
            if (!instId) return;
            const defaults = await fetchInstituteDefaultFields(instId);
            if (cancelled) return;
            const allFields = (defaults ?? []).map((entry) => {
                const cf = entry.custom_field;
                const nameLC = cf.fieldName.toLowerCase();
                const rawType = (cf.fieldType || 'text').toLowerCase();
                const resolvedType = (rawType === 'textfield' ? 'text' : rawType) as InputType;
                const hasOptions =
                    resolvedType === InputType.DROPDOWN || resolvedType === InputType.RADIO;
                // Built-in by ROLE, not by label — see scheduleStep2.
                const builtIn = isBuiltInRegistrationField({
                    key: cf.fieldKey,
                    label: cf.fieldName,
                    type: resolvedType,
                });
                return {
                    label: cf.fieldName,
                    required: builtIn || !!cf.isMandatory,
                    isDefault: builtIn || SEEDED.includes(nameLC),
                    type: resolvedType,
                    ...(hasOptions && cf.config
                        ? (() => {
                              try {
                                  const parsed = JSON.parse(cf.config);
                                  if (Array.isArray(parsed)) {
                                      return {
                                          options: parsed.map((o: { value?: string; label?: string; name?: string }) => ({
                                              label: o.value || o.label || '',
                                              name: o.value || o.name || '',
                                          })),
                                      };
                                  }
                                  if (Array.isArray(parsed?.options)) {
                                      return {
                                          options: parsed.options.map((o: { value?: string; label?: string; name?: string }) => ({
                                              label: o.value || o.label || '',
                                              name: o.value || o.name || '',
                                          })),
                                      };
                                  }
                                  if (parsed.coommaSepartedOptions) {
                                      return {
                                          options: parsed.coommaSepartedOptions
                                              .split(',')
                                              .map((v: string) => ({ label: v.trim(), name: v.trim() })),
                                      };
                                  }
                              } catch {
                                  /* ignore malformed config */
                              }
                              return {};
                          })()
                        : {}),
                };
            });
            // Every institute gets Full Name / Email / Phone Number, required to start with — an
            // institute with no DEFAULT set (or one missing a field) would otherwise open a
            // registration form that collects nothing.
            form.setValue(
                'fields',
                withBuiltInRegistrationFields(
                    allFields,
                    (field) => ({ label: field.label, type: field.type }),
                    (builtIn) => ({
                        label: builtIn.label,
                        required: true,
                        isDefault: true,
                        type: builtIn.type as InputType,
                    })
                )
            );
        };
        loadFields();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accessType]);

    const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
    const [musicFile, setMusicFile] = useState<File | null>(null);
    const [thumbnailUploading, setThumbnailUploading] = useState(false);
    const [musicUploading, setMusicUploading] = useState(false);
    const thumbInputRef = useMemo(
        () => ({ current: null as HTMLInputElement | null }),
        []
    );
    const musicInputRef = useMemo(
        () => ({ current: null as HTMLInputElement | null }),
        []
    );

    const handleSharedThumbnail = async (file: File | null) => {
        setThumbnailFile(file);
        if (!file) {
            form.setValue('sharedOptions.waitingRoomThumbnailFileId', undefined, {
                shouldDirty: true,
            });
            return;
        }
        try {
            setThumbnailUploading(true);
            const fileId = await UploadFileInS3(file, () => {}, 'your-user-id');
            form.setValue('sharedOptions.waitingRoomThumbnailFileId', fileId, {
                shouldDirty: true,
            });
        } catch (err) {
            console.error('Thumbnail upload failed', err);
            toast.error(t('toast.thumbnailUploadFailed'));
            setThumbnailFile(null);
        } finally {
            setThumbnailUploading(false);
        }
    };

    const handleSharedMusic = async (file: File | null) => {
        setMusicFile(file);
        if (!file) {
            form.setValue('sharedOptions.waitingRoomMusicFileId', undefined, {
                shouldDirty: true,
            });
            return;
        }
        try {
            setMusicUploading(true);
            const fileId = await UploadFileInS3(file, () => {}, 'your-user-id');
            form.setValue('sharedOptions.waitingRoomMusicFileId', fileId, {
                shouldDirty: true,
            });
        } catch (err) {
            console.error('Music upload failed', err);
            toast.error(t('toast.musicUploadFailed'));
            setMusicFile(null);
        } finally {
            setMusicUploading(false);
        }
    };

    const { fields, append, remove, insert } = useFieldArray({
        control: form.control,
        name: 'rows',
    });

    // NOTE: intentionally NOT subscribing to `rows` here. Watching the whole
    // rows array re-rendered this large component (and its child editors /
    // rich-text fields) on every keystroke in any cell, which accumulated DOM
    // churn until the tab ran out of memory on long editing sessions. Per-row
    // state now lives in the memoized <RowEditor>; the header count uses a
    // scoped <ReadyCountBadge>; the preview reads a non-reactive snapshot.
    const watchedTimeZone = form.watch('timeZone');

    // If settings load after the form mounted and the admin hasn't picked a
    // different timezone yet, snap to the institute default.
    useEffect(() => {
        const adminDefault = liveSessionSettings.defaultTimeZone;
        if (!adminDefault) return;
        if (form.getFieldState('timeZone').isDirty) return;
        if (form.getValues('timeZone') !== adminDefault) {
            form.setValue('timeZone', adminDefault);
        }
    }, [liveSessionSettings.defaultTimeZone, form]);

    // Once the institute-level live-session defaults load, snap the shared
    // feedback and waiting-room options to them — but only while the admin
    // hasn't already changed each field (isDirty guard). Mirrors the
    // single-class form so both scheduling flows honour the same defaults.
    useEffect(() => {
        const feedbackDefault =
            (liveSessionSettings.feedbackEnabled ?? true) &&
            (liveSessionSettings.defaultFeedbackEnabled ?? true);
        if (
            !form.getFieldState('sharedOptions.enableFeedback').isDirty &&
            form.getValues('sharedOptions.enableFeedback') !== feedbackDefault
        ) {
            form.setValue('sharedOptions.enableFeedback', feedbackDefault);
        }
        const compulsoryDefault = liveSessionSettings.defaultFeedbackCompulsory ?? false;
        if (
            !form.getFieldState('sharedOptions.feedbackCompulsory').isDirty &&
            form.getValues('sharedOptions.feedbackCompulsory') !== compulsoryDefault
        ) {
            form.setValue('sharedOptions.feedbackCompulsory', compulsoryDefault);
        }
        const waitingEnabledDefault = liveSessionSettings.defaultWaitingRoomEnabled ?? false;
        if (
            !form.getFieldState('sharedOptions.enableWaitingRoom').isDirty &&
            form.getValues('sharedOptions.enableWaitingRoom') !== waitingEnabledDefault
        ) {
            form.setValue('sharedOptions.enableWaitingRoom', waitingEnabledDefault);
        }
        const waitingTypeDefault =
            liveSessionSettings.defaultWaitingRoomType ?? WaitingRoomType.WAITING_ROOM;
        if (
            !form.getFieldState('sharedOptions.waitingRoomType').isDirty &&
            form.getValues('sharedOptions.waitingRoomType') !== waitingTypeDefault
        ) {
            form.setValue('sharedOptions.waitingRoomType', waitingTypeDefault);
        }
        const waitingTimeDefault = liveSessionSettings.defaultWaitingRoomTime ?? '15';
        if (
            !form.getFieldState('sharedOptions.waitingRoomMinutes').isDirty &&
            form.getValues('sharedOptions.waitingRoomMinutes') !== waitingTimeDefault
        ) {
            form.setValue('sharedOptions.waitingRoomMinutes', waitingTimeDefault);
        }
        const platformDefault =
            liveSessionSettings.defaultPlatform &&
            liveSessionSettings.allowedPlatforms[liveSessionSettings.defaultPlatform] !== false
                ? liveSessionSettings.defaultPlatform
                : 'other';
        if (
            !form.getFieldState('sharedOptions.defaultPlatform').isDirty &&
            form.getValues('sharedOptions.defaultPlatform') !== platformDefault
        ) {
            form.setValue('sharedOptions.defaultPlatform', platformDefault);
        }
        // Stamp the platform onto the initial row too, but only while it's the
        // lone untouched starter row — never rewrite rows the admin has begun
        // editing or added.
        const rows = form.getValues('rows');
        if (
            rows.length === 1 &&
            !form.getFieldState('rows.0.platform').isDirty &&
            rows[0]?.platform !== platformDefault
        ) {
            form.setValue('rows.0.platform', platformDefault);
        }
        // Vacademy Meet (BBB) recording & control defaults.
        const bbbRecordDefault = liveSessionSettings.defaultBbbRecordEnabled ?? true;
        if (
            !form.getFieldState('sharedOptions.recordSession').isDirty &&
            form.getValues('sharedOptions.recordSession') !== bbbRecordDefault
        ) {
            form.setValue('sharedOptions.recordSession', bbbRecordDefault);
        }
        const bbbAutoStartDefault = liveSessionSettings.defaultBbbAutoStartRecording ?? false;
        if (
            !form.getFieldState('sharedOptions.autoStartRecording').isDirty &&
            form.getValues('sharedOptions.autoStartRecording') !== bbbAutoStartDefault
        ) {
            form.setValue('sharedOptions.autoStartRecording', bbbAutoStartDefault);
        }
        const bbbMuteDefault = liveSessionSettings.defaultBbbMuteOnStart ?? true;
        if (
            !form.getFieldState('sharedOptions.muteOnStart').isDirty &&
            form.getValues('sharedOptions.muteOnStart') !== bbbMuteDefault
        ) {
            form.setValue('sharedOptions.muteOnStart', bbbMuteDefault);
        }
        const bbbWebcamDefault = liveSessionSettings.defaultBbbWebcamsOnlyForModerator ?? false;
        if (
            !form.getFieldState('sharedOptions.webcamsOnlyForModerator').isDirty &&
            form.getValues('sharedOptions.webcamsOnlyForModerator') !== bbbWebcamDefault
        ) {
            form.setValue('sharedOptions.webcamsOnlyForModerator', bbbWebcamDefault);
        }
        const bbbGuestDefault = liveSessionSettings.defaultBbbGuestPolicy ?? 'ALWAYS_ACCEPT';
        if (
            !form.getFieldState('sharedOptions.guestPolicy').isDirty &&
            form.getValues('sharedOptions.guestPolicy') !== bbbGuestDefault
        ) {
            form.setValue('sharedOptions.guestPolicy', bbbGuestDefault);
        }
        const snapBbbLockBool = (
            name:
                | 'sharedOptions.disableMic'
                | 'sharedOptions.disableCam'
                | 'sharedOptions.disablePrivateChat'
                | 'sharedOptions.disablePublicChat'
                | 'sharedOptions.disableSharedNotes'
                | 'sharedOptions.hideUserList'
                | 'sharedOptions.endWhenNoModerator',
            def: boolean
        ) => {
            if (!form.getFieldState(name).isDirty && form.getValues(name) !== def) {
                form.setValue(name, def);
            }
        };
        snapBbbLockBool(
            'sharedOptions.disableMic',
            liveSessionSettings.defaultBbbDisableMic ?? false
        );
        snapBbbLockBool(
            'sharedOptions.disableCam',
            liveSessionSettings.defaultBbbDisableCam ?? false
        );
        snapBbbLockBool(
            'sharedOptions.disablePrivateChat',
            liveSessionSettings.defaultBbbDisablePrivateChat ?? false
        );
        snapBbbLockBool(
            'sharedOptions.disablePublicChat',
            liveSessionSettings.defaultBbbDisablePublicChat ?? false
        );
        snapBbbLockBool(
            'sharedOptions.disableSharedNotes',
            liveSessionSettings.defaultBbbDisableSharedNotes ?? false
        );
        snapBbbLockBool(
            'sharedOptions.hideUserList',
            liveSessionSettings.defaultBbbHideUserList ?? false
        );
        snapBbbLockBool(
            'sharedOptions.endWhenNoModerator',
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
        form,
    ]);

    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID =
        (tokenData?.authorities && Object.keys(tokenData.authorities)[0]) || '';

    // Staff directory behind the Teacher column, fetched once for the whole
    // grid rather than per row. Non-students only, the same people the
    // single-class instructor picker offers. It is also what the CSV's
    // teacher emails / usernames are matched against: the backend's own
    // lookup reads every active user, students included, so it is only the
    // fallback for when this fetch fails.
    const teacherDirectoryQuery = useQuery({
        queryKey: ['live-session-bulk-teacher-directory', INSTITUTE_ID],
        queryFn: () => fetchEligibleOrgUsers(INSTITUTE_ID),
        enabled: !!INSTITUTE_ID,
        staleTime: 5 * 60_000,
    });
    const teacherDirectory = useMemo<TeacherDirectory>(() => {
        const users = teacherDirectoryQuery.data;
        if (users) {
            return {
                status: 'ready',
                users,
                index: buildTeacherIndex(users),
                truncated: users.length >= STAFF_DIRECTORY_PAGE_SIZE,
            };
        }
        return {
            status: teacherDirectoryQuery.isError ? 'error' : 'loading',
            users: [],
            index: null,
            truncated: false,
        };
    }, [teacherDirectoryQuery.data, teacherDirectoryQuery.isError]);

    const applyTeachersToAllRows = useCallback(
        (entries: string[]) => {
            const count = form.getValues('rows')?.length ?? 0;
            for (let i = 0; i < count; i++) {
                form.setValue(`rows.${i}.instructorIdentifiers` as const, [...entries], {
                    shouldDirty: true,
                });
            }
            toast.success(t('toast.teachersApplied', { count }));
        },
        [form, t]
    );

    const addRow = () =>
        append(
            blankRow(
                form.getValues('sharedOptions.defaultPlatform') ?? 'other',
                form.getValues('timeZone') ?? initialTimeZone
            ) as never
        );
    const duplicateRow = useCallback(
        (idx: number) => {
            const current = form.getValues(`rows.${idx}`);
            if (!current) return;
            insert(idx + 1, { ...current });
        },
        [form, insert]
    );

    const handleBulkPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
        // Tab-separated rows from spreadsheet, mapping columns:
        // Title \t Date(YYYY-MM-DD) \t Time(HH:mm) \t Hours \t Minutes \t Platform \t Link
        const text = e.clipboardData.getData('text');
        if (!text || !text.includes('\t')) return;
        e.preventDefault();
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length === 0) return;
        const parsed = lines.map((line) => {
            const cols = line.split('\t');
            return {
                title: cols[0] ?? '',
                startDate: cols[1] ?? new Date().toISOString().slice(0, 10),
                startTime: cols[2] ?? '10:00',
                durationHours: cols[3] ?? '1',
                durationMinutes: cols[4] ?? '0',
                platform: (cols[5] ?? 'other').toLowerCase(),
                link: cols[6] ?? '',
                subject: '',
                description: '',
            };
        });
        // Replace if grid only has the empty starter row
        const isStarter =
            fields.length === 1 && !form.getValues('rows.0.title') && !form.getValues('rows.0.link');
        if (isStarter) {
            form.setValue('rows', parsed as never, { shouldValidate: true });
        } else {
            for (const row of parsed) append(row as never);
        }
        toast.success(t('toast.pastedRows', { count: parsed.length }));
    };

    // Imported CSV rows replace a lone empty starter row, otherwise append —
    // same rule as paste, so admins can stack imports onto manual rows.
    const applyImportedRows = (rows: BulkSessionRow[]) => {
        if (rows.length === 0) return;
        const isStarter =
            fields.length === 1 &&
            !form.getValues('rows.0.title') &&
            !form.getValues('rows.0.link');
        if (isStarter) {
            form.setValue('rows', rows as never, { shouldValidate: true });
        } else {
            for (const row of rows) append(row as never);
        }
        toast.success(t('toast.importedRows', { count: rows.length }));
        // Teacher emails / usernames that matched nobody stay on their rows,
        // flagged in the Teacher column; say so now rather than at submit.
        const index = teacherDirectory.index;
        if (index) {
            const unmatched = rows.reduce(
                (n, r) => n + problemTeacherEntries(index, r.instructorIdentifiers ?? []).length,
                0
            );
            if (unmatched > 0) toast.warning(t('toast.teachersNotMatched', { count: unmatched }));
        }
    };

    const onSubmit = async (data: BulkSessionForm) => {
        if (!INSTITUTE_ID) {
            toast.error(t('toast.instituteNotResolved'));
            return;
        }
        setSubmitting(true);
        try {
            // Build a step-1 DTO per row by reusing the existing transformer.
            // Shared options apply to every row (waiting room, playback locks,
            // feedback, recording). File uploads happen once and the resulting
            // ids are stamped onto every row's DTO.
            const shared = data.sharedOptions;
            const sessions = data.rows.map((row) => {
                const startTimeISO = `${row.startDate}T${row.startTime}`;
                const isBbb = row.platform === 'bbb';
                const computedStreamingType = streamingTypeForPlatform(row.platform);
                // Compose a sessionFormSchema-shaped object so we can reuse the
                // mature transformer without duplicating ISO/duration logic.
                // NOTE: in the form schema, `sessionPlatform` is the streaming
                // platform name ('bbb', 'youtube', etc.) and maps to backend
                // `link_type`; `streamingType` is the embed/redirect flag and
                // maps to backend `session_streaming_service_type`. Earlier
                // versions of this code had these two reversed, which produced
                // payloads like `link_type: "embed"` + `session_streaming_service_type: "bbb"`
                // that broke BBB auto-provisioning.
                // Resolve waiting-room values: row override wins over shared.
                const rowWaitingEnabled =
                    row.waitingRoomEnabled ?? shared.enableWaitingRoom;
                const rowWaitingMinutes =
                    row.waitingRoomMinutes ?? shared.waitingRoomMinutes;
                const rowWaitingThumbnail =
                    row.waitingRoomThumbnailFileId ??
                    shared.waitingRoomThumbnailFileId;
                const rowWaitingMusic =
                    row.waitingRoomMusicFileId ?? shared.waitingRoomMusicFileId;

                const synthetic: z.infer<typeof sessionFormSchema> = {
                    title: row.title,
                    subject: row.subject ?? '',
                    openWaitingRoomBefore: rowWaitingEnabled
                        ? rowWaitingMinutes
                        : '',
                    waitingRoomType:
                        row.waitingRoomType ??
                        shared.waitingRoomType ??
                        WaitingRoomType.WAITING_ROOM,
                    sessionType: SessionType.LIVE,
                    sessionPlatform: row.platform || 'other',
                    enableWaitingRoom: rowWaitingEnabled,
                    streamingType: computedStreamingType,
                    allowRewind: shared.allowRewind,
                    allowPause: shared.allowPause,
                    // Sent only by attendance-only institutes; omitted otherwise.
                    showToLearners: liveSessionSettings.attendanceOnlyMode
                        ? shared.showToLearners
                        : undefined,
                    startTime: startTimeISO,
                    timeZone: data.timeZone,
                    events: '0',
                    description: row.description ?? '',
                    durationMinutes: row.durationMinutes || '0',
                    durationHours: row.durationHours || '0',
                    defaultLink: row.link ?? '',
                    meetingType: RecurringType.ONCE,
                    recurringSchedule: [],
                    learner_button_config: null,
                    feedbackEnabled: shared.enableFeedback,
                    feedbackCompulsory: shared.enableFeedback ? shared.feedbackCompulsory : false,
                    feedbackQuestions: shared.enableFeedback
                        ? shared.feedbackQuestions ?? BULK_DEFAULT_FEEDBACK_QUESTIONS
                        : undefined,
                    // BBB-specific recording & moderation. Harmless on non-BBB
                    // rows because the backend only persists bbb_config when
                    // the row platform is bbb.
                    bbbRecord: isBbb ? shared.recordSession : undefined,
                    bbbAutoStartRecording:
                        isBbb && shared.recordSession ? shared.autoStartRecording : undefined,
                    bbbMuteOnStart: isBbb ? shared.muteOnStart : undefined,
                    bbbWebcamsOnlyForModerator: isBbb
                        ? shared.webcamsOnlyForModerator
                        : undefined,
                    bbbGuestPolicy: isBbb ? shared.guestPolicy : undefined,
                    bbbDisableMic: isBbb ? shared.disableMic : undefined,
                    bbbDisableCam: isBbb ? shared.disableCam : undefined,
                    bbbDisablePrivateChat: isBbb ? shared.disablePrivateChat : undefined,
                    bbbDisablePublicChat: isBbb ? shared.disablePublicChat : undefined,
                    bbbDisableSharedNotes: isBbb ? shared.disableSharedNotes : undefined,
                    bbbHideUserList: isBbb ? shared.hideUserList : undefined,
                    bbbEndWhenNoModerator: isBbb ? shared.endWhenNoModerator : undefined,
                };
                const dto = transformFormToDTOStep1(
                    synthetic,
                    INSTITUTE_ID,
                    [],
                    rowWaitingMusic,
                    rowWaitingThumbnail,
                    undefined,
                    null
                );

                // Override start_time and last_entry_time with a *real* UTC
                // timestamp computed from the user's typed wall-clock and the
                // institute timezone. The shared transformer's date math
                // assumes browser-local timezone, which produces a 5:30h drift
                // on the server when the user is in IST and the institute is
                // also in IST. Using fromZonedTime makes the computation
                // timezone-aware and round-trips correctly.
                const totalDurationMinutes =
                    Number(row.durationHours || '0') * 60 +
                    Number(row.durationMinutes || '0');
                // Bulk must match the single-class wire convention: send the
                // user's wall-clock at the session's timezone, *labeled* as
                // UTC ('Z'). The backend extracts meeting_date / start_time
                // via Timestamp.toLocalDateTime() (no timezone awareness),
                // so a real UTC instant for an IST wall-clock value would
                // shift the stored date by the tz offset (e.g.
                // 2026-05-10 00:45 IST → 2026-05-09 in the DB), and the
                // search "today in session tz" filter would miss the row.
                const startUtc = fromZonedTime(
                    `${row.startDate}T${row.startTime}:00`,
                    data.timeZone
                );
                const endUtc = new Date(
                    startUtc.getTime() + totalDurationMinutes * 60_000
                );
                const wireFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
                dto.start_time = formatTZ(startUtc, wireFormat, {
                    timeZone: data.timeZone,
                });
                dto.last_entry_time = formatTZ(endUtc, wireFormat, {
                    timeZone: data.timeZone,
                });
                return dto;
            });

            // Build the per-row step-2 payloads up front so we can ship
            // EVERYTHING — sessions and their access/participants/notifications
            // — to the backend in a single /create/bulk call. The backend's
            // BulkLiveSessionService loops the `step2_per_row` array in lock
            // step with `sessions` and applies each row's step-2 to the
            // freshly-created session id.
            const beforeLiveTimes = data.notifySettings.beforeLiveTime ?? [];
            const buildPackageSessionIds = (
                rowLevels: Array<{ courseId: string; sessionId: string; levelId: string }>
            ) =>
                rowLevels.map((level) => {
                    if (!instituteDetails) return '';
                    const matchingBatch = instituteDetails.batches_for_sessions.find(
                        (batch) =>
                            batch.package_dto.id === level.courseId &&
                            batch.session.id === level.sessionId &&
                            batch.level.id === level.levelId
                    );
                    return matchingBatch?.id || '';
                });

            // Mirror the single-class step 2 join_link logic so bulk-created
            // sessions also get a clickable join link on the view page (and
            // the BBB Meeting card renders correctly). The backend overrides
            // each entry's session_id, but we still build a per-row link
            // shape so PUBLIC sessions get the registration URL (the
            // sessionId placeholder is harmless until the backend sees the
            // real id and we don't need it in the link for the private path).
            const rawPortalUrl = instituteDetails?.learner_portal_base_url;
            const learnerBaseUrl = rawPortalUrl
                ? rawPortalUrl.startsWith('http')
                    ? rawPortalUrl
                    : `https://${rawPortalUrl}`
                : BASE_URL_LEARNER_DASHBOARD;

            // Shared "recording → chapter" map, applied per row below. Only
            // destinations with a chapter chosen count; rows whose batches
            // have none get NO config at all (an empty enabled config would
            // shadow the institute-default fallback on the backend).
            const autoLinkDestinations =
                data.recordingAutoLink?.enabled && data.accessType === AccessType.PRIVATE
                    ? (data.recordingAutoLink.destinations ?? []).filter((d) => d.chapter_id)
                    : [];

            // Teacher entries that were left out of a row, reported on that
            // row's result (and in the downloadable results CSV).
            const skippedTeachersByRow = new Map<
                number,
                { notFound: string[]; ambiguous: string[] }
            >();

            const step2PerRow = data.rows.map((row, rowIndex) => {
                const joinLinkForRow =
                    data.accessType === AccessType.PUBLIC
                        ? `${learnerBaseUrl}/register/live-class?sessionId={{SESSION_ID}}`
                        : `${learnerBaseUrl}/study-library/live-class`;
                const rowPackageSessionIds = buildPackageSessionIds(row.selectedLevels ?? []);
                const rowAutoLinkDestinations = autoLinkDestinations.filter((d) =>
                    rowPackageSessionIds.includes(d.package_session_id)
                );
                const syntheticStep2Form = {
                    accessType: data.accessType,
                    batchSelectionType: 'batch',
                    selectedLevels: row.selectedLevels ?? [],
                    selectedLearners: [],
                    joinLink: joinLinkForRow,
                    notifyBy: data.notifyBy,
                    notifySettings: {
                        onCreate: data.notifySettings.onCreate,
                        beforeLive: beforeLiveTimes.length > 0,
                        beforeLiveTime: beforeLiveTimes,
                        onLive: data.notifySettings.onLive,
                        onAttendance: data.notifySettings.onAttendance,
                    },
                    // Public sessions carry the shared registration form; private
                    // sessions have no public form, so send an empty list.
                    fields: data.accessType === AccessType.PUBLIC ? (data.fields ?? []) : [],
                    // Slides are always Published in the bulk flow; notify is
                    // governed by the institute-level auto-upload setting (the
                    // backend overrides whatever is stored here).
                    recordingAutoLink:
                        rowAutoLinkDestinations.length > 0
                            ? {
                                  touched: true,
                                  enabled: true,
                                  slideStatus: 'PUBLISHED',
                                  notify: false,
                                  destinations: rowAutoLinkDestinations,
                              }
                            : undefined,
                } as unknown as Parameters<typeof transformFormToDTOStep2>[0];

                // Pass an empty session_id; backend's BulkLiveSessionService
                // overwrites it with the real id from each created session.
                const rowStep2 = transformFormToDTOStep2(
                    syntheticStep2Form,
                    '',
                    rowPackageSessionIds
                );

                // Teachers: user ids picked in the grid, or the CSV's emails /
                // usernames. With the staff directory loaded they are resolved
                // here; entries that match nobody (or two people) are left out
                // and reported on the row's result. Without the directory the
                // raw entries go to the backend, which resolves them itself and
                // reports what it couldn't match. The same goes for misses
                // against a directory that came back cut off at its page size.
                //
                // Only sent when the row names someone: an empty list would mean
                // "remove all instructors" and would wipe the creator the backend
                // seeds for rows that named nobody.
                const teacherEntries = row.instructorIdentifiers ?? [];
                if (teacherEntries.length > 0) {
                    const index = teacherDirectory.index;
                    if (index) {
                        const { userIds, unmatched, ambiguous } = splitTeacherEntries(
                            index,
                            teacherEntries
                        );
                        if (userIds.length > 0) rowStep2.instructor_user_ids = userIds;
                        const notFound = teacherDirectory.truncated ? [] : unmatched;
                        if (teacherDirectory.truncated && unmatched.length > 0) {
                            rowStep2.instructor_identifiers = unmatched;
                        }
                        if (notFound.length > 0 || ambiguous.length > 0) {
                            skippedTeachersByRow.set(rowIndex, { notFound, ambiguous });
                        }
                    } else {
                        rowStep2.instructor_identifiers = teacherEntries;
                    }
                }

                return rowStep2;
            });

            // Throttled creation: send rows in small chunks with a short pause
            // between each so the server isn't hit with everything at once.
            const chunkedResponse = await createLiveSessionsChunked(sessions, step2PerRow, {
                // One session per request so the UI can count progress per class
                // ("Scheduling 1/200…"). Total time is backend-bound, so this
                // doesn't slow things down meaningfully vs larger chunks.
                chunkSize: 1,
                onProgress: (done, total) => setCreateProgress({ done, total }),
            });
            const response = {
                ...chunkedResponse,
                results: chunkedResponse.results.map((r) => {
                    const skipped = skippedTeachersByRow.get(r.index);
                    if (!r.success || !skipped) return r;
                    const warnings = [...(r.warnings ?? [])];
                    if (skipped.notFound.length > 0) {
                        warnings.push(
                            t('resultDialog.teachersSkipped', {
                                list: skipped.notFound.join(', '),
                            })
                        );
                    }
                    if (skipped.ambiguous.length > 0) {
                        warnings.push(
                            t('resultDialog.teachersAmbiguous', {
                                list: skipped.ambiguous.join(', '),
                            })
                        );
                    }
                    return { ...r, warnings };
                }),
            };

            const successfulResults = response.results.filter(
                (r) => r.success && r.session_id
            );
            const createdIds = successfulResults.map(
                (r) => r.session_id as string
            );

            // The bulk endpoint reports per-row outcomes via `success` /
            // `error` (step1+step2 are atomic on the server now — a step2
            // failure rolls back the row's session and surfaces the real
            // error message). All we need to do here is render whatever the
            // server returned.
            const failures = response.results
                .filter((r) => !r.success)
                .map((r) => ({ index: r.index, title: r.title, error: r.error }));

            if (createdIds.length > 0) {
                // Clear any leftover bulk state — step 2 is no longer part of
                // the bulk flow now that everything is on a single sheet.
                setBulkSessionIds([]);
                setStep1Data({
                    title: data.rows[0]?.title ?? '',
                    subject: data.rows[0]?.subject ?? '',
                    openWaitingRoomBefore: '',
                    waitingRoomType: WaitingRoomType.WAITING_ROOM,
                    sessionType: SessionType.LIVE,
                    sessionPlatform: data.rows[0]?.platform || 'other',
                    enableWaitingRoom: false,
                    streamingType: streamingTypeForPlatform(data.rows[0]?.platform),
                    allowRewind: true,
                    allowPause: true,
                    startTime: `${data.rows[0]?.startDate}T${data.rows[0]?.startTime}`,
                    timeZone: data.timeZone,
                    events: '0',
                    description: data.rows[0]?.description ?? '',
                    durationMinutes: data.rows[0]?.durationMinutes ?? '30',
                    durationHours: data.rows[0]?.durationHours ?? '0',
                    defaultLink: data.rows[0]?.link ?? '',
                    meetingType: RecurringType.ONCE,
                    recurringSchedule: [],
                    learner_button_config: null,
                });
            }

            // Always show the results dialog so the admin gets a row-wise
            // outcome and can download the Success/Failed + remarks report,
            // whether or not anything failed. Navigation is via its Done button.
            setResultDialog({
                open: true,
                created: createdIds.length,
                failed: failures.length,
                results: response.results,
            });
            if (failures.length === 0) {
                toast.success(t('toast.sessionsCreated', { count: createdIds.length }));
            }
        } catch (err) {
            // Capture to Sentry (feature-tagged) + show a toast in one call so
            // bulk create failures are no longer console-only.
            reportApiError(err, {
                feature: 'live-session-bulk-schedule-create',
                fallbackMessage: 'Failed to create sessions. Please try again.',
                tags: { accessType: data.accessType },
                extra: {
                    rowCount: data.rows?.length ?? 0,
                    accessType: data.accessType,
                },
            });
        } finally {
            setSubmitting(false);
            setCreateProgress(null);
        }
    };

    const totalRows = fields.length;
    // Non-reactive snapshot for the (modal) preview dialog. The grid can't be
    // edited while the dialog is open, and opening it re-renders this component
    // (via `previewOpen` state), so reading current values here — instead of
    // subscribing to every row — stays accurate without re-rendering the whole
    // form on each keystroke. The live header count uses <ReadyCountBadge>.
    const previewRows = form.getValues('rows') ?? [];
    const previewValidCount = previewRows.filter((r) => isRowReady(r, accessType)).length;

    // Wait for the institute to load before mounting the grid. `instituteDetails`
    // is consumed by onSubmit (batches_for_sessions, learner_portal_base_url),
    // and downstream submit code assumes it is defined. Showing a loader here
    // also avoids the previous crash where useSuspenseQuery would throw a
    // pending Promise without a Suspense boundary above and trip the
    // route-level errorComponent ("System Crashed").
    if (instituteLoading || !instituteDetails) {
        return (
            <div className="flex h-64 items-center justify-center">
                <CircleNotch className="size-8 animate-spin text-neutral-400" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5 pb-20">
            <SectionCard
                icon={<Globe size={18} />}
                title={t('config.title')}
                description={t('config.description')}
            >
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium text-neutral-700">
                            {t('config.timezoneLabel')} <span className="text-danger-600">*</span>
                        </label>
                        <Select
                            value={watchedTimeZone}
                            onValueChange={(v) =>
                                form.setValue('timeZone', v, { shouldValidate: true })
                            }
                        >
                            <SelectTrigger className="h-9 w-full">
                                <SelectValue placeholder={t('config.selectTimezone')} />
                            </SelectTrigger>
                            <SelectContent>
                                {TIMEZONE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt._id} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Controller
                        control={form.control}
                        name="sharedOptions.defaultPlatform"
                        render={({ field }) => (
                            <div className="flex flex-col gap-1">
                                <label className="text-sm font-medium text-neutral-700">
                                    {t('config.defaultPlatformLabel')}
                                </label>
                                <Select
                                    value={field.value ?? 'other'}
                                    onValueChange={(v) => {
                                        field.onChange(v);
                                        // Apply to existing empty / "other" rows so admins
                                        // don't have to retype per row when they switch
                                        // platforms after adding a few rows.
                                        const rows = form.getValues('rows') ?? [];
                                        rows.forEach((r, i) => {
                                            if (!r.platform || r.platform === 'other') {
                                                form.setValue(
                                                    `rows.${i}.platform` as const,
                                                    v,
                                                    { shouldDirty: true }
                                                );
                                            }
                                        });
                                    }}
                                >
                                    <SelectTrigger className="h-9 w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {filteredStreamingOptions.map((opt) => (
                                            <SelectItem
                                                key={opt._id}
                                                value={opt.value}
                                            >
                                                {opt.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <span className="text-[11px] text-neutral-500">
                                    {t('config.defaultPlatformHint')}
                                </span>
                            </div>
                        )}
                    />
                </div>
            </SectionCard>

            <SectionCard
                icon={<UsersThree size={18} />}
                title={t('sharedSettings.title')}
                description={t('sharedSettings.description')}
            >
                <div className="grid gap-3 sm:grid-cols-2">
                    {/* Learner visibility (attendance-only institutes) */}
                    {liveSessionSettings.attendanceOnlyMode && (
                        <Controller
                            control={form.control}
                            name="sharedOptions.showToLearners"
                            render={({ field }) => (
                                <label className="flex items-center justify-between gap-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 sm:col-span-2">
                                    <div>
                                        <div className="text-sm font-medium text-neutral-800">
                                            {t('sharedSettings.showToLearnersLabel')}
                                        </div>
                                        <div className="mt-0.5 text-xs text-neutral-500">
                                            {field.value
                                                ? t('sharedSettings.showToLearnersOnHint')
                                                : t('sharedSettings.showToLearnersOffHint')}
                                        </div>
                                    </div>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </label>
                            )}
                        />
                    )}
                    {/* Waiting room */}
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium text-neutral-800">
                                    {t('sharedSettings.waitingRoomTitle')}
                                </div>
                                <div className="mt-0.5 text-xs text-neutral-500">
                                    {t('sharedSettings.waitingRoomDescription')}
                                </div>
                            </div>
                            <Controller
                                control={form.control}
                                name="sharedOptions.enableWaitingRoom"
                                render={({ field }) => (
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                )}
                            />
                        </div>
                        {form.watch('sharedOptions.enableWaitingRoom') && (
                            <div className="mt-3 space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-neutral-600">
                                        {t('sharedSettings.waitingRoomTypeLabel')}
                                    </label>
                                    <Controller
                                        control={form.control}
                                        name="sharedOptions.waitingRoomType"
                                        render={({ field }) => (
                                            <Select
                                                value={field.value}
                                                onValueChange={field.onChange}
                                            >
                                                <SelectTrigger className="mt-1 h-8 w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {WAITING_ROOM_TYPE_OPTIONS.map((opt) => (
                                                        <SelectItem
                                                            key={opt._id}
                                                            value={opt.value}
                                                        >
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-neutral-600">
                                        {t('sharedSettings.openWaitingRoomBeforeLabel')}
                                    </label>
                                    <Controller
                                        control={form.control}
                                        name="sharedOptions.waitingRoomMinutes"
                                        render={({ field }) => (
                                            <Select
                                                value={field.value}
                                                onValueChange={field.onChange}
                                            >
                                                <SelectTrigger className="mt-1 h-8 w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {WAITING_ROOM_OPTIONS.map((opt) => (
                                                        <SelectItem
                                                            key={opt._id}
                                                            value={opt.value}
                                                        >
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>
                                {form.watch('sharedOptions.waitingRoomType') !==
                                    WaitingRoomType.PRE_JOINING && (
                                    <>
                                <div>
                                    <label className="text-xs font-medium text-neutral-600">
                                        {t('sharedSettings.thumbnailLabel')}
                                    </label>
                                    <input
                                        ref={(el) => {
                                            thumbInputRef.current = el;
                                        }}
                                        type="file"
                                        accept=".png,.jpg,.jpeg"
                                        className="hidden"
                                        onChange={(e) =>
                                            handleSharedThumbnail(e.target.files?.[0] ?? null)
                                        }
                                    />
                                    <div className="mt-1 flex items-center gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => thumbInputRef.current?.click()}
                                            disabled={thumbnailUploading}
                                        >
                                            <UploadSimple size={14} className="mr-1" />
                                            {thumbnailFile
                                                ? t('sharedSettings.replace')
                                                : t('sharedSettings.upload')}
                                        </Button>
                                        {thumbnailUploading && (
                                            <span className="text-xs text-neutral-500">
                                                {t('sharedSettings.uploading')}
                                            </span>
                                        )}
                                        {thumbnailFile && !thumbnailUploading && (
                                            <span className="flex max-w-[160px] items-center gap-1 truncate rounded border border-primary-300 bg-primary-50 px-2 py-1 text-xs text-primary-700">
                                                <span className="truncate">
                                                    {thumbnailFile.name}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSharedThumbnail(null)}
                                                    className="text-danger-500"
                                                    aria-label={t('sharedSettings.removeThumbnail')}
                                                >
                                                    <XIcon size={12} />
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-neutral-600">
                                        {t('sharedSettings.backgroundScoreLabel')}
                                    </label>
                                    <input
                                        ref={(el) => {
                                            musicInputRef.current = el;
                                        }}
                                        type="file"
                                        accept=".mp3,.wav,.ogg,.m4a,.aac,.flac"
                                        className="hidden"
                                        onChange={(e) =>
                                            handleSharedMusic(e.target.files?.[0] ?? null)
                                        }
                                    />
                                    <div className="mt-1 flex items-center gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => musicInputRef.current?.click()}
                                            disabled={musicUploading}
                                        >
                                            <UploadSimple size={14} className="mr-1" />
                                            {musicFile
                                                ? t('sharedSettings.replace')
                                                : t('sharedSettings.upload')}
                                        </Button>
                                        {musicUploading && (
                                            <span className="text-xs text-neutral-500">
                                                {t('sharedSettings.uploading')}
                                            </span>
                                        )}
                                        {musicFile && !musicUploading && (
                                            <span className="flex max-w-[160px] items-center gap-1 truncate rounded border border-primary-300 bg-primary-50 px-2 py-1 text-xs text-primary-700">
                                                <MusicNote size={12} />
                                                <span className="truncate">{musicFile.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSharedMusic(null)}
                                                    className="text-danger-500"
                                                    aria-label={t('sharedSettings.removeMusic')}
                                                >
                                                    <XIcon size={12} />
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Lock playback */}
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div className="text-sm font-medium text-neutral-800">
                            {t('sharedSettings.lockPlaybackTitle')}
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-500">
                            {t('sharedSettings.lockPlaybackDescription')}
                        </div>
                        <div className="mt-3 flex flex-col gap-2">
                            <Controller
                                control={form.control}
                                name="sharedOptions.allowRewind"
                                render={({ field }) => (
                                    <label className="flex items-center justify-between text-sm">
                                        <span>{t('sharedSettings.allowRewind')}</span>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </label>
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="sharedOptions.allowPause"
                                render={({ field }) => (
                                    <label className="flex items-center justify-between text-sm">
                                        <span>{t('sharedSettings.allowPlayPause')}</span>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </label>
                                )}
                            />
                        </div>
                    </div>

                    {/* Feedback */}
                    {liveSessionSettings.feedbackEnabled && (
                        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 sm:col-span-2">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2">
                                    <ChatTeardrop
                                        size={18}
                                        className="mt-0.5 text-primary-500"
                                    />
                                    <div>
                                        <div className="text-sm font-medium text-neutral-800">
                                            {t('sharedSettings.feedbackTitle')}
                                        </div>
                                        <div className="mt-0.5 text-xs text-neutral-500">
                                            {t('sharedSettings.feedbackDescription')}
                                        </div>
                                    </div>
                                </div>
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.enableFeedback"
                                    render={({ field }) => (
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    )}
                                />
                            </div>

                            {form.watch('sharedOptions.enableFeedback') && (
                                <div className="mt-3 space-y-2">
                                    <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2">
                                        <div>
                                            <div className="text-xs font-medium text-neutral-700">
                                                {t('sharedSettings.feedbackCompulsoryLabel')}
                                            </div>
                                            <div className="mt-0.5 text-[11px] text-neutral-500">
                                                {t('sharedSettings.feedbackCompulsoryDescription')}
                                            </div>
                                        </div>
                                        <Controller
                                            control={form.control}
                                            name="sharedOptions.feedbackCompulsory"
                                            render={({ field }) => (
                                                <Switch
                                                    checked={field.value ?? false}
                                                    onCheckedChange={field.onChange}
                                                />
                                            )}
                                        />
                                    </div>
                                    <div className="text-xs font-medium text-neutral-600">
                                        {t('sharedSettings.questionsLabel')}
                                    </div>
                                    {(
                                        form.watch('sharedOptions.feedbackQuestions') ??
                                        BULK_DEFAULT_FEEDBACK_QUESTIONS
                                    ).map((q, idx) => (
                                        <div
                                            key={q.id}
                                            className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Controller
                                                    control={form.control}
                                                    name={
                                                        `sharedOptions.feedbackQuestions.${idx}.enabled` as const
                                                    }
                                                    render={({ field }) => (
                                                        <Checkbox
                                                            checked={field.value ?? true}
                                                            onCheckedChange={field.onChange}
                                                            className={cn(
                                                                'size-4 rounded-sm border-2 shadow-none',
                                                                field.value
                                                                    ? 'border-none bg-primary-500 text-white'
                                                                    : ''
                                                            )}
                                                        />
                                                    )}
                                                />
                                                <span className="text-sm">
                                                    {q.label}
                                                    <span className="ml-1 text-xs text-neutral-400">
                                                        (
                                                        {q.type === 'star_rating'
                                                            ? t('sharedSettings.ratingSuffix')
                                                            : t('sharedSettings.textSuffix')}
                                                        )
                                                    </span>
                                                </span>
                                            </div>
                                            <Controller
                                                control={form.control}
                                                name={
                                                    `sharedOptions.feedbackQuestions.${idx}.mandatory` as const
                                                }
                                                render={({ field }) => (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            field.onChange(!field.value)
                                                        }
                                                        className={cn(
                                                            'w-fit rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                                                            field.value
                                                                ? 'bg-primary-100 text-primary-700'
                                                                : 'bg-neutral-100 text-neutral-500'
                                                        )}
                                                    >
                                                        {field.value
                                                            ? t('sharedSettings.required')
                                                            : t('sharedSettings.optional')}
                                                    </button>
                                                )}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Recording — Vacademy Meet only */}
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 sm:col-span-2">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2">
                                <Record size={18} className="mt-0.5 text-primary-500" />
                                <div>
                                    <div className="text-sm font-medium text-neutral-800">
                                        {t('sharedSettings.recordingTitle')}
                                    </div>
                                    <div className="mt-0.5 text-xs text-neutral-500">
                                        {t('sharedSettings.recordingDescription')}
                                    </div>
                                </div>
                            </div>
                            <Controller
                                control={form.control}
                                name="sharedOptions.recordSession"
                                render={({ field }) => (
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                )}
                            />
                        </div>
                        {form.watch('sharedOptions.recordSession') && (
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.autoStartRecording"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.autoStartRecording')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.muteOnStart"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.muteOnStart')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.webcamsOnlyForModerator"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.webcamOnlyModerator')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <div className="flex flex-col gap-1 text-sm">
                                    <span>{t('sharedSettings.guestPolicyLabel')}</span>
                                    <Controller
                                        control={form.control}
                                        name="sharedOptions.guestPolicy"
                                        render={({ field }) => (
                                            <Select
                                                value={field.value}
                                                onValueChange={field.onChange}
                                            >
                                                <SelectTrigger className="h-8">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="ALWAYS_ACCEPT">
                                                        {t('sharedSettings.guestAlwaysAccept')}
                                                    </SelectItem>
                                                    <SelectItem value="ASK_MODERATOR">
                                                        {t('sharedSettings.guestAskModerator')}
                                                    </SelectItem>
                                                    <SelectItem value="ALWAYS_DENY">
                                                        {t('sharedSettings.guestAlwaysDeny')}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>
                            </div>
                        )}
                        {/* Lock settings apply regardless of recording, so they sit
                            outside the recordSession conditional above. */}
                        <div className="mt-3 border-t border-neutral-200 pt-3">
                            <div className="text-xs font-medium text-neutral-600">
                                {t('sharedSettings.restrictionsTitle')}
                            </div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.disableMic"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.disableMic')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.disableCam"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.disableCam')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.disablePrivateChat"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.disablePrivateChat')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.disablePublicChat"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.disablePublicChat')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.disableSharedNotes"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.disableSharedNotes')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.hideUserList"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.hideUserList')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="sharedOptions.endWhenNoModerator"
                                    render={({ field }) => (
                                        <label className="flex items-center justify-between text-sm">
                                            <span>{t('sharedSettings.endWhenNoModerator')}</span>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </label>
                                    )}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </SectionCard>

            {liveSessionSettings.descriptionEnabled && (
            <SectionCard
                icon={<Article size={18} />}
                title={t('descriptionSection.title')}
                description={t('descriptionSection.description')}
            >
                <div className="flex flex-col gap-3">
                    <Controller
                        control={form.control}
                        name="sharedOptions.defaultDescription"
                        render={({ field }) => (
                            <RichTextEditor
                                onChange={field.onChange}
                                value={field.value || ''}
                                onBlur={field.onBlur}
                                minHeight={180}
                            />
                        )}
                    />
                    <div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                const raw = form.getValues('sharedOptions.defaultDescription') ?? '';
                                // Strip HTML to detect "really empty" rich-text (e.g., "<p></p>").
                                const plain = raw.replace(/<[^>]*>/g, '').trim();
                                if (!plain) {
                                    toast.error(t('toast.descriptionRequired'));
                                    return;
                                }
                                const rows = form.getValues('rows');
                                let applied = 0;
                                rows.forEach((r, i) => {
                                    const existing = (r.description ?? '').replace(/<[^>]*>/g, '').trim();
                                    if (!existing) {
                                        form.setValue(`rows.${i}.description` as const, raw, {
                                            shouldDirty: true,
                                        });
                                        applied += 1;
                                    }
                                });
                                if (applied === 0) {
                                    toast(t('toast.noRowsToFill'));
                                } else {
                                    toast.success(
                                        t('toast.descriptionApplied', { count: applied })
                                    );
                                }
                            }}
                        >
                            {t('descriptionSection.applyToEmptyRows')}
                        </Button>
                        <span className="ml-2 text-xs text-neutral-500">
                            {t('descriptionSection.hint')}
                        </span>
                    </div>
                </div>
            </SectionCard>
            )}

            <SectionCard
                icon={<TableIcon size={18} />}
                title={t('sessionsSection.title')}
                description={t('sessionsSection.description')}
                headerRight={
                    <div className="flex items-center gap-2">
                        <ReadyCountBadge
                            control={form.control}
                            totalRows={totalRows}
                        />
                    </div>
                }
                contentClassName="p-0 sm:p-0"
            >
                <div
                    className="overflow-hidden rounded-b-xl"
                    onPaste={handleBulkPaste}
                >
                    <div className="max-h-[520px] overflow-auto">
                        <Table className="min-w-[1200px]">
                            <TableHeader className="sticky top-0 z-10 bg-neutral-50">
                                <TableRow className="border-neutral-200">
                                    <TableHead className="w-10 text-center text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.number')}
                                    </TableHead>
                                    <TableHead className="min-w-[180px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.title')}
                                    </TableHead>
                                    <TableHead className="min-w-[130px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.subject')}
                                    </TableHead>
                                    <TableHead className="min-w-[150px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.date')}
                                    </TableHead>
                                    <TableHead className="min-w-[110px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.start')}
                                    </TableHead>
                                    <TableHead className="min-w-[80px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.hrs')}
                                    </TableHead>
                                    <TableHead className="min-w-[80px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.mins')}
                                    </TableHead>
                                    <TableHead className="min-w-[140px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.platform')}
                                    </TableHead>
                                    <TableHead className="min-w-[220px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.link')}
                                    </TableHead>
                                    <TableHead className="min-w-[160px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.batches')}
                                    </TableHead>
                                    <TableHead className="min-w-44 text-2xs uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.teacher')}
                                    </TableHead>
                                    {autoUploadConfigurable && (
                                        <TableHead className="min-w-28 text-2xs uppercase tracking-wide text-neutral-500">
                                            {t('sessionsSection.columns.recording')}
                                        </TableHead>
                                    )}
                                    <TableHead className="min-w-[160px] text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.waitingRoom')}
                                    </TableHead>
                                    {liveSessionSettings.descriptionEnabled && (
                                        <TableHead className="min-w-[140px] text-[11px] uppercase tracking-wide text-neutral-500">
                                            {t('sessionsSection.columns.description')}
                                        </TableHead>
                                    )}
                                    <TableHead className="w-20 text-right text-[11px] uppercase tracking-wide text-neutral-500">
                                        {t('sessionsSection.columns.actions')}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                        <TableBody>
                            {fields.map((field, index) => (
                                <RowEditor
                                    key={field.id}
                                    index={index}
                                    form={form}
                                    subjectOptions={subjectOptions}
                                    filteredStreamingOptions={filteredStreamingOptions}
                                    courses={courses ?? EMPTY_COURSES}
                                    sessionList={sessionList}
                                    descriptionEnabled={liveSessionSettings.descriptionEnabled}
                                    showRecordingDest={autoUploadConfigurable}
                                    onOpenRecordingDest={setRecordingDestRowIndex}
                                    resolveRowBatches={resolveRowBatches}
                                    teacherDirectory={teacherDirectory}
                                    onApplyTeachersToAll={applyTeachersToAllRows}
                                    disableRemove={fields.length === 1}
                                    onDuplicate={duplicateRow}
                                    onRemove={remove}
                                />
                            ))}
                        </TableBody>
                    </Table>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50/60 px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={addRow}
                                className="h-8 gap-1.5"
                            >
                                <Plus size={14} /> {t('sessionsSection.addRow')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setCsvImportOpen(true)}
                                className="h-8 gap-1.5"
                            >
                                <UploadSimple size={14} /> {t('sessionsSection.importCsv')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                    downloadScheduleTemplate(
                                        instituteDetails?.batches_for_sessions ?? []
                                    )
                                }
                                className="h-8 gap-1.5"
                            >
                                <DownloadSimple size={14} /> {t('sessionsSection.template')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                    downloadBatchReference(
                                        instituteDetails?.batches_for_sessions ?? []
                                    )
                                }
                                className="h-8 gap-1.5"
                            >
                                <DownloadSimple size={14} /> {t('sessionsSection.batchReference')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={teacherDirectory.status !== 'ready'}
                                onClick={() => downloadTeacherReference(teacherDirectory.users)}
                                className="h-8 gap-1.5"
                            >
                                <DownloadSimple size={14} /> {t('sessionsSection.teacherReference')}
                            </Button>
                        </div>
                        <span className="hidden text-xs text-neutral-500 sm:inline">
                            {t('sessionsSection.pasteHint')}
                        </span>
                    </div>
                </div>
            </SectionCard>

            <SectionCard
                icon={<LockKey size={18} />}
                title={t('access.title')}
                description={t('access.description')}
            >
                <Controller
                    control={form.control}
                    name="accessType"
                    render={({ field }) => (
                        <MyRadioButton
                            name="accessType"
                            value={field.value ?? AccessType.PRIVATE}
                            onChange={field.onChange}
                            options={[
                                {
                                    label: (
                                        <div className="flex flex-row gap-1">
                                            <div className="font-bold">{t('access.privateLabel')}</div>
                                            {t('access.privateDescription')}
                                        </div>
                                    ),
                                    value: AccessType.PRIVATE,
                                },
                                {
                                    label: (
                                        <div className="flex flex-row gap-1">
                                            <div className="font-bold">{t('access.publicLabel')}</div>
                                            {t('access.publicDescription')}
                                        </div>
                                    ),
                                    value: AccessType.PUBLIC,
                                },
                            ]}
                            className="flex flex-col gap-3"
                        />
                    )}
                />
            </SectionCard>

            {accessType === AccessType.PUBLIC && (
                <SectionCard
                    icon={<Article size={18} />}
                    title={t('registration.title')}
                    description={t('registration.description')}
                >
                    <div className="flex flex-col gap-3">
                        <FormFieldRowHeader />
                        <Sortable
                            value={regFields}
                            onMove={({ activeIndex, overIndex }) =>
                                moveRegField(activeIndex, overIndex)
                            }
                        >
                            {regFields.map((regField, index) => (
                                <SortableItem key={regField.id} value={regField.id} asChild>
                                    <div>
                                        <FormFieldRow
                                            position={index + 1}
                                            name={form.watch(`fields.${index}.label`) ?? ''}
                                            type={form.watch(`fields.${index}.type`) ?? ''}
                                            isRequired={
                                                form.watch(`fields.${index}.required`) ?? false
                                            }
                                            isEditing={editingRegFieldIndex === index}
                                            onToggleRequired={() =>
                                                form.setValue(
                                                    `fields.${index}.required`,
                                                    !form.watch(`fields.${index}.required`),
                                                    { shouldDirty: true }
                                                )
                                            }
                                            onEdit={() => setEditingRegFieldIndex(index)}
                                            onDelete={() => removeRegField(index)}
                                            dragHandle={
                                                <SortableDragHandle className="cursor-grab border-none shadow-none">
                                                    <DotsSixVertical size={18} />
                                                </SortableDragHandle>
                                            }
                                        />
                                    </div>
                                </SortableItem>
                            ))}
                        </Sortable>

                        {/* "Keep one identity field required" spans the whole array, so it has
                            no row of its own to render in. */}
                        {form.formState.errors.fields?.message && (
                            <p className="px-3 text-caption text-danger-600">
                                {form.formState.errors.fields.message}
                            </p>
                        )}

                        <div className="flex flex-col gap-4 p-3 sm:flex-row">
                            <SharedAddCustomFieldDialog
                                trigger={
                                    <MyButton
                                        buttonType="secondary"
                                        type="button"
                                        className="w-full sm:w-auto"
                                    >
                                        <Plus /> {t('registration.addCustomField')}
                                    </MyButton>
                                }
                                onAddField={(type, name, _oldKey, options) => {
                                    const normalized = (type || 'text').toLowerCase();
                                    const resolvedType =
                                        normalized === 'textfield'
                                            ? InputType.TEXT
                                            : (normalized as InputType);
                                    const hasOptions =
                                        (resolvedType === InputType.DROPDOWN ||
                                            resolvedType === InputType.RADIO) &&
                                        !!options;
                                    appendRegField({
                                        label: name,
                                        isDefault: false,
                                        required: true,
                                        type: resolvedType,
                                        options: hasOptions
                                            ? options!.map((opt) => ({
                                                  name: opt.value,
                                                  label: opt.value,
                                              }))
                                            : [],
                                    });
                                }}
                                existingFieldNames={regFields.map((f) => f.label)}
                            />
                            {/* Editing reuses the add dialog, prefilled. Keyed per row so opening
                                a different field re-runs the prefill. */}
                            {editingRegFieldIndex !== null && regFields[editingRegFieldIndex] && (
                                <SharedAddCustomFieldDialog
                                    key={regFields[editingRegFieldIndex].id}
                                    mode="edit"
                                    open
                                    onOpenChange={(isOpen) => {
                                        if (!isOpen) setEditingRegFieldIndex(null);
                                    }}
                                    initialField={{
                                        type: form.getValues(`fields.${editingRegFieldIndex}.type`),
                                        name:
                                            form.getValues(
                                                `fields.${editingRegFieldIndex}.label`
                                            ) ?? '',
                                        options: (
                                            form.getValues(
                                                `fields.${editingRegFieldIndex}.options`
                                            ) ?? []
                                        ).map((o) => o.label),
                                        isRequired: form.getValues(
                                            `fields.${editingRegFieldIndex}.required`
                                        ),
                                    }}
                                    onAddField={(type, name, _oldKey, options, config) => {
                                        const idx = editingRegFieldIndex;
                                        // Same normalization as the add path above.
                                        const normalized = (type || 'text').toLowerCase();
                                        const resolvedType =
                                            normalized === 'textfield'
                                                ? InputType.TEXT
                                                : (normalized as InputType);
                                        form.setValue(`fields.${idx}.label`, name, {
                                            shouldDirty: true,
                                        });
                                        form.setValue(`fields.${idx}.type`, resolvedType, {
                                            shouldDirty: true,
                                        });
                                        form.setValue(
                                            `fields.${idx}.required`,
                                            config?.isRequired ?? true,
                                            { shouldDirty: true }
                                        );
                                        // The dialog only returns options for choice types, so
                                        // switching away from one clears them.
                                        form.setValue(
                                            `fields.${idx}.options`,
                                            options?.map((opt) => ({
                                                name: opt.value,
                                                label: opt.value,
                                            })) ?? [],
                                            { shouldDirty: true }
                                        );
                                        setEditingRegFieldIndex(null);
                                    }}
                                    // Its own name must stay available, or saving an unchanged
                                    // label would be blocked as a duplicate.
                                    existingFieldNames={regFields
                                        .filter((_, i) => i !== editingRegFieldIndex)
                                        .map((f) => f.label)}
                                />
                            )}
                            <MyButton
                                buttonType="secondary"
                                type="button"
                                onClick={() => setRegPreviewOpen(true)}
                                className="w-full sm:w-auto"
                            >
                                {t('registration.preview')}
                            </MyButton>
                        </div>
                    </div>
                </SectionCard>
            )}

            <SectionCard
                icon={<BellRinging size={18} />}
                title={t('notifications.title')}
                description={t('notifications.description')}
            >
                <div className="flex flex-col gap-5">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('notifications.channels')}
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {(
                                [
                                    ['notifyBy.mail', t('notifications.notifyViaEmail')],
                                    ['notifyBy.whatsapp', t('notifications.notifyViaWhatsapp')],
                                    [
                                        'notifyBy.push_notification',
                                        t('notifications.notifyViaPush'),
                                    ],
                                    [
                                        'notifyBy.system_notification',
                                        t('notifications.notifyViaSystem'),
                                    ],
                                ] as const
                            ).map(([name, label]) => (
                                <Controller
                                    key={name}
                                    control={form.control}
                                    name={name}
                                    render={({ field }) => (
                                        <label className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2">
                                            <Checkbox
                                                checked={!!field.value}
                                                onCheckedChange={field.onChange}
                                                className={cn(
                                                    'size-4 rounded-sm border-2 shadow-none',
                                                    field.value
                                                        ? 'border-none bg-primary-500 text-white'
                                                        : ''
                                                )}
                                            />
                                            <span className="text-sm">{label}</span>
                                        </label>
                                    )}
                                />
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('notifications.triggers')}
                        </div>
                        <p className="mt-0.5 text-xs text-neutral-500">
                            {t('notifications.triggersHint')}
                        </p>
                        <div className="mt-3 flex flex-col gap-2">
                            <Controller
                                control={form.control}
                                name="notifySettings.onCreate"
                                render={({ field }) => (
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                            className={cn(
                                                'size-4 rounded-sm border-2 shadow-none',
                                                field.value
                                                    ? 'border-none bg-primary-500 text-white'
                                                    : ''
                                            )}
                                        />
                                        {t('notifications.onCreate')}
                                    </label>
                                )}
                            />

                            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                                <div className="text-sm font-medium text-neutral-800">
                                    {t('notifications.notifyBefore')}
                                </div>
                                <div className="mt-2 flex flex-col gap-2">
                                    {beforeLiveFields.map((bf, index) => (
                                        <div
                                            key={bf.id}
                                            className="flex items-center gap-2"
                                        >
                                            <Controller
                                                control={form.control}
                                                name={`notifySettings.beforeLiveTime.${index}.time`}
                                                render={({ field }) => (
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={field.onChange}
                                                    >
                                                        <SelectTrigger className="h-9 w-56">
                                                            <SelectValue placeholder={t('notifications.selectReminderTime')} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {TimeOptions.map((opt) => (
                                                                <SelectItem
                                                                    key={opt.value}
                                                                    value={opt.value}
                                                                >
                                                                    {opt.label}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="text-danger-500"
                                                onClick={() => beforeLiveRemove(index)}
                                            >
                                                {t('notifications.remove')}
                                            </Button>
                                        </div>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => beforeLiveAppend({ time: '5m' })}
                                        className="w-fit gap-1"
                                    >
                                        <Plus size={14} /> {t('notifications.addReminder')}
                                    </Button>
                                </div>
                            </div>

                            <Controller
                                control={form.control}
                                name="notifySettings.onLive"
                                render={({ field }) => (
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                            className={cn(
                                                'size-4 rounded-sm border-2 shadow-none',
                                                field.value
                                                    ? 'border-none bg-primary-500 text-white'
                                                    : ''
                                            )}
                                        />
                                        {t('notifications.onLive')}
                                    </label>
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="notifySettings.onAttendance"
                                render={({ field }) => (
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                            className={cn(
                                                'size-4 rounded-sm border-2 shadow-none',
                                                field.value
                                                    ? 'border-none bg-primary-500 text-white'
                                                    : ''
                                            )}
                                        />
                                        {t('notifications.onAttendance')}
                                    </label>
                                )}
                            />
                        </div>
                    </div>
                </div>
            </SectionCard>

            <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-0 sm:rounded-lg sm:border sm:px-4">
                <MyButton
                    type="button"
                    buttonType="primary"
                    onClick={form.handleSubmit(
                        () => setPreviewOpen(true),
                        () =>
                            toast.error(t('toast.rowsHaveErrorsBeforePreview'))
                    )}
                    disable={submitting}
                >
                    {submitting
                        ? createProgress
                            ? t('footer.schedulingProgress', {
                                  done: createProgress.done,
                                  total: createProgress.total,
                              })
                            : t('footer.scheduling')
                        : t('footer.previewAndCreate')}
                </MyButton>
            </div>

            <BulkCsvImportDialog
                open={csvImportOpen}
                onOpenChange={setCsvImportOpen}
                batches={instituteDetails?.batches_for_sessions ?? []}
                allowedPlatforms={filteredStreamingOptions.map((o) => o.value)}
                onImport={applyImportedRows}
            />

            <LiveSessionPreviewDialog
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                submitting={submitting}
                submittingLabel={
                    createProgress
                        ? t('footer.schedulingProgress', {
                              done: createProgress.done,
                              total: createProgress.total,
                          })
                        : t('footer.scheduling')
                }
                onConfirm={async () => {
                    await form.handleSubmit(onSubmit, () =>
                        toast.error(t('toast.rowsHaveErrors'))
                    )();
                    setPreviewOpen(false);
                }}
                timeZone={watchedTimeZone}
                accessType={accessType}
                sessionFeatures={{
                    enableWaitingRoom: form.watch('sharedOptions.enableWaitingRoom'),
                    waitingRoomMinutes: form.watch('sharedOptions.waitingRoomMinutes'),
                    allowRewind: form.watch('sharedOptions.allowRewind'),
                    allowPause: form.watch('sharedOptions.allowPause'),
                    enableFeedback: form.watch('sharedOptions.enableFeedback'),
                    recordSession: form.watch('sharedOptions.recordSession'),
                }}
                notifications={{
                    notifyBy: {
                        mail: form.watch('notifyBy.mail'),
                        whatsapp: form.watch('notifyBy.whatsapp'),
                        push_notification: form.watch('notifyBy.push_notification'),
                        system_notification: form.watch('notifyBy.system_notification'),
                    },
                    notifySettings: {
                        onCreate: form.watch('notifySettings.onCreate'),
                        beforeLiveTime: form.watch('notifySettings.beforeLiveTime'),
                        onLive: form.watch('notifySettings.onLive'),
                        onAttendance: form.watch('notifySettings.onAttendance'),
                    },
                }}
                sessions={previewRows}
                validCount={previewValidCount}
                courses={courses ?? []}
                sessionList={sessionList}
                attendanceOnly={
                    liveSessionSettings.attendanceOnlyMode &&
                    !form.watch('sharedOptions.showToLearners')
                }
            />

            <MyDialog
                heading={t('registrationPreviewDialog.heading')}
                onOpenChange={setRegPreviewOpen}
                open={regPreviewOpen}
            >
                {regFields?.map((regField, idx) => (
                    <div className="flex flex-col items-start gap-4" key={idx}>
                        <div className="flex w-full flex-col gap-1.5">
                            <h1 className="text-sm">
                                {regField.label}
                                {regField.required && (
                                    <span className="text-danger-600">*</span>
                                )}
                            </h1>
                            <CustomFieldRenderer
                                type={regField.type}
                                name={regField.label}
                                value=""
                                disabled={true}
                                options={regField.options?.map((o) => o.name ?? o.label)}
                                required={regField.required}
                            />
                        </div>
                    </div>
                ))}
                <div className="mb-6 flex justify-center">
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="primary"
                        className="mt-4 w-fit"
                        disable
                    >
                        {t('registration.registerNow')}
                    </MyButton>
                </div>
            </MyDialog>

            {recordingDestRowIndex !== null && (
                <MyDialog
                    heading={t('recordingDestDialog.heading')}
                    onOpenChange={(o) => {
                        if (!o) setRecordingDestRowIndex(null);
                    }}
                    open
                    dialogWidth="max-w-3xl"
                >
                    <div className="flex flex-col gap-4 p-6">
                        <p className="text-caption text-neutral-500">
                            {t('recordingDestDialog.description')}
                        </p>
                        {recordingDestRowBatches.length === 0 ? (
                            <p className="rounded-md border border-warning-200 bg-warning-50 p-3 text-caption text-warning-700">
                                {t('recordingDestDialog.assignBatchesFirst')}
                            </p>
                        ) : (
                            <SessionContentDestinationPicker
                                batches={recordingDestRowBatches}
                                initialDestinations={
                                    form.getValues('recordingAutoLink.destinations') as
                                        | ContentLinkDestination[]
                                        | undefined
                                }
                                hideSubmit
                                hidePosition
                                hideNotify
                                hideStatus
                                onDestinationsChange={handleRowAutoLinkChange}
                            />
                        )}
                    </div>
                </MyDialog>
            )}

            <Dialog
                open={!!resultDialog?.open}
                onOpenChange={(o) => setResultDialog((s) => (s ? { ...s, open: o } : null))}
            >
                {/* Override the Dialog primitive's fixed 400px width (too narrow for
                    the header + two footer buttons). The primitive's viewport cap keeps
                    it inside small screens; sm:max-w-lg caps it on desktop. */}
                <DialogContent className="w-full sm:max-w-lg">
                    <DialogHeader>
                        <div className="flex items-start gap-3">
                            <span
                                className={cn(
                                    'flex size-10 shrink-0 items-center justify-center rounded-full',
                                    resultDialog && resultDialog.failed > 0
                                        ? 'bg-warning-100 text-warning-600'
                                        : 'bg-success-100 text-success-600'
                                )}
                            >
                                {resultDialog && resultDialog.failed > 0 ? (
                                    <Warning size={22} weight="fill" />
                                ) : (
                                    <CheckCircle size={22} weight="fill" />
                                )}
                            </span>
                            <div className="min-w-0 flex-1">
                                <DialogTitle>
                                    {resultDialog && resultDialog.failed > 0
                                        ? t('resultDialog.errorsTitle')
                                        : t('resultDialog.successTitle')}
                                </DialogTitle>
                                <DialogDescription className="mt-1">
                                    {resultDialog && resultDialog.failed > 0
                                        ? t('resultDialog.errorsDescription')
                                        : t('resultDialog.successDescription')}
                                </DialogDescription>
                            </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-sm font-medium text-success-700">
                                <CheckCircle size={14} weight="fill" />
                                {resultDialog?.created ?? 0} {t('resultDialog.created')}
                            </span>
                            <span
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium',
                                    resultDialog && resultDialog.failed > 0
                                        ? 'bg-danger-50 text-danger-700'
                                        : 'bg-neutral-100 text-neutral-500'
                                )}
                            >
                                <Warning size={14} />
                                {resultDialog?.failed ?? 0} {t('resultDialog.failed')}
                            </span>
                        </div>
                    </DialogHeader>
                    {resultDialog && resultDialog.failed > 0 && (
                        <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                {t('resultDialog.failedRowsHeading', { count: resultDialog.failed })}
                            </p>
                            <ScrollArea className="max-h-60 w-full overflow-x-hidden rounded-md border border-neutral-200 sm:max-h-72">
                                <ul className="divide-y divide-neutral-100 text-sm">
                                    {resultDialog.results
                                        .filter((r) => !r.success)
                                        .map((f) => (
                                            <li
                                                key={f.index}
                                                className="flex items-start gap-2 px-3 py-2"
                                            >
                                                <Warning
                                                    size={16}
                                                    className="mt-0.5 shrink-0 text-danger-500"
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="break-words font-medium text-neutral-800">
                                                        {t('resultDialog.rowLabel', { number: f.index + 1 })}
                                                        {f.title ? `: ${f.title}` : ''}
                                                    </div>
                                                    <div className="whitespace-pre-wrap break-words text-xs text-danger-600">
                                                        {f.error || t('resultDialog.unknownError')}
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                </ul>
                            </ScrollArea>
                        </div>
                    )}
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() =>
                                resultDialog && downloadResultsCsv(resultDialog.results, t)
                            }
                        >
                            <DownloadSimple size={16} className="mr-1.5" />
                            {t('resultDialog.downloadResults')}
                        </Button>
                        {resultDialog && resultDialog.failed > 0 && (
                            <Button
                                variant="outline"
                                className="w-full sm:w-auto"
                                onClick={() => setResultDialog(null)}
                            >
                                {t('resultDialog.stayAndRetry')}
                            </Button>
                        )}
                        <Button
                            onClick={() =>
                                navigate({ to: '/study-library/live-session' })
                            }
                            disabled={!resultDialog || resultDialog.created === 0}
                            className="w-full bg-primary-500 hover:bg-primary-600 sm:w-auto"
                        >
                            {t('resultDialog.doneViewSessions')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

type SelectedLevel = { courseId: string; sessionId: string; levelId: string };

interface RowBatchPickerProps {
    value: SelectedLevel[];
    onChange: (next: SelectedLevel[]) => void;
    courses: Array<{
        courseName: string;
        courseId: string;
        sessionId: string;
        levels: Array<{ name: string; id: string }>;
    }>;
    sessionList: DropdownItemType[];
}

const RowBatchPicker = ({ value, onChange, courses, sessionList }: RowBatchPickerProps) => {
    const { t } = useTranslation('studyLibraryBulkScheduleGrid');
    const [activeSessionId, setActiveSessionId] = useState<string | undefined>(
        () => sessionList[0]?.id
    );
    const [search, setSearch] = useState('');
    useEffect(() => {
        if (!activeSessionId && sessionList.length > 0) {
            setActiveSessionId(sessionList[0]!.id);
        }
    }, [sessionList, activeSessionId]);

    const sessionCourses = useMemo(
        () => courses.filter((c) => c.sessionId === activeSessionId),
        [courses, activeSessionId]
    );

    // When the admin types in the search box, filter both course names and
    // level names. A course matches if the query is in its name (all levels
    // remain visible) or if any level under it matches (only the matching
    // levels are shown).
    const visibleCourses = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return sessionCourses;
        return sessionCourses
            .map((course) => {
                const courseMatches = course.courseName.toLowerCase().includes(q);
                const matchedLevels = courseMatches
                    ? course.levels
                    : course.levels.filter((l) => l.name.toLowerCase().includes(q));
                if (matchedLevels.length === 0) return null;
                return { ...course, levels: matchedLevels };
            })
            .filter(Boolean) as typeof sessionCourses;
    }, [sessionCourses, search]);

    const sameLevel = (a: SelectedLevel, b: SelectedLevel) =>
        a.courseId === b.courseId && a.sessionId === b.sessionId && a.levelId === b.levelId;

    const toggleLevel = (item: SelectedLevel, checked: boolean) => {
        const next = [...value];
        if (checked) {
            if (!next.some((s) => sameLevel(s, item))) next.push(item);
        } else {
            const idx = next.findIndex((s) => sameLevel(s, item));
            if (idx > -1) next.splice(idx, 1);
        }
        onChange(next);
    };

    const toggleCourse = (course: (typeof courses)[number], checked: boolean) => {
        const keys = course.levels.map((l) => ({
            courseId: course.courseId,
            sessionId: course.sessionId,
            levelId: l.id,
        }));
        let next = [...value];
        if (checked) {
            for (const k of keys) {
                if (!next.some((s) => sameLevel(s, k))) next.push(k);
            }
        } else {
            next = next.filter((s) => !keys.some((k) => sameLevel(s, k)));
        }
        onChange(next);
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                        'h-8 w-full justify-start gap-1.5 truncate text-xs',
                        value.length > 0 && 'border-primary-300 bg-primary-50'
                    )}
                >
                    <UsersThreeIcon size={14} />
                    {value.length === 0
                        ? t('rowBatchPicker.assignBatches')
                        : t('rowBatchPicker.batchCount', { count: value.length })}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-80 p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="space-y-2 border-b border-neutral-200 p-3">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('rowBatchPicker.session')}
                        </div>
                        <Select
                            value={activeSessionId ?? ''}
                            onValueChange={(v) => setActiveSessionId(v)}
                        >
                            <SelectTrigger className="mt-1 h-8 w-full">
                                <SelectValue placeholder={t('rowBatchPicker.selectSession')} />
                            </SelectTrigger>
                            <SelectContent>
                                {sessionList.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                        {s.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="relative">
                        <MagnifyingGlass
                            size={14}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
                        />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('rowBatchPicker.searchPlaceholder')}
                            className="h-8 pl-7 pr-7 text-xs"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-600"
                                aria-label={t('rowBatchPicker.clearSearch')}
                            >
                                <XIcon size={12} />
                            </button>
                        )}
                    </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                    <div className="p-3">
                        {visibleCourses.length === 0 && (
                            <div className="py-6 text-center text-xs text-neutral-500">
                                {search.trim()
                                    ? t('rowBatchPicker.noMatch')
                                    : t('rowBatchPicker.noCourses')}
                            </div>
                        )}
                        <div className="flex flex-col gap-3">
                            {visibleCourses.map((course) => {
                                const total = course.levels.length;
                                const selectedInCourse = course.levels.filter((l) =>
                                    value.some(
                                        (s) =>
                                            s.courseId === course.courseId &&
                                            s.sessionId === course.sessionId &&
                                            s.levelId === l.id
                                    )
                                ).length;
                                const allSelected = total > 0 && selectedInCourse === total;
                                const indeterminate =
                                    selectedInCourse > 0 && !allSelected;
                                return (
                                    <div key={course.courseId} className="flex flex-col gap-1">
                                        <label className="flex items-center gap-2 text-xs font-semibold text-neutral-800">
                                            <Checkbox
                                                checked={
                                                    allSelected
                                                        ? true
                                                        : indeterminate
                                                          ? 'indeterminate'
                                                          : false
                                                }
                                                onCheckedChange={(c) =>
                                                    toggleCourse(course, c === true)
                                                }
                                                className={cn(
                                                    'size-4 rounded-sm border-2 shadow-none',
                                                    allSelected || indeterminate
                                                        ? 'border-none bg-primary-500 text-white'
                                                        : ''
                                                )}
                                            />
                                            <span className="truncate">{course.courseName}</span>
                                            <span className="ml-auto text-[10px] font-normal text-neutral-500">
                                                {selectedInCourse}/{total}
                                            </span>
                                        </label>
                                        <div className="ml-5 flex flex-col gap-1">
                                            {course.levels.map((level) => {
                                                const item = {
                                                    courseId: course.courseId,
                                                    sessionId: course.sessionId,
                                                    levelId: level.id,
                                                };
                                                const checked = value.some((s) =>
                                                    sameLevel(s, item)
                                                );
                                                return (
                                                    <label
                                                        key={level.id}
                                                        className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-50"
                                                    >
                                                        <Checkbox
                                                            checked={checked}
                                                            onCheckedChange={(c) =>
                                                                toggleLevel(item, c === true)
                                                            }
                                                            className={cn(
                                                                'size-3.5 rounded-sm border-2 shadow-none',
                                                                checked
                                                                    ? 'border-none bg-primary-500 text-white'
                                                                    : ''
                                                            )}
                                                        />
                                                        {level.name}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
                {value.length > 0 && (
                    <div className="flex items-center justify-between border-t border-neutral-200 px-3 py-2">
                        <span className="text-xs text-neutral-500">
                            {t('rowBatchPicker.batchesSelected', { count: value.length })}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-danger-600"
                            onClick={() => onChange([])}
                        >
                            {t('rowBatchPicker.clear')}
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

interface WaitingRoomSharedSnapshot {
    enableWaitingRoom: boolean;
    waitingRoomMinutes: string;
    waitingRoomType?: string;
    waitingRoomThumbnailFileId?: string;
    waitingRoomMusicFileId?: string;
}

interface RowWaitingRoomChange {
    enabled?: boolean;
    minutes?: string;
    waitingRoomType?: string;
    thumbnailFileId?: string;
    musicFileId?: string;
    reset?: boolean;
}

interface RowWaitingRoomPickerProps {
    rowIndex: number;
    row: {
        waitingRoomEnabled?: boolean;
        waitingRoomMinutes?: string;
        waitingRoomType?: string;
        waitingRoomThumbnailFileId?: string;
        waitingRoomMusicFileId?: string;
    } | null;
    shared: WaitingRoomSharedSnapshot;
    onChange: (patch: RowWaitingRoomChange) => void;
}

const RowWaitingRoomPicker = ({ row, shared, onChange }: RowWaitingRoomPickerProps) => {
    const { t } = useTranslation(['studyLibraryBulkScheduleGrid', 'studyLibraryOptions']);
    const WAITING_ROOM_OPTIONS = useMemo(() => buildWaitingRoomOptions(t), [t]);
    const WAITING_ROOM_TYPE_OPTIONS = useMemo(() => buildWaitingRoomTypeOptions(t), [t]);
    // Resolved (effective) values shown in the cell summary and pre-filled in
    // the popover. If the row hasn't customised a field, fall back to shared.
    const effectiveEnabled = row?.waitingRoomEnabled ?? shared.enableWaitingRoom;
    const effectiveMinutes = row?.waitingRoomMinutes ?? shared.waitingRoomMinutes;
    const effectiveWaitingRoomType =
        row?.waitingRoomType ?? shared.waitingRoomType ?? WaitingRoomType.WAITING_ROOM;
    const isPreJoining = effectiveWaitingRoomType === WaitingRoomType.PRE_JOINING;
    const effectiveThumb =
        row?.waitingRoomThumbnailFileId ?? shared.waitingRoomThumbnailFileId;
    const effectiveMusic =
        row?.waitingRoomMusicFileId ?? shared.waitingRoomMusicFileId;

    const isOverridden =
        row?.waitingRoomEnabled !== undefined ||
        row?.waitingRoomMinutes !== undefined ||
        row?.waitingRoomThumbnailFileId !== undefined ||
        row?.waitingRoomMusicFileId !== undefined;

    const [uploading, setUploading] = useState(false);
    const [musicUploading, setMusicUploading] = useState(false);
    const fileRef = useMemo(
        () => ({ current: null as HTMLInputElement | null }),
        []
    );
    const musicRef = useMemo(
        () => ({ current: null as HTMLInputElement | null }),
        []
    );

    const handleThumbUpload = async (file: File | null) => {
        if (!file) {
            onChange({ thumbnailFileId: undefined });
            return;
        }
        try {
            setUploading(true);
            const fileId = await UploadFileInS3(file, () => {}, 'your-user-id');
            onChange({ thumbnailFileId: fileId });
        } catch (err) {
            console.error('Per-row thumbnail upload failed', err);
            toast.error(t('toast.thumbnailUploadFailed'));
        } finally {
            setUploading(false);
        }
    };

    const handleMusicUpload = async (file: File | null) => {
        if (!file) {
            onChange({ musicFileId: undefined });
            return;
        }
        try {
            setMusicUploading(true);
            const fileId = await UploadFileInS3(file, () => {}, 'your-user-id');
            onChange({ musicFileId: fileId });
        } catch (err) {
            console.error('Per-row background music upload failed', err);
            toast.error(t('toast.backgroundScoreUploadFailed'));
        } finally {
            setMusicUploading(false);
        }
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                        'h-8 w-full justify-start gap-1.5 truncate text-xs',
                        effectiveEnabled && isOverridden &&
                            'border-primary-300 bg-primary-50 text-primary-700',
                        !effectiveEnabled && 'text-neutral-500'
                    )}
                >
                    <UsersThreeIcon size={14} />
                    {!effectiveEnabled ? (
                        <span>{t('waitingRoomPicker.off')}</span>
                    ) : (
                        <span className="flex items-center gap-1">
                            {effectiveMinutes}m
                            {effectiveThumb && (
                                <span title={t('waitingRoomPicker.thumbnailAttached')}>·🖼</span>
                            )}
                            {isOverridden && (
                                <span
                                    className="ml-1 rounded-full bg-primary-100 px-1.5 text-[9px] font-semibold text-primary-700"
                                    title={t('waitingRoomPicker.overrideTooltip')}
                                >
                                    {t('waitingRoomPicker.overrideBadge')}
                                </span>
                            )}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-80 p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="border-b border-neutral-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-sm font-medium text-neutral-800">
                                {t('waitingRoomPicker.title')}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                                {t('waitingRoomPicker.description')}
                            </div>
                        </div>
                        <Switch
                            checked={effectiveEnabled}
                            onCheckedChange={(v) => onChange({ enabled: v })}
                        />
                    </div>
                </div>
                {effectiveEnabled && (
                    <div className="space-y-3 p-3">
                        <div>
                            <label className="text-xs font-medium text-neutral-600">
                                {t('waitingRoomPicker.typeLabel')}
                            </label>
                            <Select
                                value={effectiveWaitingRoomType}
                                onValueChange={(v) => onChange({ waitingRoomType: v })}
                            >
                                <SelectTrigger className="mt-1 h-8 w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {WAITING_ROOM_TYPE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt._id} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-neutral-600">
                                {t('waitingRoomPicker.openBeforeLabel')}
                            </label>
                            <Select
                                value={effectiveMinutes}
                                onValueChange={(v) => onChange({ minutes: v })}
                            >
                                <SelectTrigger className="mt-1 h-8 w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {WAITING_ROOM_OPTIONS.map((opt) => (
                                        <SelectItem key={opt._id} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {!isPreJoining && (
                            <>
                        <div>
                            <label className="text-xs font-medium text-neutral-600">
                                {t('waitingRoomPicker.thumbnailLabel')}
                            </label>
                            <input
                                ref={(el) => {
                                    fileRef.current = el;
                                }}
                                type="file"
                                accept=".png,.jpg,.jpeg"
                                className="hidden"
                                onChange={(e) =>
                                    handleThumbUpload(e.target.files?.[0] ?? null)
                                }
                            />
                            <div className="mt-1 flex items-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => fileRef.current?.click()}
                                    disabled={uploading}
                                    className="h-8"
                                >
                                    <UploadSimple size={14} className="mr-1" />
                                    {effectiveThumb
                                        ? t('waitingRoomPicker.replace')
                                        : t('waitingRoomPicker.upload')}
                                </Button>
                                {uploading && (
                                    <span className="text-xs text-neutral-500">
                                        {t('waitingRoomPicker.uploading')}
                                    </span>
                                )}
                                {effectiveThumb && !uploading && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onChange({ thumbnailFileId: undefined })
                                        }
                                        className="text-xs text-danger-600"
                                    >
                                        {t('waitingRoomPicker.remove')}
                                    </button>
                                )}
                            </div>
                            {!row?.waitingRoomThumbnailFileId &&
                                shared.waitingRoomThumbnailFileId && (
                                    <p className="mt-1 text-[11px] text-neutral-400">
                                        {t('waitingRoomPicker.usingSharedThumbnail')}
                                    </p>
                                )}
                        </div>
                        <div>
                            <label className="text-xs font-medium text-neutral-600">
                                {t('waitingRoomPicker.backgroundScoreLabel')}
                            </label>
                            <input
                                ref={(el) => {
                                    musicRef.current = el;
                                }}
                                type="file"
                                accept=".mp3,.wav,.ogg,.m4a,.aac,.flac"
                                className="hidden"
                                onChange={(e) =>
                                    handleMusicUpload(e.target.files?.[0] ?? null)
                                }
                            />
                            <div className="mt-1 flex items-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => musicRef.current?.click()}
                                    disabled={musicUploading}
                                    className="h-8"
                                >
                                    <UploadSimple size={14} className="mr-1" />
                                    {effectiveMusic
                                        ? t('waitingRoomPicker.replace')
                                        : t('waitingRoomPicker.upload')}
                                </Button>
                                {musicUploading && (
                                    <span className="text-xs text-neutral-500">
                                        {t('waitingRoomPicker.uploading')}
                                    </span>
                                )}
                                {effectiveMusic && !musicUploading && (
                                    <span className="flex items-center gap-1 text-xs text-neutral-700">
                                        <MusicNote size={12} />
                                        {t('waitingRoomPicker.attached')}
                                    </span>
                                )}
                                {effectiveMusic && !musicUploading && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onChange({ musicFileId: undefined })
                                        }
                                        className="text-xs text-danger-600"
                                    >
                                        {t('waitingRoomPicker.remove')}
                                    </button>
                                )}
                            </div>
                            {!row?.waitingRoomMusicFileId &&
                                shared.waitingRoomMusicFileId && (
                                    <p className="mt-1 text-[11px] text-neutral-400">
                                        {t('waitingRoomPicker.usingSharedMusic')}
                                    </p>
                                )}
                        </div>
                            </>
                        )}
                    </div>
                )}
                {isOverridden && (
                    <div className="flex items-center justify-between border-t border-neutral-200 px-3 py-2">
                        <span className="text-[11px] text-neutral-500">
                            {t('waitingRoomPicker.overriddenHint')}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-neutral-600"
                            onClick={() => onChange({ reset: true })}
                        >
                            {t('waitingRoomPicker.resetToDefault')}
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

/**
 * The per-row "Recording" cell: shows how many of this row's batches already
 * have an auto-upload chapter configured (the map is shared per batch, so a
 * batch configured on another row counts here too) and opens the row-scoped
 * destination dialog. Subscribes only to this row's batches + the shared map.
 */
function RowRecordingDestCell({
    index,
    control,
    resolveRowBatches,
    onOpen,
}: {
    index: number;
    control: UseFormReturn<BulkSessionForm>['control'];
    resolveRowBatches: RowEditorProps['resolveRowBatches'];
    onOpen: (index: number) => void;
}) {
    const { t } = useTranslation('studyLibraryBulkScheduleGrid');
    const selectedLevels = useWatch({
        control,
        name: `rows.${index}.selectedLevels` as const,
    });
    const destinations = useWatch({ control, name: 'recordingAutoLink.destinations' });
    const batches = useMemo(
        () => resolveRowBatches(selectedLevels ?? []),
        [resolveRowBatches, selectedLevels]
    );
    const configured = useMemo(() => {
        const ids = new Set(
            (destinations ?? [])
                .filter((d) => d.chapter_id)
                .map((d) => d.package_session_id)
        );
        return batches.filter((b) => ids.has(b.packageSessionId)).length;
    }, [batches, destinations]);
    const disabled = batches.length === 0;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onOpen(index)}
                        className={cn(
                            'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-medium transition-colors',
                            configured > 0
                                ? 'border-primary-200 bg-primary-50 text-primary-500'
                                : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100',
                            disabled && 'cursor-not-allowed opacity-50'
                        )}
                    >
                        <VideoCamera className="size-3.5" />
                        {configured > 0
                            ? t('recordingDestCell.setCount', {
                                  configured,
                                  total: batches.length,
                              })
                            : t('recordingDestCell.setChapter')}
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                    {disabled
                        ? t('recordingDestCell.assignBatchesFirstTooltip')
                        : t('recordingDestCell.pickChapterTooltip')}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

type RowEditorProps = {
    index: number;
    form: UseFormReturn<BulkSessionForm>;
    subjectOptions: Array<{ value: string; label: string }>;
    filteredStreamingOptions: ReturnType<typeof buildStreamingOptions>;
    courses: RowBatchPickerProps['courses'];
    sessionList: DropdownItemType[];
    descriptionEnabled: boolean;
    /** Institute auto-upload setting is on (and access is private) — show the per-row "Recording" cell. */
    showRecordingDest: boolean;
    onOpenRecordingDest: (index: number) => void;
    /** Maps a row's selected (course, session, level) tuples to batches — provided by the parent, which owns instituteDetails. */
    resolveRowBatches: (
        selectedLevels: Array<{ courseId: string; sessionId: string; levelId: string }>
    ) => DestinationBatch[];
    /** Staff directory for the Teacher cell — owned by the parent so it is fetched once. */
    teacherDirectory: TeacherDirectory;
    onApplyTeachersToAll: (entries: string[]) => void;
    disableRemove: boolean;
    onDuplicate: (index: number) => void;
    onRemove: (index: number) => void;
};

/**
 * A single grid row, isolated behind React.memo so editing one row never
 * re-renders its siblings. It subscribes (via scoped `useWatch` /
 * `useFormState`) ONLY to the fields it renders against: this row's platform,
 * its waiting-room overrides, the shared waiting-room defaults, and its own
 * validation errors. Plain text/number inputs stay uncontrolled
 * (`form.register`), so typing in them re-renders nothing at all. That is what
 * stops a large grid from accumulating render/DOM churn (and eventually
 * crashing the tab) during a long editing session.
 */
const RowEditor = memo(function RowEditor({
    index,
    form,
    subjectOptions,
    filteredStreamingOptions,
    courses,
    sessionList,
    descriptionEnabled,
    showRecordingDest,
    onOpenRecordingDest,
    resolveRowBatches,
    teacherDirectory,
    onApplyTeachersToAll,
    disableRemove,
    onDuplicate,
    onRemove,
}: RowEditorProps) {
    const { t } = useTranslation('studyLibraryBulkScheduleGrid');
    const { control } = form;
    const { errors } = useFormState({ control, name: `rows.${index}` as const });
    const rowErrors = errors.rows?.[index];
    const hasError = Boolean(rowErrors);

    const platform = useWatch({ control, name: `rows.${index}.platform` as const });
    const linkRequired = platform !== 'zoho' && platform !== 'bbb';

    const [
        waitingRoomEnabled,
        waitingRoomMinutes,
        waitingRoomType,
        waitingRoomThumbnailFileId,
        waitingRoomMusicFileId,
    ] = useWatch({
        control,
        name: [
            `rows.${index}.waitingRoomEnabled`,
            `rows.${index}.waitingRoomMinutes`,
            `rows.${index}.waitingRoomType`,
            `rows.${index}.waitingRoomThumbnailFileId`,
            `rows.${index}.waitingRoomMusicFileId`,
        ] as const,
    });
    const sharedOptions = useWatch({ control, name: 'sharedOptions' });

    return (
        <TableRow className={cn(hasError && 'bg-danger-50/40')}>
            <TableCell className="text-center text-xs text-neutral-500">
                {index + 1}
                {hasError && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Warning
                                    size={14}
                                    className="ml-1 inline text-danger-600"
                                />
                            </TooltipTrigger>
                            <TooltipContent>{t('rowEditor.rowHasErrors')}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </TableCell>
            <TableCell>
                <Input
                    {...form.register(`rows.${index}.title` as const)}
                    placeholder={t('rowEditor.titlePlaceholder')}
                    className="h-8"
                />
                {rowErrors?.title && (
                    <p className="mt-1 text-[11px] text-danger-600">
                        {rowErrors.title.message as string}
                    </p>
                )}
            </TableCell>
            <TableCell>
                <Controller
                    control={control}
                    name={`rows.${index}.subject` as const}
                    render={({ field }) => (
                        <Select
                            value={field.value || '__none__'}
                            onValueChange={(v) =>
                                field.onChange(v === '__none__' ? '' : v)
                            }
                        >
                            <SelectTrigger className="h-8">
                                <SelectValue placeholder={t('rowEditor.selectPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">{t('rowEditor.none')}</SelectItem>
                                {subjectOptions.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                />
            </TableCell>
            <TableCell>
                <Input
                    type="date"
                    {...form.register(`rows.${index}.startDate` as const)}
                    className="h-8"
                />
                {rowErrors?.startDate && (
                    <p className="mt-1 text-[11px] text-danger-600">
                        {rowErrors.startDate.message as string}
                    </p>
                )}
            </TableCell>
            <TableCell>
                <Input
                    type="time"
                    {...form.register(`rows.${index}.startTime` as const)}
                    className="h-8"
                />
                {rowErrors?.startTime && (
                    <p className="mt-1 text-[11px] text-danger-600">
                        {rowErrors.startTime.message as string}
                    </p>
                )}
            </TableCell>
            <TableCell>
                <Input
                    type="number"
                    min={0}
                    max={24}
                    {...form.register(`rows.${index}.durationHours` as const)}
                    className="h-8"
                />
            </TableCell>
            <TableCell>
                <Input
                    type="number"
                    min={0}
                    max={59}
                    {...form.register(`rows.${index}.durationMinutes` as const)}
                    className="h-8"
                />
                {rowErrors?.durationMinutes && (
                    <p className="mt-1 text-[11px] text-danger-600">
                        {rowErrors.durationMinutes.message as string}
                    </p>
                )}
            </TableCell>
            <TableCell>
                <Select
                    value={platform ?? 'other'}
                    onValueChange={(v) =>
                        form.setValue(`rows.${index}.platform` as const, v, {
                            shouldValidate: true,
                        })
                    }
                >
                    <SelectTrigger className="h-8">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {filteredStreamingOptions.map((opt) => (
                            <SelectItem key={opt._id} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </TableCell>
            <TableCell>
                <Input
                    {...form.register(`rows.${index}.link` as const)}
                    placeholder={
                        linkRequired
                            ? t('rowEditor.linkPlaceholderUrl')
                            : t('rowEditor.linkPlaceholderAuto')
                    }
                    disabled={!linkRequired}
                    className="h-8"
                />
                {rowErrors?.link && (
                    <p className="mt-1 text-[11px] text-danger-600">
                        {rowErrors.link.message as string}
                    </p>
                )}
            </TableCell>
            <TableCell>
                <Controller
                    control={control}
                    name={`rows.${index}.selectedLevels` as const}
                    render={({ field }) => (
                        <RowBatchPicker
                            value={field.value ?? []}
                            onChange={field.onChange}
                            courses={courses}
                            sessionList={sessionList}
                        />
                    )}
                />
                {rowErrors?.selectedLevels && (
                    <p className="mt-1 text-[11px] text-danger-600">
                        {rowErrors.selectedLevels.message as string}
                    </p>
                )}
            </TableCell>
            <TableCell>
                <Controller
                    control={control}
                    name={`rows.${index}.instructorIdentifiers` as const}
                    render={({ field }) => (
                        <RowTeacherPicker
                            value={field.value ?? []}
                            onChange={field.onChange}
                            directory={teacherDirectory}
                            onApplyToAll={onApplyTeachersToAll}
                        />
                    )}
                />
            </TableCell>
            {showRecordingDest && (
                <TableCell>
                    <RowRecordingDestCell
                        index={index}
                        control={control}
                        resolveRowBatches={resolveRowBatches}
                        onOpen={onOpenRecordingDest}
                    />
                </TableCell>
            )}
            <TableCell>
                <RowWaitingRoomPicker
                    rowIndex={index}
                    row={{
                        waitingRoomEnabled,
                        waitingRoomMinutes,
                        waitingRoomType,
                        waitingRoomThumbnailFileId,
                        waitingRoomMusicFileId,
                    }}
                    shared={sharedOptions}
                    onChange={(patch) => {
                        if ('enabled' in patch) {
                            form.setValue(
                                `rows.${index}.waitingRoomEnabled` as const,
                                patch.enabled,
                                { shouldDirty: true }
                            );
                        }
                        if ('minutes' in patch) {
                            form.setValue(
                                `rows.${index}.waitingRoomMinutes` as const,
                                patch.minutes,
                                { shouldDirty: true }
                            );
                        }
                        if ('waitingRoomType' in patch) {
                            form.setValue(
                                `rows.${index}.waitingRoomType` as const,
                                patch.waitingRoomType as WaitingRoomType | undefined,
                                { shouldDirty: true }
                            );
                        }
                        if ('thumbnailFileId' in patch) {
                            form.setValue(
                                `rows.${index}.waitingRoomThumbnailFileId` as const,
                                patch.thumbnailFileId,
                                { shouldDirty: true }
                            );
                        }
                        if ('musicFileId' in patch) {
                            form.setValue(
                                `rows.${index}.waitingRoomMusicFileId` as const,
                                patch.musicFileId,
                                { shouldDirty: true }
                            );
                        }
                        if (patch.reset) {
                            form.setValue(
                                `rows.${index}.waitingRoomEnabled` as const,
                                undefined,
                                { shouldDirty: true }
                            );
                            form.setValue(
                                `rows.${index}.waitingRoomMinutes` as const,
                                undefined,
                                { shouldDirty: true }
                            );
                            form.setValue(
                                `rows.${index}.waitingRoomType` as const,
                                undefined,
                                { shouldDirty: true }
                            );
                            form.setValue(
                                `rows.${index}.waitingRoomThumbnailFileId` as const,
                                undefined,
                                { shouldDirty: true }
                            );
                            form.setValue(
                                `rows.${index}.waitingRoomMusicFileId` as const,
                                undefined,
                                { shouldDirty: true }
                            );
                        }
                    }}
                />
            </TableCell>
            {descriptionEnabled && (
                <TableCell>
                    <Controller
                        control={control}
                        name={`rows.${index}.description` as const}
                        render={({ field }) => {
                            const plain = (field.value ?? '')
                                .replace(/<[^>]*>/g, '')
                                .trim();
                            return (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className={cn(
                                                'h-8 w-full justify-start gap-1.5 truncate text-xs',
                                                plain &&
                                                    'border-primary-300 bg-primary-50'
                                            )}
                                        >
                                            <Article size={14} />
                                            <span className="truncate">
                                                {plain
                                                    ? plain.slice(0, 28) +
                                                      (plain.length > 28 ? '…' : '')
                                                    : t('rowEditor.addDescription')}
                                            </span>
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                        align="start"
                                        className="w-[420px] p-3"
                                        onOpenAutoFocus={(e) => e.preventDefault()}
                                    >
                                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                            {t('rowEditor.descriptionForRow', { number: index + 1 })}
                                        </div>
                                        <RichTextEditor
                                            value={field.value || ''}
                                            onChange={field.onChange}
                                            onBlur={field.onBlur}
                                            minHeight={140}
                                        />
                                        {plain && (
                                            <div className="mt-2 flex justify-end">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-xs text-neutral-500"
                                                    onClick={() => field.onChange('')}
                                                >
                                                    {t('rowEditor.clear')}
                                                </Button>
                                            </div>
                                        )}
                                    </PopoverContent>
                                </Popover>
                            );
                        }}
                    />
                </TableCell>
            )}
            <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => onDuplicate(index)}
                                >
                                    <Copy size={14} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('rowEditor.duplicateRow')}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-danger-500 hover:text-danger-700"
                                    disabled={disableRemove}
                                    onClick={() => onRemove(index)}
                                >
                                    <Trash size={14} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('rowEditor.removeRow')}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </TableCell>
        </TableRow>
    );
});

function ReadyCountBadge({
    control,
    totalRows,
}: {
    control: UseFormReturn<BulkSessionForm>['control'];
    totalRows: number;
}) {
    const { t } = useTranslation('studyLibraryBulkScheduleGrid');
    const rows = useWatch({ control, name: 'rows' });
    const accessType = useWatch({ control, name: 'accessType' });
    const validRowCount = (rows ?? []).filter((r) => isRowReady(r, accessType)).length;
    return (
        <Badge
            variant="secondary"
            className={cn(
                'rounded-full px-2.5 py-1 text-xs',
                validRowCount === totalRows && totalRows > 0
                    ? 'bg-primary-100 text-primary-600'
                    : ''
            )}
        >
            {t('readyCountBadge.ready', { ready: validRowCount, total: totalRows })}
        </Badge>
    );
}
