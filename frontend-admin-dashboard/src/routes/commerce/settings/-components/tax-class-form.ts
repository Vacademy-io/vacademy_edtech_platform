import type { TFunction } from 'i18next';
import { z } from 'zod';
import type { TaxClass, TaxClassRequest } from '@/routes/commerce/-shared/commerce-types';

/**
 * Form model for a tax class and its slabs. Numbers are held as the text the
 * person typed and converted once, on save, so "5" never turns into 5.000001
 * on the way. No rate, HSN code or slab is ever pre-filled.
 */
const DECIMAL = /^\d+(\.\d{1,2})?$/;
const OPTIONAL_DECIMAL = /^(\d+(\.\d{1,2})?)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPTIONAL_ISO_DATE = /^(\d{4}-\d{2}-\d{2})?$/;

const percent = (value: string) => Number(value) >= 0 && Number(value) <= 100;

export const buildTaxClassSchema = (t: TFunction) =>
    z.object({
        name: z.string().trim().min(1, t('taxClasses.validation.nameRequired')).max(120),
        code: z
            .string()
            .trim()
            .min(2, t('taxClasses.validation.codeFormat'))
            .max(30, t('taxClasses.validation.codeFormat'))
            .regex(/^[A-Z0-9_-]+$/, t('taxClasses.validation.codeFormat')),
        hsn_code: z
            .string()
            .trim()
            .regex(/^(\d{4}|\d{6}|\d{8})?$/, t('taxClasses.validation.hsn')),
        unit: z.string().trim().max(10, t('taxClasses.validation.unit')),
        rules: z
            .array(
                z
                    .object({
                        rule_id: z.string(),
                        min_unit_price: z
                            .string()
                            .trim()
                            .regex(DECIMAL, t('taxClasses.validation.amount')),
                        max_unit_price: z
                            .string()
                            .trim()
                            .regex(OPTIONAL_DECIMAL, t('taxClasses.validation.amount')),
                        rate_percent: z
                            .string()
                            .trim()
                            .regex(DECIMAL, t('taxClasses.validation.rate'))
                            .refine(percent, t('taxClasses.validation.rate')),
                        cess_percent: z
                            .string()
                            .trim()
                            .regex(OPTIONAL_DECIMAL, t('taxClasses.validation.rate'))
                            .refine(percent, t('taxClasses.validation.rate')),
                        effective_from: z
                            .string()
                            .regex(ISO_DATE, t('taxClasses.validation.fromRequired')),
                        effective_to: z
                            .string()
                            .regex(OPTIONAL_ISO_DATE, t('taxClasses.validation.date')),
                    })
                    .superRefine((rule, ctx) => {
                        if (
                            rule.max_unit_price !== '' &&
                            DECIMAL.test(rule.min_unit_price) &&
                            DECIMAL.test(rule.max_unit_price) &&
                            Number(rule.max_unit_price) <= Number(rule.min_unit_price)
                        ) {
                            ctx.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ['max_unit_price'],
                                message: t('taxClasses.validation.maxAboveMin'),
                            });
                        }
                        if (rule.effective_to !== '' && rule.effective_to < rule.effective_from) {
                            ctx.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ['effective_to'],
                                message: t('taxClasses.validation.toBeforeFrom'),
                            });
                        }
                    })
            )
            .min(1, t('taxClasses.validation.oneSlab')),
    });

export type TaxClassValues = z.infer<ReturnType<typeof buildTaxClassSchema>>;
export type TaxRuleValues = TaxClassValues['rules'][number];

export const EMPTY_RULE: TaxRuleValues = {
    rule_id: '',
    min_unit_price: '0',
    max_unit_price: '',
    rate_percent: '',
    cess_percent: '',
    effective_from: '',
    effective_to: '',
};

export const EMPTY_TAX_CLASS: TaxClassValues = {
    name: '',
    code: '',
    hsn_code: '',
    unit: '',
    rules: [EMPTY_RULE],
};

const text = (value: number | null | undefined): string =>
    value === null || value === undefined ? '' : String(value);

export const taxClassToValues = (taxClass: TaxClass): TaxClassValues => ({
    name: taxClass.name,
    code: taxClass.code.toUpperCase(),
    hsn_code: taxClass.hsn_code ?? '',
    unit: taxClass.unit ?? '',
    rules:
        taxClass.rules.length > 0
            ? taxClass.rules.map((rule) => ({
                  rule_id: rule.id ?? '',
                  min_unit_price: text(rule.min_unit_price),
                  max_unit_price: text(rule.max_unit_price),
                  rate_percent: text(rule.rate_percent),
                  cess_percent: text(rule.cess_percent),
                  effective_from: rule.effective_from,
                  effective_to: rule.effective_to ?? '',
              }))
            : [EMPTY_RULE],
});

export const valuesToTaxClassRequest = (values: TaxClassValues): TaxClassRequest => ({
    name: values.name,
    code: values.code,
    hsn_code: values.hsn_code || null,
    unit: values.unit ? values.unit.toUpperCase() : null,
    rules: values.rules.map((rule) => ({
        ...(rule.rule_id ? { id: rule.rule_id } : {}),
        min_unit_price: Number(rule.min_unit_price),
        max_unit_price: rule.max_unit_price === '' ? null : Number(rule.max_unit_price),
        rate_percent: Number(rule.rate_percent),
        cess_percent: rule.cess_percent === '' ? null : Number(rule.cess_percent),
        effective_from: rule.effective_from,
        effective_to: rule.effective_to || null,
    })),
});

/**
 * True when two slabs in force on the same date cover the same price: the
 * invariant of `commerce_tax_rate_rule`. Checked before saving so the person
 * sees which rows clash; the server enforces it.
 */
export function slabsOverlap(rules: TaxRuleValues[]): boolean {
    const spans = rules.map((rule) => ({
        min: Number(rule.min_unit_price),
        max: rule.max_unit_price === '' ? Number.POSITIVE_INFINITY : Number(rule.max_unit_price),
        from: rule.effective_from,
        to: rule.effective_to || '9999-12-31',
    }));
    for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
            const a = spans[i]!;
            const b = spans[j]!;
            const datesMeet = a.from <= b.to && b.from <= a.to;
            const pricesMeet = a.min < b.max && b.min < a.max;
            if (datesMeet && pricesMeet) return true;
        }
    }
    return false;
}
