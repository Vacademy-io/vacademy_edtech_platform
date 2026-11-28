import { useForm, Controller, FormProvider, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Separator } from '@radix-ui/react-separator';
import { MyButton } from '@/components/design-system/button';
import { MyRadioButton } from '@/components/design-system/radio';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { AccessType, InputType, StreamingPlatform } from '../../-constants/enums';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useEffect, useState, useRef, useMemo } from 'react';
import { MyDropdown } from '@/components/common/students/enroll-manually/dropdownForPackageItems';
import { DropdownValueType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { DropdownItemType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { MyInput } from '@/components/design-system/input';
import { copyToClipboard } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/helper';
import {
    Copy,
    DotsSixVertical,
    DownloadSimple,
    Plus,
    TrashSimple,
    XCircle, PencilSimple } from '@phosphor-icons/react';
import QRCode from 'react-qr-code';
import { useTranslation } from 'react-i18next';
import { handleDownloadQRCode } from '@/routes/homework-creation/create-assessment/$assessmentId/$examtype/-utils/helper';
import { Checkbox } from '@/components/ui/checkbox';
import { addCustomFiledSchema, addParticipantsSchema } from '../-schema/schema';
import { fetchInstituteDefaultFields } from '@/services/custom-field-mappings';
import { getInstituteId as getInstId } from '@/constants/helper';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { Switch } from '@/components/ui/switch';
import {
    FormFieldRow,
    FormFieldRowHeader,
} from '@/components/common/custom-fields/FormFieldRow';
import { MyDialog } from '@/components/design-system/dialog';
import SelectField from '@/components/design-system/select-field';
import { AddCustomFieldDialog as SharedAddCustomFieldDialog } from '@/components/common/custom-fields/AddCustomFieldDialog';
import { FieldRole, classifyFieldRole } from '@/components/common/custom-fields/field-roles';
import {
    isBuiltInRegistrationField,
    withBuiltInRegistrationFields,
} from '@/components/common/custom-fields/builtin-registration-fields';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
import { FieldErrors } from 'react-hook-form';
import { transformFormToDTOStep2 } from '../../-constants/helper';
import {
    createLiveSessionStep2,
    createProviderMeeting,
    createProviderMeetingsForSession,
    checkProviderAvailabilityForSession,
} from '../-services/utils';
import { getSessionBySessionId } from '../../-services/utils';
import { useLiveSessionStore } from '../-store/sessionIdstore';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listPaymentGateways } from '@/routes/settings/-services/payment-gateway-service';
import { fetchWhatsAppTemplates } from '@/routes/automation/chatbot-flows/-services/chatbot-flow-api';
import { handleFetchCampaignsList } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { MultiSelect } from '@/components/design-system/multi-select';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useSessionDetailsStore } from '../../-store/useSessionDetailsStore';
import { CircleNotch } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { LiveSessionParticipantsTab } from './LiveSessionParticipantsTab';
import { SectionCard } from './SectionCard';
import { InstructorPicker } from '../../-components/InstructorPicker';
import { getUserId } from '@/utils/userDetails';
import {
    LiveSessionPreviewDialog,
    type PreviewSessionRow,
    type PreviewRecurrenceBanner,
} from './LiveSessionPreviewDialog';
import {
    Chalkboard,
    LockKey,
    UsersThree,
    Article,
    LinkSimple,
    BellRinging,
    CurrencyCircleDollar,
    VideoCamera,
    CaretDown,
} from '@phosphor-icons/react';
import { CURRENCIES } from '@/constants/currencies';

import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    SessionContentDestinationPicker,
    type DestinationBatch,
    type DestinationPickerSubmitPayload,
} from '../../-components/content-linking/SessionContentDestinationPicker';
import type { ContentLinkDestination, SlideStatus } from '../../-services/content-link-service';
import { cn } from '@/lib/utils';

const TimeOptions = [
    { label: '5 minutes before', value: '5m' },
    { label: '10 minutes before', value: '10m' },
    { label: '30 minutes before', value: '30m' },
    { label: '1 hour before', value: '1h' },
];

const formatZohoStartTime = (dateStr?: string, timeStr?: string) => {
    if (!dateStr || !timeStr) return '';

    const datePart = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;

    let timeParts = timeStr;
    if (timeStr.includes('T')) {
        const afterT = timeStr.split('T')[1];
        if (afterT) {
            timeParts = afterT.split('+')[0] || timeStr;
        }
    }

    const timePart = timeParts?.length === 5 ? `${timeParts}:00` : timeParts || '';

    return `${datePart}T${timePart}+05:30`;
};


// Live-session field types that carry an admin-authored option list.
const hasOptionsType = (type?: string) => {
    const t = (type ?? '').toLowerCase();
    return t === 'dropdown' || t === 'radio' || t === 'multi_select' || t === 'checkbox';
};

/**
 * Options are stored in the custom field's `config` JSON, written by three different
 * generations of this feature: a bare array, `{ options: [...] }`, and the older
 * `{ coommaSepartedOptions: "a,b" }` (sic). Anything unparseable means "no options".
 */
const parseFieldOptions = (config?: string | null): { label: string; name: string }[] => {
    if (!config) return [];
    try {
        const parsed = JSON.parse(config);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toOption = (o: any) => ({
            label: o.value || o.label || o.name || '',
            name: o.value || o.name || o.label || '',
        });
        if (Array.isArray(parsed)) return parsed.map(toOption);
        if (Array.isArray(parsed?.options)) return parsed.options.map(toOption);
        if (typeof parsed?.coommaSepartedOptions === 'string') {
            return parsed.coommaSepartedOptions
                .split(',')
                .map((v: string) => ({ label: v.trim(), name: v.trim() }));
        }
    } catch {
        /* not JSON — treat as no options */
    }
    return [];
};

