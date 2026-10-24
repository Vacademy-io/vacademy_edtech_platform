// Dummy related courses data
import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { UseFormReturn } from 'react-hook-form';
import { z, z as zod } from 'zod';
import { z as zodDiscount } from 'zod';
import { CreateInviteFormValues } from './CreateInviteSchema';

// This module builds several module-level `const`s (relatedCourses, the billing-contact
// label defaults, the addPlanSchema/addDiscountSchema/addReferralSchema validation
// messages below) directly from i18next.t() calls evaluated once at import time. Nothing
// else in the codebase calls useTranslation('manageStudentsGenerateInviteLinkSchema'), so
// without this the namespace would never be loaded into i18next's resource store and every
// t() call in this file would freeze on the raw key. This eager load is a first line of
// defense for anything in this file that still reads i18next.t() lazily (inside function
// bodies); the frozen-at-import cases below (relatedCourses, addDiscountSchema, the
// billing-contact defaults) are additionally converted to compute their translated values
// fresh at call/parse time rather than once at import.
void i18next.loadNamespaces('manageStudentsGenerateInviteLinkSchema');

// Preview/example data shown on the "Show Related Courses" card. Was previously a frozen
// module-level constant built from i18next.t() at import time (before the namespace could
// possibly be loaded), so it always rendered raw translation keys. Converted to a function so
// the real consumer (ShowRelatedCoursesCard.tsx) can recompute it fresh — ideally inside a
// useMemo keyed on the current language.
export function getRelatedCourses() {
    return [
        {
            id: 'c1',
            name: i18next.t('manageStudentsGenerateInviteLinkSchema:relatedCourses.course1.name'),
            description: i18next.t(
                'manageStudentsGenerateInviteLinkSchema:relatedCourses.course1.description'
            ),
            image: '/public/related-math.png',
            tags: [
                i18next.t('manageStudentsGenerateInviteLinkSchema:relatedCourses.course1.tags.math'),
                i18next.t(
                    'manageStudentsGenerateInviteLinkSchema:relatedCourses.course1.tags.advanced'
                ),
                i18next.t('manageStudentsGenerateInviteLinkSchema:relatedCourses.course1.tags.stem'),
            ],
        },
        {
            id: 'c2',
            name: i18next.t('manageStudentsGenerateInviteLinkSchema:relatedCourses.course2.name'),
            description: i18next.t(
                'manageStudentsGenerateInviteLinkSchema:relatedCourses.course2.description'
            ),
            image: '/public/related-physics.png',
            tags: [
                i18next.t(
                    'manageStudentsGenerateInviteLinkSchema:relatedCourses.course2.tags.physics'
                ),
                i18next.t(
                    'manageStudentsGenerateInviteLinkSchema:relatedCourses.course2.tags.engineering'
                ),
            ],
        },
        {
            id: 'c3',
            name: i18next.t('manageStudentsGenerateInviteLinkSchema:relatedCourses.course3.name'),
            description: i18next.t(
                'manageStudentsGenerateInviteLinkSchema:relatedCourses.course3.description'
            ),
            image: '/public/related-writing.png',
            tags: [
                i18next.t(
                    'manageStudentsGenerateInviteLinkSchema:relatedCourses.course3.tags.writing'
                ),
                i18next.t(
                    'manageStudentsGenerateInviteLinkSchema:relatedCourses.course3.tags.creativity'
                ),
                i18next.t('manageStudentsGenerateInviteLinkSchema:relatedCourses.course3.tags.arts'),
            ],
        },
    ];
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

export interface GenerateInviteLinkDialogProps {
    selectedCourse: Course | null;
    selectedBatches: Batch[];
    showSummaryDialog: boolean;
    setShowSummaryDialog: (open: boolean) => void;
    inviteLinkId?: string;
    singlePackageSessionId?: boolean;
    isEditInviteLink?: boolean;
    setDialogOpen?: (open: boolean) => void;
    selectCourseForm?: UseFormReturn<CreateInviteFormValues>;
}

// These used to be plain `const`s assigned from i18next.t() — evaluated once at import time,
// so they froze on the raw key (or English fallback) forever, and never updated on a locale
// switch. They only ever feed `.default()` on the zod schema below, which itself is built
// once as a module-level singleton (`inviteLinkSchema` is imported/used by many other files,
// so it isn't safe to turn into a factory here). zod's `.default()` accepts a thunk instead of
// a static value and calls it fresh every time the default is actually applied during parsing
// — so converting these to getter functions and passing the functions themselves (not their
// invoked result) to `.default()` keeps the schema's shape/type identical while making the
// label text compute live instead of freezing at import.
const getBillingContactNameLabel = () =>
    i18next.t('manageStudentsGenerateInviteLinkSchema:billingContactFields.nameLabel');
const getBillingContactEmailLabel = () =>
    i18next.t('manageStudentsGenerateInviteLinkSchema:billingContactFields.emailLabel');
const getBillingContactRoleLabel = () =>
    i18next.t('manageStudentsGenerateInviteLinkSchema:billingContactFields.roleLabel');

const testInputFieldSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    oldKey: z
        .boolean()
        .nullable()
        .optional()
        .transform((val) => val ?? false),
    isRequired: z
        .boolean()
        .nullable()
        .optional()
        .transform((val) => val ?? false),
    key: z
        .string()
        .nullable()
        .optional()
        .transform((val) => val ?? ''),
    order: z
        .number()
        .nullable()
        .optional()
        .transform((val) => val ?? 0),
    options: z
        .array(
            z.object({
                id: z.string(),
                value: z.string(),
            })
        )
        .optional(),
    _id: z.string().optional(), // Custom field ID (custom_field.id) - preserved from GET API
});

