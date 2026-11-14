import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useProductPageStore } from '../-stores/product-page-store';
import { getFieldVerification } from '@/components/common/enroll-by-invite/-utils/custom-field-helpers';
import {
    dedupeFieldsByKey,
    fieldOrder,
    getActiveFields,
    resolveInitialSelection,
} from '../-utils/custom-field-aggregator';
import { submitProductPageForm } from '../-services/product-page-service';
import { pushTnCAccepted } from '@/components/common/enroll-by-invite/-utils/gtm';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
import { FieldVerification } from './FieldVerification';
import { FieldRenderType, getFieldRenderType } from '@/components/common/enroll-by-invite/-utils/custom-field-helpers';
import { parseDropdownOptions } from '@/components/common/enroll-by-invite/-utils/custom-field-helpers';
import { validatePhoneField } from '@/lib/phone-validation';
import { ArrowLeft, ArrowRight, SpinnerGap } from "@phosphor-icons/react";
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';
import type { ProductPageData, ProductPageSettings, FieldValue, PageJson } from '../-types/product-page-types';

function parseSafeJson<T>(jsonStr: string | null | undefined, fallback: T): T {
    if (!jsonStr) return fallback;
    try { return JSON.parse(jsonStr) as T; } catch { return fallback; }
}

const EMPTY_PAGE_JSON: PageJson = { globalSettings: { primaryColor: '#4F46E5', logoFileId: '' }, components: [] }; // design-lint-ignore: page-builder default color

interface MultiEnrollFormProps {
    pageData: ProductPageData;
    settings: ProductPageSettings;
    primaryColor?: string;
    courseIds?: string;
    onBack: () => void;
    onNext: () => void;
}

