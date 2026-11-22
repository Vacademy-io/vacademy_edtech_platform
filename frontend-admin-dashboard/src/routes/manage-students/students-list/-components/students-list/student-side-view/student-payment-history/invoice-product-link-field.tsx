import { useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Info } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { MyInput } from '@/components/design-system/input';
import { SearchableSelect, prefixFirstFilter } from '@/components/design-system/searchable-select';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getUserPlans, type UserPlan } from '@/services/user-plan';
import {
    applyInvoiceProductLink,
    type InvoiceDTO,
    type InvoiceProductLink,
} from '@/services/invoice-service';
import { InvitePickerDropdown } from '@/routes/manage-students/students-list/-components/enroll-bulk/components/InvitePickerDropdown';
import { useResolvedInviteDetails } from '@/routes/manage-students/students-list/-hooks/useResolvedInviteDetails';
import { cn } from '@/lib/utils';

// ─── Draft state ─────────────────────────────────────────────────────────────

export type ProductLinkMode = 'NONE' | 'RENEWAL' | 'NEW_ENROLLMENT';

export interface ProductLinkDraft {
    mode: ProductLinkMode;
    // Renewal
    userPlanId: string | null;
    /** yyyy-MM-dd; '' = the plan's normal renewal. */
    newEndDate: string;
    // New enrolment
    packageSessionId: string | null;
    /** The invite the admin picked; null = Auto. */
    enrollInviteId: string | null;
    /** What Auto resolved to (sent when Auto found the only active, non-default invite). */
    resolvedInviteId: string | null;
    paymentOptionId: string | null;
    paymentOptionType: string | null;
    planId: string | null;
    /** Auto found several invites and no default: the admin has to pick one. */
    inviteAmbiguous: boolean;
    notifyLearner: boolean;
    // Both
    applyAsMemberPrice: boolean;
    /** Renew / enrol as soon as the invoice is raised, instead of when it is paid. */
    applyNow: boolean;
}

export const EMPTY_PRODUCT_LINK: ProductLinkDraft = {
    mode: 'NONE',
    userPlanId: null,
    newEndDate: '',
    packageSessionId: null,
    enrollInviteId: null,
    resolvedInviteId: null,
    paymentOptionId: null,
    paymentOptionType: null,
    planId: null,
    inviteAmbiguous: false,
    notifyLearner: false,
    applyAsMemberPrice: false,
    applyNow: false,
};

/** Request payload for the draft, or undefined for "no product". */
export function toProductLinkPayload(d: ProductLinkDraft): InvoiceProductLink | undefined {
    if (d.mode === 'RENEWAL' && d.userPlanId) {
        return {
            type: 'RENEWAL',
            user_plan_id: d.userPlanId,
            new_end_date: d.newEndDate || undefined,
            apply_as_member_price: d.applyAsMemberPrice,
            apply_now: d.applyNow,
        };
    }
    if (d.mode === 'NEW_ENROLLMENT' && d.packageSessionId) {
        return {
            type: 'NEW_ENROLLMENT',
            package_session_id: d.packageSessionId,
            // The screen shows what Auto resolved; send it so the enrolment matches (the
            // server alone would not pick an only-active invite that is not tagged DEFAULT).
            enroll_invite_id: d.enrollInviteId ?? d.resolvedInviteId ?? undefined,
            payment_option_id: d.paymentOptionId ?? undefined,
            plan_id: d.planId ?? undefined,
            notify_learner: d.notifyLearner,
            apply_as_member_price: d.applyAsMemberPrice,
            apply_now: d.applyNow,
        };
    }
    return undefined;
}

