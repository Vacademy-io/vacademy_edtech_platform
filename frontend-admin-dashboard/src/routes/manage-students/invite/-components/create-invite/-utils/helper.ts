import i18next from 'i18next';
import { getInstituteId } from '@/constants/helper';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { CustomField } from '../../../-schema/InviteFormSchema';
import { IndividualInviteLinkDetails } from '@/types/study-library/individual-invite-interface';
import { PaymentPlanApi } from '@/types/payment';

// This module calls i18next.t('manageStudentsCreateInviteHelper:...') from plain function
// bodies (not from a React component), so react-i18next never auto-triggers a load for this
// namespace via useTranslation(). Without an explicit load, every t() call below would return
// the raw key until something else happens to load it. Fire the load eagerly on import so the
// namespace is warm well before any of these functions actually run.
void i18next.loadNamespaces('manageStudentsCreateInviteHelper');

interface DropdownOptionForConversion {
    id: number | string;
    value: string;
    disabled?: boolean;
}

/**
 * Normalises an enroll_invite start_date/end_date (ISO string, 'YYYY-MM-DD', or epoch)
 * into the 'YYYY-MM-DD' value an <input type="date"> expects. Empty/invalid → ''.
 * Used to prefill the availability-window pickers when editing an invite.
 */
export const toDateInputValue = (value?: string | number | null): string => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.slice(0, 10);
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

interface CustomFieldForConversion {
    id: number | string;
    type: string;
    name: string;
    oldKey: boolean;
    isRequired: boolean;
    options?: DropdownOptionForConversion[];
    key?: string;
    order?: number;
}

export interface ReferralData {
    id: string;
    name: string;
    status: string; // Add more status types if applicable
    source: string; // Adjust as needed
    source_id: string;
    referrer_discount_json: string;
    referee_discount_json: string;
    referrer_vesting_days: number;
    tag: string;
    description: string;
    created_at: string; // Consider `Date` if you parse it
    updated_at: string; // Consider `Date` if you parse it
}

type ApiCourseData = {
    course: {
        id: string;
        package_name: string;
    };
    sessions: {
        session_dto: {
            id: string;
            session_name: string;
        };
        level_with_details: {
            id: string;
            name: string;
        }[];
    }[];
};

/**
 * Server-stamped provenance carried onto every picker plan so the dialog can sort
 * newest-first and say who added a plan. All optional: rows created before the
 * created_by column existed have no creator, and a plan appended locally right
 * after "Add New Payment Plan" has neither until the list refetches.
 */
export interface PlanProvenance {
    createdAt?: string | null;
    createdByUserId?: string | null;
    createdByName?: string | null;
}

type FreePlan = PlanProvenance & {
    id: string;
    name: string;
    description: string;
    days?: number;
    suggestedAmount?: number[];
    minAmount?: number;
    currency?: string;
    type?: string;
};

interface PaidPlan extends PlanProvenance {
    id: string;
    name: string;
    description: string;
    price?: string;
    type?: string;
    currency?: string;
    paymentOption?: {
        value: number;
        unit: string;
        price: string;
        features: string[];
        title: string;
        newFeature: string;
    }[];
    /**
     * Set only when type='CPO'. Points at the underlying ComplexPaymentOption so the
     * dialog card can fetch full installment details (count + schedule).
     */
    cpoId?: string;
}

export interface Course {
    id: string;
    name: string;
}

export interface Batch {
    sessionId: string;
    levelId: string;
    sessionName: string;
    levelName: string;
    courseId: string;
    courseName: string;
    isParent?: boolean;
}

export interface PaymentOption {
    id: string;
    name: string;
    status: string; // add more status types if needed
    source: string; // update with other possible sources
    source_id: string;
    tag: string; // restrict more if tag values are known
    type: string; // assuming these are the possible types
    require_approval: boolean;
    payment_plans: PaymentPlanApi[]; // Payment plans array
    payment_option_metadata_json: string; // or parsed as: PaymentOptionMetadata if you want to parse it
    /** Set when type='CPO'. FK to the underlying ComplexPaymentOption row. */
    complex_payment_option_id?: string | null;
    created_at?: string | null;
    created_by_user_id?: string | null;
    created_by_name?: string | null;
}

interface PaymentPlansInterface {
    value: number;
    unit: string;
    price: string;
    features: string[];
    title: string;
    newFeature: string;
}

export function transformApiDataToDummyStructure(data: ApiCourseData[]) {
    const dummyCourses: { id: string; name: string }[] = [];
    const dummyBatches: Record<
        string,
        {
            sessionId: string;
            sessionName: string;
            levels: {
                levelId: string;
                levelName: string;
            }[];
        }[]
    > = {};

    data.forEach((courseItem) => {
        const courseId = courseItem.course.id;
        const courseName = courseItem.course.package_name;

        // Add to dummyCourses
        dummyCourses.push({
            id: courseId,
            name: courseName,
        });

        // Prepare sessions for dummyBatches
        const sessions = courseItem.sessions.map((sessionItem) => ({
            sessionId: sessionItem.session_dto.id,
            sessionName: sessionItem.session_dto.session_name,
            levels: sessionItem.level_with_details.map((lvl) => ({
                levelId: lvl.id,
                levelName: lvl.name,
            })),
        }));

        dummyBatches[courseId] = sessions;
    });

    return { dummyCourses, dummyBatches };
}

