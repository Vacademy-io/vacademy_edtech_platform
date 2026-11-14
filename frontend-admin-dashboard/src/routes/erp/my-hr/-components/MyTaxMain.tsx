import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Info, Lock, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';
import { reportApiError } from '@/lib/report-api-error';
import { HrTextField } from '@/routes/erp/people/-components/HrFormFields';
import { HrErrorState, HrLoadingRows } from '@/routes/erp/people/-components/HrStates';
import {
    financialYearOf,
    recentFinancialYears,
} from '@/routes/erp/compliance/-components/compliance-shared';
import {
    useMyHrIdentity,
    useMyTaxDeclaration,
    useSaveTaxDeclaration,
} from '@/routes/erp/my-hr/-hooks/use-my-hr';
import { MyHrNoProfileState, MyHrStatusChip } from './my-hr-shared';

/**
 * The chapter VI-A heads the payroll tax engine reads out of `declarations`.
 *
 * Labelled in the words someone actually thinks in — "Life insurance, PPF, ELSS,
 * home-loan principal" beats "section_80c" for everyone who is not an
 * accountant — with the section number kept as a hint so a CA-supplied list
 * still maps cleanly onto the form.
 */
const OLD_REGIME_FIELD_NAMES = [
    'section_80c',
    'section_80d',
    'section_80ccd1b',
    'section_80e',
    'hra_rent_paid',
] as const;

const NAMESPACE = 'erpMyTaxMain';

/**
 * `schema` is a module-scope singleton whose shape drives `TaxFormValues` via
 * `z.infer`, so it cannot be rebuilt inside the component with a `t` from
 * `useTranslation()` without breaking that type. Validation copy uses the
 * shared i18next singleton directly instead (same pattern as
 * studyLibraryScheduleSchema).
 */
const schemaT: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

/** Labelled in the words someone actually thinks in, built with `t` inside the component. */
const buildOldRegimeFields = (t: TFunction) =>
    OLD_REGIME_FIELD_NAMES.map((name) => ({
        name,
        label: t(`oldRegimeFields.${name}.label`),
        hint: t(`oldRegimeFields.${name}.hint`),
    }));

const amount = z
    .string()
    .trim()
    .refine((value) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0), {
        message: schemaT('validation.amountNonNegative'),
    });

const schema = z.object({
    section_80c: amount,
    section_80d: amount,
    section_80ccd1b: amount,
    section_80e: amount,
    hra_rent_paid: amount,
    is_metro_city: z.boolean(),
});

type TaxFormValues = z.infer<typeof schema>;

const emptyValues: TaxFormValues = {
    section_80c: '',
    section_80d: '',
    section_80ccd1b: '',
    section_80e: '',
    hra_rent_paid: '',
    is_metro_city: false,
};

/** Whatever the record holds for `key`, as a string an input can show. */
const declaredString = (declarations: Record<string, unknown> | undefined, key: string): string => {
    const value = declarations?.[key];
    if (value === null || value === undefined || value === '') return '';
    return String(value);
};

/** A declaration in one of these states is HR's copy now, not the employee's draft. */
const LOCKED_STATUSES = new Set(['VERIFIED', 'LOCKED']);

/**
 * The employee's tax declaration for a financial year.
 *
 * **Why the regime is a choice and not a field.** Under the new regime almost
 * none of the deductions below apply, so showing them anyway would invite
 * someone to fill in six numbers that change nothing about their take-home. The
 * two options are presented as cards with the trade-off written out, and the
 * deduction fields only exist once the old regime is picked.
 *
 * **What this screen does NOT do.** It does not compute tax, and it does not
 * accept proofs — HR verifies documents separately, and a declaration they have
 * verified or locked can no longer be edited here. That is stated on the page
 * rather than discovered by a failed save.
 */
