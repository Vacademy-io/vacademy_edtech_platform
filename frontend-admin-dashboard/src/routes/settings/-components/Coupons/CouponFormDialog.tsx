import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Percent, Receipt, Sparkle } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import {
    AppliedDiscountInput,
    CouponCreateRequest,
    CouponDetail,
    CouponUpdateRequest,
    useCreateCoupon,
    useUpdateCoupon,
} from '@/services/coupons';
import { CouponScopePicker, CouponScopeValue } from './CouponScopePicker';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    OtherTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';

// =============================================================================
// Schema
// =============================================================================

const buildCouponSchema = (t: TFunction) =>
    z
        .object({
            code: z
                .string()
                .min(3, t('schema.codeMinLength'))
                .max(32, t('schema.codeMaxLength'))
                .regex(/^[A-Z0-9_-]+$/, t('schema.codeFormat')),
            discountType: z.enum(['PERCENTAGE', 'FLAT']),
            // null while the field is blank, so clearing it never snaps back to 0.
            discountValue: z
                .number({ invalid_type_error: t('schema.discountValueRequired') })
                .nullable()
                // superRefine (not refine) so the form type keeps null for the blank state.
                .superRefine((v, ctx) => {
                    if (v === null) {
                        ctx.addIssue({ code: 'custom', message: t('schema.discountValueRequired') });
                    } else if (v <= 0) {
                        ctx.addIssue({ code: 'custom', message: t('schema.discountValuePositive') });
                    }
                }),
            // Blank or 0 = no cap.
            maxDiscountValue: z.number().min(0).nullable().optional(),
            redeemStartDate: z.string().optional(),
            // Blank = never expires.
            redeemEndDate: z.string().optional(),
            usageLimit: z
                .number({ invalid_type_error: t('schema.usageLimitInvalid') })
                .int()
                .positive()
                .nullable()
                .optional(),
            isEmailRestricted: z.boolean(),
            allowedEmailsRaw: z.string().optional(),
            scope: z.object({
                mode: z.enum(['all', 'sessions', 'invites']),
                packageSessionIds: z.array(z.string()),
                enrollInviteIds: z.array(z.string()),
            }),
            status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
        })
        .refine((v) => v.discountType !== 'PERCENTAGE' || (v.discountValue ?? 0) <= 100, {
            message: t('schema.percentageMax'),
            path: ['discountValue'],
        })
        .refine(
            (v) =>
                !v.redeemStartDate ||
                !v.redeemEndDate ||
                new Date(v.redeemEndDate) > new Date(v.redeemStartDate),
            {
                message: t('schema.endDateAfterStart'),
                path: ['redeemEndDate'],
            }
        );

type CouponFormValues = z.infer<ReturnType<typeof buildCouponSchema>>;

// =============================================================================
// Helpers
// =============================================================================

const parseEmails = (raw: string | undefined): string[] =>
    !raw
        ? []
        : raw
              .split(/[,\n\s;]+/)
              .map((s) => s.trim())
              .filter(Boolean);

const formatDateForInput = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // <input type="date"> expects 'YYYY-MM-DD'. Coupons are day-granular —
    // CouponValidationService treats the end date as end-of-day, so we don't
    // need a time picker (and the native datetime-local widget silently
    // blanks the form value when the seconds/AM-PM portion is incomplete).
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const scopeFromDetail = (editing?: CouponDetail | null): CouponScopeValue => {
    if (!editing) return { mode: 'all', packageSessionIds: [], enrollInviteIds: [] };
    if (editing.applicable_enroll_invite_ids.length > 0) {
        return {
            mode: 'invites',
            packageSessionIds: [],
            enrollInviteIds: editing.applicable_enroll_invite_ids,
        };
    }
    if (editing.applicable_package_session_ids.length > 0) {
        return {
            mode: 'sessions',
            packageSessionIds: editing.applicable_package_session_ids,
            enrollInviteIds: [],
        };
    }
    return { mode: 'all', packageSessionIds: [], enrollInviteIds: [] };
};