/**
 * Normalize the invite form's field type to the backend's expected values.
 * Multi-input revamp (2026-04): forward the actual type instead of
 * collapsing to text/dropdown/number, so the learner form renders the
 * correct input (date picker, file upload, checkboxes, etc.).
 */
function normalizeFieldType(uiType: string): string {
    if (uiType === 'textfield') return 'text';
    return uiType || 'text';
}

function transformCustomFields(customFields: CustomField[], instituteId: string) {
    const toSnakeCase = (str: string | null | undefined) =>
        (str ?? '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .toLowerCase();
    return customFields.map((field, index) => {
        const backendType = normalizeFieldType(field.type);
        const hasOptions = ['dropdown', 'radio', 'multi_select'].includes(backendType);
        const optionValues = hasOptions ? field.options?.map((opt) => opt.value) : undefined;
        // Serialize options as proper JSON array (same format as campaign flow)
        const config = optionValues && optionValues.length > 0
            ? JSON.stringify(optionValues.map((v, i) => ({ id: i + 1, value: v, label: v })))
            : '';

        // Array position is the order the admin sees and drags, so it is the only truthful
        // source here. This was already the effective behaviour — the form schema carries no
        // `order` key, so the previous `field.order ?? index` always fell through to the index
        // — but stamping it explicitly is what makes a reorder actually persist.
        return {
            id: field._id ? (field.id || '') : '',
            institute_id: instituteId,
            type: '',
            type_id: '',
            individual_order: index,
            // Per-form required-ness. The nested `isMandatory` below is the SHARED master row
            // that every other form using this field reads, and the backend deliberately does
            // not write it from here — so without this key the Required switch saved nothing
            // and flipped back on the next open.
            is_mandatory: field.isRequired,
            custom_field: {
                guestId: '',
                id: field._id || '',
                fieldKey: toSnakeCase(field.name),
                fieldName: field.name,
                fieldType: backendType,
                defaultValue: '',
                config,
                formOrder: index,
                isMandatory: field.isRequired,
                isFilter: true,
                isSortable: true,
                createdAt: '',
                updatedAt: '',
                sessionId: '',
                liveSessionId: '',
                customFieldValue: '',
            },
        };
    });
}

function safeJsonParse<T = unknown>(str: string, fallback: T): T {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * Re-transform saved custom fields from backend format to the invite form
 * format used by React Hook Form.
 *
 * Seeded fields (Full Name, Email, Phone Number) are non-deletable but
 * their required status can be toggled. Admin-created fields are fully
 * deletable from the invite.
 */
export function ReTransformCustomFields(inviteDetails: IndividualInviteLinkDetails) {
    const SEEDED_KEYS = ['full_name', 'email', 'phone_number'];

    // The API does not guarantee an order, and the builder treats array position AS the
    // form order (drag reorders the array, and the save path stamps the index). Listing
    // them unsorted therefore both shows the wrong order and writes it back on save.
    const orderOf = (field: { individual_order?: number; custom_field?: { formOrder?: number } }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (field as any).individual_order ?? field.custom_field?.formOrder ?? 0;

    return [...(inviteDetails?.institute_custom_fields ?? [])]
        .sort((a, b) => orderOf(a) - orderOf(b))
        .map((field, index) => {
        // Parse config — handles both formats:
        //   1. New JSON array: [{id,value,label}]  (from updated save path)
        //   2. Old object: { coommaSepartedOptions: "A,B,C" }
        //   3. Plain comma string: "A,B,C"
        let options: { id: string; value: string; disabled: boolean }[] | undefined;
        const rawConfig = field.custom_field.config;
        if (rawConfig) {
            try {
                const parsed = JSON.parse(rawConfig);
                if (Array.isArray(parsed)) {
                    // New format: [{id, value, label}]
                    options = parsed.map((opt: any, i: number) => ({
                        id: String(opt.id ?? i),
                        value: (opt.value || opt.label || '').trim(),
                        disabled: true,
                    }));
                } else if (parsed && typeof parsed === 'object') {
                    // Object format with options array: { options: [...] }
                    if (Array.isArray(parsed.options)) {
                        options = parsed.options.map((opt: any, i: number) => ({
                            id: String(opt.id ?? i),
                            value: (opt.value || opt.label || '').trim(),
                            disabled: true,
                        }));
                    }
                    // Old format: { coommaSepartedOptions: "A,B,C" }
                    const csv = parsed.coommaSepartedOptions || parsed.commaSeparatedOptions;
                    if (!options && typeof csv === 'string') {
                        options = csv.split(',').map((v: string, i: number) => ({
                            id: String(i),
                            value: v.trim(),
                            disabled: true,
                        }));
                    }
                }
            } catch {
                // Plain comma-separated string (not JSON)
                if (rawConfig.includes(',')) {
                    options = rawConfig.split(',').map((v: string, i: number) => ({
                        id: String(i),
                        value: v.trim(),
                        disabled: true,
                    }));
                }
            }
        }

        const cfKey = (field.custom_field.fieldKey || '').toLowerCase();
        const isSeeded = SEEDED_KEYS.some((k) => cfKey.startsWith(k));

        return {
            id: field.id,
            type: field.custom_field.fieldType || 'text',
            name: field.custom_field.fieldName,
            oldKey: isSeeded,
            // What THIS invite stored, not what the field is called and not the shared master:
            // OR-ing `isSeeded` in here dragged Full Name / Email / Phone Number back to Required
            // every time the invite was reopened, and reading the master instead of the mapping
            // showed another form's answer. Seeded fields still START required — that is decided
            // when they are seeded, not here.
            isRequired: field.is_mandatory ?? field.custom_field.isMandatory ?? isSeeded,
            key: field.custom_field.fieldName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, ''),
            order: (field as any).individual_order ?? field.custom_field.formOrder ?? index,
            _id: field.custom_field.id,
            ...(options && { options }),
        };
    });
}

export function convertInviteData(
    data: InviteLinkFormValues,
    selectedCourse: Course | null,
    selectedBatches: Batch[],
    getPackageSessionId: ({
        courseId,
        levelId,
        sessionId,
    }: {
        courseId: string;
        levelId: string;
        sessionId: string;
    }) => void,
    paymentPlans: PaymentOption[],
    referralProgramDetails: ReferralData[],
    instituteLogoFileId: string,
    inviteId?: string,
    existingInviteDetails?: IndividualInviteLinkDetails | null,
    instituteVendor?: { vendor: string; vendor_id: string } | null
) {
    const instituteId = getInstituteId();
    const isBundle = selectedBatches.length > 1;
    const jsonMetaData = {
        course: data.course,
        description: data.description,
        learningOutcome: data.learningOutcome,
        aboutCourse: data.aboutCourse,
        targetAudience: data.targetAudience,
        coursePreview: data.coursePreview,
        courseBanner: data.courseBanner,
        courseMedia: data.courseMedia,
        coursePreviewBlob: data.coursePreviewBlob,
        courseBannerBlob: data.courseBannerBlob,
        courseMediaBlob: data.courseMediaBlob,
        tags: data.tags,
        showRelatedCourses: data.showRelatedCourses,
        includeInstituteLogo: data.includeInstituteLogo,
        blendHeaderWithBackground: data.blendHeaderWithBackground,
        instituteLogoFileId: instituteLogoFileId,
        restrictToSameBatch: data.restrictToSameBatch,
        includePaymentPlans: data.includePaymentPlans,
        customHtml: data.customHtml,
    };

    // Create package_session_to_payment_options for all batches

    const packageSessionToPaymentOptions = selectedBatches.map((batch) => {
        const packageSessionId = getPackageSessionId({
            courseId: batch.courseId,
            levelId: batch.levelId,
            sessionId: batch.sessionId,
        });

        return {
            package_session_id: packageSessionId,
            payment_option: getMatchingPaymentAndReferralPlanForAPIs(
                paymentPlans,
                data.selectedPlan?.id || '',
                referralProgramDetails,
                data.planReferralMappings
            ),
        };
    });

    // enroll_invite.currency is copied onto every payment_log created from this link, and the
    // payments listing reads it to pick the ₹/$/… symbol. Sending '' left those rows with no
    // currency at all, so an INR charge could render as USD — take it from the plan being sold.
    const inviteCurrency =
        paymentPlans.find((option) => option.id === data.selectedPlan?.id)?.payment_plans?.[0]
            ?.currency ||
        data.selectedPlan?.currency ||
        existingInviteDetails?.currency ||
        '';

    const convertedData = {
        id: inviteId || '',
        name: data.name,
        // Invite-link availability window (enroll_invite.start_date / end_date). Empty = open-ended.
        start_date: data.availabilityStartDate || '',
        end_date: data.availabilityEndDate || '',
        invite_code: '',
        status: 'ACTIVE',
        institute_id: instituteId,
        vendor: existingInviteDetails?.vendor || instituteVendor?.vendor || 'STRIPE',
        vendor_id: existingInviteDetails?.vendor_id || instituteVendor?.vendor_id || 'STRIPE',
        currency: inviteCurrency,
        tag: '',
        is_bundled: isBundle,
        // The invite's own access window. The backend reads this for FREE and DONATION
        // plans (which have no plan-level validity); ONE_TIME and SUBSCRIPTION take their
        // days from the payment plan instead. It used to be sent *only* for subscription
        // — the one type that ignores it — so free and donation invites always granted
        // unlimited access no matter what the admin entered.
        learner_access_days: (() => {
            const days = parseInt(data.accessDurationDays ?? '', 10);
            return Number.isFinite(days) && days > 0 ? days : null;
        })(),
        web_page_meta_data_json: JSON.stringify(jsonMetaData),
        setting_json: (() => {
            const existing = existingInviteDetails?.setting_json
                ? JSON.parse(existingInviteDetails.setting_json)
                : {};
            const next = {
                ...existing,
                postformfillConfiguration: data.postformfillConfiguration || {
                    showLoginButton: true,
                },
            };
            // Sub-org settings → setting.SUB_ORG_SETTING (matches EnrollInviteSettingDTO).
            // Only written when enabled; otherwise the block is removed so toggling it
            // off clears a previously-saved sub-org config.
            const subOrg = data.subOrgSettings;
            if (subOrg?.enabled) {
                next.setting = {
                    ...(existing.setting || {}),
                    SUB_ORG_SETTING: {
                        ...((existing.setting || {}).SUB_ORG_SETTING || {}),
                        AUTH_ROLES: subOrg.authRoles ?? [],
                        ALLOWED_TEAM_ROLES: subOrg.allowedTeamRoles ?? [],
                        ADMIN_PERMISSIONS: subOrg.adminPermissions ?? [],
                        ...(subOrg.memberCount != null
                            ? { MEMBER_COUNT: subOrg.memberCount }
                            : {}),
                    },
                };
            } else if (next.setting?.SUB_ORG_SETTING) {
                const { SUB_ORG_SETTING: _removed, ...restSetting } = next.setting;
                next.setting = restSetting;
            }
            // Autopay / free-trial → setting.AUTOPAY_SETTING (read at enrollment).
            // Only written when enabled; removed on toggle-off. Spreads next.setting
            // so a co-enabled SUB_ORG_SETTING above is preserved.
            const autopay = data.autopaySettings;
            if (autopay?.enabled) {
                // Keys this form does not manage (TRIAL_STARTS_ON, TRIAL_TIMEZONE,
                // CHARGE_LEAD_DAYS, ...) are set directly on the invite by ops and must
                // survive an admin re-saving the form. Only the form's own keys are
                // rebuilt below, so clearing a field here still removes that key.
                const { ENABLED: _e, TRIAL_DAYS: _t, MAX_AMOUNT: _m, AUTH_ENABLED: _ae,
                    AUTH_REFUNDABLE: _ar, AUTH_AMOUNT: _aa, GRACE_PERIOD_DAYS: _g,
                    TOTAL_DURATION_MONTHS: _d, ...preservedAutopay } =
                    (next.setting || existing.setting || {}).AUTOPAY_SETTING || {};
                next.setting = {
                    ...(next.setting || existing.setting || {}),
                    AUTOPAY_SETTING: {
                        ...preservedAutopay,
                        ENABLED: true,
                        TRIAL_DAYS: autopay.trialDays ?? 0,
                        ...(autopay.maxAmount != null
                            ? { MAX_AMOUNT: autopay.maxAmount }
                            : {}),
                        AUTH_ENABLED: autopay.authEnabled !== false,
                        AUTH_REFUNDABLE: autopay.authRefundable === true,
                        ...(autopay.authAmount != null
                            ? { AUTH_AMOUNT: autopay.authAmount }
                            : {}),
                        ...(autopay.gracePeriodDays != null
                            ? { GRACE_PERIOD_DAYS: autopay.gracePeriodDays }
                            : {}),
                        ...(autopay.totalDurationMonths != null
                            ? { TOTAL_DURATION_MONTHS: autopay.totalDurationMonths }
                            : {}),
                    },
                };
            } else if (next.setting?.AUTOPAY_SETTING) {
                const { AUTOPAY_SETTING: _removedAutopay, ...restSetting } = next.setting;
                next.setting = restSetting;
            }
            // Availability message → setting.AVAILABILITY_SETTING.UNAVAILABLE_MESSAGE (rich HTML,
            // shown to learners when the link is expired / not-yet-started / deactivated). Written
            // only when the admin entered text; removed when cleared. Spreads next.setting so any
            // co-enabled SUB_ORG_SETTING / AUTOPAY_SETTING block is preserved.
            const unavailableHtml = data.unavailableMessage || '';
            const unavailableText = unavailableHtml.replace(/<[^>]*>/g, '').trim();
            if (unavailableText) {
                next.setting = {
                    ...(next.setting || existing.setting || {}),
                    AVAILABILITY_SETTING: {
                        UNAVAILABLE_MESSAGE: unavailableHtml,
                    },
                };
            } else if (next.setting?.AVAILABILITY_SETTING) {
                const { AVAILABILITY_SETTING: _removedAvail, ...restSetting } = next.setting;
                next.setting = restSetting;
            }
            // Team notifications → setting.NOTIFICATION_SETTING.TO_NOTIFY (comma-separated,
            // same shape as audience.to_notify). The backend mails each address when a
            // learner fills this invite's form. Removed when the admin clears the list.
            const notifyEmails = (data.teamNotificationEmails || [])
                .map((email) => email.trim())
                .filter(Boolean);
            if (notifyEmails.length > 0) {
                next.setting = {
                    ...(next.setting || existing.setting || {}),
                    NOTIFICATION_SETTING: {
                        ENABLED: true,
                        TO_NOTIFY: notifyEmails.join(', '),
                    },
                };
            } else if (next.setting?.NOTIFICATION_SETTING) {
                const { NOTIFICATION_SETTING: _removedNotify, ...restSetting } = next.setting;
                next.setting = restSetting;
            }
            return JSON.stringify(next);
        })(),
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        institute_custom_fields: transformCustomFields(data.custom_fields, instituteId || ''),
        package_session_to_payment_options: packageSessionToPaymentOptions,
    };
    return convertedData;
}

const provenanceOf = (item: PaymentOption): PlanProvenance => ({
    createdAt: item.created_at ?? null,
    createdByUserId: item.created_by_user_id ?? null,
    createdByName: item.created_by_name ?? null,
});

const createdAtMillis = (plan: PlanProvenance): number => {
    if (!plan.createdAt) return Number.POSITIVE_INFINITY;
    const t = new Date(plan.createdAt).getTime();
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

/**
 * Newest plan first. A plan without a created date sorts to the top: the only
 * way one reaches the picker is the local append right after "Add New Payment
 * Plan", and that is exactly the plan the admin is looking for. Stable, so the
 * backend's own created_at DESC order survives for ties.
 */
export function sortPlansNewestFirst<T extends PlanProvenance>(plans: T[]): T[] {
    return plans
        .map((plan, index) => ({ plan, index }))
        .sort((a, b) => createdAtMillis(b.plan) - createdAtMillis(a.plan) || a.index - b.index)
        .map(({ plan }) => plan);
}

/** Picker filter values. ONE_TIME also covers the legacy lowercase 'upfront' rows. */
export type PlanTypeFilter = 'FREE' | 'ONE_TIME' | 'DONATION' | 'SUBSCRIPTION' | 'CPO';

export const PLAN_TYPE_FILTERS: PlanTypeFilter[] = [
    'FREE',
    'ONE_TIME',
    'DONATION',
    'SUBSCRIPTION',
    'CPO',
];

export const normalizePlanType = (type?: string | null): PlanTypeFilter | null => {
    switch ((type ?? '').toLowerCase()) {
        case 'free':
            return 'FREE';
        case 'one_time':
        case 'upfront':
            return 'ONE_TIME';
        case 'donation':
            return 'DONATION';
        case 'subscription':
            return 'SUBSCRIPTION';
        case 'cpo':
            return 'CPO';
        default:
            return null;
    }
};

/**
 * Applies the picker's search box and type pills. Search is a case-insensitive
 * substring match on the plan name; an empty query and a null type mean "all".
 */
export function filterPlans<T extends PlanProvenance & { name: string; type?: string }>(
    plans: T[],
    query: string,
    type: PlanTypeFilter | null
): T[] {
    const q = query.trim().toLowerCase();
    return plans.filter((plan) => {
        if (type && normalizePlanType(plan.type) !== type) return false;
        if (q && !(plan.name ?? '').toLowerCase().includes(q)) return false;
        return true;
    });
}

export function splitPlansByType(data: PaymentOption[]): {
    freePlans: FreePlan[];
    paidPlans: PaidPlan[];
} {
    const freePlans: FreePlan[] = [];
    const paidPlans: PaidPlan[] = [];

    data.forEach((item) => {
        const type = (item.type ?? '').toLowerCase();
        if (!type) return;
        if (type === 'cpo') {
            // CPO mirrors have a single synthetic payment_plan whose actual_price equals
            // the total contract value (sum of all installments). Currency is derived from
            // that plan; metadata_json is typically empty for CPOs.
            const syntheticPlan = item.payment_plans?.[0];
            paidPlans.push({
                ...provenanceOf(item),
                id: item.id,
                name: item.name,
                description: i18next.t(
                    'manageStudentsCreateInviteHelper:planDescription.complexPaymentOption'
                ),
                price: syntheticPlan?.actual_price != null ? String(syntheticPlan.actual_price) : '',
                currency: syntheticPlan?.currency || 'INR',
                type: item.type,
                cpoId: item.complex_payment_option_id || undefined,
            });
            return;
        }
        if (type === 'free' || type === 'donation') {
            const parsedData = JSON.parse(item.payment_option_metadata_json);
            if (type === 'donation') {
                freePlans.push({
                    ...provenanceOf(item),
                    id: item.id,
                    name: item.name,
                    description: i18next.t(
                        'manageStudentsCreateInviteHelper:planDescription.donation'
                    ),
                    suggestedAmount:
                        parsedData?.donationData?.suggestedAmounts
                            ?.split(',')
                            ?.map((x: string) => Number(x.trim())) || [],
                    minAmount: Number(parsedData?.donationData?.minimumAmount) || 0,
                    currency: parsedData?.currency || '',
                    type: item.type,
                });
            } else {
                freePlans.push({
                    ...provenanceOf(item),
                    id: item.id,
                    name: item.name,
                    description: i18next.t(
                        'manageStudentsCreateInviteHelper:planDescription.free'
                    ),
                    days: parsedData?.freeData?.validityDays || 0,
                    type: item.type,
                });
            }
        } else {
            const parsedData = JSON.parse(item.payment_option_metadata_json);
            if (type === 'upfront' || type === 'one_time') {
                paidPlans.push({
                    ...provenanceOf(item),
                    id: item.id,
                    name: item.name,
                    description: i18next.t(
                        'manageStudentsCreateInviteHelper:planDescription.oneTime'
                    ),
                    price: parsedData?.upfrontData?.fullPrice || '',
                    currency: parsedData?.currency || '',
                    type: item.type,
                });
            } else {
                paidPlans.push({
                    ...provenanceOf(item),
                    id: item.id,
                    name: item.name,
                    description: i18next.t(
                        'manageStudentsCreateInviteHelper:planDescription.subscription'
                    ),
                    currency: parsedData?.currency || '',
                    type: item.type,
                    paymentOption:
                        parsedData?.subscriptionData?.customIntervals.map(
                            (interval: PaymentPlansInterface) => {
                                return {
                                    value: interval.value || 0,
                                    unit: interval.unit || '',
                                    price: interval.price || '',
                                    features: interval.features || [],
                                    title: interval.title || '',
                                    newFeature: interval.newFeature || '',
                                };
                            }
                        ) || [],
                });
            }
        }
    });

    return { freePlans, paidPlans };
}

export function getDefaultPlanFromPaymentsData(data: PaymentOption[]) {
    const item = data.find((item) => item.tag === 'DEFAULT');
    if (!item)
        return {
            id: '',
            name: '',
            days: 0,
            suggestedAmount: [],
            minAmount: 0,
            currency: '',
            price: '',
            paymentOption: [],
            type: '',
        };
    const type = (item.type ?? '').toLowerCase();
    if (type === 'cpo') {
        const syntheticPlan = item.payment_plans?.[0];
        return {
            id: item.id,
            name: item.name,
            description: i18next.t(
                'manageStudentsCreateInviteHelper:planDescription.complexPaymentOption'
            ),
            price: syntheticPlan?.actual_price != null ? String(syntheticPlan.actual_price) : '',
            currency: syntheticPlan?.currency || 'INR',
            type: item.type,
            cpoId: item.complex_payment_option_id || undefined,
        };
    }
    const parsedData = JSON.parse(item.payment_option_metadata_json);
    if (type === 'donation') {
        return {
            id: item.id,
            name: item.name,
            description: i18next.t('manageStudentsCreateInviteHelper:planDescription.donation'),
            suggestedAmount:
                parsedData?.donationData?.suggestedAmounts
                    ?.split(',')
                    ?.map((x: string) => Number(x.trim())) || [],
            minAmount: Number(parsedData?.donationData?.minimumAmount) || 0,
            currency: parsedData?.currency || '',
            type: item.type,
        };
    } else if (type === 'free') {
        return {
            id: item.id,
            name: item.name,
            description: i18next.t('manageStudentsCreateInviteHelper:planDescription.free'),
            days: parsedData?.freeData?.validityDays || 0,
            type: item.type,
        };
    } else if (type === 'upfront' || type === 'one_time') {
        return {
            id: item.id,
            name: item.name,
            description: i18next.t('manageStudentsCreateInviteHelper:planDescription.oneTime'),
            price: parsedData?.upfrontData?.fullPrice || '',
            currency: parsedData?.currency || '',
            type: item.type,
        };
    } else {
        return {
            id: item.id,
            name: item.name,
            description: i18next.t('manageStudentsCreateInviteHelper:planDescription.subscription'),
            currency: parsedData?.currency || '',
            type: item.type,
            paymentOption:
                parsedData?.subscriptionData?.customIntervals.map(
                    (interval: PaymentPlansInterface) => {
                        return {
                            value: interval.value || 0,
                            unit: interval.unit || '',
                            price: interval.price || '',
                            features: interval.features || [],
                            title: interval.title || '',
                            newFeature: interval.newFeature || '',
                        };
                    }
                ) || [],
        };
    }
}

export function getMatchingPaymentPlan(data: PaymentOption[], id: string) {
    const item = data.find((item) => item.id === id);
    if (!item)
        return {
            id: '',
            name: '',
            days: 0,
            suggestedAmount: [],
            minAmount: 0,
            currency: '',
            price: '',
            paymentOption: [],
            type: '',
        };
    const type = (item.type ?? '').toLowerCase();
    if (type === 'cpo') {
        const syntheticPlan = item.payment_plans?.[0];
        return {
            id: item.id,
            name: item.name,
            description: i18next.t(
                'manageStudentsCreateInviteHelper:planDescription.complexPaymentOption'
            ),
            price: syntheticPlan?.actual_price != null ? String(syntheticPlan.actual_price) : '',
            currency: syntheticPlan?.currency || 'INR',
            type: item.type,
            cpoId: item.complex_payment_option_id || undefined,
        };
    }
    const parsedData = JSON.parse(item.payment_option_metadata_json);
    if (type === 'donation') {
        return {
            id: item.id,
            name: item.name,
            description: i18next.t('manageStudentsCreateInviteHelper:planDescription.donation'),
            suggestedAmount:
                parsedData?.donationData?.suggestedAmounts
                    ?.split(',')
                    ?.map((x: string) => Number(x.trim())) || [],
            minAmount: Number(parsedData?.donationData?.minimumAmount) || 0,
            currency: parsedData?.currency || '',
            type: item.type,
        };
    } else if (type === 'free') {
        return {
            id: item.id,
            name: item.name,
            description: i18next.t('manageStudentsCreateInviteHelper:planDescription.free'),
            days: parsedData?.freeData?.validityDays || 0,
            type: item.type,
        };
    } else if (type === 'upfront' || type === 'one_time') {
        return {
            id: item.id,
            name: item.name,
            description: i18next.t('manageStudentsCreateInviteHelper:planDescription.oneTime'),
            price: parsedData?.upfrontData?.fullPrice || '',
            currency: parsedData?.currency || '',
            type: item.type,
        };
    } else {
        return {
            id: item.id,
            name: item.name,
            description: i18next.t('manageStudentsCreateInviteHelper:planDescription.subscription'),
            currency: parsedData?.currency || '',
            type: item.type,
            paymentOption:
                parsedData?.subscriptionData?.customIntervals.map(
                    (interval: PaymentPlansInterface) => {
                        return {
                            value: interval.value || 0,
                            unit: interval.unit || '',
                            price: interval.price || '',
                            features: interval.features || [],
                            title: interval.title || '',
                            newFeature: interval.newFeature || '',
                        };
                    }
                ) || [],
        };
    }
}

export function getMatchingPaymentAndReferralPlanForAPIs(
    data: PaymentOption[],
    id: string,
    referralProgramDetails: ReferralData[],
    planReferralMappings: Record<string, string> // planId -> referralId mapping
) {
    const item = data.find((item) => item.id === id);

    // If it's a subscription plan, we need to handle multiple payment options
    if (item?.type?.toLowerCase() === 'subscription') {
        const parsedData = JSON.parse(item.payment_option_metadata_json || '{}');
        const customIntervals = parsedData?.subscriptionData?.customIntervals || [];

        // Map each subscription interval to have its own referral
        const updatedIntervals = customIntervals.map(
            (interval: PaymentPlansInterface, index: number) => {
                const planId = `${item.id}_option_${index}`;
                const referralId = planReferralMappings[planId];
                const referralProgram = referralId
                    ? referralProgramDetails.find((ref) => ref.id === referralId)
                    : null;

                return {
                    ...interval,
                    referral_option: referralProgram || null,
                };
            }
        );

        // Update the metadata with referral options
        const updatedMetadata = {
            ...parsedData,
            subscriptionData: {
                ...parsedData.subscriptionData,
                customIntervals: updatedIntervals,
            },
        };

        return {
            ...item,
            payment_option_metadata_json: JSON.stringify(updatedMetadata),
            payment_plans: item?.payment_plans?.map((plan) => {
                // For subscription plans, the main payment plan gets the first option's referral
                const firstPlanId = `${item.id}_option_0`;
                const referralId = planReferralMappings[firstPlanId];
                const referralProgram = referralId
                    ? referralProgramDetails.find((ref) => ref.id === referralId)
                    : null;

                return {
                    ...plan,
                    referral_option: referralProgram || null,
                };
            }),
        };
    } else {
        // For other plan types (free, one_time, upfront, donation)
        return {
            ...item,
            payment_plans: item?.payment_plans?.map((plan) => {
                const planId = item.id;
                const referralId = planReferralMappings[planId];
                const referralProgram = referralId
                    ? referralProgramDetails.find((ref) => ref.id === referralId)
                    : null;

                return {
                    ...plan,
                    referral_option: referralProgram || null,
                };
            }),
        };
    }
}

export function getPaymentOptionBySessionId(
    data: IndividualInviteLinkDetails,
    targetSessionId: string | null
) {
    return (
        data?.package_session_to_payment_options?.find(
            (item) => item.package_session_id === targetSessionId
        ) || null
    );
}

export function convertReferralData(data: ReferralData[]) {
    if (!data) return [];

    // Import the conversion logic from the referral service
    const convertFromApiFormat = (apiResponse: ReferralData) => {
        try {
            const referrerDiscountData = JSON.parse(apiResponse.referrer_discount_json);
            const refereeDiscountData = JSON.parse(apiResponse.referee_discount_json);

            // Helper function to convert new tier format to referee reward
            const convertNewTierFormatToRefereeReward = (tierData: Record<string, unknown>) => {
                const tiers = tierData.tiers as Array<Record<string, unknown>>;
                if (tiers && tiers[0]) {
                    const firstTier = tiers[0];
                    const benefits = firstTier.benefits as Array<Record<string, unknown>>;
                    if (benefits && benefits[0]) {
                        return convertBenefitToReward(benefits[0]);
                    }
                }

                // Fallback to default
                return {
                    type: 'discount_percentage',
                    value: 10,
                    currency: 'USD',
                };
            };

            // Helper function to convert new tier format to referrer rewards
            const convertNewTierFormatToReferrerRewards = (tierData: Record<string, unknown>) => {
                const tiers = tierData.tiers as Array<Record<string, unknown>>;
                if (tiers && Array.isArray(tiers)) {
                    return tiers.map((tier) => {
                        const benefits = tier.benefits as Array<Record<string, unknown>>;
                        const benefit = benefits && benefits[0] ? benefits[0] : null;

                        const referralRange = tier.referralRange as Record<string, unknown>;

                        // Convert to the simplified format expected by the form
                        return {
                            referralCount: (referralRange?.min as number) || 1,
                            type: benefit ? getBenefitType(benefit) : 'discount_percentage',
                        };
                    });
                }
                return [];
            };

            // Helper function to convert benefit to reward (with enhanced fields but fallback to form schema)
            const convertBenefitToReward = (benefit: Record<string, unknown>) => {
                const benefitValue = benefit.value as Record<string, unknown>;
                const type = getBenefitType(benefit);

                const reward = {
                    type,
                    value: getRewardValue(benefit, benefitValue, type),
                    currency: 'INR',
                    // Enhanced fields for display (will be preserved but form schema only requires the basic structure)
                    ...(type === 'bonus_content' && {
                        contentType: (benefitValue?.contentUrl as string) ? 'link' : 'upload',
                        contentUrl: benefitValue?.contentUrl as string,
                        fileIds: benefitValue?.fileIds as string[],
                        template: benefitValue?.templateId as string,
                        title:
                            (benefit.description as string) ||
                            i18next.t('manageStudentsCreateInviteHelper:referral.defaultBonusContentTitle'),
                    }),
                    ...(type === 'points_system' && {
                        pointsPerReferral: (benefitValue?.points as number) || 0,
                        pointTriggers:
                            (benefit.pointTriggers as Array<Record<string, unknown>>) || [],
                    }),
                };

                return reward;
            };

            // Helper function to get benefit type
            const getBenefitType = (benefit: Record<string, unknown>) => {
                switch (benefit.type) {
                    case 'PERCENTAGE_DISCOUNT':
                        return 'discount_percentage';
                    case 'FLAT_DISCOUNT':
                        return 'discount_fixed';
                    case 'FREE_MEMBERSHIP_DAYS':
                        return 'free_days';
                    case 'CONTENT':
                        return 'bonus_content';
                    case 'POINTS':
                        return 'points_system';
                    default:
                        return 'discount_percentage';
                }
            };

            // Helper function to get reward value
            const getRewardValue = (
                benefit: Record<string, unknown>,
                benefitValue: Record<string, unknown>,
                type: string
            ) => {
                switch (type) {
                    case 'discount_percentage':
                        return (benefitValue?.percentage as number) || 0;
                    case 'discount_fixed':
                        return (benefitValue?.amount as number) || 0;
                    case 'free_days':
                        return (benefitValue?.days as number) || 0;
                    case 'points_system':
                        return (benefitValue?.points as number) || 0;
                    case 'bonus_content':
                        return 0; // Content benefits don't have a numeric value
                    default:
                        return 10;
                }
            };

            // Handle referee reward - convert from new tier-based format
            const refereeReward = convertNewTierFormatToRefereeReward(refereeDiscountData);

            // Handle referrer rewards - convert from new tier-based format
            const referrerRewards = convertNewTierFormatToReferrerRewards(referrerDiscountData);

            return {
                id: apiResponse.id,
                name: apiResponse.name,
                refereeBenefit: refereeReward,
                referrerBenefit: referrerRewards,
                vestingPeriod: apiResponse.referrer_vesting_days,
                combineOffers: true,
            };
        } catch (error) {
            console.error('Error parsing referral option data:', error);
            // Return fallback data
            return {
                id: apiResponse.id,
                name: apiResponse.name,
                refereeBenefit: {
                    type: 'discount_percentage',
                    value: 10,
                    currency: 'USD',
                },
                referrerBenefit: [],
                vestingPeriod: apiResponse.referrer_vesting_days || 0,
                combineOffers: true,
            };
        }
    };

    return data.map(convertFromApiFormat);
}

export function getDefaultMatchingReferralData(data: ReferralData[]) {
    const item = data.find((item) => item.tag === 'DEFAULT');
    if (!item)
        return {
            id: '',
            name: '',
            refereeBenefit: {
                type: '',
                value: 0,
                currency: '',
            },
            referrerBenefit: [
                {
                    referralCount: 0,
                    type: '',
                },
            ],
            vestingPeriod: 0,
            combineOffers: false,
        };

    // Use the same conversion logic as convertReferralData
    const convertedData = convertReferralData([item]);
    return (
        convertedData[0] || {
            id: item.id,
            name: item.name,
            refereeBenefit: {
                type: '',
                value: 0,
                currency: '',
            },
            referrerBenefit: [],
            vestingPeriod: item.referrer_vesting_days || 0,
            combineOffers: true,
        }
    );
}

interface SelectedPlan {
    id: string;
    name: string;
    paymentOption?: {
        title: string;
        price: string;
        value: number;
        unit: string;
        features: string[];
        newFeature: string;
    }[];
    type?: string;
}

// Helper function to extract all plan IDs from a selected plan for referral mapping
export function getAllPlanIdsFromSelectedPlan(selectedPlan: SelectedPlan | null): string[] {
    if (!selectedPlan) return [];

    const planIds: string[] = [];

    // For subscription plans with multiple payment options
    if (selectedPlan.paymentOption && Array.isArray(selectedPlan.paymentOption)) {
        selectedPlan.paymentOption.forEach((_, index: number) => {
            // Generate a unique ID for each payment option
            planIds.push(`${selectedPlan.id}_option_${index}`);
        });
    } else {
        // For other plan types (free, one_time, upfront, donation)
        planIds.push(selectedPlan.id);
    }

    return planIds;
}

// Helper function to get plan display name
export function getPlanDisplayName(selectedPlan: SelectedPlan | null, planId: string): string {
    if (!selectedPlan) return '';

    // For subscription plans with multiple payment options
    if (selectedPlan.paymentOption && Array.isArray(selectedPlan.paymentOption)) {
        const parts = planId.split('_option_');
        if (parts.length === 2 && parts[1]) {
            const optionIndex = parseInt(parts[1]);
            const option = selectedPlan.paymentOption[optionIndex];
            return (
                option?.title ||
                i18next.t('manageStudentsCreateInviteHelper:planOption.fallbackTitle', {
                    name: selectedPlan.name,
                    number: optionIndex + 1,
                })
            );
        }
    }

    // For other plan types
    return selectedPlan.name;
}

export function convertRegistrationFormData(data: CustomFieldForConversion[]) {
    const now = new Date().toISOString();
    const transformedData = data.map((field: CustomFieldForConversion) => ({
        comma_separated_options:
            field.type === 'dropdown'
                ? field.options?.map((opt: DropdownOptionForConversion) => opt.value).join(',') ||
                ''
                : '',
        created_at: now,
        field_key: field.key || (field.name ?? '').toLowerCase().replace(/\s+/g, '_'),
        field_name: field.name,
        field_order: field.order ?? 0,
        field_type: field.type,
        id: field.id.toString(),
        is_mandatory: field.isRequired || false,
        status: 'ACTIVE',
        updated_at: now,
    }));
    return transformedData;
}