// Schema for the form
export const inviteLinkSchema = z.object({
    name: z.string(),
    includeInstituteLogo: z.boolean().default(false),
    blendHeaderWithBackground: z.boolean().default(false),
    includePaymentPlans: z.boolean().default(false),
    requireApproval: z.boolean().default(false),
    messageTemplate: z.enum(['standard', 'review', 'custom']).optional(),
    customMessage: z.string().optional(),
    id: z.string().optional(),
    course: z
        .string()
        .nullable()
        .transform((val) => val ?? ''),
    description: z
        .string()
        .nullable()
        .transform((val) => val ?? ''),
    learningOutcome: z
        .string()
        .nullable()
        .transform((val) => val ?? ''),
    aboutCourse: z
        .string()
        .nullable()
        .transform((val) => val ?? ''),
    targetAudience: z
        .string()
        .nullable()
        .transform((val) => val ?? ''),
    coursePreview: z
        .string()
        .nullable()
        .transform((val) => val ?? ''),
    courseBanner: z
        .string()
        .nullable()
        .transform((val) => val ?? ''),
    courseMedia: z.any().optional(),
    coursePreviewBlob: z.string().optional(),
    courseBannerBlob: z.string().optional(),
    courseMediaBlob: z.string().optional(),
    tags: z.array(z.string()).default([]),
    newTag: z.string().default(''),
    filteredTags: z.array(z.string()).default([]),
    custom_fields: z.array(testInputFieldSchema),
    uploadingStates: z.object({
        coursePreview: z.boolean().default(false),
        courseBanner: z.boolean().default(false),
        courseMedia: z.boolean().default(false),
    }),
    youtubeUrl: z.string().default(''),
    youtubeError: z.string().default(''),
    showYoutubeInput: z.boolean().default(false),
    showMediaMenu: z.boolean().default(false),
    freePlans: z
        .array(
            z.object({
                id: z.string(),
                name: z.string(),
                days: z.number().optional(),
                suggestedAmount: z.array(z.number()).optional(),
                minAmount: z.number().optional(),
                currency: z.string().optional(),
                type: z.string().optional(),
                // Server-stamped; the picker sorts on createdAt and shows the creator.
                createdAt: z.string().nullable().optional(),
                createdByUserId: z.string().nullable().optional(),
                createdByName: z.string().nullable().optional(),
            })
        )
        .default([]),
    paidPlans: z
        .array(
            z.object({
                id: z.string(),
                name: z.string(),
                price: z
                    .union([z.string(), z.number()])
                    .optional()
                    .transform((val) => val?.toString() ?? ''),
                currency: z.string().optional(),
                paymentOption: z
                    .array(
                        z.object({
                            value: z.number(),
                            unit: z.string(),
                            price: z
                                .union([z.string(), z.number()])
                                .transform((val) => val.toString()),
                            features: z.array(z.string()),
                            title: z.string(),
                            newFeature: z.string(),
                        })
                    )
                    .optional(),
                type: z.string().optional(),
                createdAt: z.string().nullable().optional(),
                createdByUserId: z.string().nullable().optional(),
                createdByName: z.string().nullable().optional(),
            })
        )
        .default([]),
    showPlansDialog: z.boolean().default(false),
    selectedPlan: z
        .object({
            id: z.string(),
            name: z.string(),
            days: z.number().optional(),
            suggestedAmount: z.array(z.number()).optional(),
            minAmount: z.number().optional(),
            currency: z.string().optional(),
            price: z
                .union([z.string(), z.number()])
                .optional()
                .transform((val) => val?.toString() ?? ''),
            paymentOption: z
                .array(
                    z.object({
                        value: z.number(),
                        unit: z.string(),
                        price: z.union([z.string(), z.number()]).transform((val) => val.toString()),
                        features: z.array(z.string()),
                        title: z.string(),
                        newFeature: z.string(),
                    })
                )
                .optional(),
            type: z.string().optional(),
        })
        .optional(),

    showAddPlanDialog: z.boolean().default(false),
    showDiscountDialog: z.boolean().default(false),
    discounts: z
        .array(
            z.object({
                id: z.string(),
                title: z.string(),
                code: z.string(),
                type: z.string(),
                value: z.number(),
                expires: z.string(),
            })
        )
        .default([]),
    showAddDiscountDialog: z.boolean().default(false),
    selectedDiscountId: z.string().default('none'),
    // Legacy fields - keeping for backward compatibility
    selectedReferral: z
        .object({
            id: z.string().optional(),
            name: z.string().optional(),
            refereeBenefit: z
                .object({
                    type: z.string(),
                    value: z.number(),
                    currency: z.string(),
                })
                .optional(),
            referrerBenefit: z
                .array(
                    z.object({
                        referralCount: z.number(),
                        type: z.string(),
                    })
                )
                .optional(),
            vestingPeriod: z.number().optional(),
            combineOffers: z.boolean().optional(),
        })
        .optional(),
    referralPrograms: z
        .array(
            z.object({
                id: z.string(),
                name: z.string(),
                refereeBenefit: z.object({
                    type: z.string(),
                    value: z.number(),
                    currency: z.string(),
                }),
                referrerBenefit: z.array(
                    z.object({
                        referralCount: z.number(),
                        type: z.string(),
                    })
                ),
                vestingPeriod: z.number(),
                combineOffers: z.boolean(),
            })
        )
        .default([]),
    selectedReferralId: z.string().default('r1'),

    // New per-plan referral fields
    planReferralMappings: z.record(z.string(), z.string()).default({}), // planId -> referralId
    selectedPlanForReferral: z.string().default(''), // Currently selected plan for referral config
    showPlanReferralDialog: z.boolean().default(false), // New dialog for plan-referral config

    // Existing referral dialogs - kept for creating/editing referrals
    showReferralDialog: z.boolean().default(false),
    showAddReferralDialog: z.boolean().default(false),
    restrictToSameBatch: z.boolean().default(false),
    // Invite-link availability window (maps to enroll_invite.start_date / end_date).
    // Empty string = that side of the window is open. Outside the window (or when the link
    // is deactivated) learners see `unavailableMessage` instead of the enrollment form.
    availabilityStartDate: z.string().default(''),
    availabilityEndDate: z.string().default(''),
    // Admin-authored rich-text (HTML) message shown when the link is not accepting
    // enrollments. Stored in setting_json under setting.AVAILABILITY_SETTING.UNAVAILABLE_MESSAGE.
    unavailableMessage: z.string().default(''),
    accessDurationType: z.string().default('define'),
    accessDurationDays: z
        .string()
        .nullable()
        .transform((val) => val ?? ''),
    inviteeEmail: z.string().default(''),
    inviteeEmails: z.array(z.string()).default([]),
    // Team members mailed whenever a learner fills this invite's enrollment form.
    // Mirrors the audience campaign's Team Notifications (audience.to_notify);
    // serialized to setting_json.setting.NOTIFICATION_SETTING.TO_NOTIFY as a
    // comma-separated string.
    teamNotificationEmails: z.array(z.string()).default([]),
    customHtml: z.string().default(''),
    showRelatedCourses: z.boolean().default(false),
    selectedOptionValue: z.string().default('textfield'),
    textFieldValue: z.string().default(''),
    dropdownOptions: z
        .array(
            z.object({
                id: z.string(),
                value: z.string(),
                disabled: z.boolean(),
            })
        )
        .default([]),
    isDialogOpen: z.boolean().default(false),
    postformfillConfiguration: z.object({
        redirectPath: z.string().optional(),
        showLoginButton: z.boolean().default(true),
        content: z.string().optional(),
        collectBillingContactDetails: z.boolean().default(false),
        // Per-field configuration for the billing-contact fields rendered on the
        // learner registration form when collectBillingContactDetails=true.
        // Each field has a customizable label and a required flag; the third
        // field (role) also accepts a comma-separated `options` string —
        // when present the learner sees a dropdown, when empty a free-text input.
        billingContactFields: z.object({
            name: z.object({
                label: z.string().default(getBillingContactNameLabel),
                required: z.boolean().default(true),
            }).default(() => ({ label: getBillingContactNameLabel(), required: true })),
            email: z.object({
                label: z.string().default(getBillingContactEmailLabel),
                required: z.boolean().default(true),
            }).default(() => ({ label: getBillingContactEmailLabel(), required: true })),
            role: z.object({
                label: z.string().default(getBillingContactRoleLabel),
                required: z.boolean().default(false),
                options: z.string().default(''),
            }).default(() => ({ label: getBillingContactRoleLabel(), required: false, options: '' })),
        }).default(() => ({
            name:  { label: getBillingContactNameLabel(), required: true },
            email: { label: getBillingContactEmailLabel(), required: true },
            role:  { label: getBillingContactRoleLabel(), required: false, options: '' },
        })),
    }).default(() => ({
        showLoginButton: true,
        collectBillingContactDetails: false,
        billingContactFields: {
            name:  { label: getBillingContactNameLabel(), required: true },
            email: { label: getBillingContactEmailLabel(), required: true },
            role:  { label: getBillingContactRoleLabel(), required: false, options: '' },
        },
    })),
    // Sub-org settings for this invite link. When `enabled`, enrolling via this
    // invite into a sub-org-associated batch provisions a sub-org and these
    // values drive the new sub-org admin's roles/permissions/seat cap. Mirrors
    // the Create Sub-Org modal; serialized to setting_json.setting.SUB_ORG_SETTING.
    subOrgSettings: z
        .object({
            enabled: z.boolean().default(false),
            authRoles: z.array(z.string()).default([]),
            allowedTeamRoles: z.array(z.string()).default([]),
            adminPermissions: z.array(z.string()).default(['FULL']),
            memberCount: z
                .number()
                .nullable()
                .default(null),
        })
        .default({
            enabled: false,
            authRoles: [],
            allowedTeamRoles: [],
            adminPermissions: ['FULL'],
            memberCount: null,
        }),
    // Autopay / free-trial for paid subscription plans on this invite. When
    // `enabled`, enrolling registers a recurring mandate and the subscription
    // auto-renews; `trialDays > 0` gives access now with the first charge at
    // trial end. Serialized to setting_json.setting.AUTOPAY_SETTING and read at
    // enrollment time.
    autopaySettings: z
        .object({
            enabled: z.boolean().default(false),
            trialDays: z
                .number()
                .int()
                .min(0)
                .nullable()
                .default(0)
                .transform((val) => val ?? 0),
            // Mandate cap per auto-charge. null = derive from the plan price.
            maxAmount: z.number().min(0).nullable().default(null),
            // Nominal charge taken at trial signup to register the mandate. null = 1.
            authEnabled: z.boolean().nullable().default(true),
            authAmount: z.number().min(0).nullable().default(null),
            authRefundable: z.boolean().nullable().default(false),
            // Days of access kept past expiry while retrying a failed renewal. null = none.
            gracePeriodDays: z.number().int().min(0).nullable().default(null),
            // Total subscription term in months; autopay stops after it. null = open-ended.
            totalDurationMonths: z.number().int().min(1).nullable().default(null),
        })
        .default({
            enabled: false,
            trialDays: 0,
            maxAmount: null,
            authEnabled: true,
            authAmount: null,
            authRefundable: false,
            gracePeriodDays: null,
            totalDurationMonths: null,
        }),
});

