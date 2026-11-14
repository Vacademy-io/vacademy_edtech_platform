import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
// add-course-form.tsx
import React, { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { AddCourseStep1, step1Schema } from './add-course-steps/add-course-step1';
import { AddCourseStep2, step2Schema } from './add-course-steps/add-course-step2';
import { AddCourseStep3 } from './add-course-steps/add-course-step3';
import { toast } from 'sonner';
import {
    convertToApiCourseFormat,
    convertToApiCourseFormatUpdate,
    SessionDetails,
    transformCourseData,
} from '../-utils/helper';
import { useAddCourse } from '@/services/study-library/course-operations/add-course';
import { useNavigate } from '@tanstack/react-router';
import { useAddSubject } from '@/routes/study-library/courses/course-details/subjects/-services/addSubject';
import { useAddModule } from '@/routes/study-library/courses/course-details/subjects/modules/-services/add-module';
import { useAddChapter } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/-services/add-chapter';
import { SubjectType } from '@/routes/study-library/courses/course-details/-components/course-details-page';
import { fetchInstituteDetails } from '@/services/student-list-section/getInstituteDetails';
import { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '../../layout-container/sidebar/utils';
import { CourseDetailsFormValues } from '@/routes/study-library/courses/course-details/-components/course-details-schema';
import { useUpdateCourse } from '@/services/study-library/course-operations/update-course';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useCourseSettings } from '@/hooks/useCourseSettings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';
import {
    getDisplaySettingsFromCache,
    getDisplaySettingsWithFallback,
} from '@/services/display-settings';
import { getTokenDecodedData, getTokenFromCookie, getUserRoles } from '@/lib/auth/sessionUtility';
import { TokenKey, type Authority } from '@/constants/auth/tokens';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSTITUTE_VENDORS } from '@/constants/urls';
import { useQueryClient } from '@tanstack/react-query';
import type { InviteLinkFormValues } from '@/routes/manage-students/invite/-components/create-invite/GenerateInviteLinkSchema';
import { handleGetPaymentDetails } from '@/routes/manage-students/invite/-components/create-invite/-services/get-payments';
import { handleGetReferralProgramDetails } from '@/routes/manage-students/invite/-components/create-invite/-services/referral-services';
import {
    fetchBatchesWithRetry,
    firstFailureMessage,
    setUpInvitesForNewCourse,
    type InviteSetupResult,
} from './-services/course-invite-setup';
import { selectTargetBatches, type CourseBatchDTO } from './-utils/course-invite-payload';
import {
    parseCoursePageJson,
    readCoursePageJsonFromCourseInit,
} from './-utils/course-page-content';
import type { CoursePageStatus } from './add-course-steps/course-page-section';
import { fetchCourseStudyLibraryDetails } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';

export interface Level {
    id: string;
    name: string;
}

export interface Session {
    id: string;
    name: string;
    startDate: string;
    levels: Level[];
}

export type Step1Data = z.infer<typeof step1Schema>;
export type Step2Data = z.infer<typeof step2Schema>;

// Combined form data type
export interface CourseFormData extends Step1Data, Step2Data {
    status?: string;
    created_by_user_id?: string;
    original_course_id?: string | null;
    version_number?: number;
    /**
     * Edit only: true once the course's stored course_page_json was read from course-init.
     * Until then the update omits the field so the backend keeps what is stored.
     */
    coursePageJsonLoaded?: boolean;
}

/**
 * How many batches (package sessions) step 2 has configured, which is how many invite
 * links the payment step will produce. Subgroups create a child batch each, on top of
 * their parent.
 */
function countConfiguredBatches(data: Partial<CourseFormData>): number {
    const sessions = data.sessions ?? [];
    if (sessions.length === 0) return 1;

    let total = 0;
    for (const session of sessions) {
        const levels = session.levels ?? [];
        if (levels.length === 0) {
            total += 1;
            continue;
        }
        for (const level of levels) {
            const subgroups = level.subgroups?.length ?? 0;
            total += subgroups > 0 ? subgroups + 1 : 1;
        }
    }
    return total || 1;
}