const formatPreview = (
    t: TFunction,
    v: CouponFormValues,
    locale: string,
    currencySymbol = '₹'
): string => {
    const discountStr =
        v.discountType === 'PERCENTAGE'
            ? v.maxDiscountValue
                ? t('priceLine.percentOffWithMax', {
                      value: v.discountValue ?? 0,
                      max: `${currencySymbol}${v.maxDiscountValue.toLocaleString(locale)}`,
                  })
                : t('priceLine.percentOff', { value: v.discountValue ?? 0 })
            : t('priceLine.flatOff', {
                  amount: `${currencySymbol}${(v.discountValue ?? 0).toLocaleString(locale)}`,
              });
    const expiry = v.redeemEndDate
        ? new Date(v.redeemEndDate).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
          })
        : '';
    return expiry ? t('priceLine.withExpiry', { discount: discountStr, date: expiry }) : discountStr;
};

// =============================================================================
// Component
// =============================================================================

export interface CouponFormDialogProps {
    instituteId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** When set, dialog is in edit mode — code is locked + post-redemption fields disabled. */
    editing?: CouponDetail | null;
    /** Pre-fill scope when launching from a contextual button (e.g. invite flow). */
    prefillScope?: Partial<CouponScopeValue>;
    onSaved?: (coupon: CouponDetail) => void;
}

