import { useMemo } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle, Crown, Trash, UserPlus, Users, Warning } from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { TokenKey } from '@/constants/auth/tokens';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { cn } from '@/lib/utils';
import { isIOS } from '@/native';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { isUserAdmin } from '@/utils/userDetails';
import { handleDeleteDisableDashboardUsers } from '@/routes/dashboard/-services/dashboard-services';
import { fetchEligibleOrgUsers } from '@/routes/manage-institute/teams/-services/institute-users-service';
import { inviteTeamMember } from '@/routes/manage-institute/teams/-services/team-member-services';
import { signupErrorMessage } from '@/routes/signup/-services/self-signup';
import { PlanBillingDocuments } from '@/components/common/ai-credits/PlanBillingDocuments';
import { useBillingDocumentsQuery } from '@/services/ai-plans/storefront';
import {
    canAddTeachers,
    PLAN_ACCESS_QUERY_KEY,
    usePlanAccess,
    type PlanAccess,
    type ProductPlan,
} from './-hooks/usePlanAccess';

export const Route = createFileRoute('/evalezy/plan')({
    component: PlanPage,
});

const TEACHERS_QUERY_KEY = 'EVALEZY_TEACHERS';

const inr = (amount: number | null | undefined) =>
    amount == null
        ? ''
        : new Intl.NumberFormat('en-IN', {
              style: 'currency',
              currency: 'INR',
              maximumFractionDigits: 2,
              minimumFractionDigits: 0,
          }).format(amount);

const shortDate = (iso: string | null | undefined) =>
    iso
        ? new Date(iso).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
          })
        : '';

/** The workspace owner: the account that signed up (its email is the institute's email). */
const useIsOwner = () => {
    const instituteEmail = useInstituteDetailsStore((s) => s.instituteDetails?.email);
    const token = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
    if (instituteEmail && token?.email) {
        return instituteEmail.trim().toLowerCase() === token.email.trim().toLowerCase();
    }
    return isUserAdmin();
};

/**
 * Plan and teachers: what the workspace bought (trial or plan), the plans it can buy (paid on
 * Razorpay through the AI plans checkout), and, on a multi-user plan, its teachers.
 */
function PlanPage() {
    const { t } = useTranslation('evalezy');
    const access = usePlanAccess();
    const instituteId = getCurrentInstituteId();

    if (access.isLoading) return <DashboardLoader />;
    if (!access.data) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-6 text-center">
                <Warning size={28} className="text-warning-600" />
                <p className="text-body text-neutral-600">{t('plan.loadFailed')}</p>
                <MyButton buttonType="secondary" onClick={() => void access.refetch()}>
                    {t('plan.retry')}
                </MyButton>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-h3 font-semibold text-neutral-800">{t('plan.title')}</h1>
            <CurrentPlanCard access={access.data} />
            {canAddTeachers(access.data) && <TeachersCard access={access.data} />}
            <PlanCards access={access.data} />
            {/* GST invoices of the plan (and credit notes); none in the iPhone app. */}
            {!isIOS() && instituteId && access.data.status !== 'NONE' && (
                <InvoicesSection instituteId={instituteId} />
            )}
        </div>
    );
}

const CurrentPlanCard = ({ access }: { access: PlanAccess }) => {
    const { t } = useTranslation('evalezy');
    const onPlan = access.status === 'PLAN';
    const onTrial = access.status === 'TRIAL';
    const pending = access.status === 'PAYMENT_PENDING';
    return (
        <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption font-medium uppercase text-neutral-500">
                    {t('plan.current')}
                </span>
                {onTrial && (
                    <span
                        className={cn(
                            'rounded-full px-2 py-0.5 text-caption font-semibold',
                            access.trial_expired
                                ? 'bg-danger-50 text-danger-700'
                                : 'bg-warning-50 text-warning-700'
                        )}
                    >
                        {access.trial_expired ? t('plan.trialEnded') : t('plan.trialBadge')}
                    </span>
                )}
            </div>
            <p className="flex items-center gap-2 text-h3 font-semibold text-neutral-800">
                {onPlan && <Crown size={20} weight="fill" className="text-warning-500" />}
                {onPlan
                    ? access.plan_name
                    : onTrial
                      ? t('plan.freeTrial')
                      : pending
                        ? t('plan.pendingTitle')
                        : t('plan.managed')}
            </p>
            {pending && (
                <p className="flex items-start gap-1 rounded-md bg-warning-50 p-2 text-body text-warning-700">
                    <Warning size={16} className="mt-0.5 shrink-0" weight="fill" />
                    {isIOS() ? t('plan.pendingBodyIos') : t('plan.pendingBody')}
                </p>
            )}
            <ul className="flex flex-col gap-1 text-body text-neutral-600">
                {onPlan && access.plan_credits != null && (
                    <li>
                        {t('plan.creditsIncluded', {
                            credits: access.plan_credits.toLocaleString('en-IN'),
                        })}
                    </li>
                )}
                {onPlan && access.plan_ends_at && (
                    <li>{t('plan.validTill', { date: shortDate(access.plan_ends_at) })}</li>
                )}
                {onTrial && access.trial_ends_at && (
                    <li>
                        {access.trial_expired
                            ? t('plan.trialEndedOn', { date: shortDate(access.trial_ends_at) })
                            : t('plan.trialEndsOn', { date: shortDate(access.trial_ends_at) })}
                    </li>
                )}
                {access.seat_limit != null && (
                    <li className="flex items-center gap-1">
                        <Users size={14} />
                        {access.seat_limit === 1
                            ? t('plan.oneTeacher')
                            : t('plan.upToUsers', { count: access.seat_limit })}
                    </li>
                )}
            </ul>
        </section>
    );
};

