/**
 * StudentParentProfile — the "Guardian" side-view tab.
 *
 * A single userId can be EITHER side of a guardian-student link:
 *   - a guardian, with one or more linked children, or
 *   - a student, with at most one linked guardian.
 * `selectedStudent` (StudentTable) carries no `is_parent` flag, so this
 * component determines which case it is itself: it fetches the children
 * list first — a non-empty result means "this is a guardian profile" — and
 * only falls back to the parent lookup when there are no children.
 *
 * Supports linking a guardian/child directly from this tab (not just from
 * the assignment-time dialog) — reuses the same GuardianLinkPanel +
 * /parent-link/v1/link plumbing built for the bulk-assign dialog. The anchor
 * (this profile's own userId) always already exists here, so this is the
 * simple LINK/CREATE case — no need for the new-guardian-from-scratch
 * endpoint the assignment dialog needs for brand-new manual chips.
 *
 * Click-through navigation: clicking a linked child or a linked guardian
 * pivots this tab's own view to that person (an in-panel history stack,
 * with a "back" trail) — NOT a jump to their full StudentTable side-view.
 * A guardian isn't an enrolled student and has no StudentTable row to jump
 * to, and a synthesized placeholder row risked breaking enrollment-shaped
 * tabs (courses, payments, …) elsewhere in the side-view for real students
 * too. Pivoting in-panel works for both directions with zero backend
 * changes and no risk to other tabs.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_PARENT_LINK_PARENT,
    GET_PARENT_LINK_CHILDREN,
    SHARE_GUARDIAN_CREDENTIALS,
} from '@/constants/urls';
import { Users, Plus, ArrowLeft, Key, PaperPlaneTilt } from '@phosphor-icons/react';
import { useStudentCredentails } from '@/services/student-list-section/getStudentCredentails';
import { getCurrentInstituteId, getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getDisplaySettingsWithFallback, getDisplaySettingsFromCache } from '@/services/display-settings';
import { useParentSettings } from '@/hooks/use-parent-settings';
import { useParentLink } from '../../../../-hooks/useParentLink';
import { GuardianLinkPanel } from '../../../../-components/enroll-bulk/components/GuardianLinkPanel';
import { ParentLinkPersonInput, isParentLinkPersonValid } from '../../../../-types/bulk-assign-types';
import { MyButton } from '@/components/design-system/button';
import {
    ProfileHero,
    ProfileSectionCard,
    ProfileFieldRow,
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
} from '../profile-ui';

// ── Types ─────────────────────────────────────────────────────────────────────
// Subset of the backend UserDTO — only the fields this tab renders.
interface GuardianLinkedUser {
    id: string;
    username: string | null;
    email: string | null;
    full_name: string | null;
    mobile_number: string | null;
}

interface ViewedPerson {
    id: string;
    name: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchGuardian(studentUserId: string): Promise<GuardianLinkedUser | null> {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_PARENT_LINK_PARENT,
        params: { studentUserId },
    });
    return response.data ?? null;
}

async function fetchChildren(parentUserId: string): Promise<GuardianLinkedUser[]> {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_PARENT_LINK_CHILDREN,
        params: { parentUserId },
    });
    return response.data ?? [];
}

function extractErrorMessage(err: unknown, t: TFunction): string {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    return e?.response?.data?.message || e?.message || t('toast.linkGuardianFailedDefault');
}

// ── Inline link form (shared by both directions) ───────────────────────────────

interface InlineLinkFormProps {
    instituteId: string;
    /** "Guardian" (student adding a guardian) or "Student" (guardian adding a child). */
    personLabel: string;
    searchRoles: string[];
    onSubmit: (person: ParentLinkPersonInput) => Promise<void>;
    onCancel: () => void;
    submitting: boolean;
}