export type InviteLinkFormValues = z.infer<typeof inviteLinkSchema>;

// Add new plan form schema.
// NOTE: not imported anywhere else in the codebase (verified via repo-wide grep for
// `addPlanSchema` / `AddPlanFormValues`) — dead code. Its `i18next.t()` validation messages
// below are frozen at module-load time same as the exports fixed above, but since nothing
// actually builds a form against this schema the freeze has no observable effect. Left as-is
// rather than reworked into a factory (per the surgical, minimal-blast-radius scope of this
// fix) — it already benefits from the eager `loadNamespaces` call above if it's ever wired up.
export const addPlanSchema = zod.object({
    planType: zod.enum(['free', 'paid']),
    name: zod
        .string()
        .min(1, i18next.t('manageStudentsGenerateInviteLinkSchema:validation.planNameRequired')),
    description: zod
        .string()
        .min(1, i18next.t('manageStudentsGenerateInviteLinkSchema:validation.descriptionRequired')),
    price: zod.string().optional(),
});

export type AddPlanFormValues = zod.infer<typeof addPlanSchema>;

// Builds the Add Discount validation schema. This used to be a module-level `const` built
// once at import time from i18next.t() calls, which froze the .min() error messages on the
// raw key (or English fallback) forever — zod's `.min(len, message)` only accepts a static
// string/object for `message`, unlike `.default()`, so there is no lazy-thunk escape hatch
// here. Converted to a factory so the sole real consumer (the addDiscountForm in
// GenerateInviteLinkDialog.tsx) can rebuild it fresh from a component-scoped `t`, recomputed
// whenever the active locale changes.
export const buildAddDiscountSchema = (t: TFunction) =>
    zodDiscount.object({
        title: zodDiscount
            .string()
            .min(1, t('manageStudentsGenerateInviteLinkSchema:validation.titleRequired')),
        code: zodDiscount
            .string()
            .min(1, t('manageStudentsGenerateInviteLinkSchema:validation.codeRequired')),
        type: zodDiscount.enum(['percent', 'rupees']),
        value: zodDiscount
            .number()
            .min(1, t('manageStudentsGenerateInviteLinkSchema:validation.valueRequired')),
        expires: zodDiscount
            .string()
            .min(1, t('manageStudentsGenerateInviteLinkSchema:validation.expiryDateRequired')),
    });