export const MyTaxMain = () => {
    const { t } = useTranslation('erpMyTaxMain');
    const { employeeId, isProfileLoading, hasNoProfile } = useMyHrIdentity();
    const [financialYear, setFinancialYear] = useState(() => financialYearOf());
    const [regime, setRegime] = useState<'OLD' | 'NEW'>('NEW');
    const [refusal, setRefusal] = useState<string | null>(null);

    const query = useMyTaxDeclaration(employeeId, financialYear);
    const mutation = useSaveTaxDeclaration(employeeId, financialYear);

    const declaration = query.data ?? null;
    const status = (declaration?.status ?? '').toUpperCase();
    const isLocked = LOCKED_STATUSES.has(status);

    const form = useForm<TaxFormValues>({
        resolver: zodResolver(schema),
        defaultValues: emptyValues,
        mode: 'onBlur',
    });

    /**
     * Re-seed from the record whenever the FY (or the record) changes. Without
     * this, switching years would leave last year's numbers in the inputs and
     * silently save them against the new year.
     */
    useEffect(() => {
        setRefusal(null);
        if (!declaration) {
            setRegime('NEW');
            form.reset(emptyValues);
            return;
        }
        const declarations = declaration.declarations as Record<string, unknown> | undefined;
        setRegime((declaration.regime ?? 'NEW').toUpperCase() === 'OLD' ? 'OLD' : 'NEW');
        form.reset({
            section_80c: declaredString(declarations, 'section_80c'),
            section_80d: declaredString(declarations, 'section_80d'),
            section_80ccd1b: declaredString(declarations, 'section_80ccd1b'),
            section_80e: declaredString(declarations, 'section_80e'),
            hra_rent_paid: declaredString(declarations, 'hra_rent_paid'),
            is_metro_city: declarations?.['is_metro_city'] === true,
        });
    }, [declaration, form]);

    const isMetro = form.watch('is_metro_city');
    const oldRegimeFields = useMemo(() => buildOldRegimeFields(t), [t]);

    const save = form.handleSubmit(async (values) => {
        setRefusal(null);
        const declarations: Record<string, unknown> =
            regime === 'OLD'
                ? {
                      ...Object.fromEntries(
                          OLD_REGIME_FIELD_NAMES.map((name) => [
                              name,
                              // Blank means "nothing under this head", which the engine
                              // reads as zero — sending "" would be a parse error.
                              values[name] === '' ? 0 : Number(values[name]),
                          ])
                      ),
                      is_metro_city: values.is_metro_city,
                  }
                : {};
        try {
            await mutation.mutateAsync({
                declarationId: declaration?.id,
                regime,
                declarations,
            });
            toast.success(t('toast.saved'));
        } catch (error) {
            setRefusal(
                reportApiError(error, {
                    feature: 'erp-my-hr',
                    tags: { action: 'save-tax-declaration' },
                    fallbackMessage: t('errors.saveFailed'),
                    showToast: false,
                })
            );
        }
    });

    const regimeCards = useMemo(
        () =>
            [
                {
                    value: 'NEW' as const,
                    title: t('regimeCards.new.title'),
                    blurb: t('regimeCards.new.blurb'),
                },
                {
                    value: 'OLD' as const,
                    title: t('regimeCards.old.title'),
                    blurb: t('regimeCards.old.blurb'),
                },
            ] as const,
        [t]
    );

    if (isProfileLoading) return <HrLoadingRows rows={4} />;
    if (hasNoProfile) return <MyHrNoProfileState />;

    return (
        <div className="flex flex-col gap-5">
            <p className="max-w-3xl text-body text-muted-foreground">{t('intro')}</p>

            <div className="flex flex-wrap items-center gap-3">
                <span className="text-caption text-muted-foreground">
                    {t('financialYearLabel')}
                </span>
                <MyDropdown
                    currentValue={financialYear}
                    dropdownList={recentFinancialYears()}
                    handleChange={(value) => setFinancialYear(String(value))}
                />
                {declaration?.status && <MyHrStatusChip status={declaration.status} />}
            </div>

            {query.isLoading ? (
                <HrLoadingRows rows={3} />
            ) : query.isError ? (
                <HrErrorState
                    message={t('errors.loadFailed')}
                    onRetry={() => void query.refetch()}
                />
            ) : (
                <>
                    {isLocked && (
                        <div className="flex items-start gap-2 rounded-md border border-info-200 bg-info-50 p-3">
                            <Lock size={16} className="mt-0.5 shrink-0 text-info-600" />
                            <p className="text-body text-neutral-600">
                                {status === 'VERIFIED'
                                    ? t('lockedNotice.verified')
                                    : t('lockedNotice.locked')}
                            </p>
                        </div>
                    )}

                    <section className="flex flex-col gap-3">
                        <h2 className="text-title text-foreground">{t('whichRegime')}</h2>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {regimeCards.map((card) => {
                                const selected = regime === card.value;
                                return (
                                    <button
                                        key={card.value}
                                        type="button"
                                        disabled={isLocked}
                                        onClick={() => setRegime(card.value)}
                                        aria-pressed={selected}
                                        className={cn(
                                            'flex flex-col gap-2 rounded-lg border p-4 text-start transition-colors',
                                            selected
                                                ? 'border-primary-500 bg-primary-50'
                                                : 'border-border bg-card hover:border-primary-200',
                                            isLocked && 'cursor-not-allowed opacity-60'
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={cn(
                                                    'size-4 rounded-full border-2',
                                                    selected
                                                        ? 'border-primary-500 bg-primary-500'
                                                        : 'border-neutral-300'
                                                )}
                                            />
                                            <span className="text-subtitle font-medium text-foreground">
                                                {card.title}
                                            </span>
                                        </div>
                                        <span className="text-caption text-muted-foreground">
                                            {card.blurb}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    {regime === 'NEW' ? (
                        <Card className="flex items-start gap-2 p-4">
                            <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                            <p className="text-body text-muted-foreground">
                                {t('newRegimeNote')}
                            </p>
                        </Card>
                    ) : (
                        <Form {...form}>
                            <form className="flex flex-col gap-4" noValidate>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    {oldRegimeFields.map((field) => (
                                        <HrTextField
                                            key={field.name}
                                            control={form.control}
                                            name={field.name}
                                            label={field.label}
                                            inputType="number"
                                            placeholder="0"
                                            description={field.hint}
                                            disabled={isLocked}
                                        />
                                    ))}
                                </div>

                                <label className="flex items-start gap-2">
                                    <Checkbox
                                        checked={isMetro}
                                        disabled={isLocked}
                                        onCheckedChange={(checked) =>
                                            form.setValue('is_metro_city', checked === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <span className="flex flex-col gap-0.5">
                                        <span className="text-body text-foreground">
                                            {t('metroCheckbox.label')}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {t('metroCheckbox.hint')}
                                        </span>
                                    </span>
                                </label>

                                <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                                    <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                                    <span>{t('hraNote')}</span>
                                </div>
                            </form>
                        </Form>
                    )}

                    {refusal && (
                        <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3">
                            <WarningCircle
                                size={16}
                                weight="fill"
                                className="mt-0.5 shrink-0 text-danger-600"
                            />
                            <p className="text-body text-danger-600">{refusal}</p>
                        </div>
                    )}

                    {!isLocked && (
                        <div className="flex flex-col gap-2">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                type="button"
                                className="w-full sm:w-auto sm:self-start"
                                onAsyncClick={save}
                                loadingText={t('saving')}
                            >
                                {declaration ? t('updateDeclaration') : t('saveDeclaration')}
                            </MyButton>
                            <p className="text-caption text-muted-foreground">
                                {t('keepReceiptsNote')}
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