export const MultiEnrollForm = ({ pageData, settings, primaryColor = '#2563eb', courseIds, onBack, onNext }: MultiEnrollFormProps) => { // design-lint-ignore: page-builder default color
    const { t } = useTranslation('productPages');
    const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const {
        selectedPsOptionIds, setRegistrationData, setFormSubmitResult, toggleSelection, setSelection, utmParams, finalPrice,
    } = useProductPageStore();

    const currency = pageData.currency || 'INR';
    const currencySymbol = currency === 'INR' ? '₹' : currency;

    // When the total payable is zero, the payment step auto-skips, so this button
    // just advances to the (instant) enrollment — label it "Next" rather than "Continue to Payment".
    const isFreeTotal = finalPrice() <= 0;

    // Only the courses from the URL (or DB-preselected) — shown in "Enrolling for"
    const primaryIds = useMemo(
        () => new Set(resolveInitialSelection(pageData.mappings, courseIds)),
        [pageData.mappings, courseIds]
    );
    const primaryMappings = useMemo(
        () => pageData.mappings.filter((m) => primaryIds.has(m.ps_invite_payment_option_id)),
        [pageData.mappings, primaryIds]
    );

    const pageSuggestions = useMemo(
        () => parseSafeJson<PageJson>(pageData.page_json, EMPTY_PAGE_JSON).suggestions ?? {},
        [pageData.page_json]
    );
    // Include selected suggested courses too so the user can remove them
    const suggestedIds = useMemo(() => [...new Set(
        selectedPsOptionIds.flatMap((id) => pageSuggestions[id] ?? [])
    )], [selectedPsOptionIds, pageSuggestions]);

    const removeSuggested = (id: string) =>
        setSelection(selectedPsOptionIds.filter((sid) => sid !== id));
    const suggestedMappings = useMemo(() => pageData.mappings.filter(
        (m) => suggestedIds.includes(m.ps_invite_payment_option_id) && m.status === 'ACTIVE'
    ), [pageData.mappings, suggestedIds]);

    // Deduped BEFORE anything reads it: validation, submission and rendering all
    // key off fieldKey, so a duplicate row is never a second answer — only a
    // second box asking for the same one.
    const activeAggregatedFields = dedupeFieldsByKey(
        getActiveFields(pageData.mappings, selectedPsOptionIds, pageData.aggregated_custom_fields)
    );

    // The VALUE that was verified, per field — not a boolean. Editing a verified
    // number has to re-arm the gate, and a flag cannot tell you that it did.
    const [verifiedValues, setVerifiedValues] = useState<Record<string, string>>({});

    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [tncAccepted, setTncAccepted] = useState(false);
    const [submitError, setSubmitError] = useState('');

    const updateField = (key: string, value: string) => {
        setFormValues((prev) => ({ ...prev, [key]: value }));
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};
        for (const af of activeAggregatedFields) {
            const cf = af.field.custom_field;
            if (getFieldRenderType(cf.fieldKey, cf.fieldType) === FieldRenderType.PHONE) {
                // The phone widget pre-fills the country dial code, so the value is
                // never empty — a "required + non-empty" check always passes. Check
                // national digits + country-aware format instead.
                const phoneError = validatePhoneField(formValues[cf.fieldKey], {
                    required: cf.isMandatory,
                    label: cf.fieldName,
                });
                if (phoneError) newErrors[cf.fieldKey] = phoneError;
            } else if (cf.isMandatory && !formValues[cf.fieldKey]?.trim()) {
                newErrors[cf.fieldKey] = t('multiEnrollForm.fieldRequired', { fieldName: cf.fieldName });
            }

            // Checked here as well as in the UI: the gate is the whole point of
            // the field, and a disabled button is not a guarantee.
            const verification = getFieldVerification(cf.config);
            const answer = formValues[cf.fieldKey]?.trim();
            if (verification && answer && verifiedValues[cf.fieldKey] !== formValues[cf.fieldKey]) {
                newErrors[cf.fieldKey] = `Please verify your ${cf.fieldName.toLowerCase()} first`;
            }
        }
        if (settings.tnc.enabled && !tncAccepted) {
            newErrors['_tnc'] = t('multiEnrollForm.tncRequired');
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const formSubmitMutation = useMutation({
        mutationFn: () => {
            const registrationData: Record<string, FieldValue> = {};
            for (const af of activeAggregatedFields) {
                const cf = af.field.custom_field;
                registrationData[cf.fieldKey] = {
                    id: cf.id,
                    key: cf.fieldKey,
                    name: cf.fieldName,
                    value: formValues[cf.fieldKey] || '',
                    is_mandatory: cf.isMandatory,
                    type: cf.fieldType,
                    comma_separated_options: cf.commaSeparatedOptions ?? undefined,
                    config: cf.config ?? undefined,
                    enroll_invite_ids: af.enroll_invite_ids,
                };
            }
            setRegistrationData(registrationData);

            return submitProductPageForm({
                coursePageCode: pageData.code,
                instituteId: pageData.institute_id,
                selectedPsInvitePaymentOptionIds: selectedPsOptionIds,
                registrationData,
                utmParams,
            });
        },
        onSuccess: (data) => {
            setFormSubmitResult(data.user_id, data.abandoned_cart_entry_ids);
            if (settings.tnc.enabled) pushTnCAccepted();
            onNext();
        },
        onError: (err) => {
            setSubmitError(err instanceof Error ? err.message : t('multiEnrollForm.submissionFailed'));
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;
        setSubmitError('');
        formSubmitMutation.mutate();
    };

    return (
        <>
            {/* Form. Sits inside CheckoutLayout's card, alongside the live
                order summary — hence panel padding rather than a page shell. */}
            <div className="px-5 py-6 sm:px-6">
                <div className="mb-6">
                    <h1 className="text-xl font-bold text-gray-900">{t('multiEnrollForm.title')}</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        {t('multiEnrollForm.subtitle')}
                    </p>
                </div>

                {/* Selected courses — compact single-line summary (URL-passed or preselected only) */}
                {primaryMappings.length > 0 && (
                    <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                        <span className="shrink-0 text-xs font-medium text-gray-400">{t('multiEnrollForm.enrollingFor')}</span>
                        {primaryMappings.map((m) => {
                            const name = m.package_name
                                ? `${m.package_name}${m.session_name ? ` · ${m.session_name}` : ''}`
                                : m.payment_plan?.name || course;
                            const price = m.payment_plan?.actual_price ?? 0;
                            return (
                                <span
                                    key={m.ps_invite_payment_option_id}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs"
                                >
                                    <span className="max-w-36 truncate font-medium text-gray-800">{name}</span>
                                    {price > 0 && (
                                        <span className="text-gray-400">·&nbsp;{currencySymbol}{price.toLocaleString()}</span>
                                    )}
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* Suggested courses — shown before the form so users can adjust their cart before filling fields */}
                {(() => {
                    const showOn = settings.suggestedCourses?.showOn ?? 'BOTH';
                    const visible = settings.suggestedCourses?.enabled &&
                        (showOn === 'FORM' || showOn === 'BOTH') &&
                        suggestedMappings.length > 0;
                    if (!visible) return null;
                    return (
                        <div className="mb-6 space-y-stack">
                            <h2 className="text-sm font-semibold text-gray-700">
                                {settings.suggestedCourses!.heading || t('common.peopleAlsoBuy')}
                            </h2>
                            <div className="flex gap-3 overflow-x-auto pb-2">
                                {suggestedMappings.map((m) => {
                                    const plan = m.payment_plan;
                                    const isAdded = selectedPsOptionIds.includes(m.ps_invite_payment_option_id);
                                    const initials = (m.package_name || plan?.name || 'C')
                                        .trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
                                    const label = m.package_name
                                        ? `${m.package_name}${m.session_name ? ` · ${m.session_name}` : ''}`
                                        : plan?.name || course;
                                    return (
                                        <div
                                            key={m.ps_invite_payment_option_id}
                                            className="flex w-44 shrink-0 flex-col rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                                        >
                                            <div
                                                className="mb-2.5 flex size-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                                                style={{ backgroundColor: primaryColor }}
                                            >
                                                {initials}
                                            </div>
                                            <p className="mb-1 line-clamp-2 flex-1 text-xs font-semibold leading-snug text-gray-900">{label}</p>
                                            <p className="mb-3 text-sm font-bold text-gray-900">
                                                {(plan?.actual_price ?? 0) > 0
                                                    ? `${currencySymbol}${plan!.actual_price.toLocaleString()}`
                                                    : t('common.free')}
                                            </p>
                                            {isAdded ? (
                                                <button
                                                    type="button"
                                                    onClick={() => removeSuggested(m.ps_invite_payment_option_id)}
                                                    className="w-full rounded-lg border border-red-400 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:opacity-80"
                                                >
                                                    {t('common.removeSuggested')}
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSelection(m.ps_invite_payment_option_id)}
                                                    className="w-full rounded-lg border py-1.5 text-xs font-semibold transition-colors hover:opacity-80"
                                                    style={{ borderColor: primaryColor, color: primaryColor }}
                                                >
                                                    {t('common.addSuggested')}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                <form onSubmit={handleSubmit} className="space-y-5">
                    {activeAggregatedFields
                        .slice()
                        .sort((a, b) => fieldOrder(a) - fieldOrder(b))
                        .map((af) => {
                            const cf = af.field.custom_field;
                            const renderType = getFieldRenderType(cf.fieldKey, cf.fieldType);
                            const verification = getFieldVerification(cf.config);
                            const options = cf.commaSeparatedOptions
                                ? parseDropdownOptions(cf.commaSeparatedOptions)
                                : cf.config && cf.config !== '{}'
                                  ? parseDropdownOptions(cf.config)
                                  : [];

                            return (
                                <div key={cf.id} className="space-y-1">
                                    <label className="block text-sm font-medium text-gray-700">
                                        {cf.fieldName}
                                        {cf.isMandatory && (
                                            <span className="ms-1 text-red-500">*</span>
                                        )}
                                    </label>
                                    <CustomFieldRenderer
                                        type={renderType}
                                        name={cf.fieldKey}
                                        placeholder={t('multiEnrollForm.enterPlaceholder', { fieldName: cf.fieldName.toLowerCase() })}
                                        value={formValues[cf.fieldKey] || ''}
                                        onChange={(val) => updateField(cf.fieldKey, String(val))}
                                        options={options}
                                        config={cf.config ?? undefined}
                                        required={cf.isMandatory}
                                    />
                                    {verification && (
                                        <FieldVerification
                                            verification={verification}
                                            value={formValues[cf.fieldKey] || ''}
                                            instituteId={pageData.institute_id}
                                            label={cf.fieldName}
                                            verified={
                                                !!formValues[cf.fieldKey] &&
                                                verifiedValues[cf.fieldKey] === formValues[cf.fieldKey]
                                            }
                                            onVerified={(verifiedValue) => {
                                                setVerifiedValues((prev) => ({
                                                    ...prev,
                                                    [cf.fieldKey]: verifiedValue,
                                                }));
                                                setErrors((prev) => ({ ...prev, [cf.fieldKey]: '' }));
                                            }}
                                        />
                                    )}
                                    {errors[cf.fieldKey] && (
                                        <p className="text-xs text-red-600">{errors[cf.fieldKey]}</p>
                                    )}
                                </div>
                            );
                        })}

                    {settings.tnc.enabled && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            {settings.tnc.content && (
                                <div
                                    className="mb-3 text-xs text-gray-600 prose prose-xs max-w-none"
                                    dangerouslySetInnerHTML={{ __html: settings.tnc.content }}
                                />
                            )}
                            {settings.tnc.externalUrl && !settings.tnc.content && (
                                <p className="mb-3 text-xs text-gray-600">
                                    {t('multiEnrollForm.readOurTnc')}{' '}
                                    <a
                                        href={settings.tnc.externalUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline text-blue-600"
                                    >
                                        {t('multiEnrollForm.termsAndConditionsLink')}
                                    </a>
                                    .
                                </p>
                            )}
                            <label className="flex cursor-pointer items-start gap-2">
                                <input
                                    type="checkbox"
                                    checked={tncAccepted}
                                    onChange={(e) => {
                                        setTncAccepted(e.target.checked);
                                        if (errors['_tnc']) setErrors((p) => ({ ...p, _tnc: '' }));
                                    }}
                                    className="mt-0.5 size-4 rounded border-gray-300 text-blue-600"
                                />
                                <span className="text-sm text-gray-700">
                                    {t('multiEnrollForm.tncAgreeCheckbox')}
                                </span>
                            </label>
                            {errors['_tnc'] && (
                                <p className="mt-1 text-xs text-red-600">{errors['_tnc']}</p>
                            )}
                        </div>
                    )}

                    {submitError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {submitError}
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-2">
                        {!settings.disableBackNavigation ? (
                            <button
                                type="button"
                                onClick={onBack}
                                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
                            >
                                <ArrowLeft className="size-4" />
                                {t('common.back')}
                            </button>
                        ) : <div />}
                        <button
                            type="submit"
                            disabled={formSubmitMutation.isPending}
                            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                            style={{ backgroundColor: primaryColor }}
                        >
                            {formSubmitMutation.isPending ? (
                                <>
                                    <SpinnerGap className="size-4 animate-spin" />
                                    {t('multiEnrollForm.saving')}
                                </>
                            ) : (
                                <>
                                    {isFreeTotal ? t('common.next') : t('multiEnrollForm.continueToPayment')}
                                    <ArrowRight className="size-4" />
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
};