export type AddDiscountFormValues = zodDiscount.infer<ReturnType<typeof buildAddDiscountSchema>>;

// Add Referral Program form schema.
// NOTE: not imported anywhere else in the codebase (verified via repo-wide grep for
// `addReferralSchema` / `AddReferralFormValues`) — dead code. Same frozen-at-import caveat
// and same rationale for leaving it untouched as addPlanSchema above.
export const addReferralSchema = zod.object({
    name: zod
        .string()
        .min(1, i18next.t('manageStudentsGenerateInviteLinkSchema:validation.programNameRequired')),
    refereeBenefit: zod
        .string()
        .min(
            1,
            i18next.t('manageStudentsGenerateInviteLinkSchema:validation.refereeBenefitRequired')
        ),
    referrerTiers: zod
        .array(
            zod.object({
                tier: zod
                    .string()
                    .min(1, i18next.t('manageStudentsGenerateInviteLinkSchema:validation.tierRequired')),
                reward: zod
                    .string()
                    .min(
                        1,
                        i18next.t('manageStudentsGenerateInviteLinkSchema:validation.rewardRequired')
                    ),
            })
        )
        .min(
            1,
            i18next.t('manageStudentsGenerateInviteLinkSchema:validation.atLeastOneTierRequired')
        ),
    vestingPeriod: zod.number(),
    combineOffers: zod.boolean(),
});
export type AddReferralFormValues = zod.infer<typeof addReferralSchema>;