export const CouponFormDialog = ({
    instituteId,
    open,
    onOpenChange,
    editing,
    prefillScope,
    onSaved,
}: CouponFormDialogProps) => {
    const { t, i18n } = useTranslation('settingsCouponForm');
    const couponSchema = useMemo(() => buildCouponSchema(t), [t]);
    const createMutation = useCreateCoupon();
    const updateMutation = useUpdateCoupon();
    const isEdit = !!editing;
    const isFrozen = (editing?.usage_count ?? 0) > 0;

    const defaultValues = useMemo<CouponFormValues>(() => {
        const baseScope = scopeFromDetail(editing);
        const scope: CouponScopeValue = prefillScope
            ? {
                  mode: prefillScope.mode ?? baseScope.mode,
                  packageSessionIds: prefillScope.packageSessionIds ?? baseScope.packageSessionIds,
                  enrollInviteIds: prefillScope.enrollInviteIds ?? baseScope.enrollInviteIds,
              }
            : baseScope;

        if (editing) {
            const discount = editing.applied_discount;
            return {
                code: editing.code,
                discountType: (discount?.discount_type ?? 'PERCENTAGE') as 'PERCENTAGE' | 'FLAT',
                discountValue: discount?.discount_point ?? null,
                maxDiscountValue: discount?.max_discount_point ?? null,
                redeemStartDate: formatDateForInput(editing.redeem_start_date),
                redeemEndDate: formatDateForInput(editing.redeem_end_date),
                usageLimit: editing.usage_limit ?? null,
                isEmailRestricted: editing.email_restricted,
                allowedEmailsRaw: editing.allowed_email_ids
                    ? (() => {
                          try {
                              return (JSON.parse(editing.allowed_email_ids) as string[]).join(', ');
                          } catch {
                              return editing.allowed_email_ids ?? '';
                          }
                      })()
                    : '',
                scope,
                status: (editing.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as
                    | 'ACTIVE'
                    | 'INACTIVE',
            };
        }
        return {
            code: '',
            discountType: 'PERCENTAGE',
            discountValue: null,
            maxDiscountValue: null,
            redeemStartDate: '',
            redeemEndDate: '',
            usageLimit: null,
            isEmailRestricted: false,
            allowedEmailsRaw: '',
            scope,
            status: 'ACTIVE',
        };
    }, [editing, prefillScope]);

    const form = useForm<CouponFormValues>({
        resolver: zodResolver(couponSchema),
        defaultValues,
    });

    useEffect(() => {
        if (open) form.reset(defaultValues);
    }, [open, defaultValues, form]);

    const watchedValues = form.watch();
    const isPercentage = watchedValues.discountType === 'PERCENTAGE';

    const learnerSingular = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const batchSingular = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const batchPlural = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const inviteSingular = getTerminology(OtherTerms.Invite, SystemTerms.Invite);
    const invitePlural = getTerminologyPlural(OtherTerms.Invite, SystemTerms.Invite);

    const onSubmit = async (values: CouponFormValues) => {
        const appliedDiscount: AppliedDiscountInput = {
            discount_type: values.discountType,
            // The schema rejects a blank value, so it is always set here.
            discount_point: values.discountValue ?? 0,
            max_discount_point:
                values.discountType === 'PERCENTAGE' && values.maxDiscountValue
                    ? values.maxDiscountValue
                    : null,
        };

        const emails = values.isEmailRestricted ? parseEmails(values.allowedEmailsRaw) : [];
        const allowedEmailIdsJson = values.isEmailRestricted ? JSON.stringify(emails) : null;

        const scopePackageSessions =
            values.scope.mode === 'sessions' ? values.scope.packageSessionIds : [];
        const scopeInvites = values.scope.mode === 'invites' ? values.scope.enrollInviteIds : [];

        try {
            let saved: CouponDetail;
            if (isEdit && editing) {
                const updatePayload: CouponUpdateRequest = {
                    status: values.status,
                    redeem_start_date: values.redeemStartDate
                        ? new Date(values.redeemStartDate).toISOString()
                        : null,
                    redeem_end_date: values.redeemEndDate
                        ? new Date(values.redeemEndDate).toISOString()
                        : null,
                    // A null end date means "unchanged" to the API, so blanking it must be explicit.
                    clear_redeem_end_date: !values.redeemEndDate,
                    usage_limit: values.usageLimit ?? null,
                    is_email_restricted: values.isEmailRestricted,
                    allowed_email_ids: allowedEmailIdsJson,
                    applicable_package_session_ids: scopePackageSessions,
                    applicable_enroll_invite_ids: scopeInvites,
                    // Only send discount when un-frozen (pre-redemption)
                    applied_discount: isFrozen ? undefined : appliedDiscount,
                };
                saved = await updateMutation.mutateAsync({
                    couponId: editing.id,
                    payload: updatePayload,
                });
                toast.success(t('toasts.updated'));
            } else {
                const createPayload: CouponCreateRequest = {
                    code: values.code,
                    status: values.status,
                    redeem_start_date: values.redeemStartDate
                        ? new Date(values.redeemStartDate).toISOString()
                        : null,
                    redeem_end_date: values.redeemEndDate
                        ? new Date(values.redeemEndDate).toISOString()
                        : null,
                    usage_limit: values.usageLimit ?? null,
                    is_email_restricted: values.isEmailRestricted,
                    allowed_email_ids: allowedEmailIdsJson,
                    applicable_package_session_ids: scopePackageSessions,
                    applicable_enroll_invite_ids: scopeInvites,
                    applied_discount: appliedDiscount,
                };
                saved = await createMutation.mutateAsync(createPayload);
                toast.success(t('toasts.created', { code: saved.code }));
            }
            onSaved?.(saved);
            onOpenChange(false);
        } catch (err: unknown) {
            const message =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                (err as Error)?.message ??
                t('toasts.saveFailed');
            toast.error(message);
        }
    };

    const isPending = createMutation.isPending || updateMutation.isPending;

    const footer = (
        <>
            <MyButton
                buttonType="secondary"
                scale="medium"
                onClick={() => onOpenChange(false)}
                type="button"
            >
                {t('footer.cancel')}
            </MyButton>
            <MyButton
                buttonType="primary"
                scale="medium"
                onClick={form.handleSubmit(onSubmit)}
                disable={isPending}
                type="button"
            >
                {isPending
                    ? t('footer.saving')
                    : isEdit
                      ? t('footer.saveChanges')
                      : t('footer.createCoupon')}
            </MyButton>
        </>
    );

    return (
        <MyDialog
            heading={isEdit ? t('dialog.editHeading', { code: editing?.code }) : t('dialog.newHeading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footer={footer}
        >
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="grid gap-6 px-1 py-2 md:grid-cols-[1fr_280px]"
                >
                    {/* Left: form fields */}
                    <div className="space-y-6">
                        {/* Basics */}
                        <section className="space-y-3">
                            <h3 className="text-subtitle font-semibold text-neutral-800">
                                {t('basics.title')}
                            </h3>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <FormField
                                    control={form.control}
                                    name="code"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('basics.code.label')}</FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    placeholder={t('basics.code.placeholder')}
                                                    disabled={isEdit}
                                                    className="font-mono uppercase"
                                                    onChange={(e) =>
                                                        field.onChange(e.target.value.toUpperCase())
                                                    }
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="discountType"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('basics.discountType.label')}</FormLabel>
                                            <Select
                                                value={field.value}
                                                onValueChange={field.onChange}
                                                disabled={isFrozen}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="PERCENTAGE">
                                                        {t('basics.discountType.percentage')}
                                                    </SelectItem>
                                                    <SelectItem value="FLAT">
                                                        {t('basics.discountType.flat')}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <FormField
                                    control={form.control}
                                    name="discountValue"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {isPercentage
                                                    ? t('basics.value.labelPercentage')
                                                    : t('basics.value.labelFlat')}
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    type="number"
                                                    step="0.01"
                                                    min={0}
                                                    max={isPercentage ? 100 : undefined}
                                                    placeholder={
                                                        isPercentage
                                                            ? t('basics.value.placeholderPercentage')
                                                            : t('basics.value.placeholderFlat')
                                                    }
                                                    disabled={isFrozen}
                                                    value={field.value ?? ''}
                                                    onChange={(e) =>
                                                        field.onChange(
                                                            e.target.value === ''
                                                                ? null
                                                                : Number(e.target.value)
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {isPercentage && (
                                    <FormField
                                        control={form.control}
                                        name="maxDiscountValue"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t('basics.maxCap.label')}{' '}
                                                    <span className="text-caption text-neutral-400">
                                                        {t('basics.maxCap.noCapHint')}
                                                    </span>
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        min={0}
                                                        placeholder={t('basics.maxCap.placeholder')}
                                                        disabled={isFrozen}
                                                        value={field.value ?? ''}
                                                        onChange={(e) =>
                                                            field.onChange(
                                                                e.target.value === ''
                                                                    ? null
                                                                    : Number(e.target.value)
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </div>
                        </section>

                        {/* Validity */}
                        <section className="space-y-3">
                            <h3 className="text-subtitle font-semibold text-neutral-800">
                                {t('validity.title')}
                            </h3>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <FormField
                                    control={form.control}
                                    name="redeemStartDate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t('validity.startDate.label')}{' '}
                                                <span className="text-caption text-neutral-400">
                                                    {t('validity.startDate.optional')}
                                                </span>
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    type="date"
                                                    disabled={isFrozen}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="redeemEndDate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t('validity.endDate.label')}{' '}
                                                <span className="text-caption text-neutral-400">
                                                    {t('validity.endDate.noExpiryHint')}
                                                </span>
                                            </FormLabel>
                                            <FormControl>
                                                <Input {...field} type="date" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <FormField
                                control={form.control}
                                name="usageLimit"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t('validity.usageLimit.label')}{' '}
                                            <span className="text-caption text-neutral-400">
                                                {t('validity.usageLimit.unlimitedHint')}
                                            </span>
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={1}
                                                step={1}
                                                placeholder={t('validity.usageLimit.placeholder')}
                                                value={field.value ?? ''}
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value === ''
                                                            ? null
                                                            : Number(e.target.value)
                                                    )
                                                }
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </section>

                        {/* Email restriction */}
                        <section className="space-y-3">
                            <FormField
                                control={form.control}
                                name="isEmailRestricted"
                                render={({ field }) => (
                                    <FormItem className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-3">
                                        <div>
                                            <FormLabel className="cursor-pointer">
                                                {t('emailRestriction.restrictLabel')}
                                            </FormLabel>
                                            <p className="text-caption text-neutral-500">
                                                {t('emailRestriction.restrictHint', {
                                                    term: learnerSingular.toLowerCase(),
                                                })}
                                            </p>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            {watchedValues.isEmailRestricted && (
                                <FormField
                                    control={form.control}
                                    name="allowedEmailsRaw"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t('emailRestriction.allowedEmailsLabel')}
                                            </FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    {...field}
                                                    rows={3}
                                                    placeholder={t(
                                                        'emailRestriction.allowedEmailsPlaceholder'
                                                    )}
                                                    className="font-mono text-caption"
                                                />
                                            </FormControl>
                                            <p className="mt-1 text-caption text-neutral-400">
                                                {t('emailRestriction.emailsCaptured', {
                                                    count: parseEmails(field.value).length,
                                                })}
                                            </p>
                                        </FormItem>
                                    )}
                                />
                            )}
                        </section>

                        {/* Scope */}
                        <section className="space-y-3">
                            <h3 className="text-subtitle font-semibold text-neutral-800">
                                {t('scope.title')}
                                {isFrozen && (
                                    <span className="ml-2 text-caption font-normal text-neutral-400">
                                        {t('scope.locked')}
                                    </span>
                                )}
                            </h3>
                            <FormField
                                control={form.control}
                                name="scope"
                                render={({ field }) => (
                                    <FormItem>
                                        <CouponScopePicker
                                            instituteId={instituteId}
                                            value={field.value}
                                            onChange={field.onChange}
                                            disabled={isFrozen}
                                        />
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </section>
                    </div>

                    {/* Right: live preview */}
                    <aside className="space-y-3 rounded-lg border border-primary-100 bg-primary-50/30 p-4">
                        <div className="flex items-center gap-2 text-primary-700">
                            <Sparkle size={18} weight="fill" />
                            <h4 className="text-subtitle font-semibold">
                                {t('livePreview.heading', { term: learnerSingular })}
                            </h4>
                        </div>
                        <div className="rounded-md border border-success-200 bg-success-50 px-3 py-2">
                            <div className="flex items-center gap-2 text-success-700">
                                {isPercentage ? <Percent size={14} /> : <Receipt size={14} />}
                                <span className="font-mono text-caption font-semibold">
                                    {watchedValues.code || t('livePreview.codePlaceholder')}
                                </span>
                            </div>
                            <p className="mt-1 text-caption text-success-700">
                                {formatPreview(t, watchedValues, i18n.language)}
                            </p>
                        </div>
                        <dl className="space-y-2 text-caption">
                            <div className="flex justify-between">
                                <dt className="text-neutral-500">{t('livePreview.status')}</dt>
                                <dd className="font-medium text-neutral-700">
                                    {watchedValues.status}
                                </dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-neutral-500">{t('livePreview.usage')}</dt>
                                <dd className="font-medium text-neutral-700">
                                    {editing?.usage_count ?? 0} / {watchedValues.usageLimit ?? '∞'}
                                </dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-neutral-500">{t('livePreview.scope')}</dt>
                                <dd className="text-right font-medium text-neutral-700">
                                    {watchedValues.scope.mode === 'all'
                                        ? t('livePreview.instituteWide')
                                        : watchedValues.scope.mode === 'sessions'
                                          ? t('livePreview.scopeCount', {
                                                count: watchedValues.scope.packageSessionIds
                                                    .length,
                                                unit:
                                                    watchedValues.scope.packageSessionIds
                                                        .length === 1
                                                        ? batchSingular.toLowerCase()
                                                        : batchPlural.toLowerCase(),
                                            })
                                          : t('livePreview.scopeCount', {
                                                count: watchedValues.scope.enrollInviteIds.length,
                                                unit:
                                                    watchedValues.scope.enrollInviteIds.length ===
                                                    1
                                                        ? inviteSingular.toLowerCase()
                                                        : invitePlural.toLowerCase(),
                                            })}
                                </dd>
                            </div>
                            {watchedValues.isEmailRestricted && (
                                <div className="flex justify-between">
                                    <dt className="text-neutral-500">
                                        {t('livePreview.emailRestricted')}
                                    </dt>
                                    <dd className="font-medium text-neutral-700">
                                        {t('livePreview.allowedCount', {
                                            count: parseEmails(watchedValues.allowedEmailsRaw)
                                                .length,
                                        })}
                                    </dd>
                                </div>
                            )}
                        </dl>
                        {isFrozen && (
                            <p
                                className={cn(
                                    'rounded-md border border-warning-400 bg-warning-100 px-3 py-2',
                                    'text-caption text-warning-600'
                                )}
                            >
                                {t('frozenNotice')}
                            </p>
                        )}
                    </aside>
                </form>
            </Form>
        </MyDialog>
    );
};