function InlineLinkForm({
    instituteId,
    personLabel,
    searchRoles,
    onSubmit,
    onCancel,
    submitting,
}: InlineLinkFormProps) {
    const { t } = useTranslation('manageStudentsParentProfile');
    const [person, setPerson] = useState<ParentLinkPersonInput | undefined>(undefined);
    const ready = isParentLinkPersonValid(person);

    return (
        <div className="flex flex-col gap-3">
            <GuardianLinkPanel
                instituteId={instituteId}
                personLabel={personLabel}
                searchRoles={searchRoles}
                value={person}
                onChange={setPerson}
            />
            <div className="flex items-center justify-end gap-2">
                <MyButton buttonType="secondary" scale="small" onClick={onCancel} disable={submitting}>
                    {t('linkForm.cancel')}
                </MyButton>
                <MyButton
                    buttonType="primary"
                    scale="small"
                    onClick={() => person && onSubmit(person)}
                    disable={!ready || submitting}
                >
                    {submitting ? t('linkForm.linking') : t('linkForm.linkButton', { person: personLabel })}
                </MyButton>
            </div>
        </div>
    );
}

// ── Back-navigation trail ───────────────────────────────────────────────────────

function BackTrail({ current, onBack }: { current: ViewedPerson; onBack: () => void }) {
    const { t } = useTranslation('manageStudentsParentProfile');
    return (
        <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 self-start text-caption font-medium text-primary-500 hover:text-primary-700"
        >
            <ArrowLeft size={14} weight="bold" />
            {t('backTrail.label', { name: current.name })}
        </button>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

interface StudentParentProfileProps {
    userId: string;
}

export function StudentParentProfile({ userId }: StudentParentProfileProps) {
    const { t } = useTranslation('manageStudentsParentProfile');
    const [copiedField, setCopiedField] = useState<string>('');
    const [showLinkForm, setShowLinkForm] = useState(false);
    // In-panel pivot history: empty = viewing `userId` itself. Each entry is a
    // person clicked into (a linked child or guardian) — see file header.
    const [history, setHistory] = useState<ViewedPerson[]>([]);
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';
    const { enabled: guardianLinkingEnabled } = useParentSettings();
    const { mutateAsync: linkGuardian, isPending: isLinking } = useParentLink();
    const [allowViewPassword, setAllowViewPassword] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const roleKey = getActiveRoleDisplaySettingsKey();
            const cached = getDisplaySettingsFromCache(roleKey);
            const settings =
                cached?.learnerManagement ?? (await getDisplaySettingsWithFallback(roleKey)).learnerManagement;
            if (!cancelled) setAllowViewPassword(settings?.allowViewPassword ?? false);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // noUncheckedIndexedAccess means history[n] is `ViewedPerson | undefined`
    // even right after a length check — resolve it once, explicitly.
    const lastView = history.length > 0 ? history[history.length - 1] : undefined;
    const currentId = lastView ? lastView.id : userId;

    // The actual selected student changed upstream (e.g. admin picked a
    // different learner) — drop any in-panel pivot so we don't show a stale
    // "back to X" trail pointing at the wrong root.
    useEffect(() => {
        setHistory([]);
        setShowLinkForm(false);
    }, [userId]);

    const goInto = (person: ViewedPerson) => {
        setShowLinkForm(false);
        setHistory((h) => [...h, person]);
    };
    const goBack = () => {
        setShowLinkForm(false);
        setHistory((h) => h.slice(0, -1));
    };

    // `fieldKey` is a stable internal id used for the `copiedField` equality
    // check (never translated — comparing translated display text for logic
    // would silently break in every non-English locale). `fieldLabel` is the
    // translated, human-readable name shown in the toast.
    const handleCopy = async (text: string, fieldKey: string, fieldLabel: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldKey);
            toast.success(t('toast.copiedToClipboard', { field: fieldLabel }));
            setTimeout(() => setCopiedField(''), 2000);
        } catch {
            toast.error(t('toast.copyFailed', { field: fieldLabel }));
        }
    };

    const childrenQuery = useQuery({
        queryKey: ['parent-link-children', currentId],
        queryFn: () => fetchChildren(currentId),
        enabled: !!currentId,
        staleTime: 2 * 60 * 1000,
        retry: 1,
    });

    const isGuardian = (childrenQuery.data?.length ?? 0) > 0;

    // Only look up a guardian once we know this profile has no children of
    // its own — avoids an unnecessary request for guardian profiles.
    const parentQuery = useQuery({
        queryKey: ['parent-link-parent', currentId],
        queryFn: () => fetchGuardian(currentId),
        enabled: !!currentId && !childrenQuery.isLoading && !isGuardian,
        staleTime: 2 * 60 * 1000,
        retry: 1,
    });

    // Same credential-reveal endpoint/hook already used by the student
    // portal-access tab (GET /auth-service/v1/user/user-credentials/{userId}) —
    // reused here rather than inventing a second plaintext-exposure path.
    // Called unconditionally (Rules of Hooks) — only *enabled* once we know
    // this profile is a student with a resolved guardian id.
    const guardianId = parentQuery.data?.id ?? '';
    const credentialsQuery = useStudentCredentails({ userId: guardianId });
    // Raw password value (untranslated) kept separately from the display
    // string below — logic (e.g. whether to show a copy button) must branch
    // on this, never on the translated placeholder text.
    const guardianRawPassword = guardianId ? credentialsQuery.data?.password : undefined;

    // This student's OWN login (currentId itself, not the guardian's) -- a
    // guardian-linked child created via onboarding/parent-add-student flows
    // often has no course/enrollment yet, so there's no manage-students row
    // for them and thus no Portal Access tab to see their own credentials in.
    // This is the one place a child-without-enrollment is reachable from at
    // all (pivoted into from the guardian's Linked Children list), so it's
    // shown here too, gated by the same allowViewPassword display setting.
    const ownCredentialsQuery = useStudentCredentails({ userId: currentId });
    const guardianPassword = guardianId
        ? guardianRawPassword || (credentialsQuery.isLoading ? t('status.loading') : t('status.passwordNotFound'))
        : null;

    // Emails the guardian's credentials so they can onboard to the Parent
    // Portal. The backend picks the recipient (student vs guardian) from the
    // institute's Guardian Setting — a backfilled guardian's own address is a
    // synthetic placeholder, so it usually routes to the student's real email.
    const { mutate: shareCredentials, isPending: sharingCredentials } = useMutation({
        mutationFn: async () => {
            const response = await authenticatedAxiosInstance.post(SHARE_GUARDIAN_CREDENTIALS, null, {
                params: { instituteId, studentUserId: currentId },
            });
            return response.data as { sent: boolean; recipient_email?: string; reason?: string };
        },
        onSuccess: (result) => {
            if (result.sent) {
                toast.success(
                    result.recipient_email
                        ? t('toast.guardianCredentialsSentTo', { email: result.recipient_email })
                        : t('toast.guardianCredentialsSent')
                );
            } else {
                toast.warning(result.reason || t('toast.guardianCredentialsNotSent'));
            }
        },
        onError: () => {
            toast.error(t('toast.guardianCredentialsSendFailed'));
        },
    });

    const submitLink = async (
        direction: 'PARENT_ADDS_STUDENT' | 'STUDENT_ADDS_PARENT',
        person: ParentLinkPersonInput
    ) => {
        const base = {
            institute_id: instituteId,
            direction,
            anchor_user_id: currentId,
        } as const;
        const request =
            person.kind === 'create_new'
                ? {
                      ...base,
                      mode: 'CREATE_NEW' as const,
                      new_full_name: person.fullName,
                      new_email: person.email,
                      new_mobile_number: person.mobileNumber || undefined,
                  }
                : {
                      ...base,
                      mode: 'LINK_EXISTING' as const,
                      existing_user_id: person.userId,
                  };
        try {
            await linkGuardian(request);
            toast.success(
                direction === 'STUDENT_ADDS_PARENT' ? t('toast.guardianLinked') : t('toast.studentLinked')
            );
            setShowLinkForm(false);
            queryClient.invalidateQueries({ queryKey: ['parent-link-children', currentId] });
            queryClient.invalidateQueries({ queryKey: ['parent-link-parent', currentId] });
        } catch (err) {
            toast.error(extractErrorMessage(err, t));
        }
    };

    const backTrail = lastView && <BackTrail current={lastView} onBack={goBack} />;

    // This student's (currentId's) own login -- shown on the "student" branch only (not the
    // guardian's own view of their children list). See the ownCredentialsQuery comment above
    // for why this needs to exist here specifically.
    const ownCredentialsBlock =
        allowViewPassword === false ? (
            <p className="text-2xs text-muted-foreground">{t('ownLogin.passwordHidden')}</p>
        ) : (
            <ProfileSectionCard icon={Key} heading={t('ownLogin.heading')}>
                <dl>
                    <ProfileFieldRow
                        label={t('fields.username')}
                        value={ownCredentialsQuery.data?.username ?? null}
                        copied={copiedField === 'studentUsername'}
                        onCopy={
                            ownCredentialsQuery.data?.username
                                ? () =>
                                      handleCopy(
                                          ownCredentialsQuery.data!.username,
                                          'studentUsername',
                                          t('toastFields.studentUsername')
                                      )
                                : undefined
                        }
                    />
                    <ProfileFieldRow
                        label={t('fields.password')}
                        value={
                            ownCredentialsQuery.data?.password ??
                            (ownCredentialsQuery.isLoading ? t('status.loading') : t('status.notFound'))
                        }
                        copied={copiedField === 'studentPassword'}
                        onCopy={
                            ownCredentialsQuery.data?.password
                                ? () =>
                                      handleCopy(
                                          ownCredentialsQuery.data!.password,
                                          'studentPassword',
                                          t('toastFields.studentPassword')
                                      )
                                : undefined
                        }
                    />
                </dl>
            </ProfileSectionCard>
        );

    if (childrenQuery.isLoading || parentQuery.isLoading) {
        return (
            <div className="flex flex-col gap-3">
                {backTrail}
                <ProfileSkeleton blocks={2} />
            </div>
        );
    }

    if (childrenQuery.isError) {
        return (
            <div className="flex flex-col gap-3">
                {backTrail}
                <ProfileError
                    title={t('errors.loadGuardianInfo')}
                    onRetry={() => childrenQuery.refetch()}
                />
            </div>
        );
    }

    // ── Guardian profile: show the linked children ──
    if (isGuardian) {
        const children = childrenQuery.data ?? [];
        return (
            <div className="flex flex-col gap-3">
                {backTrail}
                <ProfileHero
                    icon={Users}
                    tone="info"
                    eyebrow={t('guardianHero.eyebrow')}
                    title={t('guardianHero.title')}
                    subtitle={t('guardianHero.linkedToChildren', { count: children.length })}
                />
                <ProfileSectionCard
                    icon={Users}
                    heading={t('linkedChildren.heading')}
                    action={
                        guardianLinkingEnabled && !showLinkForm ? (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setShowLinkForm(true)}
                            >
                                <Plus size={14} weight="bold" /> {t('linkedChildren.addChild')}
                            </MyButton>
                        ) : undefined
                    }
                >
                    <div className="flex flex-col divide-y divide-border">
                        {children.map((child) => (
                            <button
                                key={child.id}
                                type="button"
                                onClick={() =>
                                    goInto({
                                        id: child.id,
                                        name: child.full_name || child.email || t('fallback.thisLearner'),
                                    })
                                }
                                className="flex flex-col gap-0.5 py-2 text-left first:pt-0 last:pb-0 hover:opacity-80"
                                title={t('linkedChildren.viewLearnerTooltip')}
                            >
                                <span className="text-sm font-medium text-primary-600 underline-offset-2 hover:underline">
                                    {child.full_name || '—'}
                                </span>
                                <span className="text-2xs text-muted-foreground">
                                    {child.email || '—'}
                                </span>
                                <span className="text-2xs text-muted-foreground">
                                    {child.mobile_number || '—'}
                                </span>
                            </button>
                        ))}
                    </div>
                    {showLinkForm && (
                        <div className="mt-3 border-t border-border pt-3">
                            <InlineLinkForm
                                instituteId={instituteId}
                                personLabel={t('roles.student')}
                                searchRoles={['STUDENT']}
                                submitting={isLinking}
                                onCancel={() => setShowLinkForm(false)}
                                onSubmit={(person) => submitLink('PARENT_ADDS_STUDENT', person)}
                            />
                        </div>
                    )}
                </ProfileSectionCard>
            </div>
        );
    }

    // ── Student profile: show the linked guardian, if any ──
    if (parentQuery.isError) {
        return (
            <div className="flex flex-col gap-3">
                {backTrail}
                <ProfileError
                    title={t('errors.loadGuardianInfo')}
                    onRetry={() => parentQuery.refetch()}
                />
            </div>
        );
    }

    const guardian = parentQuery.data;

    if (!guardian) {
        return (
            <div className="flex flex-col gap-3">
                {backTrail}
                {ownCredentialsBlock}
                <ProfileEmpty
                    icon={Users}
                    title={t('noGuardian.title')}
                    hint={t('noGuardian.hint')}
                />
                {guardianLinkingEnabled && (
                    <ProfileSectionCard icon={Users} heading={t('linkGuardianSection.heading')}>
                        {showLinkForm ? (
                            <InlineLinkForm
                                instituteId={instituteId}
                                personLabel={t('roles.guardian')}
                                searchRoles={['PARENT']}
                                submitting={isLinking}
                                onCancel={() => setShowLinkForm(false)}
                                onSubmit={(person) => submitLink('STUDENT_ADDS_PARENT', person)}
                            />
                        ) : (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setShowLinkForm(true)}
                            >
                                <Plus size={14} weight="bold" /> {t('linkGuardianSection.addGuardian')}
                            </MyButton>
                        )}
                    </ProfileSectionCard>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {backTrail}
            {ownCredentialsBlock}
            <ProfileSectionCard
                icon={Users}
                heading={t('guardianSection.heading')}
                action={
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => shareCredentials()}
                            disabled={sharingCredentials}
                            className="flex items-center gap-1 text-caption font-medium text-primary-500 hover:text-primary-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            title={t('guardianSection.shareCredentialsTooltip')}
                        >
                            <PaperPlaneTilt className="size-3.5" />
                            {sharingCredentials ? t('guardianSection.sending') : t('guardianSection.shareCredentials')}
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                goInto({
                                    id: guardian.id,
                                    name: guardian.full_name || guardian.email || t('fallback.thisGuardian'),
                                })
                            }
                            className="text-caption font-medium text-primary-500 hover:text-primary-700 hover:underline"
                            title={t('guardianSection.viewProfileTooltip')}
                        >
                            {t('guardianSection.viewProfileLink')}
                        </button>
                    </div>
                }
            >
                <dl>
                    <ProfileFieldRow label={t('fields.name')} value={guardian.full_name} />
                    <ProfileFieldRow
                        label={t('fields.username')}
                        value={guardian.username}
                        copied={copiedField === 'username'}
                        onCopy={
                            guardian.username
                                ? () => handleCopy(guardian.username!, 'username', t('toastFields.username'))
                                : undefined
                        }
                    />
                    <ProfileFieldRow
                        label={t('fields.email')}
                        value={guardian.email}
                        copied={copiedField === 'email'}
                        onCopy={
                            guardian.email
                                ? () => handleCopy(guardian.email!, 'email', t('toastFields.email'))
                                : undefined
                        }
                    />
                    <ProfileFieldRow label={t('fields.mobile')} value={guardian.mobile_number} />
                    <ProfileFieldRow
                        label={t('fields.password')}
                        value={guardianPassword}
                        copied={copiedField === 'password'}
                        onCopy={
                            guardianRawPassword
                                ? () => handleCopy(guardianRawPassword, 'password', t('toastFields.password'))
                                : undefined
                        }
                    />
                </dl>
            </ProfileSectionCard>
        </div>
    );
}