/** The reason the draft cannot be submitted, or null. */
export function getProductLinkError(
    d: ProductLinkDraft,
    t: TFunction,
    isOrgAssociated: boolean
): string | null {
    if (d.mode === 'RENEWAL' && !d.userPlanId) {
        return t('productLink.errors.chooseMembership', {
            defaultValue: 'Choose the membership this invoice renews',
        });
    }
    if (d.mode === 'NEW_ENROLLMENT') {
        if (!d.packageSessionId) {
            return t('productLink.errors.chooseCourse', {
                defaultValue: 'Choose what this invoice enrols the learner in',
            });
        }
        if (isOrgAssociated) {
            return t('productLink.errors.orgAssociated', {
                defaultValue:
                    'This one enrols learners into an organisation. Use Enrol Learner for it instead.',
            });
        }
        if (d.inviteAmbiguous && !d.enrollInviteId) {
            return t('productLink.errors.chooseInvite', { defaultValue: 'Choose an invite' });
        }
        if ((d.paymentOptionType ?? '').toUpperCase() === 'CPO') {
            return t('productLink.errors.cpo', {
                defaultValue:
                    'This is paid in installments (fee plan). Use Enrol Learner; its installments are billed there.',
            });
        }
    }
    return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RENEWABLE_STATUSES = ['ACTIVE', 'EXPIRED', 'CANCELED', 'PENDING', 'PENDING_FOR_PAYMENT', 'PAYMENT_FAILED'];

function planName(plan: UserPlan): string {
    const invite = plan.enroll_invite?.name;
    const paymentPlan = plan.payment_plan_dto?.name;
    return [invite, paymentPlan].filter(Boolean).join(' · ') || 'Membership';
}

function planPrice(plan: UserPlan): number | null {
    if (plan.regional_price != null) return plan.regional_price;
    return plan.payment_plan_dto?.actual_price ?? null;
}

function shortDate(iso?: string | null): string {
    if (!iso) return '';
    try {
        return format(new Date(iso), 'dd MMM yyyy');
    } catch {
        return '';
    }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface InvoiceProductLinkFieldProps {
    userId: string;
    instituteId: string;
    value: ProductLinkDraft;
    onChange: (next: ProductLinkDraft) => void;
    /** Invoice total, for the "charge this on future renewals" option. */
    totalLabel: string;
    /** Prefills the first invoice line (only where the admin has not typed one yet). */
    onSuggestLine: (suggestion: { description: string; unitPrice: number | null }) => void;
    /** Reports whether the chosen course enrols into an organisation (blocks submit). */
    onOrgAssociatedChange?: (orgAssociated: boolean) => void;
}

/**
 * "What does this invoice pay for?" — nothing, a renewal of a membership the learner holds, or
 * an enrolment in a new course. Applied by the server once the invoice is paid; the invoice
 * amount is the custom price, and can optionally become the membership's renewal price.
 */
export function InvoiceProductLinkField({
    userId,
    instituteId,
    value,
    onChange,
    totalLabel,
    onSuggestLine,
    onOrgAssociatedChange,
}: InvoiceProductLinkFieldProps) {
    const { t } = useTranslation('manageStudentsCreateInvoiceDialog');
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const set = (patch: Partial<ProductLinkDraft>) => onChange({ ...value, ...patch });

    // ── Renewal: the learner's memberships ──
    const { data: plansPage, isLoading: plansLoading } = useQuery({
        queryKey: ['invoice-product-link-plans', userId, instituteId],
        queryFn: () => getUserPlans(1, 50, RENEWABLE_STATUSES, userId, instituteId),
        enabled: value.mode === 'RENEWAL' && !!userId && !!instituteId,
        staleTime: 60 * 1000,
    });
    const plans = plansPage?.content ?? [];
    const selectedPlan = plans.find((p) => p.id === value.userPlanId) ?? null;

    // ── New enrolment: courses, invite, plan ──
    const batches = useInstituteDetailsStore((s) => s.instituteDetails?.batches_for_sessions);
    const courseOptions = useMemo(
        () =>
            (batches ?? [])
                .filter((b) => (b.status ?? 'ACTIVE').toUpperCase() !== 'DELETED')
                .map((b) => {
                    const level =
                        b.level?.level_name && b.level.level_name.toUpperCase() !== 'DEFAULT'
                            ? ` · ${b.level.level_name}`
                            : '';
                    const child = b.name ? ` · ${b.name}` : '';
                    const session = b.session?.session_name ? ` (${b.session.session_name})` : '';
                    return {
                        id: b.id,
                        label: `${b.package_dto?.package_name ?? courseTerm}${level}${child}${session}`,
                        orgAssociated: !!b.is_org_associated,
                        // Search also matches each part on its own: batch, level, session.
                        keywords: [b.name, b.level?.level_name, b.session?.session_name].filter(
                            (k): k is string => !!k
                        ),
                    };
                })
                .sort((a, b) => a.label.localeCompare(b.label))
                // The searchable list keys items by label: two unnamed batches of the same course,
                // level and session would collide, so a duplicate gets a short id suffix.
                .map((c, i, all) =>
                    all.some((o, j) => j !== i && o.label === c.label)
                        ? { ...c, label: `${c.label} · #${c.id.slice(-4)}` }
                        : c
                ),
        [batches, courseTerm]
    );
    const selectedCourse = courseOptions.find((c) => c.id === value.packageSessionId) ?? null;

    const { data: resolved, isFetching: resolving } = useResolvedInviteDetails({
        instituteId,
        packageSessionId: value.mode === 'NEW_ENROLLMENT' ? (value.packageSessionId ?? '') : '',
        enrollInviteId: value.enrollInviteId,
    });
    const paymentPlans = (resolved?.paymentOption?.payment_plans ?? []).filter(
        (p) => (p.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE'
    );
    const selectedPaymentPlan = paymentPlans.find((p) => p.id === value.planId) ?? null;

    useEffect(() => {
        onOrgAssociatedChange?.(value.mode === 'NEW_ENROLLMENT' && !!selectedCourse?.orgAssociated);
    }, [value.mode, selectedCourse?.orgAssociated, onOrgAssociatedChange]);

    // Keep what Auto resolved (invite, option, default plan) in the draft.
    useEffect(() => {
        if (value.mode !== 'NEW_ENROLLMENT' || !value.packageSessionId || !resolved) return;
        const resolvedInviteId = resolved.invite?.id ?? null;
        const paymentOptionId = resolved.paymentOption?.id ?? null;
        const paymentOptionType = resolved.paymentOption?.type ?? null;
        const inviteAmbiguous = resolved.resolution === 'AMBIGUOUS';
        const planStillValid = paymentPlans.some((p) => p.id === value.planId);
        const planId = planStillValid ? value.planId : (paymentPlans[0]?.id ?? null);
        if (
            resolvedInviteId !== value.resolvedInviteId ||
            paymentOptionId !== value.paymentOptionId ||
            paymentOptionType !== value.paymentOptionType ||
            inviteAmbiguous !== value.inviteAmbiguous ||
            planId !== value.planId
        ) {
            set({ resolvedInviteId, paymentOptionId, paymentOptionType, inviteAmbiguous, planId });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolved, value.mode, value.packageSessionId]);

    // Prefill the first line once a product is picked.
    useEffect(() => {
        if (value.mode === 'RENEWAL' && selectedPlan) {
            onSuggestLine({
                description: `${t('productLink.renewalLinePrefix', { defaultValue: 'Renewal' })} — ${planName(selectedPlan)}`,
                unitPrice: planPrice(selectedPlan),
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value.mode, selectedPlan?.id]);
    useEffect(() => {
        if (value.mode === 'NEW_ENROLLMENT' && selectedCourse) {
            onSuggestLine({
                description: selectedPaymentPlan
                    ? `${selectedCourse.label} — ${selectedPaymentPlan.name}`
                    : selectedCourse.label,
                unitPrice: selectedPaymentPlan?.actual_price ?? null,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value.mode, selectedCourse?.id, selectedPaymentPlan?.id]);

    const modes: { mode: ProductLinkMode; label: string }[] = [
        { mode: 'NONE', label: t('productLink.modes.none', { defaultValue: 'No product' }) },
        {
            mode: 'RENEWAL',
            label: t('productLink.modes.renewal', { defaultValue: 'Renew a membership' }),
        },
        {
            mode: 'NEW_ENROLLMENT',
            label: t('productLink.modes.newEnrollment', {
                defaultValue: 'Enrol in a new {{course}}',
                course: courseTerm,
            }),
        },
    ];

    const isSubscription = (opt?: string | null) => (opt ?? '').toUpperCase() === 'SUBSCRIPTION';
    const showMemberPrice =
        value.mode === 'RENEWAL'
            ? !!selectedPlan
            : value.mode === 'NEW_ENROLLMENT' && isSubscription(value.paymentOptionType);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body font-semibold text-neutral-700">
                    {t('productLink.heading', { defaultValue: 'Product (optional)' })}
                </p>
                <div className="flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-1">
                    {modes.map((m) => (
                        <button
                            key={m.mode}
                            type="button"
                            onClick={() =>
                                onChange({
                                    ...EMPTY_PRODUCT_LINK,
                                    mode: m.mode,
                                })
                            }
                            className={cn(
                                'rounded-md px-2.5 py-1 text-caption font-medium transition-colors',
                                value.mode === m.mode
                                    ? 'bg-white text-primary-600 shadow-sm'
                                    : 'text-neutral-600 hover:text-neutral-800'
                            )}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>

            {value.mode === 'RENEWAL' && (
                <div className="space-y-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-caption text-neutral-600">
                            {t('productLink.membershipLabel', { defaultValue: 'Membership to renew' })}
                        </label>
                        <Select
                            value={value.userPlanId ?? undefined}
                            onValueChange={(id) => set({ userPlanId: id })}
                            disabled={plansLoading}
                        >
                            <SelectTrigger>
                                <SelectValue
                                    placeholder={
                                        plansLoading
                                            ? t('productLink.loading', { defaultValue: 'Loading…' })
                                            : t('productLink.membershipPlaceholder', {
                                                  defaultValue: 'Choose a membership',
                                              })
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent className="z-popover-above-modal">
                                {plans.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{planName(p)}</span>
                                            <span className="text-xs text-neutral-500">
                                                {p.status}
                                                {p.end_date ? ` · ${shortDate(p.end_date)}` : ''}
                                                {planPrice(p) != null ? ` · ${planPrice(p)} ${p.payment_plan_dto?.currency ?? ''}` : ''}
                                            </span>
                                        </div>
                                    </SelectItem>
                                ))}
                                {!plansLoading && plans.length === 0 && (
                                    <div className="px-3 py-2 text-xs text-neutral-400">
                                        {t('productLink.noMemberships', {
                                            defaultValue: 'This learner has no membership to renew',
                                        })}
                                    </div>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    {selectedPlan && (
                        <MyInput
                            inputType="date"
                            label={t('productLink.accessUntilLabel', {
                                defaultValue: 'Access until (optional)',
                            })}
                            inputPlaceholder=""
                            input={value.newEndDate}
                            onChangeFunction={(e) => set({ newEndDate: e.target.value })}
                            className="w-full"
                        />
                    )}
                    {selectedPlan && !value.newEndDate && (
                        <p className="text-caption text-neutral-500">
                            {t('productLink.accessUntilHint', {
                                defaultValue:
                                    'Empty: extended by the plan’s validity from its current end date (or from the payment day if it has lapsed).',
                            })}
                        </p>
                    )}
                </div>
            )}

            {value.mode === 'NEW_ENROLLMENT' && (
                <div className="space-y-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-caption text-neutral-600">{courseTerm}</label>
                        <SearchableSelect
                            options={courseOptions.map((c) => ({
                                value: c.id,
                                label: c.label,
                                keywords: c.keywords,
                            }))}
                            value={value.packageSessionId ?? ''}
                            onChange={(id) =>
                                onChange({
                                    ...EMPTY_PRODUCT_LINK,
                                    mode: 'NEW_ENROLLMENT',
                                    packageSessionId: id || null,
                                    notifyLearner: value.notifyLearner,
                                    applyAsMemberPrice: value.applyAsMemberPrice,
                                    applyNow: value.applyNow,
                                })
                            }
                            placeholder={t('productLink.coursePlaceholder', { defaultValue: 'Choose…' })}
                            searchPlaceholder={t('productLink.courseSearch', {
                                defaultValue: 'Search by {{course}}, level, batch or session',
                                course: courseTerm.toLowerCase(),
                            })}
                            emptyText={t('productLink.courseEmpty', { defaultValue: 'Nothing matches' })}
                            filter={prefixFirstFilter}
                            // Inside the dialog: a portalled list could not be scrolled.
                            portal={false}
                            triggerClassName="w-full"
                        />
                    </div>

                    {value.packageSessionId && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex flex-col gap-1">
                                <label className="text-caption text-neutral-600">
                                    {t('productLink.inviteLabel', { defaultValue: 'Invite' })}
                                </label>
                                <InvitePickerDropdown
                                    instituteId={instituteId}
                                    packageSessionId={value.packageSessionId}
                                    value={value.enrollInviteId}
                                    onValueChange={(inviteId) =>
                                        set({ enrollInviteId: inviteId, planId: null })
                                    }
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-caption text-neutral-600">
                                    {t('productLink.planLabel', { defaultValue: 'Plan' })}
                                </label>
                                <Select
                                    value={value.planId ?? undefined}
                                    onValueChange={(id) => set({ planId: id })}
                                    disabled={resolving || paymentPlans.length === 0}
                                >
                                    <SelectTrigger>
                                        <SelectValue
                                            placeholder={
                                                resolving
                                                    ? t('productLink.loading', { defaultValue: 'Loading…' })
                                                    : t('productLink.planDefault', {
                                                          defaultValue: 'Default plan',
                                                      })
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent className="z-popover-above-modal">
                                        {paymentPlans.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                                {p.name} · {p.actual_price} {p.currency ?? ''}
                                                {p.validity_in_days ? ` · ${p.validity_in_days}d` : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {value.packageSessionId && resolved?.resolution === 'NONE' && (
                        <p className="flex items-start gap-1.5 text-caption text-neutral-500">
                            <Info className="mt-0.5 size-3.5 shrink-0" />
                            {t('productLink.noInvite', {
                                defaultValue:
                                    'No invite is set up for this yet: the learner gets free access through a new default invite.',
                            })}
                        </p>
                    )}

                    {value.packageSessionId && (
                        <label className="flex items-center gap-2 text-caption text-neutral-700">
                            <Checkbox
                                checked={value.notifyLearner}
                                onCheckedChange={(c) => set({ notifyLearner: c === true })}
                            />
                            {t('productLink.notifyLearner', {
                                defaultValue: 'Send the enrolment email when it is paid',
                            })}
                        </label>
                    )}
                </div>
            )}

            {showMemberPrice && (
                <label className="flex items-start gap-2 text-caption text-neutral-700">
                    <Checkbox
                        className="mt-0.5"
                        checked={value.applyAsMemberPrice}
                        onCheckedChange={(c) => set({ applyAsMemberPrice: c === true })}
                    />
                    <span className="flex flex-col">
                        <span>
                            {t('productLink.applyAsMemberPrice', {
                                defaultValue: 'Charge {{amount}} on future renewals too (instead of the plan price)',
                                amount: totalLabel,
                            })}
                        </span>
                        {value.applyAsMemberPrice && (
                            <span className="text-neutral-500">
                                {t('productLink.applyAsMemberPriceHint', {
                                    defaultValue:
                                        'The membership moves to a plan at this price with the same validity. If no plan has this price, a private one is created that only this learner is on; the original plan does not change.',
                                })}
                            </span>
                        )}
                    </span>
                </label>
            )}

            {value.mode !== 'NONE' && (
                <label className="flex items-start gap-2 text-caption text-neutral-700">
                    <Checkbox
                        className="mt-0.5"
                        checked={value.applyNow}
                        onCheckedChange={(c) => set({ applyNow: c === true })}
                    />
                    <span>
                        {value.mode === 'RENEWAL'
                            ? t('productLink.applyNowRenewal', {
                                  defaultValue: 'Renew now, collect the payment later',
                              })
                            : t('productLink.applyNowEnrol', {
                                  defaultValue: 'Enrol now, collect the payment later',
                              })}
                    </span>
                </label>
            )}

            {value.mode !== 'NONE' && (
                <p
                    className={cn(
                        'flex items-start gap-1.5 rounded-md px-3 py-2 text-caption',
                        'border border-info-200 bg-info-50 text-info-700'
                    )}
                >
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    {value.applyNow
                        ? t('productLink.applyNowNote', {
                              defaultValue:
                                  'Applied as soon as the invoice is created. The payment is recorded on the membership when it arrives. Cancelling the invoice later does not undo it.',
                          })
                        : value.mode === 'RENEWAL'
                          ? t('productLink.renewalNote', {
                                defaultValue:
                                    'The membership is renewed when this invoice is paid. The invoice amount is the price of this renewal, and the payment is recorded on the membership.',
                            })
                          : t('productLink.enrollmentNote', {
                                defaultValue:
                                    'The learner is enrolled when this invoice is paid. The invoice amount is the price, and the payment is recorded on the new membership.',
                            })}
                </p>
            )}
        </div>
    );
}

// ─── Status on the invoice list ──────────────────────────────────────────────

/**
 * One line under an admin invoice that pays for a product: what it is, and whether it has been
 * applied — "applies on payment", "applying", "applied (until …)", or "failed" with Retry.
 */
export function InvoiceProductLinkStatus({
    invoice,
    instituteId,
    onRefresh,
}: {
    invoice: InvoiceDTO;
    instituteId: string;
    onRefresh?: () => void;
}) {
    const { t } = useTranslation('manageStudentsCreateInvoiceDialog');
    const link = invoice.product_link;
    const retry = useMutation({
        mutationFn: () => applyInvoiceProductLink(invoice.id, instituteId),
        onSuccess: (updated) => {
            if (updated.product_link?.status === 'FULFILLED') {
                toast.success(t('productLink.status.appliedToast', { defaultValue: 'Applied' }));
            } else if (updated.product_link?.error) {
                toast.error(updated.product_link.error);
            }
            onRefresh?.();
        },
        onError: (err: unknown) => {
            const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
            toast.error(message || t('productLink.status.retryFailed', { defaultValue: 'Could not apply it' }));
            onRefresh?.();
        },
    });
    if (!link) return null;

    const invoiceStatus = String(invoice.status || '').toUpperCase();
    const label = link.label || (link.type === 'RENEWAL' ? 'Renewal' : 'Enrolment');
    let state: { text: string; cls: string };
    if (invoiceStatus === 'REJECTED') {
        state = {
            text: t('productLink.status.cancelled', { defaultValue: 'not applied (invoice cancelled)' }),
            cls: 'text-neutral-500',
        };
    } else if (link.status === 'FULFILLED' && invoiceStatus !== 'PAID') {
        state = {
            text: link.result_end_date
                ? t('productLink.status.appliedAwaitingPayment', {
                      defaultValue: 'applied · access until {{date}} · payment pending',
                      date: shortDate(link.result_end_date),
                  })
                : t('productLink.status.appliedAwaitingPaymentNoDate', {
                      defaultValue: 'applied · payment pending',
                  }),
            cls: 'text-success-700',
        };
    } else if (link.status === 'FULFILLED') {
        state = {
            text: link.result_end_date
                ? t('productLink.status.appliedUntil', {
                      defaultValue: 'applied · access until {{date}}',
                      date: shortDate(link.result_end_date),
                  })
                : t('productLink.status.applied', { defaultValue: 'applied' }),
            cls: 'text-success-700',
        };
    } else if (link.status === 'FAILED') {
        state = { text: t('productLink.status.failed', { defaultValue: 'not applied' }), cls: 'text-danger-600' };
    } else if (link.status === 'IN_PROGRESS') {
        state = { text: t('productLink.status.inProgress', { defaultValue: 'applying…' }), cls: 'text-primary-600' };
    } else {
        state = {
            text: link.apply_now
                ? t('productLink.status.pendingNow', { defaultValue: 'not applied yet' })
                : t('productLink.status.pending', { defaultValue: 'applies when paid' }),
            cls: 'text-neutral-500',
        };
    }
    // Retry: a failed one, or one stuck "applying", on a paid (or apply-now) invoice (the server refuses while
    // a run is genuinely in progress, and takes over an abandoned one after 10 minutes).
    const due = invoiceStatus === 'PAID' || (!!link.apply_now && invoiceStatus === 'PENDING_PAYMENT');
    const canRetry = due && (link.status === 'FAILED' || link.status === 'IN_PROGRESS');

    return (
        <div className="mt-0.5 flex flex-col gap-0.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-1.5">
                <span className="inline-flex shrink-0 items-center rounded border border-primary-200 bg-primary-50 px-1.5 py-0.5 text-2xs font-medium text-primary-700">
                    {link.type === 'RENEWAL'
                        ? t('productLink.status.renewalChip', { defaultValue: 'Renewal' })
                        : t('productLink.status.enrolmentChip', { defaultValue: 'Enrolment' })}
                </span>
                <span className="min-w-0 truncate text-neutral-700" title={label}>
                    {label.replace(/^(Renewal|Enrol) · /, '')}
                </span>
                <span aria-hidden className="text-neutral-400">·</span>
                <span className={state.cls}>{state.text}</span>
                {canRetry && (
                    <button
                        type="button"
                        onClick={() => retry.mutate()}
                        disabled={retry.isPending}
                        className="font-medium text-primary-600 hover:underline disabled:opacity-50"
                    >
                        {retry.isPending
                            ? t('productLink.status.retrying', { defaultValue: 'Applying…' })
                            : t('productLink.status.retry', { defaultValue: 'Retry' })}
                    </button>
                )}
            </div>
            {link.status === 'FULFILLED' && link.renewal_price != null && (
                <span className="text-neutral-600">
                    {t('productLink.status.renewsAt', {
                        defaultValue: 'renews at {{amount}} ({{plan}})',
                        amount: `${link.renewal_price} ${invoice.currency ?? ''}`.trim(),
                        plan: link.price_plan_name ?? '',
                    })}
                </span>
            )}
            {link.error && invoiceStatus !== 'REJECTED' && (
                <span className={link.status === 'FAILED' ? 'text-danger-600' : 'text-warning-700'}>
                    {link.error}
                </span>
            )}
        </div>
    );
}