// Main wrapper component
export const AddCourseForm = ({
    isEdit,
    initialCourseData,
    getParentPackageSessionId,
}: {
    isEdit?: boolean;
    initialCourseData?: CourseDetailsFormValues;
    /** When editing, use this to send the parent batch id per (session, level) for update-course-details. */
    getParentPackageSessionId?: (params: {
        courseId: string;
        sessionId: string;
        levelId: string;
    }) => string;
}) => {
    // Aliased: both course-create and course-update branches declare their own freshly
    // fetched `instituteDetails` inside their success handlers.
    const { instituteDetails: storeInstituteDetails, getPackageSessionId } =
        useInstituteDetailsStore();
    const addSubjectMutation = useAddSubject();
    const addModuleMutation = useAddModule();
    const addChapterMutation = useAddChapter();
    const queryClient = useQueryClient();
    const { settings: courseSettings, loading: settingsLoading } = useCourseSettings();
    const [roleDisplaySettings, setRoleDisplaySettings] = useState<DisplaySettingsData | null>(
        null
    );

    useEffect(() => {
        let isMounted = true;

        const loadDisplaySettings = async () => {
            try {
                const accessToken = getTokenFromCookie(TokenKey.accessToken);
                const roles = getUserRoles(accessToken);
                const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
                const roleKey = getActiveRoleDisplaySettingsKey();

                const cached = getDisplaySettingsFromCache(roleKey);
                if (cached && isMounted) {
                    setRoleDisplaySettings(cached);
                }

                const latest = await getDisplaySettingsWithFallback(roleKey);
                if (isMounted) {
                    setRoleDisplaySettings(latest);
                }
            } catch (error) {
                console.error('Failed to load display settings for course creation', error);
            }
        };

        loadDisplaySettings();

        return () => {
            isMounted = false;
        };
    }, []);

    const navigate = useNavigate();
    const addCourseMutation = useAddCourse();
    const updateCourseMutation = useUpdateCourse();
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState<Partial<CourseFormData>>(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        initialCourseData ? transformCourseData(initialCourseData) : {}
    );

    const oldFormData = useRef<Partial<CourseFormData>>(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        initialCourseData ? transformCourseData(initialCourseData) : {}
    );
    const [isOpen, setIsOpen] = useState(!isEdit);
    const [isCreating, setIsCreating] = useState(false);
    // Per-batch progress while the payment step writes its invite links.
    const [inviteProgress, setInviteProgress] = useState<{ done: number; total: number } | null>(
        null
    );

    // ADMIN only for now. A teacher's course is created as DRAFT and the approval flow calls
    // createDefaultEnrollInvitesForCourse again on approval — possibly against a copy of the
    // package — so configuring invites here would fight that path.
    const isAdmin = (() => {
        const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
        return !!(
            tokenData?.authorities &&
            Object.values(tokenData.authorities).some((auth: Authority) =>
                auth?.roles?.includes('ADMIN')
            )
        );
    })();

    // Recomputed every render on purpose: caching it in state would let the step count shift
    // under the user as course settings resolve.
    const showPaymentStep =
        !isEdit && isAdmin && courseSettings?.permissions?.allowPaymentOptionChange !== false;

    const steps = showPaymentStep ? [1, 2, 3] : [1, 2];
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    // Labels follow the institute's naming settings (main's 65f6d9fa3d), which landed on
    // the two inline headers this refactor collapsed into renderHeader.
    const stepLabel =
        step === 1
            ? `${courseTerm} Details`
            : step === 2
              ? `${courseTerm} Structure`
              : 'Payment & Enrolment';

    // When editing, refresh form data whenever initialCourseData changes
    // (e.g. after a successful update or switching to a different course).
    useEffect(() => {
        if (!isEdit || !initialCourseData) return;

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const transformed = transformCourseData(initialCourseData) as CourseFormData;
        setFormData(transformed);
        oldFormData.current = transformed;
        setStep(1);
    }, [isEdit, initialCourseData]);

    // The edit form may be filled from the institute-wide init list, which never carries
    // course_page_json (always null). Read it from course-init before the course-page
    // section can be edited, so a save can neither clear nor overwrite FAQs unseen.
    const [coursePageLoadFailed, setCoursePageLoadFailed] = useState(false);
    const editCourseId = isEdit ? formData.id : undefined;
    const coursePageLoaded = !!formData.coursePageJsonLoaded;
    useEffect(() => {
        if (!isEdit || !isOpen || !editCourseId || coursePageLoaded) return undefined;
        let cancelled = false;
        setCoursePageLoadFailed(false);
        fetchCourseStudyLibraryDetails(editCourseId)
            .then((data: unknown) => {
                if (cancelled) return;
                const { loaded, raw } = readCoursePageJsonFromCourseInit(data, editCourseId);
                if (!loaded) {
                    setCoursePageLoadFailed(true);
                    return;
                }
                const coursePage = parseCoursePageJson(raw);
                setFormData((prev) =>
                    prev.id === editCourseId
                        ? { ...prev, coursePage, coursePageJsonLoaded: true }
                        : prev
                );
                oldFormData.current = {
                    ...oldFormData.current,
                    coursePage,
                    coursePageJsonLoaded: true,
                };
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                console.warn('[edit-course] could not load course page content', error);
                setCoursePageLoadFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [isEdit, isOpen, editCourseId, coursePageLoaded]);

    const coursePageStatus: CoursePageStatus =
        !isEdit || coursePageLoaded ? 'ready' : coursePageLoadFailed ? 'unavailable' : 'loading';

    const handleStep1Submit = (data: Step1Data) => {
        setFormData((prev) => ({ ...prev, ...data }));
        setStep(2);
    };

    function findIdByPackageId(data: BatchForSessionType[], packageId: string): string {
        return data
            .filter((item) => item.package_dto?.id === packageId)
            .map((item) => item.id)
            .join(',');
    }

    function retainNewActiveLevels(sessions: SessionDetails[]) {
        return sessions.map((session) => ({
            ...session,
            levels: (session.levels ?? []).filter(
                (level) => level.new_level === false && level.package_session_status === 'ACTIVE'
            ),
        }));
    }

    function findUnmatchedBatchIds(
        sessionsData: SessionDetails[],
        batchesData: BatchForSessionType[],
        courseId?: string
    ): string[] {
        /* ------- build a fast‑lookup map: sessionId → Set(levelIds) ------- */
        const sessionLevelMap = new Map<string, Set<string>>();

        sessionsData.forEach((session) => {
            const levels = session.levels ?? [];
            sessionLevelMap.set(session.id, new Set(levels.map((l) => l.id)));
        });

        /* ------- walk the batches and collect the “missing” ones ------- */
        return batchesData
            .filter((batch) => {
                if (courseId && batch.package_dto?.id !== courseId) return false; // course filter
                const levelSet = sessionLevelMap.get(batch.session.id);
                return !levelSet || !levelSet.has(batch.level.id); // session missing OR level missing
            })
            .map((batch) => batch.id);
    }

    /** The institute's payment vendor, or null — the invite falls back to STRIPE. */
    const fetchInstituteVendor = async () => {
        try {
            const instituteId = getInstituteId();
            if (!instituteId) return null;
            const response = await authenticatedAxiosInstance.get(
                `${GET_INSTITUTE_VENDORS}?instituteId=${instituteId}`
            );
            const vendors = (response.data ?? []) as { vendor: string; vendor_id: string }[];
            return vendors[0] ?? null;
        } catch (error) {
            console.warn('[add-course] could not read institute vendors', error);
            return null;
        }
    };

    /**
     * Attaches the payment step's plan to every batch of the course just created.
     *
     * Runs last and never throws: the course is already committed, so a failure here is
     * reported as partial success rather than losing the course.
     */
    const setUpPaymentForCourse = async ({
        courseId,
        courseName,
        batches,
        sessions,
        inviteValues,
        customFieldsDirty,
    }: {
        courseId: string;
        courseName: string;
        batches: CourseBatchDTO[];
        sessions: SessionDetails[];
        inviteValues: InviteLinkFormValues;
        customFieldsDirty: boolean;
    }): Promise<InviteSetupResult | null> => {
        const instituteId = getInstituteId();
        if (!instituteId || batches.length === 0) return null;

        const targetBatches = selectTargetBatches(batches, sessions);
        if (targetBatches.length === 0) return null;

        setInviteProgress({ done: 0, total: targetBatches.length });

        // fetchQuery, not the step's rendered data: a plan created moments ago may not be in
        // the component's cached copy yet, and a selectedPlan missing from paymentsData
        // produces a payload with no payment_option.id, which the backend rejects.
        const [paymentsData, referralProgramDetails, instituteVendor] = await Promise.all([
            queryClient.fetchQuery(handleGetPaymentDetails()),
            queryClient.fetchQuery(handleGetReferralProgramDetails()),
            fetchInstituteVendor(),
        ]);

        const result = await setUpInvitesForNewCourse({
            instituteId,
            courseId,
            courseName,
            targetBatches,
            inviteValues,
            customFieldsDirty,
            paymentsData,
            referralProgramDetails,
            instituteLogoFileId: storeInstituteDetails?.institute_logo_file_id || '',
            instituteVendor,
            onProgress: (done, total) => setInviteProgress({ done, total }),
        });

        // These all cache for an hour, so without this the admin lands on the Invite Links
        // tab and sees nothing.
        queryClient.invalidateQueries({ queryKey: ['GET_INVITE_LINKS'] });
        queryClient.invalidateQueries({ queryKey: ['inviteList'] });
        queryClient.invalidateQueries({ queryKey: ['default-invite'] });
        queryClient.invalidateQueries({ queryKey: ['course-default-invite-code'] });

        return result;
    };

    const runCreateOrUpdate = (
        finalData: Partial<CourseFormData>,
        inviteValues: InviteLinkFormValues | null,
        customFieldsDirty = false
    ) => {
        setIsCreating(true);
        const newSubject: SubjectType = {
            id: '', // Let backend assign ID
            subject_name: 'DEFAULT',
            subject_code: '',
            credit: 0,
            thumbnail_id: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            modules: [], // Add empty modules array
        };

        const newModule = {
            id: '',
            module_name: 'DEFAULT',
            description: '',
            status: '',
            thumbnail_id: '',
        };

        const newChapter = {
            id: '', // Let backend assign ID
            chapter_name: 'DEFAULT',
            status: 'ACTIVE',
            file_id: '',
            description: '',
            chapter_order: 0,
        };

        // Format the data using the helper function
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const formattedData = convertToApiCourseFormat(finalData);
        const formattedDataUpdate = convertToApiCourseFormatUpdate(
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            oldFormData.current,
            finalData,
            // The edit page's map wins (it knows parent batches); fall back to the
            // institute store so a miss never sends package_session_id='' — the
            // backend treats that as "no batch" and drops the level's changes.
            isEdit && getParentPackageSessionId
                ? (params: { courseId: string; sessionId: string; levelId: string }) =>
                      getParentPackageSessionId(params) || getPackageSessionId(params) || ''
                : getPackageSessionId
        );

        const previousSessions = retainNewActiveLevels(formattedDataUpdate.sessions);

        if (isEdit) {
            updateCourseMutation.mutate(
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                { requestData: formattedDataUpdate },
                {
                    onSuccess: async () => {
                        try {
                            const instituteDetails = await fetchInstituteDetails();

                            // Wait for institute details and validate
                            if (!instituteDetails?.batches_for_sessions) {
                                console.warn(
                                    'Institute details not loaded, skipping structure creation'
                                );
                                toast.success(
                                    `${getTerminology(ContentTerms.Course, SystemTerms.Course)} updated successfully`
                                );
                                setIsOpen(false);
                                setStep(1);
                                setFormData({});
                                return;
                            }

                            const unmatchedPackageSessionIds = findUnmatchedBatchIds(
                                previousSessions,
                                instituteDetails.batches_for_sessions,
                                formattedDataUpdate.id
                            );

                            // Only create structure if there are unmatched batches
                            if (unmatchedPackageSessionIds.length > 0) {
                                const packageSessionIdsStr = unmatchedPackageSessionIds.join(',');

                                if (formattedData.course_depth === 2) {
                                    const subjectResponse = await addSubjectMutation.mutateAsync({
                                        subject: newSubject,
                                        packageSessionIds: packageSessionIdsStr,
                                    });

                                    const moduleResponse = await addModuleMutation.mutateAsync({
                                        subjectId: subjectResponse.data.id,
                                        packageSessionIds: packageSessionIdsStr,
                                        module: newModule,
                                    });

                                    await addChapterMutation.mutateAsync({
                                        subjectId: subjectResponse.data.id,
                                        moduleId: moduleResponse.data.id,
                                        commaSeparatedPackageSessionIds: packageSessionIdsStr,
                                        chapter: newChapter,
                                    });
                                } else if (formattedData.course_depth === 3) {
                                    const subjectResponse = await addSubjectMutation.mutateAsync({
                                        subject: newSubject,
                                        packageSessionIds: packageSessionIdsStr,
                                    });

                                    await addModuleMutation.mutateAsync({
                                        subjectId: subjectResponse.data.id,
                                        packageSessionIds: packageSessionIdsStr,
                                        module: newModule,
                                    });
                                } else if (formattedData.course_depth === 4) {
                                    await addSubjectMutation.mutateAsync({
                                        subject: newSubject,
                                        packageSessionIds: packageSessionIdsStr,
                                    });
                                }
                            } else {
                                console.log(
                                    'No unmatched batches found - skipping structure creation'
                                );
                            }

                            toast.success(
                                `${getTerminology(ContentTerms.Course, SystemTerms.Course)} updated successfully`
                            );
                            setIsOpen(false);
                            setStep(1);
                            setFormData({});
                        } catch (err) {
                            console.error('Error in course update flow:', err);
                            toast.error(
                                `Failed to update ${getTerminology(ContentTerms.Course, SystemTerms.Course)}`
                            );
                        }
                    },
                    onError: () => {
                        toast.error(
                            `Failed to update ${getTerminology(ContentTerms.Course, SystemTerms.Course)}`
                        );
                        setIsCreating(false);
                    },
                }
            );
        } else {
            addCourseMutation.mutate(
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                { requestData: formattedData },
                {
                    onSuccess: async (response) => {
                        try {
                            let packageSessionId = '';
                            let batches: CourseBatchDTO[] = [];

                            try {
                                // Bounded poll rather than a blind sleep: add-course is
                                // transactional, so this usually returns on the first try.
                                batches = await fetchBatchesWithRetry(response.data);
                                if (batches.length > 0) {
                                    packageSessionId = batches.map((batch) => batch.id).join(',');
                                }
                            } catch (error) {
                                console.warn('Failed to get course batches directly:', error);
                            }

                            if (!packageSessionId) {
                                const instituteDetails = await fetchInstituteDetails();
                                if (!instituteDetails?.batches_for_sessions) {
                                    throw new Error('Institute details not loaded');
                                }
                                packageSessionId = findIdByPackageId(
                                    instituteDetails.batches_for_sessions,
                                    response.data
                                );
                                if (!packageSessionId) {
                                    throw new Error(
                                        `Package session ID not found for the created ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`
                                    );
                                }
                            }

                            // Always seed DEFAULT subject/module/chapter per depth.
                            // Copy-from-batch is now a separate user action on the
                            // course-details page (Outline / Content Structure tab),
                            // scoped to the currently-viewed package_session.
                            if (formattedData.course_depth === 2) {
                                const subjectResponse = await addSubjectMutation.mutateAsync({
                                    subject: newSubject,
                                    packageSessionIds: packageSessionId,
                                });

                                const moduleResponse = await addModuleMutation.mutateAsync({
                                    subjectId: subjectResponse.data.id,
                                    packageSessionIds: packageSessionId,
                                    module: newModule,
                                });

                                await addChapterMutation.mutateAsync({
                                    subjectId: subjectResponse.data.id,
                                    moduleId: moduleResponse.data.id,
                                    commaSeparatedPackageSessionIds: packageSessionId,
                                    chapter: newChapter,
                                });
                            } else if (formattedData.course_depth === 3) {
                                const subjectResponse = await addSubjectMutation.mutateAsync({
                                    subject: newSubject,
                                    packageSessionIds: packageSessionId,
                                });

                                await addModuleMutation.mutateAsync({
                                    subjectId: subjectResponse.data.id,
                                    packageSessionIds: packageSessionId,
                                    module: newModule,
                                });
                            } else if (formattedData.course_depth === 4) {
                                await addSubjectMutation.mutateAsync({
                                    subject: newSubject,
                                    packageSessionIds: packageSessionId,
                                });
                            }

                            // Payment / invite setup is the last, non-fatal phase. Its own
                            // try/catch keeps a failure here (a dead payment-options call,
                            // say) from reaching the outer catch, which would skip the
                            // navigate and strand the admin on step 3 with the course
                            // already created.
                            let inviteResult: InviteSetupResult | null = null;
                            if (inviteValues) {
                                try {
                                    inviteResult = await setUpPaymentForCourse({
                                        courseId: response.data,
                                        courseName: formattedData.course_name,
                                        batches,
                                        sessions: formattedData.sessions,
                                        inviteValues,
                                        customFieldsDirty,
                                    });
                                } catch (error) {
                                    console.error('[add-course] payment setup failed', error);
                                    inviteResult = null;
                                }
                            }

                            if (!inviteValues || !inviteResult) {
                                if (inviteValues && !inviteResult) {
                                    // We never got usable batches back, so there was nothing
                                    // to attach the plan to.
                                    toast.warning(
                                        `${courseTerm} created, but payment setup could not be saved. Set it up from the Invite Links tab.`,
                                        { duration: 6000 }
                                    );
                                } else {
                                    toast.success(`${courseTerm} created successfully`);
                                }
                            } else if (inviteResult.failed.length === 0) {
                                toast.success(`${courseTerm} created with payment setup`);
                            } else {
                                const total =
                                    inviteResult.failed.length + inviteResult.succeeded.length;
                                const reason = firstFailureMessage(inviteResult.failed);
                                const scope =
                                    inviteResult.succeeded.length === 0
                                        ? 'could not be saved'
                                        : `failed for ${inviteResult.failed.length} of ${total} batches`;
                                toast.warning(
                                    `${courseTerm} created, but payment setup ${scope}. Set it up from the Invite Links tab.` +
                                        (reason ? ` (${reason})` : ''),
                                    { duration: 6000 }
                                );
                            }

                            setIsOpen(false);
                            setStep(1);
                            setFormData({});
                            setInviteProgress(null);
                            navigate({
                                to: `/study-library/courses/course-details?courseId=${response.data}`,
                            });
                        } catch (err) {
                            console.error('Error in course creation flow:', err);
                            toast.error(
                                err instanceof Error
                                    ? err.message
                                    : `Error creating ${getTerminology(ContentTerms.Course, SystemTerms.Course)}`
                            );
                        } finally {
                            setIsCreating(false);
                            setInviteProgress(null);
                        }
                    },
                    onError: () => {
                        toast.error(
                            `Failed to create ${getTerminology(ContentTerms.Course, SystemTerms.Course)}`
                        );
                        setIsCreating(false);
                        setInviteProgress(null);
                    },
                }
            );
        }
    };

    const handleStep2Submit = (data: Step2Data) => {
        const merged = { ...formData, ...data };
        setFormData(merged);

        // With the payment step enabled, step 2 only collects — the course is created from
        // step 3 so the invite can be configured in the same run.
        if (showPaymentStep) {
            setStep(3);
            return;
        }

        runCreateOrUpdate(merged, null);
    };

    const handleStep3Submit = (values: InviteLinkFormValues, customFieldsDirty: boolean) =>
        runCreateOrUpdate(formData, values, customFieldsDirty);

    const handleStep3Skip = () => runCreateOrUpdate(formData, null);

    const handleBack = () => {
        setStep((previous) => Math.max(1, previous - 1));
    };

    const renderStep = () => {
        if (step === 3) {
            return (
                <AddCourseStep3
                    step1Data={formData as Step1Data}
                    batchCount={countConfiguredBatches(formData)}
                    onBack={handleBack}
                    onSubmit={handleStep3Submit}
                    onSkip={handleStep3Skip}
                    isLoading={isCreating}
                    progress={inviteProgress}
                />
            );
        }
        if (step === 2) {
            return (
                <AddCourseStep2
                    onBack={handleBack}
                    onSubmit={handleStep2Submit}
                    initialData={formData as Step2Data}
                    isLoading={isCreating}
                    disableCreate={isCreating}
                    isEdit={isEdit}
                    courseSettings={courseSettings}
                    settingsLoading={settingsLoading}
                    courseCreationDisplay={roleDisplaySettings?.courseCreation}
                    courseId={formData.id}
                    isFinalStep={!showPaymentStep}
                />
            );
        }
        return (
            <AddCourseStep1
                onNext={handleStep1Submit}
                initialData={formData as Step1Data}
                courseSettings={courseSettings}
                settingsLoading={settingsLoading}
                coursePageStatus={coursePageStatus}
            />
        );
    };

    const renderHeader = () => (
        <div className="bg-primary-50 px-4 pb-3 pt-4">
            <div className="flex items-center justify-between gap-4">
                <h1 className="font-semibold text-primary-500">
                    {isEdit ? 'Edit' : 'Create'}{' '}
                    {getTerminology(ContentTerms.Course, SystemTerms.Course)} - Step {step} of{' '}
                    {steps.length}
                </h1>
                <span className="text-xs font-medium text-primary-500/80">{stepLabel}</span>
            </div>
            <div className="mt-3 flex items-center gap-2">
                {steps.map((s) => (
                    <React.Fragment key={s}>
                        <div
                            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                                step >= s ? 'bg-primary-500' : 'bg-primary-200/60'
                            }`}
                        />
                        {s < steps.length && (
                            <div
                                className={`size-2 rounded-full transition-all duration-300 ${
                                    step > s ? 'bg-primary-500' : 'bg-primary-200/60'
                                }`}
                            />
                        )}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );

    // For non-edit mode, render the form directly without dialog
    if (!isEdit) {
        return (
            <div className="flex h-full flex-col">
                {renderHeader()}
                {renderStep()}
            </div>
        );
    }

    // For edit mode, use the dialog
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <MyButton type="button" buttonType="primary" layoutVariant="default" scale="small">
                    Edit {getTerminology(ContentTerms.Course, SystemTerms.Course)}
                </MyButton>
            </DialogTrigger>
            <DialogContent
                className="z-[10000] flex !h-[97%] !max-h-[97%] w-[97%] flex-col overflow-hidden p-0" /* design-lint-ignore: full-viewport course editor above the app overlays (pre-existing) */
            >
                <div className="flex h-full flex-col">
                    {renderHeader()}
                    {renderStep()}
                </div>
            </DialogContent>
        </Dialog>
    );
};
