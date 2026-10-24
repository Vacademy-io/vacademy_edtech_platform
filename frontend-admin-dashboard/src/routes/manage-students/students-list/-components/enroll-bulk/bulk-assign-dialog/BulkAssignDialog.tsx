import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useBulkAssign } from '../../../-hooks/useBulkAssign';
import {
    useParentLink,
    ParentLinkRequest,
    useLinkNewGuardian,
    LinkNewGuardianRequest,
} from '../../../-hooks/useParentLink';
import {
    AdmissionPackageState,
    BulkAssignRequest,
    BulkAssignResponse,
    BulkEnrollOptions,
    isChipGuardianReady,
    isSubOrgSelectionReady,
    SelectedLearner,
    SelectedPackageSession,
    subOrgRolesCsv,
} from '../../../-types/bulk-assign-types';
import { Step1LearnerSelector } from './steps/Step1LearnerSelector';
import { Step2CourseSelector } from './steps/Step2CourseSelector';
import { Step3EnrollConfig } from './steps/Step3EnrollConfig';
import { Step4SubOrg } from './steps/Step4SubOrg';
import { Step4Preview } from './steps/Step4Preview';
import { toAdmissionPackageRequest } from '../components/AdmissionPackagePanel';
import { cn } from '@/lib/utils';
import {
    getAdminDiscountValidationError,
    toAdminDiscountPayload,
} from '@/services/admin-discounts';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useCourseSettings } from '@/hooks/useCourseSettings';
import { toOfflinePaymentDetailsPayload } from '@/services/offline-payment-modes';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';

interface BulkAssignDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
    /** When provided, pre-selects this course/batch in Step 2 */
    initialPackageSessionId?: string;
    /**
     * Opens the wizard for ONE learner who is already known — the lead/student side view
     * knows exactly who it is, so Step 1 has nothing to ask and is dropped. Everything
     * after it (invite, CPO instalments, discount, preview) is the same wizard, which is
     * the point: the side view used to run a thinner copy of this flow that had no
     * instalment or discount editing at all.
     */
    initialLearner?: { userId: string; email: string; name: string };
}

/**
 * Wizard steps, in order. 'suborg' only appears when at least one selected batch is
 * org-associated, so the indices shift and must never be hard-coded.
 */
type StepKey = 'learners' | 'courses' | 'config' | 'suborg' | 'preview';