/**
 * The plan's invoices, shown only once the list loads: the list is refused while online plans are
 * closed for the workspace, and there can be no plan invoice then anyway.
 */
const InvoicesSection = ({ instituteId }: { instituteId: string }) => {
    const docs = useBillingDocumentsQuery(instituteId);
    if (!docs.data) return null;
    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <PlanBillingDocuments instituteId={instituteId} />
        </div>
    );
};

const PlanCards = ({ access }: { access: PlanAccess }) => {
    const { t } = useTranslation('evalezy');
    const navigate = useNavigate();
    const isOwner = useIsOwner();
    const plans = access.plans ?? [];
    if (access.status === 'MANAGED') return null;
    if (plans.length === 0) {
        // No plans set for the product yet: say so instead of a page with nothing to buy.
        return (
            <p className="flex items-start gap-1 rounded-md bg-warning-50 p-3 text-body text-warning-700">
                <Warning size={16} className="mt-0.5 shrink-0" weight="fill" />
                {t('plan.noPlans')}
            </p>
        );
    }
    const currentIndex = plans.findIndex((p) => p.key === access.plan_key);
    const period =
        access.plan_validity_months === 12 || access.plan_validity_months == null
            ? t('plan.year')
            : t('plan.months', { count: access.plan_validity_months });

    const bullets = (p: ProductPlan, i: number) => [
        t('plan.bulletCredits', {
            credits: (p.credits ?? 0).toLocaleString('en-IN'),
            period,
        }),
        ...(access.extra_credit_price_inr != null
            ? [t('plan.bulletExtra', { price: inr(access.extra_credit_price_inr) })]
            : []),
        (p.users ?? 1) <= 1
            ? t('plan.bulletOneTeacher')
            : t('plan.bulletTeachers', { count: p.users ?? 1 }),
        i > 0 ? t('plan.bulletEverything', { plan: plans[0]?.name }) : t('plan.bulletBasics'),
    ];

    return (
        <section className="flex flex-col gap-3">
            <h2 className="text-subtitle font-semibold text-neutral-800">
                {access.status === 'PLAN' ? t('plan.otherPlans') : t('plan.choose')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
                {plans.map((p, i) => {
                    const current = i === currentIndex;
                    // Buying a smaller plan than the live one is not offered here.
                    const lower = currentIndex >= 0 && i < currentIndex;
                    return (
                        <div
                            key={p.key}
                            className={cn(
                                'flex flex-col gap-3 rounded-lg border bg-white p-4',
                                current ? 'border-primary-500' : 'border-neutral-200'
                            )}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-subtitle font-semibold text-neutral-800">
                                    {p.name}
                                </h3>
                                {current && (
                                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption font-semibold text-primary-500">
                                        {t('plan.currentBadge')}
                                    </span>
                                )}
                            </div>
                            <p className="text-h2 font-semibold text-neutral-800">
                                {inr(p.price_inr)}
                                <span className="text-body font-normal text-neutral-500">
                                    {' '}
                                    / {period}
                                </span>
                            </p>
                            <ul className="flex flex-1 flex-col gap-1">
                                {bullets(p, i).map((b) => (
                                    <li
                                        key={b}
                                        className="flex items-start gap-1 text-body text-neutral-600"
                                    >
                                        <CheckCircle
                                            size={16}
                                            className="mt-0.5 shrink-0 text-success-600"
                                        />
                                        {b}
                                    </li>
                                ))}
                            </ul>
                            {!current && !lower && !isIOS() && isOwner && (
                                <MyButton
                                    buttonType="primary"
                                    className="w-full"
                                    onClick={() =>
                                        void navigate({
                                            to: '/evalezy/credits',
                                            search: { buy: p.key },
                                        })
                                    }
                                >
                                    {t('plan.buy', { plan: p.name })}
                                </MyButton>
                            )}
                        </div>
                    );
                })}
            </div>
            {!isIOS() && <p className="text-caption text-neutral-500">{t('plan.payNote')}</p>}
        </section>
    );
};

const TeachersCard = ({ access }: { access: PlanAccess }) => {
    const { t } = useTranslation('evalezy');
    const instituteId = getCurrentInstituteId() ?? '';
    const queryClient = useQueryClient();
    const isOwner = useIsOwner();
    const myId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user;
    const teachers = useQuery({
        queryKey: [TEACHERS_QUERY_KEY, instituteId],
        queryFn: () => fetchEligibleOrgUsers(instituteId),
        enabled: !!instituteId,
    });
    const used = teachers.data?.length ?? 0;
    const full = access.seat_limit != null && used >= access.seat_limit;

    const remove = useMutation({
        mutationFn: (userId: string) =>
            handleDeleteDisableDashboardUsers(instituteId, 'DISABLED', userId),
        onSuccess: () => {
            toast.success(t('plan.teacherRemoved'));
            void queryClient.invalidateQueries({ queryKey: [TEACHERS_QUERY_KEY] });
        },
        onError: (e) => toast.error(signupErrorMessage(e) ?? t('plan.actionFailed')),
    });

    return (
        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-subtitle font-semibold text-neutral-800">
                    {t('plan.teachers')}
                </h2>
                {access.seat_limit != null && (
                    <span className="text-caption text-neutral-500">
                        {t('plan.seatsUsed', { used, limit: access.seat_limit })}
                    </span>
                )}
            </div>
            {teachers.isLoading ? (
                <DashboardLoader />
            ) : teachers.isError ? (
                <p className="text-body text-danger-600">{t('plan.loadFailed')}</p>
            ) : (
                <ul className="flex flex-col divide-y divide-neutral-100">
                    {(teachers.data ?? []).map((u) => (
                        <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                                <p className="truncate text-body font-medium text-neutral-800">
                                    {u.full_name || u.username}
                                    {u.id === myId && (
                                        <span className="ml-1 text-caption text-neutral-500">
                                            {t('plan.you')}
                                        </span>
                                    )}
                                </p>
                                <p className="truncate text-caption text-neutral-500">{u.email}</p>
                            </div>
                            {isOwner && u.id !== myId && (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    disabled={remove.isPending}
                                    onClick={() => remove.mutate(u.id)}
                                    aria-label={t('plan.remove')}
                                >
                                    <Trash size={16} className="text-danger-600" />
                                </MyButton>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {isOwner &&
                (full ? (
                    <p className="text-caption text-warning-700">{t('plan.full')}</p>
                ) : (
                    <AddTeacherForm instituteId={instituteId} />
                ))}
        </section>
    );
};

const AddTeacherForm = ({ instituteId }: { instituteId: string }) => {
    const { t } = useTranslation('evalezy');
    const queryClient = useQueryClient();
    const schema = useMemo(
        () =>
            z.object({
                name: z.string().trim().min(2, t('signup.required')),
                email: z.string().trim().email(t('demo.emailInvalid')),
            }),
        [t]
    );
    type Values = z.infer<typeof schema>;
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { name: '', email: '' },
    });

    const add = useMutation({
        // Same full Evalezy access as the owner.
        mutationFn: (v: Values) =>
            inviteTeamMember(instituteId, { name: v.name, email: v.email, roles: ['ADMIN'] }),
        onSuccess: (res) => {
            toast.success(
                res?.existing_account ? t('plan.teacherAddedExisting') : t('plan.teacherAdded')
            );
            form.reset();
            void queryClient.invalidateQueries({ queryKey: [TEACHERS_QUERY_KEY] });
            void queryClient.invalidateQueries({ queryKey: [PLAN_ACCESS_QUERY_KEY] });
        },
        onError: (e) => toast.error(signupErrorMessage(e) ?? t('plan.actionFailed')),
    });

    const field = (name: 'name' | 'email', label: string, inputType = 'text') => (
        <FormField
            control={form.control}
            name={name}
            render={({ field: f }) => (
                <FormItem className="min-w-0 flex-1">
                    <FormControl>
                        <MyInput
                            label={label}
                            required
                            inputType={inputType}
                            input={f.value ?? ''}
                            onChangeFunction={f.onChange}
                            error={form.formState.errors[name]?.message}
                            className="w-full sm:w-full"
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    return (
        <FormProvider {...form}>
            <form
                className="flex flex-col gap-3 border-t border-neutral-100 pt-3"
                onSubmit={form.handleSubmit((v) => add.mutate(v))}
            >
                <p className="text-caption text-neutral-500">{t('plan.addHint')}</p>
                <div className="flex flex-col gap-3 sm:flex-row">
                    {field('name', t('plan.teacherName'))}
                    {field('email', t('plan.teacherEmail'), 'email')}
                </div>
                <MyButton
                    type="submit"
                    buttonType="secondary"
                    disabled={add.isPending}
                    className="w-full sm:w-fit"
                >
                    <UserPlus size={16} />
                    {add.isPending ? t('plan.adding') : t('plan.addTeacher')}
                </MyButton>
            </form>
        </FormProvider>
    );
};