export default function ScheduleStep2() {
    const { t: tHelper } = useTranslation('homeworkCreationCreateAssessmentHelper');
    const { clearSessionId, clearStep1Data, clearBulkSessionIds, clearDeepLink } =
        useLiveSessionStore();
    const preselectedBatchIds = useLiveSessionStore((state) => state.preselectedBatchIds);
    const returnUrl = useLiveSessionStore((state) => state.returnUrl);
    const bulkSessionIds = useLiveSessionStore((state) => state.bulkSessionIds);
    const isBulkFlow = bulkSessionIds.length > 0;
    const { studyLibraryData } = useStudyLibraryStore();
    const [addCustomFieldDialog, setAddCustomFieldDialog] = useState<boolean>(false);
    const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);
    const queryClient = useQueryClient();
    const [previewDialog, setPreviewDialog] = useState<boolean>(false);
    const [previewOpen, setPreviewOpen] = useState<boolean>(false);
    const { sessionId, step1Data } = useLiveSessionStore();
    const isEditState = useLiveSessionStore((state) => state.isEdit);
    const { sessionDetails } = useSessionDetailsStore();
    const { settings: liveSessionSettings } = useLiveSessionSettings();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const navigate = useNavigate();
    const router = useRouter();

    // Get the institute details at component level
    const { instituteDetails } = useInstituteDetailsStore();

    /**
     * This ref helps us ensure that the heavy edit-mode form pre-population
     * logic executes only ONCE. Without this, `form.setValue` & `setCurrentSession`
     * could run on every re-render if any object reference in `sessionDetails` or
     * `instituteDetails` changes (even when the actual data is identical), leading
     * to an infinite render-refresh cycle in dev (observed as the app “refreshing
     * again and again”).
     */
    const hasInitialisedEditState = useRef(false);

    /**
     * Batches this class was already linked to when the admin opened it for
     * editing — and ONLY the ones we could resolve against
     * `batches_for_sessions`. Submit diffs the current selection against this to
     * work out what to unlink. Unresolvable ids are deliberately excluded: they
     * never make it into `selectedLevels`, so treating them as "removed" would
     * silently delete a live row the admin never touched (a batch from another
     * institute, or one that has since been archived).
     */
    const originallyLinkedBatchIds = useRef<string[]>([]);

    useEffect(() => {
        // Allow either a single sessionId (normal flow) or a list of bulk
        // sessionIds. Without either we can't link participants to anything.
        if (!sessionId && bulkSessionIds.length === 0) {
            navigate({ to: '/study-library/live-session' });
        }
    }, [sessionId, bulkSessionIds.length, navigate]);

    useEffect(() => {
        if (sessionDetails && !hasInitialisedEditState.current) {
            form.setValue(
                'accessType',
                sessionDetails?.schedule?.access_type === 'public'
                    ? AccessType.PUBLIC
                    : AccessType.PRIVATE
            );
            const defaultNotifySettings = {
                onCreate: false,
                onEdit: false,
                beforeLive: false,
                beforeLiveTime: [] as { time: string }[],
                onLive: false,
                onAttendance: false,
            };

            let mail = false;
            let whatsapp = false;

            sessionDetails?.notifications?.addedNotificationActions.forEach((action) => {
                const { type, notify, notifyBy, time } = action;

                if (type === 'ON_CREATE') {
                    defaultNotifySettings.onCreate = notify;
                } else if (type === 'ON_LIVE') {
                    defaultNotifySettings.onLive = notify;
                } else if (type === 'BEFORE_LIVE') {
                    defaultNotifySettings.beforeLive = notify;
                    if (time) {
                        defaultNotifySettings.beforeLiveTime = [{ time }];
                    }
                }

                // Merge mail & whatsapp flags
                mail = mail || notifyBy.mail;
                whatsapp = whatsapp || notifyBy.whatsapp;
            });

            form.setValue('notifySettings', defaultNotifySettings);

            // ------------------------------------------------------------------
            // NEW: Pre-populate selected levels (batches) when editing classes (both PRIVATE and PUBLIC)
            // ------------------------------------------------------------------
            if (instituteDetails && sessionDetails.schedule.package_session_ids?.length > 0) {
                const selectedLevelsFromPackages = sessionDetails.schedule.package_session_ids
                    .map((pkgId) => {
                        const batch = instituteDetails.batches_for_sessions.find(
                            (b) => b.id === pkgId
                        );
                        if (!batch) return null;
                        return {
                            courseId: batch.package_dto.id,
                            sessionId: batch.session.id,
                            levelId: batch.level.id,
                        };
                    })
                    .filter(Boolean) as {
                    courseId: string;
                    sessionId: string;
                    levelId: string;
                }[];

                // Remember what was linked on open, restricted to the ids that
                // actually resolved above — see `originallyLinkedBatchIds`.
                originallyLinkedBatchIds.current =
                    sessionDetails.schedule.package_session_ids.filter((pkgId: string) =>
                        instituteDetails.batches_for_sessions.some((b) => b.id === pkgId)
                    );

                if (selectedLevelsFromPackages.length) {
                    form.setValue('selectedLevels', selectedLevelsFromPackages);

                    // Also set the currentSession dropdown so that UI immediately shows relevant levels
                    const firstSessionId = selectedLevelsFromPackages[0]!.sessionId;
                    const matchingSession = sessionList.find((s) => s.id === firstSessionId);
                    if (matchingSession) {
                        setCurrentSession(matchingSession);
                    }
                }
            }

            // ------------------------------------------------------------------
            // NEW: Pre-populate "auto-add recordings to course" config, if any
            // was previously saved (docs/LIVE_SESSION_RECORDING_AUTO_LINK_PLAN.md).
            // ------------------------------------------------------------------
            const savedAutoLink = sessionDetails.schedule.recording_auto_link_config;
            if (savedAutoLink) {
                form.setValue('recordingAutoLink', {
                    enabled: savedAutoLink.enabled,
                    slideStatus: savedAutoLink.slide_status,
                    notify: savedAutoLink.notify,
                    destinations: savedAutoLink.destinations,
                    touched: false, // hydrated, not yet edited by the admin — don't resend unless they open the section
                });
            }

            // Mark initialisation done so this block never runs again
            hasInitialisedEditState.current = true;
        }
    }, [sessionDetails, instituteDetails]);

    // Prepare session data first
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

    // Initialize form with default values
    const form = useForm<z.infer<typeof addParticipantsSchema>>({
        resolver: zodResolver(addParticipantsSchema),
        defaultValues: {
            accessType:
                sessionDetails?.schedule?.access_type === 'private'
                    ? AccessType.PRIVATE
                    : AccessType.PUBLIC,
            batchSelectionType: 'batch',
            selectedLevels: [],
            selectedLearners: [],
            // Pre-fill the scheduler as the instructor. The backend seeds the
            // same person on create, but seeding it here too means the admin
            // sees an accurate, editable list instead of an empty one.
            instructorUserIds: [getUserId()].filter(Boolean),
            joinLink: '',
            notifyBy: {
                mail: liveSessionSettings.defaultNotifyByEmail ?? false,
                whatsapp: liveSessionSettings.defaultNotifyByWhatsapp ?? false,
                push_notification: liveSessionSettings.defaultNotifyByPush ?? false,
                system_notification: liveSessionSettings.defaultNotifyBySystem ?? false,
            },
            notifySettings: {
                onCreate: liveSessionSettings.defaultNotifyOnCreate ?? false,
                onEdit: false,
                beforeLive: !!liveSessionSettings.defaultNotifyBeforeReminder,
                beforeLiveTime: liveSessionSettings.defaultNotifyBeforeReminder
                    ? [{ time: liveSessionSettings.defaultNotifyBeforeReminder }]
                    : [],
                onLive: liveSessionSettings.defaultNotifyOnLive ?? true,
                onAttendance: liveSessionSettings.defaultNotifyOnAttendance ?? false,
            },
            fields: [],
            paymentEnabled: false,
            paymentPrice: '',
            paymentCurrency: 'INR',
            paymentVendor: '',
            requireEmailVerification: false,
            requirePhoneVerification: false,
            whatsappOtpTemplateName: '',
            audiencePushEnabled: false,
            audiencePushAudienceIds: [],
        },
    });

    // Set up current session
    const [currentSession, setCurrentSession] = useState<DropdownItemType | undefined>(() =>
        sessionList.length > 0 ? sessionList[0] : undefined
    );

    // Update form when session details are available
    useEffect(() => {
        if (!sessionDetails || !instituteDetails) return;

        // Set access type
        form.setValue(
            'accessType',
            sessionDetails.schedule.access_type === 'public'
                ? AccessType.PUBLIC
                : AccessType.PRIVATE
        );

        // Prefill paid-class fee config (edit mode)
        if (sessionDetails.paymentConfig?.enabled) {
            form.setValue('paymentEnabled', true);
            form.setValue('paymentPrice', String(sessionDetails.paymentConfig.price ?? ''));
            form.setValue('paymentCurrency', sessionDetails.paymentConfig.currency ?? 'INR');
            form.setValue('paymentVendor', sessionDetails.paymentConfig.vendor ?? '');
        }

        // Prefill registration verification toggles (edit mode)
        form.setValue('requireEmailVerification', !!sessionDetails.requireEmailVerification);
        form.setValue('requirePhoneVerification', !!sessionDetails.requirePhoneVerification);
        form.setValue('whatsappOtpTemplateName', sessionDetails.whatsappOtpTemplateName ?? '');

        // Prefill instructors (edit mode). The backend already applies the
        // creator fallback, so an older session without an instructor row comes
        // back carrying its creator rather than an empty list.
        if (Array.isArray(sessionDetails.instructors)) {
            form.setValue(
                'instructorUserIds',
                sessionDetails.instructors.map((i) => i?.user_id).filter((id): id is string => !!id)
            );
        }

        // Prefill "save registrants to audience list(s)" (edit mode)
        form.setValue('audiencePushEnabled', !!sessionDetails.audiencePushConfig?.enabled);
        form.setValue(
            'audiencePushAudienceIds',
            sessionDetails.audiencePushConfig?.audience_ids ?? []
        );

        // Set notification settings
        const defaultNotifySettings = {
            onCreate: false,
            onEdit: false,
            beforeLive: false,
            beforeLiveTime: [] as { time: string }[],
            onLive: false,
            onAttendance: false,
        };

        let mail = false;
        let whatsapp = false;
        let push_notification = false;
        let system_notification = false;

        sessionDetails.notifications?.addedNotificationActions.forEach((action) => {
            const { type, notify, notifyBy, time } = action;

            if (type === 'ON_CREATE') {
                defaultNotifySettings.onCreate = notify;
            } else if (type === 'ON_LIVE') {
                defaultNotifySettings.onLive = notify;
            } else if (type === 'BEFORE_LIVE') {
                defaultNotifySettings.beforeLive = notify;
                if (time) {
                    defaultNotifySettings.beforeLiveTime = [{ time }];
                }
            } else if (type === 'ATTENDANCE') {
                defaultNotifySettings.onAttendance = notify;
            }

            // Merge channel flags
            mail = mail || notifyBy.mail;
            whatsapp = whatsapp || notifyBy.whatsapp;
            push_notification = push_notification || (notifyBy as any).push_notification || false;
            system_notification =
                system_notification || (notifyBy as any).system_notification || false;
        });

        form.setValue('notifySettings', defaultNotifySettings);
        form.setValue('notifyBy', { mail, whatsapp, push_notification, system_notification });

        // Load previously selected levels for both PRIVATE and PUBLIC sessions
        if (
            sessionDetails.schedule.package_session_ids &&
            sessionDetails.schedule.package_session_ids.length > 0
        ) {
            // Initialize array for selected levels
            const selectedLevels: { courseId: string; sessionId: string; levelId: string }[] = [];

            // Process each package_session_id
            sessionDetails.schedule.package_session_ids.forEach((packageSessionId) => {
                // Find the matching batch in institute details
                const matchingBatch = instituteDetails.batches_for_sessions.find(
                    (batch) => batch.id === packageSessionId
                );

                if (matchingBatch) {
                    selectedLevels.push({
                        courseId: matchingBatch.package_dto.id,
                        sessionId: matchingBatch.session.id,
                        levelId: matchingBatch.level.id,
                    });
                }
            });

            // Set the selected levels in the form
            if (selectedLevels.length > 0) {
                form.setValue('selectedLevels', selectedLevels);

                // If we have any selections, set the current session to match the first selected level
                const firstSelectedLevel = selectedLevels[0];
                const matchingSession = sessionList.find(
                    (session) => session.id === firstSelectedLevel?.sessionId
                );
                if (matchingSession) {
                    setCurrentSession(matchingSession);
                }
            }
        }
    }, [sessionDetails, instituteDetails, sessionList, form]);

    // Deep-link preselect (create flow only): when the schedule flow was opened
    // from another page with a preselected batch (e.g. Course Details → Live
    // Sessions tab), seed the batch selection here so the admin doesn't have to
    // pick it again. Runs once, and never in edit mode (edit seeds from the saved
    // session above) or when the admin has already chosen batches.
    const hasSeededPreselect = useRef(false);
    useEffect(() => {
        if (hasSeededPreselect.current) return;
        if (isEditState || sessionDetails) return;
        if (!preselectedBatchIds || preselectedBatchIds.length === 0) return;
        if (!instituteDetails) return;
        const existing = form.getValues('selectedLevels') || [];
        if (existing.length > 0) {
            hasSeededPreselect.current = true;
            return;
        }

        const selectedLevels: { courseId: string; sessionId: string; levelId: string }[] = [];
        preselectedBatchIds.forEach((packageSessionId) => {
            const matchingBatch = instituteDetails.batches_for_sessions.find(
                (batch) => batch.id === packageSessionId
            );
            if (matchingBatch) {
                selectedLevels.push({
                    courseId: matchingBatch.package_dto.id,
                    sessionId: matchingBatch.session.id,
                    levelId: matchingBatch.level.id,
                });
            }
        });

        if (selectedLevels.length > 0) {
            form.setValue('selectedLevels', selectedLevels);
            const firstSelectedLevel = selectedLevels[0];
            const matchingSession = sessionList.find(
                (session) => session.id === firstSelectedLevel?.sessionId
            );
            if (matchingSession) {
                setCurrentSession(matchingSession);
            }
            hasSeededPreselect.current = true;
        }
    }, [isEditState, sessionDetails, preselectedBatchIds, instituteDetails, sessionList, form]);

    const addCustomFieldform = useForm<z.infer<typeof addCustomFiledSchema>>({
        resolver: zodResolver(addCustomFiledSchema),
        defaultValues: {
            fieldType: 'text',
            options: [],
        },
    });

    const {
        control: customControl,
        watch: customWatch,
        register,
        handleSubmit: handleCustomSubmit,
    } = addCustomFieldform;

    const filedType = customWatch('fieldType');
    const {
        fields: customOptionsFields,
        move: customMove,
        append: customAppend,
    } = useFieldArray({
        control: customControl,
        name: 'options',
    });

    const { control, handleSubmit, watch, getValues, setValue } = form;

    // Institute payment gateways (per-session gateway picker) and WhatsApp
    // templates (phone-OTP template picker), fetched lazily when the relevant
    // toggle is on.
    const wizardInstituteId = getInstId() ?? '';
    const paymentEnabledOn = !!watch('paymentEnabled');
    const phoneVerificationOn = !!watch('requirePhoneVerification');
    const { data: gatewayMappings = [] } = useQuery({
        queryKey: ['institute-payment-gateways', wizardInstituteId],
        queryFn: () => listPaymentGateways(wizardInstituteId),
        enabled: !!wizardInstituteId && paymentEnabledOn,
    });
    const activeGateways = gatewayMappings.filter((g) => g.status === 'ACTIVE');
    // Backend rule: the default gateway is the most recently created ACTIVE mapping.
    const defaultVendor = [...activeGateways].sort((a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? '')
    )[0]?.vendor;
    const { data: whatsappTemplates = [] } = useQuery({
        queryKey: ['whatsapp-otp-templates', wizardInstituteId],
        queryFn: () => fetchWhatsAppTemplates(wizardInstituteId),
        enabled: !!wizardInstituteId && phoneVerificationOn,
    });
    const approvedTemplates = whatsappTemplates.filter(
        (t) => (t.status ?? '').toUpperCase() === 'APPROVED'
    );
    // Audience lists for the "save registrants to audience list(s)" picker,
    // fetched lazily once the toggle is on (public sessions only).
    const audiencePushOn = !!watch('audiencePushEnabled');
    const { data: campaignsData } = useQuery({
        ...handleFetchCampaignsList({
            institute_id: wizardInstituteId,
            status: 'ACTIVE',
            page: 0,
            size: 500,
        }),
        enabled: !!wizardInstituteId && audiencePushOn,
    });
    const audienceListOptions = useMemo(
        () =>
            (campaignsData?.content ?? [])
                .map((campaign) => ({
                    value: campaign.id ?? campaign.campaign_id ?? campaign.audience_id ?? '',
                    label: campaign.campaign_name,
                }))
                .filter((option) => option.value !== ''),
        [campaignsData]
    );
    const { fields, move, append, remove } = useFieldArray({
        control,
        name: 'fields',
    });

    const accessType = watch('accessType');
    const batchSelectionType = watch('batchSelectionType');
    const watchedSelectedLevels = watch('selectedLevels');
    const recordingAutoLink = watch('recordingAutoLink');

    // Currently-selected batches, resolved to packageSessionIds + display
    // names — feeds the "Auto-add recordings to course" destination picker.
    // Only meaningful in batch mode; empty for individual-learner selection.
    const recordingAutoLinkBatches = useMemo<DestinationBatch[]>(() => {
        if (!instituteDetails || batchSelectionType !== 'batch') return [];
        return (watchedSelectedLevels ?? [])
            .map((level) => {
                const batch = instituteDetails.batches_for_sessions.find(
                    (b) =>
                        b.package_dto.id === level.courseId &&
                        b.session.id === level.sessionId &&
                        b.level.id === level.levelId
                );
                if (!batch) return null;
                return {
                    packageSessionId: batch.id,
                    displayName: [batch.package_dto.package_name, batch.level.level_name, batch.session.session_name]
                        .filter(Boolean)
                        .join(' · '),
                };
            })
            .filter((b): b is DestinationBatch => b !== null);
    }, [instituteDetails, batchSelectionType, watchedSelectedLevels]);

    // Collapsed by default unless the admin already has a saved/enabled config.
    const [recordingAutoLinkOpen, setRecordingAutoLinkOpen] = useState(false);
    const hasOpenedAutoLinkOnce = useRef(false);
    useEffect(() => {
        if (hasOpenedAutoLinkOnce.current) return;
        if (recordingAutoLink?.enabled) {
            setRecordingAutoLinkOpen(true);
            hasOpenedAutoLinkOnce.current = true;
        }
    }, [recordingAutoLink?.enabled]);

    const handleRecordingAutoLinkToggle = (enabled: boolean) => {
        const current = getValues('recordingAutoLink');
        setValue(
            'recordingAutoLink',
            {
                enabled,
                slideStatus: current?.slideStatus ?? 'PUBLISHED',
                notify: current?.notify ?? false,
                destinations: current?.destinations ?? [],
                touched: true,
            },
            { shouldDirty: true }
        );
        if (enabled) setRecordingAutoLinkOpen(true);
    };

    const handleRecordingAutoLinkDestinationsChange = (payload: DestinationPickerSubmitPayload) => {
        const current = getValues('recordingAutoLink');
        setValue(
            'recordingAutoLink',
            {
                enabled: current?.enabled ?? true,
                slideStatus: payload.slideStatus,
                notify: payload.notify,
                destinations: payload.destinations,
                touched: true,
            },
            { shouldDirty: true }
        );
    };

    /**
     * Required is the admin's call on every registration field, built-ins included — but a
     * channel the form verifies with an OTP has to be collected, so that one field stays
     * required for as long as its verification is on. Same for the email on a paid class:
     * the invoice is billed and mailed to it.
     */
    const requiredLockReasonFor = (field: { label?: string; type?: string }): string | undefined => {
        const role = classifyFieldRole({ type: field.type, label: field.label });
        if (role === FieldRole.EMAIL) {
            if (watch('requireEmailVerification')) {
                return 'Email is verified with an OTP on this form, so it has to stay required.';
            }
            if (watch('paymentEnabled')) {
                return 'A paid class is invoiced by email, so the email field has to stay required.';
            }
        }
        if (role === FieldRole.PHONE && watch('requirePhoneVerification')) {
            return 'The mobile number is verified with a WhatsApp OTP on this form, so it has to stay required.';
        }
        return undefined;
    };

    /**
     * Turning a verification on for a channel the form no longer requires would block every
     * learner at submit, so flip that field back to required as the toggle goes on rather than
     * failing them later.
     */
    const requireIdentityField = (role: FieldRole) => {
        (getValues('fields') ?? []).forEach((field, index) => {
            if (
                !field.required &&
                classifyFieldRole({ type: field.type, label: field.label }) === role
            ) {
                setValue(`fields.${index}.required`, true, { shouldDirty: true });
            }
        });
    };

    const rawPortalUrl = instituteDetails?.learner_portal_base_url;
    const learnerBaseUrl = rawPortalUrl
        ? rawPortalUrl.startsWith('http')
            ? rawPortalUrl
            : `https://${rawPortalUrl}`
        : BASE_URL_LEARNER_DASHBOARD;
    useEffect(() => {
        if (isEditState) {
            if (accessType === AccessType.PUBLIC) {
                const SEEDED_LABELS = ['full name', 'email', 'phone number', 'mobile number'];
                const fields =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    [...(sessionDetails?.notifications?.addedFields ?? [])]
                        // The saved position, not whatever order the API happened to return:
                        // every save rewrites form_order from this array's index, so listing
                        // them unsorted would write a scrambled order back to the learner form.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .sort((a: any, b: any) => (a.formOrder ?? 0) - (b.formOrder ?? 0))
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .map((field: any) => {
                            // Options live in the field's config JSON. Dropping them here left
                            // the editor showing a choice field with no choices.
                            const options = parseFieldOptions(field.config);
                            return {
                                id: field.id,
                                label: field.label,
                                required: field.required,
                                isDefault: SEEDED_LABELS.includes(
                                    (field.label || '').toLowerCase()
                                ),
                                type: field.type,
                                ...(options.length > 0 ? { options } : {}),
                            };
                        });

                form.setValue('fields', fields);
                form.setValue(
                    'joinLink',
                    `${learnerBaseUrl}/register/live-class?sessionId=${sessionId}`
                );
            } else {
                form.setValue('fields', []);
                form.setValue('joinLink', `${learnerBaseUrl}/study-library/live-class`);
            }
            return;
        }
        if (accessType === AccessType.PUBLIC) {
            form.setValue('fields', []);
            form.setValue(
                'joinLink',
                `${learnerBaseUrl}/register/live-class?sessionId=${sessionId}`
            );

            const SEEDED = ['full name', 'email', 'phone number', 'mobile number'];
            const loadFields = async () => {
                const instId = getInstId();
                if (!instId) return;
                const defaults = await fetchInstituteDefaultFields(instId);
                const allFields = (defaults ?? []).map((entry) => {
                    const cf = entry.custom_field;
                    const nameLC = cf.fieldName.toLowerCase();
                    // Multi-input revamp: forward the real field type so the
                    // form schema / learner registration renders date pickers,
                    // file upload, checkboxes, etc. Options are parsed for
                    // both dropdown and radio.
                    const rawType = (cf.fieldType || 'text').toLowerCase();
                    const resolvedType = (rawType === 'textfield' ? 'text' : rawType) as InputType;
                    const hasOptions = hasOptionsType(resolvedType);
                    // Built-in by ROLE, not by label: an institute that calls it "Name" or
                    // "E-mail" gets the same default-on Required as one that spells it out.
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
                        ...(hasOptions && parseFieldOptions(cf.config).length > 0
                            ? { options: parseFieldOptions(cf.config) }
                            : {}),
                    };
                });
                // Every institute gets Full Name / Email / Phone Number, required to start with —
                // an institute with no DEFAULT set (or one missing a field) would otherwise open a
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
        } else {
            form.setValue('fields', []);
            form.setValue('joinLink', `${learnerBaseUrl}/study-library/live-class`);
        }
    }, [accessType, learnerBaseUrl]);
    const {
        fields: beforeLiveFields,
        append: beforeLiveAppend,
        remove: beforeLiveRemove,
        replace: beforeLiveReplace,
    } = useFieldArray({
        control,
        name: 'notifySettings.beforeLiveTime',
    });

    // For NEW sessions only: once the institute notification defaults load,
    // snap the channels/triggers (and the pre-seeded reminder) to them, while
    // the admin hasn't manually changed each field. Edit mode is populated from
    // the saved notification actions instead, so we skip it entirely.
    useEffect(() => {
        if (isEditState || sessionDetails) return;
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
        // Pre-seed the reminder only while the list is still empty and untouched.
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
        isEditState,
        sessionDetails,
        beforeLiveReplace,
        form,
    ]);

    const handleSessionChange = (value: DropdownValueType) => {
        if (value && typeof value === 'object' && 'id' in value && 'name' in value) {
            setCurrentSession(value as DropdownItemType);
        }
    };

    const onSubmitClick = async (data: z.infer<typeof addParticipantsSchema>) => {
        if (isSubmitting) return; // Prevent multiple submissions

        setIsSubmitting(true);
        try {
            const packageSessionIds = data.selectedLevels.map((level) => {
                if (!instituteDetails) return '';

                const matchingBatch = instituteDetails.batches_for_sessions.find(
                    (batch) =>
                        batch.package_dto.id === level.courseId &&
                        batch.session.id === level.sessionId &&
                        batch.level.id === level.levelId
                );

                return matchingBatch?.id || '';
            });

            // Batches that were linked when this class was opened but are no
            // longer selected. Without this the backend never unlinks anything
            // (it only deletes ids named here), so a deselected batch kept
            // showing under "linked batches" after every save.
            //
            // Scoped to batch mode on purpose: in individual-learner mode the
            // payload sends no batches at all, and treating that as "remove them
            // all" would detach every batch the moment an admin switched tabs.
            const deletedPackageSessionIds =
                data.batchSelectionType === 'batch'
                    ? originallyLinkedBatchIds.current.filter(
                          (id) => !packageSessionIds.includes(id)
                      )
                    : [];

            // In bulk flow we fan out the same access/notification payload to
            // every session created in step 1. Failures are tolerated per row
            // so the user gets partial success feedback.
            const targetSessionIds = isBulkFlow ? bulkSessionIds : [sessionId];
            const fanOutResults: { id: string; ok: boolean; error?: unknown }[] = [];

            for (const targetId of targetSessionIds) {
                try {
                    // sessionDetails is snapshotted when the admin opens the session for
                    // editing and is not refetched after step 1, so it still holds the
                    // pre-edit schedule the reschedule mail needs for {{OLD_TIME}}.
                    // Only meaningful when editing a single existing session.
                    const previousSchedule =
                        isEditState && !isBulkFlow ? sessionDetails?.schedule : null;
                    const body = transformFormToDTOStep2(
                        data,
                        targetId,
                        packageSessionIds,
                        previousSchedule,
                        deletedPackageSessionIds
                    );
                    await createLiveSessionStep2(body);
                    fanOutResults.push({ id: targetId, ok: true });
                } catch (err) {
                    console.error(`Step 2 failed for sessionId=${targetId}`, err);
                    fanOutResults.push({ id: targetId, ok: false, error: err });
                }
            }

            const okCount = fanOutResults.filter((r) => r.ok).length;
            const failCount = fanOutResults.length - okCount;

            if (isBulkFlow) {
                if (okCount > 0 && failCount === 0) {
                    toast.success(
                        `Participants & access applied to ${okCount} ${getTerminology(
                            ContentTerms.LiveSession,
                            SystemTerms.LiveSession
                        )}${okCount === 1 ? '' : 's'}.`
                    );
                } else if (okCount > 0 && failCount > 0) {
                    toast.error(
                        `Applied to ${okCount} session${okCount === 1 ? '' : 's'}, but ${failCount} failed. Check console for details.`
                    );
                } else {
                    throw new Error('All bulk step 2 calls failed');
                }
            } else {
                toast.success(
                    `${getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession)} created successfully!`
                );
            }

            // Handle potential Zoho meeting creation
            // Skipped in bulk flow because per-row platforms/timings vary and
            // the Zoho meeting creation is keyed off step1Data which is only
            // representative in bulk mode.
            if (
                !isBulkFlow &&
                step1Data?.sessionPlatform === StreamingPlatform.ZOHO &&
                instituteDetails?.id
            ) {
                try {
                    const sessionDetailsPayload = await getSessionBySessionId(sessionId);
                    const schedules = sessionDetailsPayload?.schedule?.added_schedules || [];

                    for (const schedule of schedules) {
                        try {
                            const durationMinutes =
                                Number(schedule.duration) ||
                                Number(step1Data.durationHours) * 60 +
                                    Number(step1Data.durationMinutes);

                            const sessionStartDate =
                                schedule.meetingDate ||
                                schedule.meeting_date ||
                                (step1Data as any)?.startDate ||
                                new Date().toISOString().split('T')[0];
                            const formattedStartTime = formatZohoStartTime(
                                sessionStartDate,
                                schedule.startTime || schedule.start_time
                            );

                            await createProviderMeeting({
                                instituteId: instituteDetails.id,
                                sessionId: sessionId,
                                scheduleId: schedule.id,
                                topic:
                                    step1Data.title ||
                                    sessionDetailsPayload?.schedule?.title ||
                                    'Live Class',
                                agenda: step1Data.description || 'Live Subject Class',
                                startTime: formattedStartTime,
                                durationMinutes: durationMinutes > 0 ? durationMinutes : 30,
                                timezone:
                                    step1Data.timeZone ||
                                    sessionDetailsPayload?.schedule?.timezone ||
                                    'Asia/Kolkata',
                                provider: 'ZOHO_MEETING',
                            });
                        } catch (err) {
                            console.error(
                                `Error creating Zoho meeting for schedule ${schedule.id}:`,
                                err
                            );
                        }
                    }
                } catch (err) {
                    console.error('Error fetching session details to create Zoho meeting:', err);
                }
            }

            // Handle Zoom meeting creation — only when an account was selected in
            // step 1 (integration enabled). Without an account the admin pasted a
            // defaultLink instead, so there's nothing to create. Mirrors the Zoho
            // block above; skipped in bulk for the same reason.
            if (
                !isBulkFlow &&
                step1Data?.sessionPlatform === StreamingPlatform.ZOOM &&
                (step1Data as any)?.zoomAccountId &&
                instituteDetails?.id
            ) {
                try {
                    const s = step1Data as any;
                    const altHostsRaw = (s?.zoomAlternativeHosts ?? '').trim();
                    const zoomConfig = {
                        // Entry / security
                        waitingRoom: s?.zoomWaitingRoom ?? true,
                        joinBeforeHost: s?.zoomJoinBeforeHost ?? false,
                        meetingAuthentication: s?.zoomMeetingAuthentication ?? false,
                        approvalType: Number(s?.zoomApprovalType ?? 2),
                        alternativeHosts: altHostsRaw
                            ? altHostsRaw
                                  .split(',')
                                  .map((e: string) => e.trim())
                                  .filter(Boolean)
                            : undefined,
                        // Audio / Video
                        muteUponEntry: s?.zoomMuteUponEntry ?? true,
                        hostVideo: s?.zoomHostVideo ?? false,
                        participantVideo: s?.zoomParticipantVideo ?? false,
                        audio: s?.zoomAudio ?? 'both',
                        // In-meeting
                        autoRecording: s?.zoomAutoRecording ?? 'cloud',
                        breakoutRoom: s?.zoomBreakoutRoom ?? false,
                        focusMode: s?.zoomFocusMode ?? false,
                        allowMultipleDevices: s?.zoomAllowMultipleDevices ?? false,
                        watermark: s?.zoomWatermark ?? false,
                    };

                    // One server-side call provisions a Zoom meeting for EVERY schedule of
                    // the session (recurring => one meeting per occurrence). The backend
                    // loops the rows idempotently and derives each occurrence's start time
                    // + duration from its own row, so we no longer fan out N fragile calls
                    // from the browser.
                    // Advisory double-booking check: warn (don't block) if the chosen
                    // Zoom account already has meetings overlapping any occurrence.
                    try {
                        const availability = await checkProviderAvailabilityForSession(
                            sessionId,
                            s.zoomAccountId
                        );
                        if (availability?.available === false) {
                            const count = availability.conflicts?.length ?? 0;
                            toast.warning(
                                `Heads up: this Zoom account already has ${count} overlapping meeting${
                                    count === 1 ? '' : 's'
                                } at the selected time. Creating anyway.`
                            );
                        }
                    } catch {
                        // advisory only — never block meeting creation
                    }

                    const fallbackDuration =
                        Number(step1Data.durationHours) * 60 + Number(step1Data.durationMinutes);
                    await createProviderMeetingsForSession({
                        instituteId: instituteDetails.id,
                        sessionId: sessionId,
                        topic: step1Data.title || 'Live Class',
                        agenda: step1Data.description || 'Live Subject Class',
                        durationMinutes: fallbackDuration > 0 ? fallbackDuration : 30,
                        timezone: step1Data.timeZone || 'Asia/Kolkata',
                        provider: 'ZOOM_MEETING',
                        // Vendor-neutral fields (preferred); legacy zoom* sent too for transition.
                        providerConfig: zoomConfig,
                        providerAccountId: s.zoomAccountId,
                        zoomAccountId: s.zoomAccountId,
                        zoomConfig,
                    });
                } catch (err) {
                    console.error('Error creating Zoom meetings for session:', err);
                }
            }

            // Handle Google Meet meeting creation — only when a connected account was selected in
            // step 1 (integration on). Without an account the admin pasted a defaultLink instead.
            // Mirrors the Zoom block; skipped in bulk for the same reason.
            if (
                !isBulkFlow &&
                step1Data?.sessionPlatform === StreamingPlatform.MEET &&
                (step1Data as any)?.googleMeetAccountId &&
                instituteDetails?.id
            ) {
                try {
                    const s = step1Data as any;
                    // Advisory double-booking check: warn (don't block) on overlap.
                    try {
                        const availability = await checkProviderAvailabilityForSession(
                            sessionId,
                            s.googleMeetAccountId
                        );
                        if (availability?.available === false) {
                            const count = availability.conflicts?.length ?? 0;
                            toast.warning(
                                `Heads up: this Google account already has ${count} overlapping meeting${
                                    count === 1 ? '' : 's'
                                } at the selected time. Creating anyway.`
                            );
                        }
                    } catch {
                        // advisory only — never block meeting creation
                    }

                    // Meet space settings — keys read by GoogleMeetManager.buildSpaceConfig.
                    // Unset values fall back to the account defaults on the backend.
                    const hostOnly = (on?: boolean) => (on ? 'HOSTS_ONLY' : 'NO_RESTRICTION');
                    const googleConfig = {
                        accessType: s?.googleAccessType,
                        recording: s?.googleRecord,
                        transcription: s?.googleTranscription ?? false,
                        smartNotes: s?.googleSmartNotes ?? false,
                        attendanceReport: s?.googleAttendanceReport ?? false,
                        hostManagement: s?.googleHostManagement ?? false,
                        ...(s?.googleHostManagement
                            ? {
                                  chatRestriction: hostOnly(s?.googleChatHostsOnly),
                                  reactionRestriction: hostOnly(s?.googleReactionsHostsOnly),
                                  presentRestriction: hostOnly(s?.googlePresentHostsOnly),
                                  joinAsViewer: s?.googleJoinAsViewer ?? false,
                              }
                            : {}),
                    };

                    const fallbackDuration =
                        Number(step1Data.durationHours) * 60 + Number(step1Data.durationMinutes);
                    await createProviderMeetingsForSession({
                        instituteId: instituteDetails.id,
                        sessionId: sessionId,
                        topic: step1Data.title || 'Live Class',
                        agenda: step1Data.description || 'Live Subject Class',
                        durationMinutes: fallbackDuration > 0 ? fallbackDuration : 30,
                        timezone: step1Data.timeZone || 'Asia/Kolkata',
                        provider: 'GOOGLE_MEET',
                        providerAccountId: s.googleMeetAccountId,
                        providerConfig: googleConfig,
                    });
                } catch (err) {
                    console.error('Error creating Google Meet meetings for session:', err);
                }
            }

            await queryClient.invalidateQueries({ queryKey: ['liveSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['upcomingSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['pastSessions'] });
            await queryClient.invalidateQueries({ queryKey: ['draftSessions'] });
            clearSessionId();
            clearStep1Data();
            clearBulkSessionIds();
            // If we were deep-linked in from another page (e.g. Course Details →
            // Live Sessions tab), return to that exact URL instead of the
            // live-session list. Push the raw path+search string through the
            // router history rather than reconstructing a typed `to`/`search`
            // pair — the return URL is an arbitrary in-app location and history
            // push avoids route-pattern / search-encoding round-trip pitfalls.
            const destination = returnUrl;
            clearDeepLink();
            if (destination) {
                router.history.push(destination);
            } else {
                navigate({ to: '/study-library/live-session' });
            }
        } catch (error) {
            // Capture to Sentry (feature-tagged) + show a toast in one call so
            // create failures are no longer console-only.
            reportApiError(error, {
                feature: 'live-session-schedule-create',
                fallbackMessage: 'Failed to create live session. Please try again.',
                tags: {
                    flow: isBulkFlow ? 'bulk-fanout' : 'single',
                    mode: isEditState ? 'edit' : 'create',
                },
                extra: {
                    sessionId,
                    accessType: data.accessType,
                    batchCount: data.selectedLevels?.length ?? 0,
                    learnerCount: data.selectedLearners?.length ?? 0,
                },
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const onCustomSubmit = (data: z.infer<typeof addCustomFiledSchema>) => {
        append({
            label: data.fieldName,
            isDefault: false,
            required: true,
            type: data.options.length > 0 ? InputType.DROPDOWN : InputType.TEXT,
            options:
                data.fieldType === 'dropdown'
                    ? data.options.map((option) => ({
                          name: option.optionField,
                          label: option.optionField,
                      }))
                    : [],
        });
        setAddCustomFieldDialog(false);
    };

    const onError = (errors: FieldErrors<typeof addParticipantsSchema>) => {
        console.log('Validation errors:', errors);

        // Show validation error toast
        toast.error('Please fix the validation errors and try again.', {
            icon: <XCircle size={20} className="text-red-500" />,
        });
    };

    // A private class is restricted to specific participants, so creating one
    // requires at least one target — a batch (Select Batch) or an individual
    // learner (Select Individually). Enforced on CREATE only: edit mode doesn't
    // reload individual-learner selections, so blocking there would wrongly stop
    // admins from re-saving an existing, already-populated private class.
    const privateNeedsParticipants = (data: z.infer<typeof addParticipantsSchema>) =>
        !isEditState &&
        data.accessType === AccessType.PRIVATE &&
        (data.selectedLevels?.length ?? 0) === 0 &&
        (data.selectedLearners?.length ?? 0) === 0;

    // Set true once a create attempt is blocked for missing participants; the
    // inline error below derives its visibility from the live values so it
    // disappears as soon as the admin assigns a batch/learner.
    const [attemptedPrivateCreate, setAttemptedPrivateCreate] = useState(false);

    // Block opening the preview when a private class has no participants;
    // surface both a toast and the inline error near the picker.
    const handleOpenPreview = handleSubmit((data) => {
        if (privateNeedsParticipants(data)) {
            setAttemptedPrivateCreate(true);
            toast.error('Assign at least one batch to a private live class.', {
                icon: <XCircle size={20} className="text-red-500" />,
            });
            return;
        }
        setPreviewOpen(true);
    }, onError);

    const previewSelectedLevels = watch('selectedLevels');
    const isWeeklyRecurring =
        (step1Data?.meetingType as string | undefined) === 'weekly' &&
        !!step1Data?.recurringSchedule?.length;
    const dayShort: Record<string, string> = {
        monday: 'Mon',
        tuesday: 'Tue',
        wednesday: 'Wed',
        thursday: 'Thu',
        friday: 'Fri',
        saturday: 'Sat',
        sunday: 'Sun',
    };
    const recurrenceUntilLabel = step1Data?.endDate
        ? (() => {
              try {
                  return new Date(step1Data.endDate).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                  });
              } catch {
                  return step1Data.endDate;
              }
          })()
        : undefined;

    let previewSessions: PreviewSessionRow[] = [];
    let previewRecurrenceBanner: PreviewRecurrenceBanner | undefined;

    if (isWeeklyRecurring && step1Data?.recurringSchedule) {
        const selectedDays: string[] = [];
        const rows: PreviewSessionRow[] = [];
        for (const day of step1Data.recurringSchedule) {
            if (!day?.isSelect) continue;
            const dayName = dayShort[day.day] ?? day.day;
            selectedDays.push(dayName);
            for (const s of day.sessions ?? []) {
                rows.push({
                    title: day.default_class_name?.trim() || step1Data?.title,
                    subject: step1Data?.subject,
                    whenLabel: dayName,
                    whenSubLabel: s.startTime || '—',
                    durationHours: s.durationHours ?? step1Data?.durationHours,
                    durationMinutes: s.durationMinutes ?? step1Data?.durationMinutes,
                    link: s.link || day.default_class_link || step1Data?.defaultLink,
                    platform: step1Data?.sessionPlatform,
                    selectedLevels: previewSelectedLevels,
                });
            }
        }
        if (rows.length > 0) {
            previewSessions = rows;
            previewRecurrenceBanner = {
                pattern: 'Recurring weekly',
                days: selectedDays,
                until: recurrenceUntilLabel ? `Until ${recurrenceUntilLabel}` : undefined,
                totalLabel: `${rows.length} slot${rows.length === 1 ? '' : 's'}/week`,
            };
        }
    }

    if (previewSessions.length === 0) {
        const rawStartTime = step1Data?.startTime ?? '';
        const [datePart, timePart] = rawStartTime.includes('T')
            ? rawStartTime.split('T')
            : ['', rawStartTime];
        previewSessions = [
            {
                title: step1Data?.title,
                subject: step1Data?.subject,
                startDate: datePart,
                startTime: timePart,
                durationHours: step1Data?.durationHours,
                durationMinutes: step1Data?.durationMinutes,
                link: step1Data?.defaultLink,
                platform: step1Data?.sessionPlatform,
                selectedLevels: previewSelectedLevels,
            },
        ];
    }

    return (
        <>
            <FormProvider {...form}>
                <form onSubmit={handleOpenPreview} className="flex flex-col gap-5">
                    <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3 sm:-mx-0 sm:px-0">
                        <div className="flex items-center gap-3">
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="secondary"
                                onClick={() =>
                                    navigate({ to: '/study-library/live-session/schedule/step1' })
                                }
                            >
                                Back
                            </MyButton>
                            <div>
                                <h1 className="text-lg font-semibold text-neutral-800">
                                    Participants & Access
                                </h1>
                                <p className="text-xs text-neutral-500">
                                    Choose who can join and how they get notified.
                                </p>
                            </div>
                        </div>
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            disable={isSubmitting}
                            onClick={handleOpenPreview}
                        >
                            {isSubmitting ? (
                                <CircleNotch className="animate-spin text-white" />
                            ) : (
                                'Preview & create'
                            )}
                        </MyButton>
                    </div>

                    {isBulkFlow && (
                        <div className="flex items-start gap-2 rounded-md border border-primary-200 bg-primary-50/60 px-3 py-2 text-sm text-neutral-700">
                            <span className="font-medium">Bulk mode:</span>
                            <span>
                                These access & notification settings will be applied to all{' '}
                                {bulkSessionIds.length} sessions you just created.
                            </span>
                        </div>
                    )}

                    <SectionCard
                        icon={<Chalkboard size={18} />}
                        title="Instructors"
                        description="Who is taking this class. Defaults to you. Instructors receive this session's notification emails and are shown to learners on the class card."
                    >
                        <FormField
                            control={control}
                            name="instructorUserIds"
                            render={({ field }) => (
                                <InstructorPicker
                                    instituteId={instituteDetails?.id ?? ''}
                                    value={field.value ?? []}
                                    onChange={field.onChange}
                                />
                            )}
                        />
                    </SectionCard>

                    <SectionCard
                        icon={<LockKey size={18} />}
                        title="Participant Access"
                        description="Who can join this class — restricted to selected learners or open via a shared link."
                    >
                        <div className="flex flex-col gap-4 font-medium">
                            {isEditState && (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <div className="font-bold">{accessType} : </div>
                                    {accessType === AccessType.PRIVATE ? (
                                        <div>
                                            Restrict the class to specific participants by assigning
                                            it to institute batches or selecting individual
                                            learners.
                                        </div>
                                    ) : (
                                        <div>
                                            Allow anyone to join this class via a shared link.
                                        </div>
                                    )}
                                </div>
                            )}
                            {!isEditState && (
                                <FormField
                                    control={control}
                                    name="accessType"
                                    render={({ field }) => (
                                        <MyRadioButton
                                            name="meetingType"
                                            value={field.value ?? ''}
                                            onChange={field.onChange}
                                            disabled={isEditState}
                                            options={[
                                                {
                                                    label: (
                                                        <div className="flex flex-row gap-1">
                                                            <div className="font-bold">
                                                                Private Class:
                                                            </div>
                                                            Restrict the class to specific
                                                            participants by assigning it to
                                                            institute batches or selecting
                                                            individual learners.
                                                        </div>
                                                    ),
                                                    value: AccessType.PRIVATE,
                                                },
                                                {
                                                    label: (
                                                        <div className="flex flex-row gap-1">
                                                            <div className="font-bold">
                                                                Public Class:
                                                            </div>
                                                            Allow anyone to join this class via a
                                                            shared link.
                                                        </div>
                                                    ),
                                                    value: AccessType.PUBLIC,
                                                },
                                            ]}
                                            className="flex flex-col gap-4"
                                        />
                                    )}
                                />
                            )}
                        </div>
                    </SectionCard>

                    <SectionCard
                        icon={<CurrencyCircleDollar size={18} />}
                        title="Payment"
                        description="Sell access to this session. Attendees pay a one-time price to register, get a receipt by email, and can only join once payment is complete."
                    >
                        <div className="flex flex-col gap-4">
                            <FormField
                                control={control}
                                name="paymentEnabled"
                                render={({ field }) => (
                                    <label className="flex w-fit cursor-pointer items-center gap-3">
                                        <Switch
                                            checked={!!field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                        <span className="text-sm font-medium">Paid live class</span>
                                    </label>
                                )}
                            />
                            {watch('paymentEnabled') && (
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                                    <FormField
                                        control={control}
                                        name="paymentPrice"
                                        render={({ field, fieldState }) => (
                                            <FormItem className="w-full sm:w-52">
                                                <FormControl>
                                                    <MyInput
                                                        inputType="number"
                                                        label="Price"
                                                        required
                                                        inputPlaceholder="e.g. 499"
                                                        input={field.value ?? ''}
                                                        onChangeFunction={(e) =>
                                                            field.onChange(e.target.value)
                                                        }
                                                        error={fieldState.error?.message}
                                                        className="!w-full min-w-0"
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <div className="w-full sm:w-60">
                                        <SelectField
                                            label="Currency"
                                            name="paymentCurrency"
                                            options={CURRENCIES.map((currency, index) => ({
                                                _id: index,
                                                value: currency.code,
                                                label: `${currency.code} — ${currency.name}`,
                                            }))}
                                            control={control}
                                            required
                                        />
                                    </div>
                                    <div className="w-full sm:w-60">
                                        <SelectField
                                            label="Payment gateway"
                                            name="paymentVendor"
                                            options={activeGateways.map((gateway, index) => ({
                                                _id: index,
                                                value: gateway.vendor,
                                                label:
                                                    gateway.vendor === defaultVendor
                                                        ? `${gateway.vendor} (Default)`
                                                        : gateway.vendor,
                                            }))}
                                            control={control}
                                        />
                                        <p className="mt-1 text-caption text-neutral-500">
                                            Leave unset to charge via the default gateway.
                                        </p>
                                    </div>
                                </div>
                            )}
                            {watch('paymentEnabled') && (
                                <p className="text-sm text-neutral-500">
                                    Payments are collected through your institute&apos;s configured
                                    payment gateway. Each payer automatically receives an invoice
                                    with a PDF attachment on successful payment.
                                </p>
                            )}
                        </div>
                    </SectionCard>

                    {/* A public class can ALSO be assigned to batches. The open
                        registration link and batch enrolment coexist: the backend sets
                        access_level and writes participant rows independently, and no
                        learner query filters on access_level. Batches stay optional for
                        public (required only for private, enforced below). */}
                    <SectionCard
                        icon={<UsersThree size={18} />}
                        title="Select Participants"
                        description={
                            accessType === AccessType.PUBLIC
                                ? 'Optional for a public class — anyone can still join via the shared link. Assign batches to also show this class inside the learner app for those batches.'
                                : 'Pick a session, then choose batches or individual learners to enroll.'
                        }
                    >
                        <div className="flex flex-col gap-4">
                            <div className="w-full sm:max-w-72">
                                <MyDropdown
                                    currentValue={currentSession ?? undefined}
                                    dropdownList={sessionList}
                                    placeholder={`Select ${getTerminology(ContentTerms.Session, SystemTerms.Session)}`}
                                    handleChange={handleSessionChange}
                                />
                            </div>
                            <LiveSessionParticipantsTab
                                form={form}
                                courses={courses}
                                currentSession={currentSession}
                            />
                            {attemptedPrivateCreate &&
                                !isEditState &&
                                (previewSelectedLevels?.length ?? 0) === 0 &&
                                (watch('selectedLearners')?.length ?? 0) === 0 && (
                                    <p className="text-sm text-danger-600">
                                        Assign at least one batch (or individual learner) to a
                                        private live class.
                                    </p>
                                )}
                        </div>
                    </SectionCard>

                    {/* Auto-add recordings to course — batch mode only. Gated behind the
                        institute-wide "Auto-upload recordings to course" setting (see
                        docs/LIVE_SESSION_RECORDING_AUTO_LINK_PLAN.md, Phase 2). */}
                    {batchSelectionType === 'batch' &&
                        liveSessionSettings.lmsConnection.autoUploadRecordingsEnabled && (
                            <Collapsible
                                open={recordingAutoLinkOpen}
                                onOpenChange={setRecordingAutoLinkOpen}
                            >
                                <SectionCard
                                    icon={<VideoCamera size={18} />}
                                    title={`Auto-add recordings to ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`}
                                    description={`When a recording of this class becomes available, automatically add it as a video slide in the chosen ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()} — no manual step needed.`}
                                    headerRight={
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={recordingAutoLink?.enabled ?? false}
                                                onCheckedChange={handleRecordingAutoLinkToggle}
                                            />
                                            <CollapsibleTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="flex size-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                                                    aria-label="Toggle section"
                                                >
                                                    <CaretDown
                                                        size={14}
                                                        className={cn(
                                                            'transition-transform',
                                                            recordingAutoLinkOpen && 'rotate-180'
                                                        )}
                                                    />
                                                </button>
                                            </CollapsibleTrigger>
                                        </div>
                                    }
                                >
                                    <CollapsibleContent>
                                        {recordingAutoLinkBatches.length === 0 ? (
                                            <p className="text-body text-neutral-500">
                                                Select at least one batch above to choose a
                                                destination{' '}
                                                {getTerminology(
                                                    ContentTerms.Chapters,
                                                    SystemTerms.Chapters
                                                ).toLocaleLowerCase()}
                                                .
                                            </p>
                                        ) : (
                                            <SessionContentDestinationPicker
                                                batches={recordingAutoLinkBatches}
                                                initialDestinations={
                                                    recordingAutoLink?.destinations as
                                                        | ContentLinkDestination[]
                                                        | undefined
                                                }
                                                initialSlideStatus={
                                                    recordingAutoLink?.slideStatus as
                                                        | SlideStatus
                                                        | undefined
                                                }
                                                hideSubmit
                                                hidePosition
                                                hideNotify
                                                onDestinationsChange={
                                                    handleRecordingAutoLinkDestinationsChange
                                                }
                                            />
                                        )}
                                    </CollapsibleContent>
                                </SectionCard>
                            </Collapsible>
                        )}

                    {/* Registration Form Fields - Only for Public classes */}
                    {accessType === AccessType.PUBLIC && (
                        <SectionCard
                            icon={<Article size={18} />}
                            title="Registration Form"
                            description="Fields shown to learners on the public registration form. Drag to reorder."
                        >
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-col gap-3 rounded-md border bg-neutral-50 p-3">
                                    <p className="text-sm font-medium">Contact verification</p>
                                    <FormField
                                        control={control}
                                        name="requireEmailVerification"
                                        render={({ field }) => (
                                            <label className="flex w-fit cursor-pointer items-center gap-3">
                                                <Switch
                                                    checked={!!field.value}
                                                    onCheckedChange={(checked) => {
                                                        field.onChange(checked);
                                                        if (checked) requireIdentityField(FieldRole.EMAIL);
                                                    }}
                                                />
                                                <span className="text-sm">
                                                    Verify email with an OTP before registering
                                                </span>
                                            </label>
                                        )}
                                    />
                                    <FormField
                                        control={control}
                                        name="requirePhoneVerification"
                                        render={({ field }) => (
                                            <label className="flex w-fit cursor-pointer items-center gap-3">
                                                <Switch
                                                    checked={!!field.value}
                                                    onCheckedChange={(checked) => {
                                                        field.onChange(checked);
                                                        if (checked) requireIdentityField(FieldRole.PHONE);
                                                    }}
                                                />
                                                <span className="text-sm">
                                                    Verify mobile number with a WhatsApp OTP before
                                                    registering
                                                </span>
                                            </label>
                                        )}
                                    />
                                    {watch('requirePhoneVerification') && (
                                        <div className="flex flex-col gap-1">
                                            <div className="w-full sm:w-72">
                                                <p className="mb-1 text-sm font-medium">
                                                    WhatsApp OTP template
                                                </p>
                                                <Controller
                                                    name="whatsappOtpTemplateName"
                                                    control={control}
                                                    render={({ field }) => (
                                                        <TemplateSearchableSelect
                                                            options={toTemplateOptions(
                                                                approvedTemplates
                                                            )}
                                                            value={field.value ?? ''}
                                                            onChange={field.onChange}
                                                            placeholder="Institute default OTP template"
                                                            emptyText="No approved template matches your search."
                                                        />
                                                    )}
                                                />
                                            </div>
                                            <p className="text-sm text-neutral-500">
                                                The OTP is sent on WhatsApp using this approved
                                                template. Leave unset to use your institute&apos;s
                                                default OTP template.
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col gap-3 rounded-md border bg-neutral-50 p-3">
                                    <p className="text-sm font-medium">Audience lists</p>
                                    <FormField
                                        control={control}
                                        name="audiencePushEnabled"
                                        render={({ field }) => (
                                            <label className="flex w-fit cursor-pointer items-center gap-3">
                                                <Switch
                                                    checked={!!field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                                <span className="text-sm">
                                                    Save registrants to audience list(s)
                                                </span>
                                            </label>
                                        )}
                                    />
                                    {watch('audiencePushEnabled') && (
                                        <div className="flex flex-col gap-1">
                                            <FormField
                                                control={control}
                                                name="audiencePushAudienceIds"
                                                render={({ field, fieldState }) => (
                                                    <FormItem className="w-full sm:w-96">
                                                        <FormControl>
                                                            <MultiSelect
                                                                options={audienceListOptions}
                                                                selected={field.value ?? []}
                                                                onChange={field.onChange}
                                                                placeholder="Select audience lists"
                                                            />
                                                        </FormControl>
                                                        {fieldState.error?.message && (
                                                            <p className="text-sm text-danger-600">
                                                                {fieldState.error.message}
                                                            </p>
                                                        )}
                                                    </FormItem>
                                                )}
                                            />
                                            <p className="text-sm text-neutral-500">
                                                Everyone who registers for this class is also added
                                                as a lead to each selected list in Audience Manager.
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <FormFieldRowHeader />
                                <Sortable
                                    value={fields}
                                    onMove={({ activeIndex, overIndex }) =>
                                        move(activeIndex, overIndex)
                                    }
                                >
                                    {fields.map((field, index) => (
                                        <SortableItem key={field.id} value={field.id} asChild>
                                            <div>
                                                <FormFieldRow
                                                    position={index + 1}
                                                    name={watch(`fields.${index}.label`) ?? ''}
                                                    type={watch(`fields.${index}.type`) ?? ''}
                                                    isRequired={
                                                        watch(`fields.${index}.required`) ?? false
                                                    }
                                                    requiredLockReason={requiredLockReasonFor({
                                                        label: watch(`fields.${index}.label`),
                                                        type: watch(`fields.${index}.type`),
                                                    })}
                                                    isEditing={editingFieldIndex === index}
                                                    onToggleRequired={() =>
                                                        setValue(
                                                            `fields.${index}.required`,
                                                            !watch(`fields.${index}.required`),
                                                            { shouldDirty: true }
                                                        )
                                                    }
                                                    onEdit={() => setEditingFieldIndex(index)}
                                                    onDelete={() => remove(index)}
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

                                {/* Required-ness rules that span fields (an identity field must
                                    stay required, an OTP-verified channel must be collected) are
                                    raised on the `fields` array itself, so they have no row of
                                    their own to render in. */}
                                {form.formState.errors.fields?.message && (
                                    <p className="px-3 text-caption text-danger-600">
                                        {form.formState.errors.fields.message}
                                    </p>
                                )}

                                {/* adding customs fields and new registration form options */}
                                <div className="flex flex-col gap-4 p-3 sm:flex-row">
                                    <SharedAddCustomFieldDialog
                                        trigger={
                                            <MyButton
                                                buttonType="secondary"
                                                type="button"
                                                className="w-full sm:w-auto"
                                            >
                                                <Plus></Plus> Add Custom Field
                                            </MyButton>
                                        }
                                        onAddField={(type, name, _oldKey, options) => {
                                            // Multi-input revamp (2026-04): forward the actual
                                            // field type instead of collapsing to TEXT/DROPDOWN so
                                            // the learner-facing live session registration form
                                            // can render date pickers, file upload, checkboxes,
                                            // etc. InputType was broadened to include all 11 types.
                                            const normalized = (type || 'text').toLowerCase();
                                            const resolvedType =
                                                normalized === 'textfield'
                                                    ? InputType.TEXT
                                                    : (normalized as InputType);
                                            const hasOptions =
                                                (resolvedType === InputType.DROPDOWN ||
                                                    resolvedType === InputType.RADIO) &&
                                                !!options;
                                            append({
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
                                        existingFieldNames={fields
                                            .filter((f) => (f as any).status !== 'DELETED')
                                            .map((f) => f.label)}
                                    />
                                    {/* Editing reuses the add dialog, prefilled. Keyed per row so
                                        opening a different field re-runs the prefill. */}
                                    {editingFieldIndex !== null && fields[editingFieldIndex] && (
                                        <SharedAddCustomFieldDialog
                                            key={fields[editingFieldIndex].id}
                                            mode="edit"
                                            open
                                            onOpenChange={(isOpen) => {
                                                if (!isOpen) setEditingFieldIndex(null);
                                            }}
                                            initialField={{
                                                type: getValues(`fields.${editingFieldIndex}.type`),
                                                name:
                                                    getValues(
                                                        `fields.${editingFieldIndex}.label`
                                                    ) ?? '',
                                                options: (
                                                    getValues(
                                                        `fields.${editingFieldIndex}.options`
                                                    ) ?? []
                                                ).map((o) => o.label),
                                                isRequired: getValues(
                                                    `fields.${editingFieldIndex}.required`
                                                ),
                                            }}
                                            onAddField={(type, name, _oldKey, options, config) => {
                                                const idx = editingFieldIndex;
                                                // Same normalization as the add path, so an edited
                                                // field stores the identical type string.
                                                const normalized = (type || 'text').toLowerCase();
                                                const resolvedType =
                                                    normalized === 'textfield'
                                                        ? InputType.TEXT
                                                        : (normalized as InputType);
                                                setValue(`fields.${idx}.label`, name, {
                                                    shouldDirty: true,
                                                });
                                                setValue(`fields.${idx}.type`, resolvedType, {
                                                    shouldDirty: true,
                                                });
                                                setValue(
                                                    `fields.${idx}.required`,
                                                    config?.isRequired ?? true,
                                                    { shouldDirty: true }
                                                );
                                                // The dialog only returns options for choice
                                                // types, so switching away from one clears them.
                                                setValue(
                                                    `fields.${idx}.options`,
                                                    options?.map((opt) => ({
                                                        name: opt.value,
                                                        label: opt.value,
                                                    })) ?? [],
                                                    { shouldDirty: true }
                                                );
                                                setEditingFieldIndex(null);
                                            }}
                                            // Its own name must stay available, or saving an
                                            // unchanged label would be blocked as a duplicate.
                                            existingFieldNames={fields
                                                .filter((_, i) => i !== editingFieldIndex)
                                                .map((f) => f.label)}
                                        />
                                    )}
                                    <MyButton
                                        buttonType="secondary"
                                        type="button"
                                        onClick={() => {
                                            setPreviewDialog(true);
                                        }}
                                        className="w-full sm:w-auto"
                                    >
                                        Preview Registration Form
                                    </MyButton>
                                </div>
                            </div>
                        </SectionCard>
                    )}

                    <SectionCard
                        icon={<LinkSimple size={18} />}
                        title="Join Link"
                        description="Share this link or QR code with learners — it's auto-generated and read-only."
                    >
                        <div
                            className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10"
                            id="join-link-qr-code"
                        >
                            <div className="flex flex-1 flex-col gap-2">
                                <div className="text-xs font-medium text-neutral-500">
                                    Share link
                                </div>
                                <div className="flex w-full items-center gap-2">
                                    <FormField
                                        control={control}
                                        name="joinLink"
                                        render={({ field: { ...field } }) => (
                                            <FormItem className="w-full">
                                                <FormControl>
                                                    <MyInput
                                                        inputType="text"
                                                        inputPlaceholder="Join Link"
                                                        input={field.value}
                                                        onChangeFunction={field.onChange}
                                                        error={
                                                            form.formState.errors.joinLink?.message
                                                        }
                                                        readOnly
                                                        size="large"
                                                        className="!w-full min-w-0"
                                                        {...field}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <MyButton
                                        type="button"
                                        scale="small"
                                        buttonType="secondary"
                                        className="h-10 min-w-10 shrink-0"
                                        onClick={() => copyToClipboard(getValues('joinLink'))}
                                    >
                                        <Copy size={20} />
                                    </MyButton>
                                </div>
                            </div>
                            <div className="flex flex-col items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                                <div className="text-xs font-medium text-neutral-500">QR Code</div>
                                <div className="flex items-center gap-3">
                                    <FormField
                                        control={control}
                                        name="joinLink"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <QRCode
                                                        value={field.value ?? ''}
                                                        className="size-20 rounded bg-white p-1"
                                                        id="qr-code-svg"
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <MyButton
                                        type="button"
                                        scale="small"
                                        buttonType="secondary"
                                        className="h-9"
                                        onClick={() => handleDownloadQRCode('qr-code-svg', tHelper)}
                                    >
                                        <DownloadSimple size={16} />
                                        <span className="ml-1 text-xs">Download</span>
                                    </MyButton>
                                </div>
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard
                        icon={<BellRinging size={18} />}
                        title="Notifications"
                        description="Choose channels and the moments when participants get notified."
                    >
                        <div className="flex flex-col gap-5">
                            <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                    Channels
                                </div>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                    <FormField
                                        control={control}
                                        name={`notifyBy.mail`}
                                        render={({ field }) => (
                                            <FormItem className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className={`size-4 rounded-sm border-2 shadow-none ${
                                                            field.value
                                                                ? 'border-none bg-primary-500 text-white'
                                                                : ''
                                                        }`}
                                                    />
                                                </FormControl>
                                                <FormLabel className="!m-0 text-sm font-normal">
                                                    Notify Via Email
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={control}
                                        name={`notifyBy.whatsapp`}
                                        render={({ field }) => (
                                            <FormItem className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className={`size-4 rounded-sm border-2 shadow-none ${
                                                            field.value
                                                                ? 'border-none bg-primary-500 text-white'
                                                                : ''
                                                        }`}
                                                    />
                                                </FormControl>
                                                <FormLabel className="!m-0 text-sm font-normal">
                                                    Notify Via WhatsApp
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={control}
                                        name={`notifyBy.push_notification`}
                                        render={({ field }) => (
                                            <FormItem className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className={`size-4 rounded-sm border-2 shadow-none ${
                                                            field.value
                                                                ? 'border-none bg-primary-500 text-white'
                                                                : ''
                                                        }`}
                                                    />
                                                </FormControl>
                                                <FormLabel className="!m-0 text-sm font-normal">
                                                    Notify Via Push Notification
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={control}
                                        name={`notifyBy.system_notification`}
                                        render={({ field }) => (
                                            <FormItem className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className={`size-4 rounded-sm border-2 shadow-none ${
                                                            field.value
                                                                ? 'border-none bg-primary-500 text-white'
                                                                : ''
                                                        }`}
                                                    />
                                                </FormControl>
                                                <FormLabel className="!m-0 text-sm font-normal">
                                                    Notify Via System Notification
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <Separator />

                            <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                    Triggers
                                </div>
                                <p className="mt-0.5 text-xs text-neutral-500">
                                    Pick when notifications should fire on the channels above.
                                </p>
                                <div className="mt-3 flex flex-col gap-2">
                                    <FormField
                                        control={control}
                                        name={`notifySettings.onCreate`}
                                        render={({ field }) => (
                                            <FormItem className="flex items-end gap-2">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className={`size-5 rounded-sm border-2 shadow-none ${
                                                            field.value
                                                                ? 'border-none bg-primary-500 text-white' // Blue background and red tick when checked
                                                                : '' // Default styles when unchecked
                                                        }`}
                                                    />
                                                </FormControl>
                                                <FormLabel className="!mb-1 font-thin">
                                                    When Live Class is created
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />

                                    {isEditState && (
                                        <FormField
                                            control={control}
                                            name={`notifySettings.onEdit`}
                                            render={({ field }) => (
                                                <FormItem className="flex items-end gap-2">
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={field.value ?? false}
                                                            onCheckedChange={field.onChange}
                                                            className={`size-5 rounded-sm border-2 shadow-none ${
                                                                field.value
                                                                    ? 'border-none bg-primary-500 text-white'
                                                                    : ''
                                                            }`}
                                                        />
                                                    </FormControl>
                                                    <FormLabel className="!mb-1 font-thin">
                                                        Send Reschedule/Edit Email
                                                    </FormLabel>
                                                </FormItem>
                                            )}
                                        />
                                    )}

                                    <div>
                                        <div className="text-sm font-medium">Notify Before</div>

                                        {beforeLiveFields.map((field, index) => (
                                            <div key={field.id} className="flex items-center">
                                                <SelectField
                                                    label=""
                                                    name={`notifySettings.beforeLiveTime.${index}.time`}
                                                    labelStyle="font-thin"
                                                    options={TimeOptions.map((option, index) => ({
                                                        value: option.value,
                                                        label: option.label,
                                                        _id: index,
                                                    }))}
                                                    control={form.control}
                                                    className="mt-2 w-56 font-thin"
                                                />
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    onClick={() => beforeLiveRemove(index)}
                                                    className="text-red-500"
                                                >
                                                    Remove
                                                </MyButton>
                                            </div>
                                        ))}

                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            onClick={() => beforeLiveAppend({ time: '' })}
                                            className="m-0 flex justify-start gap-2 p-0 text-primary-500"
                                        >
                                            <Plus size={16} /> Add
                                        </MyButton>
                                    </div>

                                    <FormField
                                        control={control}
                                        name={`notifySettings.onLive`}
                                        render={({ field }) => (
                                            <FormItem className="flex items-end gap-2">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className={`size-5 rounded-sm border-2 shadow-none ${
                                                            field.value
                                                                ? 'border-none bg-primary-500 text-white'
                                                                : ''
                                                        }`}
                                                    />
                                                </FormControl>
                                                <FormLabel className="!mb-1 font-thin">
                                                    When class goes live
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={control}
                                        name={`notifySettings.onAttendance`}
                                        render={({ field }) => (
                                            <FormItem className="flex items-end gap-2">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                        className={`size-5 rounded-sm border-2 shadow-none ${
                                                            field.value
                                                                ? 'border-none bg-primary-500 text-white'
                                                                : ''
                                                        }`}
                                                    />
                                                </FormControl>
                                                <FormLabel className="!mb-1 font-thin">
                                                    When attendance is marked (present/absent)
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>
                        </div>
                    </SectionCard>
                </form>
                {/* Preview Registration Form */}
                <MyDialog
                    heading="Preview Registration Form"
                    onOpenChange={setPreviewDialog}
                    open={previewDialog}
                >
                    {fields?.map((testInputFields, idx) => {
                        return (
                            <div className="flex flex-col items-start gap-4" key={idx}>
                                <div className="flex w-full flex-col gap-1.5">
                                    <h1 className="text-sm">
                                        {testInputFields.label}
                                        {testInputFields.required && (
                                            <span className="text-subtitle text-danger-600">*</span>
                                        )}
                                    </h1>
                                    <CustomFieldRenderer
                                        type={testInputFields.type}
                                        name={testInputFields.label}
                                        value=""
                                        disabled={true}
                                        options={testInputFields.options?.map(
                                            (o) => o.name ?? o.label
                                        )}
                                        required={testInputFields.required}
                                    />
                                </div>
                            </div>
                        );
                    })}

                    <div className="mb-6 flex justify-center">
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="primary"
                            className="mt-4 w-fit"
                            disable
                        >
                            Register Now
                        </MyButton>
                    </div>
                </MyDialog>
                <LiveSessionPreviewDialog
                    open={previewOpen}
                    onOpenChange={setPreviewOpen}
                    submitting={isSubmitting}
                    onConfirm={async () => {
                        await handleSubmit(onSubmitClick, onError)();
                        setPreviewOpen(false);
                    }}
                    timeZone={step1Data?.timeZone}
                    accessType={accessType}
                    sessionFeatures={{
                        enableWaitingRoom: step1Data?.enableWaitingRoom,
                        waitingRoomMinutes: step1Data?.openWaitingRoomBefore,
                        allowRewind: step1Data?.allowRewind,
                        allowPause: step1Data?.allowPause,
                        enableFeedback: step1Data?.feedbackEnabled,
                        recordSession: step1Data?.bbbRecord,
                    }}
                    notifications={{
                        notifyBy: watch('notifyBy'),
                        notifySettings: {
                            onCreate: watch('notifySettings.onCreate'),
                            beforeLiveTime: watch('notifySettings.beforeLiveTime'),
                            onLive: watch('notifySettings.onLive'),
                            onAttendance: watch('notifySettings.onAttendance'),
                        },
                    }}
                    sessions={previewSessions}
                    recurrenceBanner={previewRecurrenceBanner}
                    topLevelDescription={step1Data?.description}
                    courses={courses ?? []}
                    sessionList={sessionList}
                    attendanceOnly={
                        liveSessionSettings.attendanceOnlyMode && !step1Data?.showToLearners
                    }
                />
            </FormProvider>
            {/* Add Custom Field Dialog is now embedded inline via SharedAddCustomFieldDialog */}
        </>
    );
}