export const BulkAssignDialog = ({
    open,
    onOpenChange,
    onSuccess,
    initialPackageSessionId,
    initialLearner,
}: BulkAssignDialogProps) => {
    const { t } = useTranslation('manageStudentsBulkAssignDialog');
    const { getPackageWiseLevels, instituteDetails } = useInstituteDetailsStore();
    const { enrollmentNotifications } = useCourseSettings();
    const showNotifyLearners = enrollmentNotifications?.showNotifyLearners ?? true;
    const showSendCredentials = enrollmentNotifications?.showSendCredentials ?? true;

    // Build initial selection from initialPackageSessionId
    const buildInitialSelection = (): SelectedPackageSession[] => {
        if (!initialPackageSessionId) return [];
        const groups = getPackageWiseLevels();
        for (const group of groups) {
            for (const level of group.level) {
                if (level.package_session_id === initialPackageSessionId) {
                    return [{
                        packageSessionId: initialPackageSessionId,
                        courseName: group.package_dto.package_name,
                        sessionName: '',
                        levelName: level.level_dto.level_name,
                        enrollInviteId: null,
                        accessDays: null,
                    }];
                }
            }
        }
        return [];
    };

    const [step, setStep] = useState(0);
    const [selectedLearners, setSelectedLearners] = useState<SelectedLearner[]>([]);
    const [selectedPackageSessions, setSelectedPackageSessions] = useState<
        SelectedPackageSession[]
    >([]);

    // Stamp `is_org_associated` (read off the institute-details store, the only place the
    // flag is available client-side) onto each selection. Batches carrying it are sold to
    // organisations, which is what makes the sub-org step appear.
    useEffect(() => {
        const batches = instituteDetails?.batches_for_sessions;
        if (!batches?.length || selectedPackageSessions.length === 0) return;
        let changed = false;
        const next = selectedPackageSessions.map((ps) => {
            const flag = batches.some(
                (b) => b.id === ps.packageSessionId && b.is_org_associated === true
            );
            if (ps.isOrgAssociated === flag) return ps;
            changed = true;
            return { ...ps, isOrgAssociated: flag };
        });
        if (changed) setSelectedPackageSessions(next);
    }, [selectedPackageSessions, instituteDetails]);

    const needsSubOrgStep = selectedPackageSessions.some((ps) => ps.isOrgAssociated);

    const stepKeys: StepKey[] = [
        // Nothing to pick when the caller already named the learner.
        ...(initialLearner ? [] : (['learners'] as StepKey[])),
        'courses',
        'config',
        ...(needsSubOrgStep ? (['suborg'] as StepKey[]) : []),
        'preview',
    ];
    const stepLabels: Record<StepKey, string> = {
        learners: t('stepper.learners', {
            term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
        }),
        courses: t('stepper.courses', {
            term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
        }),
        config: t('stepper.config'),
        suborg: t('stepper.suborg'),
        preview: t('stepper.preview'),
    };
    const STEPS = stepKeys.map((key) => stepLabels[key]);
    const currentStep: StepKey = stepKeys[step] ?? 'learners';
    const previewIndex = stepKeys.length - 1;

    // Seed the single known learner so the wizard opens straight on the course step.
    // Keyed on the VALUES, not the object: callers build this inline, so depending on
    // identity would re-seed on every render and never settle.
    const seedUserId = initialLearner?.userId;
    const seedEmail = initialLearner?.email;
    const seedName = initialLearner?.name;
    useEffect(() => {
        if (!open || !seedUserId) return;
        setSelectedLearners([
            {
                type: 'existing',
                userId: seedUserId,
                email: seedEmail ?? '',
                name: seedName ?? '',
            },
        ]);
    }, [open, seedUserId, seedEmail, seedName]);

    // Pre-select course when dialog opens with an initialPackageSessionId
    useEffect(() => {
        if (open && initialPackageSessionId) {
            const initial = buildInitialSelection();
            if (initial.length > 0) {
                setSelectedPackageSessions(initial);
            }
        }
    }, [open, initialPackageSessionId]);
    const [options, setOptions] = useState<BulkEnrollOptions>({
        duplicateHandling: 'SKIP',
        notifyLearners: false,
        sendCredentials: false,
        transactionId: '',
        paymentDate: '',
    });
    const [previewResponse, setPreviewResponse] = useState<BulkAssignResponse | null>(null);
    // Two or more courses enrolled as one admission package (Step 3); null = each on its own.
    const [admissionPackage, setAdmissionPackage] = useState<AdmissionPackageState | null>(null);
    const packageOn = !!admissionPackage?.enabled && selectedPackageSessions.length >= 2;
    useEffect(() => {
        if (admissionPackage && selectedPackageSessions.length < 2) setAdmissionPackage(null);
    }, [admissionPackage, selectedPackageSessions.length]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Inline per-chip errors from a failed guardian-link resolution (Step 1, 'existing' chips only).
    const [guardianLinkErrors, setGuardianLinkErrors] = useState<Record<number, string>>({});
    const [isResolvingGuardianLinks, setIsResolvingGuardianLinks] = useState(false);

    const { mutateAsync: bulkAssign } = useBulkAssign();
    const { mutateAsync: linkGuardian } = useParentLink();
    const { mutateAsync: linkNewGuardian } = useLinkNewGuardian();

    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];

    const buildRequest = (dryRun: boolean): BulkAssignRequest => {
        // Defensive: a chip flagged 'is_guardian' must never be enrolled — its
        // resolved student replaces it in `selectedLearners` once Step 1's
        // guardian-link resolution succeeds (see resolveStep1GuardianLinks),
        // so this only guards against an unresolved leftover ever reaching here.
        const isEnrollmentTarget = (l: SelectedLearner) => l.parentLink?.mode !== 'is_guardian';

        const existingUserIds = selectedLearners
            .filter((l): l is Extract<SelectedLearner, { type: 'existing' }> => l.type === 'existing' && isEnrollmentTarget(l))
            .map((l) => l.userId);

        const newUsers = selectedLearners
            .filter((l): l is Extract<SelectedLearner, { type: 'new' }> => l.type === 'new' && isEnrollmentTarget(l))
            .map((l) => l.newUser);

        return {
            institute_id: INSTITUTE_ID || '',
            user_ids: existingUserIds.length > 0 ? existingUserIds : undefined,
            new_users: newUsers.length > 0 ? newUsers : undefined,
            assignments: selectedPackageSessions.map((ps) => ({
                package_session_id: ps.packageSessionId,
                // Auto mode sends the invite the row showed: left null, the backend only finds a
                // DEFAULT invite and otherwise enrolls through a new free one.
                enroll_invite_id: ps.enrollInviteId ?? ps.autoResolvedInviteId ?? null,
                access_days: ps.accessDays ?? null,
                cpo_config: !packageOn && ps.cpoConfig
                    ? {
                          ...ps.cpoConfig,
                          // discount_split is the wizard's own; the rows already carry the result.
                          installment_schedule: ps.cpoConfig.installment_schedule
                              ? { ...ps.cpoConfig.installment_schedule, discount_split: undefined }
                              : ps.cpoConfig.installment_schedule,
                          payment_details:
                              ps.cpoConfig.payment_mode === 'OFFLINE'
                                  ? toOfflinePaymentDetailsPayload(ps.cpoConfig.payment_details)
                                  : null,
                      }
                    : null,
                // Omitted entirely when "No discount" so the request is unchanged from before.
                ...(!packageOn && toAdminDiscountPayload(ps.adminDiscount)
                    ? { admin_discount: toAdminDiscountPayload(ps.adminDiscount) }
                    : {}),
                // Only org-associated batches carry a sub-org; sending it for a normal batch
                // would be ignored by the backend but is noise, so it's omitted entirely.
                ...(ps.isOrgAssociated
                    ? ps.subOrgSkipped
                        ? { skip_sub_org: true }
                        : {
                              sub_org_id: ps.subOrgId ?? null,
                              sub_org_roles: subOrgRolesCsv(ps.subOrgRole),
                              new_sub_org:
                                  !ps.subOrgId && ps.newSubOrg?.name?.trim()
                                      ? {
                                            name: ps.newSubOrg.name.trim(),
                                            email: ps.newSubOrg.email?.trim() || null,
                                            mobile_number:
                                                ps.newSubOrg.mobileNumber?.trim() || null,
                                        }
                                      : null,
                          }
                    : {}),
            })),
            options: {
                duplicate_handling: options.duplicateHandling,
                // When the course-setting visibility is off, the toggle is hidden in the
                // dialog and the corresponding field is forced to false in the request —
                // so a stale `true` from state can never reach the backend.
                notify_learners: showNotifyLearners ? options.notifyLearners : false,
                send_credentials: showSendCredentials ? options.sendCredentials : false,
                transaction_id: options.transactionId || undefined,
                payment_date: options.paymentDate || undefined,
                // Only with an actual payment: the fields preselect a mode on their own. And only
                // while the shared fields are shown — hidden ones (every course records its
                // payment in its own fee panel) must not reach a payment the admin never saw.
                ...(!packageOn &&
                (options.paymentDate || options.transactionId) &&
                selectedPackageSessions.some((ps) => !ps.ownsPayment)
                    ? { payment_details: toOfflinePaymentDetailsPayload(options.paymentDetails) }
                    : {}),
                dry_run: dryRun,
            },
            ...(packageOn && admissionPackage
                ? {
                      admission_package: toAdmissionPackageRequest(
                          admissionPackage,
                          selectedPackageSessions.reduce((sum, ps) => sum + (ps.packageFee ?? 0), 0)
                      ),
                  }
                : {}),
        };
    };

    const buildParentLinkRequest = (
        anchorUserId: string,
        pl: SelectedLearner['parentLink']
    ): ParentLinkRequest | null => {
        if (!pl || pl.mode === 'none') return null;
        const direction: ParentLinkRequest['direction'] =
            pl.mode === 'is_guardian' ? 'PARENT_ADDS_STUDENT' : 'STUDENT_ADDS_PARENT';
        const person = pl.mode === 'is_guardian' ? pl.student : pl.guardian;
        const base = {
            institute_id: INSTITUTE_ID || '',
            direction,
            anchor_user_id: anchorUserId,
        };
        if (person.kind === 'create_new') {
            return {
                ...base,
                mode: 'CREATE_NEW',
                new_full_name: person.fullName,
                new_email: person.email,
                new_mobile_number: person.mobileNumber || undefined,
            };
        }
        return {
            ...base,
            mode: 'LINK_EXISTING',
            existing_user_id: person.userId,
        };
    };

    const extractErrorMessage = (reason: unknown): string => {
        const err = reason as { response?: { data?: { message?: string } }; message?: string };
        return err?.response?.data?.message || err?.message || t('errors.guardianLinkFallback');
    };

    /**
     * Builds the /parent-link/v1/link-new-guardian request for a 'new' chip
     * flagged 'is_guardian'. Unlike buildParentLinkRequest, this never needs
     * a real anchor id: the guardian is created fresh from the chip's own
     * manually-entered newUser fields, and the endpoint creates the guardian
     * unconditionally (it's specifically for the "guardian doesn't exist as
     * any user yet" case).
     */
    const buildLinkNewGuardianRequest = (
        l: Extract<SelectedLearner, { type: 'new' }>
    ): LinkNewGuardianRequest | null => {
        if (!l.parentLink || l.parentLink.mode !== 'is_guardian') return null;
        const student = l.parentLink.student;
        const base = {
            institute_id: INSTITUTE_ID || '',
            guardian_full_name: l.newUser.full_name || '',
            guardian_email: l.newUser.email || '',
            guardian_mobile_number: l.newUser.mobile_number || undefined,
        };
        if (student.kind === 'create_new') {
            return {
                ...base,
                mode: 'CREATE_NEW',
                student_full_name: student.fullName,
                student_email: student.email || undefined,
                student_mobile_number: student.mobileNumber || undefined,
            };
        }
        return {
            ...base,
            mode: 'LINK_EXISTING',
            student_existing_user_id: student.userId,
        };
    };

    /**
     * Resolves guardian-link choices BEFORE advancing past Step 1, for the
     * two cases that don't need a real, backend-minted enrollment id:
     *  - 'existing' chips with any guardian-link choice — their anchor id is
     *    already real, so /parent-link/v1/link can fire right away.
     *  - 'new' chips flagged 'is_guardian' — /parent-link/v1/link-new-guardian
     *    creates the guardian fresh from the chip's own manually-entered
     *    info, so it never needs an anchor either. A chip flagged as the
     *    guardian must never reach the enrollment call at all (there's no
     *    "enroll this chip" step to defer to for it), so this MUST run here
     *    and not after enrollment.
     *
     * Runs every chip's call in parallel (both groups together, via
     * Promise.all over two Promise.allSettled batches); blocks progression
     * (returns false) until every call has settled.
     *
     * On success for an 'is_guardian' chip (either group), the chip's own
     * target is swapped to the resolved student, typed as an 'existing'
     * chip — the guardian itself must never be enrolled, and the swapped
     * chip now flows through Step2/Step3/Step4 exactly like any other
     * resolved chip.
     *
     * 'add_guardian' on 'new' chips is NOT handled here — see
     * resolveNewChipGuardianLinks (it needs a real post-enrollment id).
     */
    const resolveStep1GuardianLinks = async (): Promise<boolean> => {
        const existingTargets = selectedLearners
            .map((l, idx) => ({ l, idx }))
            .filter(
                (entry): entry is { l: Extract<SelectedLearner, { type: 'existing' }>; idx: number } =>
                    entry.l.type === 'existing' && !!entry.l.parentLink && entry.l.parentLink.mode !== 'none'
            );

        const newGuardianTargets = selectedLearners
            .map((l, idx) => ({ l, idx }))
            .filter(
                (entry): entry is { l: Extract<SelectedLearner, { type: 'new' }>; idx: number } =>
                    entry.l.type === 'new' && !!entry.l.parentLink && entry.l.parentLink.mode === 'is_guardian'
            );

        if (existingTargets.length === 0 && newGuardianTargets.length === 0) return true;

        const [existingSettled, newGuardianSettled] = await Promise.all([
            Promise.allSettled(
                existingTargets.map(({ l }) => {
                    const request = buildParentLinkRequest(l.userId, l.parentLink);
                    if (!request) return Promise.reject(new Error(t('errors.invalidGuardianLinkSelection')));
                    return linkGuardian(request);
                })
            ),
            Promise.allSettled(
                newGuardianTargets.map(({ l }) => {
                    const request = buildLinkNewGuardianRequest(l);
                    if (!request) return Promise.reject(new Error(t('errors.invalidGuardianLinkSelection')));
                    return linkNewGuardian(request);
                })
            ),
        ]);

        const nextLearners = [...selectedLearners];
        const nextErrors: Record<number, string> = {};
        let allOk = true;

        existingSettled.forEach((result, i) => {
            const target = existingTargets[i];
            if (!target) return;
            const { l, idx } = target;
            if (result.status === 'fulfilled') {
                if (l.parentLink?.mode === 'is_guardian') {
                    const student = l.parentLink.student;
                    const resolvedName = student.kind === 'create_new' ? student.fullName : student.name;
                    const resolvedEmail = student.email;
                    nextLearners[idx] = {
                        type: 'existing',
                        userId: result.value.student_user_id,
                        name: resolvedName || l.name,
                        email: resolvedEmail || l.email,
                        parentLink: { mode: 'none' },
                    };
                }
            } else {
                allOk = false;
                nextErrors[idx] = extractErrorMessage(result.reason);
            }
        });

        newGuardianSettled.forEach((result, i) => {
            const target = newGuardianTargets[i];
            if (!target) return;
            const { l, idx } = target;
            if (result.status === 'fulfilled') {
                const student = l.parentLink?.mode === 'is_guardian' ? l.parentLink.student : undefined;
                const resolvedName =
                    (student?.kind === 'create_new' ? student.fullName : student?.name) ||
                    l.newUser.full_name;
                const resolvedEmail = student?.email || l.newUser.email;
                nextLearners[idx] = {
                    type: 'existing',
                    userId: result.value.student_user_id,
                    name: resolvedName,
                    email: resolvedEmail,
                    parentLink: { mode: 'none' },
                };
            } else {
                allOk = false;
                nextErrors[idx] = extractErrorMessage(result.reason);
            }
        });

        setSelectedLearners(nextLearners);
        setGuardianLinkErrors(nextErrors);
        return allOk;
    };

    /**
     * Resolves guardian-link choices for 'new' chips AFTER the real,
     * non-dry-run bulkAssign call succeeds.
     *
     * Why deferred: `new_users[]` only get real ids when the backend actually
     * creates them (BulkAssignmentService.bulkAssign — dry-run uses
     * placeholder ids; only `!dryRun` calls
     * createUserFromAuthServiceForLearnerEnrollment). /parent-link/v1/link
     * requires a real anchor_user_id, so a 'new' chip's guardian link can't
     * be resolved before this point — there is no "create user without
     * enrolling" path reachable from this dialog.
     *
     * Only 'add_guardian' is reachable here: 'is_guardian' on 'new' chips is
     * resolved earlier, in the pre-Step2 phase (see resolveStep1GuardianLinks),
     * via /parent-link/v1/link-new-guardian — which creates the guardian
     * fresh, so it doesn't need a real enrollment id and never reaches this
     * post-enrollment path.
     *
     * Correlates each 'new' chip to its real created id by matching email
     * against the bulkAssign response's `results[].user_email` — the most
     * reliable key available on that response shape.
     */
    const resolveNewChipGuardianLinks = async (result: BulkAssignResponse) => {
        const targets = selectedLearners.filter(
            (l): l is Extract<SelectedLearner, { type: 'new' }> =>
                l.type === 'new' && !!l.parentLink && l.parentLink.mode === 'add_guardian'
        );
        if (targets.length === 0) return;

        const settled = await Promise.allSettled(
            targets.map((l) => {
                const email = l.newUser.email;
                const match = result.results.find((r) => !!r.user_email && r.user_email === email && !!r.user_id);
                if (!match?.user_id) {
                    return Promise.reject(
                        new Error(
                            t('errors.couldNotResolveCreatedUser', {
                                name: l.newUser.full_name || email,
                            })
                        )
                    );
                }
                const request = buildParentLinkRequest(match.user_id, l.parentLink);
                if (!request) return Promise.reject(new Error(t('errors.invalidGuardianLinkSelection')));
                return linkGuardian(request);
            })
        );

        settled.forEach((s, i) => {
            if (s.status === 'rejected') {
                const l = targets[i];
                if (!l) return;
                toast.error(
                    t('toasts.guardianLinkFailed', {
                        name: l.newUser.full_name || l.newUser.email,
                        message: extractErrorMessage(s.reason),
                    })
                );
            }
        });
    };

    const clearGuardianLinkError = (index: number) => {
        setGuardianLinkErrors((prev) => {
            if (!(index in prev)) return prev;
            const next = { ...prev };
            delete next[index];
            return next;
        });
    };

    const handlePreview = async () => {
        setIsSubmitting(true);
        try {
            const result = await bulkAssign(buildRequest(true));
            setPreviewResponse(result);
            setStep(previewIndex);
        } catch (e) {
            toast.error(t('toasts.previewFailed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            const result = await bulkAssign(buildRequest(false));
            // Fire off any deferred 'new'-chip guardian links now that the
            // enrollment call has minted their real user ids. Best-effort:
            // enrollment already succeeded, so a link failure here surfaces
            // as a toast rather than blocking the (already-real) enrollment.
            await resolveNewChipGuardianLinks(result);
            const { summary } = result;
            toast.success(
                t('toasts.enrollmentComplete', {
                    successful: summary.successful,
                    skipped: summary.skipped,
                    failed: summary.failed,
                })
            );
            onSuccess?.();
            handleClose();
        } catch (e) {
            toast.error(t('toasts.enrollmentFailed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        setStep(0);
        setSelectedLearners([]);
        setSelectedPackageSessions(buildInitialSelection());
        setOptions({ duplicateHandling: 'SKIP', notifyLearners: false, sendCredentials: false, transactionId: '', paymentDate: '' });
        setPreviewResponse(null);
        setAdmissionPackage(null);
        setGuardianLinkErrors({});
        onOpenChange(false);
    };

    const canGoNext = () => {
        if (currentStep === 'learners') {
            return (
                selectedLearners.length > 0 &&
                selectedLearners.every(isChipGuardianReady) &&
                !isResolvingGuardianLinks
            );
        }
        if (currentStep === 'courses') return selectedPackageSessions.length > 0;
        // An admin discount that's half filled in (no value / no reason) must not be sent.
        if (currentStep === 'config' && packageOn)
            return (
                !admissionPackage?.error &&
                selectedPackageSessions.every((ps) => ps.packageFee != null && !ps.inviteNeedsChoice)
            );
        if (currentStep === 'config')
            return (
                selectedPackageSessions.every(
                    (ps) =>
                        !getAdminDiscountValidationError(ps.adminDiscount) &&
                        !(ps.adminDiscount && ps.adminDiscount.mode !== 'NONE' && ps.adminDiscountError) &&
                        // An installment schedule the backend would reject (e.g. amounts that
                        // don't add up) must be fixed before Preview.
                        !ps.cpoScheduleError &&
                        // Offline payment details the institute requires (mode, reference, proof).
                        !(ps.cpoConfig?.payment_mode === 'OFFLINE' && ps.cpoPaymentError) &&
                        // Auto mode could not tell which invite is meant.
                        !ps.inviteNeedsChoice
                ) &&
                !(
                    (options.paymentDate || options.transactionId) &&
                    selectedPackageSessions.some((ps) => !ps.ownsPayment) &&
                    options.paymentDetailsError
                )
            );
        // Every org-associated batch must name the organisation being enrolled into —
        // the backend rejects the enrollment outright without one.
        if (currentStep === 'suborg') return selectedPackageSessions.every(isSubOrgSelectionReady);
        return false;
    };

    // One existing learner: their own value of the numbering-series field (e.g. branch) is
    // preselected in the payment fields. Several learners share whatever is picked.
    const numberingUserId = useMemo(() => {
        const targets = selectedLearners.filter((l) => l.parentLink?.mode !== 'is_guardian');
        const only = targets.length === 1 ? targets[0] : undefined;
        return only?.type === 'existing' ? only.userId : null;
    }, [selectedLearners]);

    const handleNext = async () => {
        if (currentStep === 'learners') {
            setIsResolvingGuardianLinks(true);
            const ok = await resolveStep1GuardianLinks();
            setIsResolvingGuardianLinks(false);
            if (!ok) return; // inline chip errors already set — block advancing
            setStep(1);
            return;
        }
        // The step right before Preview generates it; which one that is depends on
        // whether the sub-org step is in play.
        if (step === previewIndex - 1) {
            handlePreview();
            return;
        }
        setStep((s) => s + 1);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent
                className="z-[1100] flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[820px] flex-col gap-0 overflow-hidden p-0 font-normal sm:h-[85vh] sm:max-h-[85vh]" // design-lint-ignore: pre-existing viewport-relative dialog sizing, unrelated to the guardian-link feature (out of scope for this change)
            >
                {/* Header */}
                <DialogHeader>
                    <div className="bg-primary-50 px-4 py-3 sm:px-6 sm:py-4">
                        <h2 className="text-h3 font-semibold text-primary-500">
                            {t('dialogTitle', {
                                term: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                            })}
                        </h2>
                        {/* Step progress bar */}
                        <div className="mt-3 flex items-center gap-0">
                            {STEPS.map((label, idx) => (
                                <div key={idx} className="flex flex-1 items-center">
                                    <div className="flex min-w-0 flex-col items-center">
                                        <div
                                            className={cn(
                                                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-all sm:h-7 sm:w-7 sm:text-xs', // design-lint-ignore: pre-existing step-badge sizing, unrelated to the guardian-link feature (out of scope for this change)
                                                idx < step
                                                    ? 'bg-primary-500 text-white'
                                                    : idx === step
                                                      ? 'border-2 border-primary-500 bg-white text-primary-500'
                                                      : 'bg-neutral-200 text-neutral-500'
                                            )}
                                        >
                                            {idx < step ? '✓' : idx + 1}
                                        </div>
                                        <span
                                            className={cn(
                                                'mt-1 max-w-full truncate text-center text-[9px] sm:whitespace-nowrap sm:text-[10px]', // design-lint-ignore: pre-existing step-label sizing, unrelated to the guardian-link feature (out of scope for this change)
                                                idx === step
                                                    ? 'font-semibold text-primary-500'
                                                    : 'text-neutral-400'
                                            )}
                                        >
                                            {label}
                                        </span>
                                    </div>
                                    {idx < STEPS.length - 1 && (
                                        <div
                                            className={cn(
                                                'mb-3 h-[2px] flex-1', // design-lint-ignore: pre-existing step-divider sizing, unrelated to the guardian-link feature (out of scope for this change)
                                                idx < step ? 'bg-primary-500' : 'bg-neutral-200'
                                            )}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </DialogHeader>

                {/* Step Content */}
                <div className="flex-1 overflow-y-auto">
                    {currentStep === 'learners' && (
                        <Step1LearnerSelector
                            instituteId={INSTITUTE_ID || ''}
                            selectedLearners={selectedLearners}
                            onSelectedLearnersChange={setSelectedLearners}
                            onPaymentInfoDetected={(info) => {
                                setOptions((prev) => ({
                                    ...prev,
                                    paymentDate: info.paymentDate || prev.paymentDate,
                                    transactionId: info.transactionId || prev.transactionId,
                                }));
                            }}
                            guardianLinkErrors={guardianLinkErrors}
                            onClearGuardianLinkError={clearGuardianLinkError}
                        />
                    )}
                    {currentStep === 'courses' && (
                        <Step2CourseSelector
                            selectedPackageSessions={selectedPackageSessions}
                            onSelectedPackageSessionsChange={setSelectedPackageSessions}
                            initialPackageSessionId={initialPackageSessionId}
                        />
                    )}
                    {currentStep === 'config' && (
                        <Step3EnrollConfig
                            instituteId={INSTITUTE_ID || ''}
                            selectedPackageSessions={selectedPackageSessions}
                            onSelectedPackageSessionsChange={setSelectedPackageSessions}
                            options={options}
                            onOptionsChange={setOptions}
                            numberingUserId={numberingUserId}
                            admissionPackage={admissionPackage}
                            onAdmissionPackageChange={setAdmissionPackage}
                        />
                    )}
                    {currentStep === 'suborg' && (
                        <Step4SubOrg
                            selectedPackageSessions={selectedPackageSessions}
                            onSelectedPackageSessionsChange={setSelectedPackageSessions}
                        />
                    )}
                    {currentStep === 'preview' && previewResponse && (
                        <Step4Preview
                            previewResponse={previewResponse}
                            selectedPackageSessions={selectedPackageSessions}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-4 py-3 sm:px-6 sm:py-4">
                    <div>
                        {step > 0 && (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                onClick={() => setStep((s) => s - 1)}
                                disabled={isSubmitting}
                            >
                                {t('footer.back')}
                            </MyButton>
                        )}
                    </div>
                    <div className="flex gap-2 sm:gap-3">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="default"
                            onClick={handleClose}
                            disabled={isSubmitting}
                        >
                            {t('footer.cancel')}
                        </MyButton>
                        {step < previewIndex ? (
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="default"
                                onClick={handleNext}
                                disable={!canGoNext() || isSubmitting || isResolvingGuardianLinks}
                            >
                                {isResolvingGuardianLinks
                                    ? t('footer.linkingGuardians')
                                    : isSubmitting
                                      ? t('footer.loading')
                                      : step === previewIndex - 1
                                        ? t('footer.previewButton')
                                        : t('footer.next')}
                            </MyButton>
                        ) : (
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="default"
                                onClick={handleConfirm}
                                disable={
                                    isSubmitting ||
                                    (previewResponse?.summary.successful === 0 &&
                                        previewResponse?.summary.re_enrolled === 0)
                                }
                            >
                                {isSubmitting ? t('footer.enrolling') : t('footer.confirmEnrollment')}
                            </MyButton>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
