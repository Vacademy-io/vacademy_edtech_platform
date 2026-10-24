import { z } from 'zod';
import type { TFunction } from 'i18next';
import { DEFAULT_POST_SUBMIT_CONFIGURATION } from '@/services/audience-post-submit-settings';
import { DEFAULT_FORM_APPEARANCE } from '@/services/audience-form-appearance';

const testInputFieldSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    oldKey: z.boolean(),
    isRequired: z.boolean(),
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
                // Dependent dropdowns: the parent field's option value this option
                // belongs to. Declared so validation does not strip it on submit.
                parent: z.string().optional(),
            })
        )
        .optional(),
    // Backend custom_fields.id (master UUID). Without this, the backend
    // can't find the existing master row and tries to create a new one,
    // which crashes on institutes with duplicate field_key rows.
    _id: z.string().optional(),
    status: z.string().optional(),
    field_id: z.string().optional(),
    custom_field_data: z.any().optional(),
    /**
     * The field's settings object from AddCustomFieldDialog — help text, file
     * limits, checkbox consent copy, and the verification gate. The dialog has
     * always returned this and the form dropped it on the floor, so those
     * settings never survived a save on a campaign field.
     */
    config: z.record(z.unknown()).optional(),
});

/**
 * Post-submit ("thank you") configuration.
 *
 * Every branch here is deliberately UNFAILABLE — `.catch()` / `.default()` on
 * each leaf, and no `.max()` on the button array. This block has no error UI of
 * its own, and react-hook-form's `handleSubmit` silently skips the success
 * handler when *any* field fails, so a strict rule here would turn "Save
 * Changes" into a dead button with nothing on screen explaining why. A campaign
 * whose `setting_json` was hand-edited (or written by a future/older client)
 * must still be editable and savable.
 *
 * Real enforcement lives where it can report itself: `validatePostSubmitConfiguration`
 * (blocks the save with a toast) and `normalizePostSubmitConfiguration` (coerces
 * and caps on the way to the API).
 */
const postSubmitConfigurationSchema = z.object({
    enabled: z.boolean().catch(false),
    successTitle: z.string().catch(DEFAULT_POST_SUBMIT_CONFIGURATION.successTitle),
    successMessage: z.string().catch(DEFAULT_POST_SUBMIT_CONFIGURATION.successMessage),
    content: z.string().catch(''),
    buttons: z
        .array(
            z.object({
                id: z.string().catch(''),
                text: z.string().catch(''),
                url: z.string().catch(''),
                variant: z.enum(['primary', 'secondary']).catch('secondary'),
            })
        )
        // No .max(): the editor caps adding at MAX_POST_SUBMIT_BUTTONS and
        // normalize slices on the way out. A cap here could only ever block a
        // save with no visible reason.
        .catch([]),
    allowAnotherResponse: z.boolean().catch(false),
    anotherResponseText: z.string().catch(''),
    redirectUrl: z.string().catch(''),
    redirectDelaySeconds: z.number().catch(0),
});

/**
 * Form Appearance — how the public response form itself looks.
 *
 * Unfailable for the same reason as `postSubmitConfigurationSchema` above: it
 * has no error UI of its own, and one failing leaf here would make "Save
 * Changes" a dead button. Real enforcement lives in `validateFormAppearance`
 * (blocks the save with a toast) and `normalizeFormAppearance` (coerces on the
 * way to the API).
 */
const formAppearanceSchema = z.object({
    template: z
        .enum(['standard', 'banner', 'split', 'framed', 'minimal', 'gradient', 'dark', 'logo'])
        .catch(DEFAULT_FORM_APPEARANCE.template),
    layout: z.enum(['classic', 'hero', 'split']).catch(DEFAULT_FORM_APPEARANCE.layout),
    width: z.enum(['narrow', 'regular', 'wide']).catch(DEFAULT_FORM_APPEARANCE.width),
    background: z.enum(['gradient', 'plain', 'muted']).catch(DEFAULT_FORM_APPEARANCE.background),
    accent: z
        .enum(['primary', 'success', 'info', 'warning', 'neutral'])
        .catch(DEFAULT_FORM_APPEARANCE.accent),
    cardStyle: z
        .enum(['glass', 'elevated', 'outlined', 'flat'])
        .catch(DEFAULT_FORM_APPEARANCE.cardStyle),
    coverImageUrl: z.string().catch(''),
    eyebrow: z.string().catch(''),
    headline: z.string().catch(''),
    headingAlign: z.enum(['left', 'center', 'right']).catch(DEFAULT_FORM_APPEARANCE.headingAlign),
    showHeader: z.boolean().catch(DEFAULT_FORM_APPEARANCE.showHeader),
    showHeadline: z.boolean().catch(DEFAULT_FORM_APPEARANCE.showHeadline),
    subheadline: z.string().catch(''),
    showDescription: z.boolean().catch(DEFAULT_FORM_APPEARANCE.showDescription),
    showObjective: z.boolean().catch(DEFAULT_FORM_APPEARANCE.showObjective),
    formTitle: z.string().catch(''),
    formSubtitle: z.string().catch(''),
    formHeaderAlign: z
        .enum(['left', 'center', 'right'])
        .catch(DEFAULT_FORM_APPEARANCE.formHeaderAlign),
    submitLabel: z.string().catch(''),
    showRequiredLegend: z.boolean().catch(DEFAULT_FORM_APPEARANCE.showRequiredLegend),
    showProgress: z.boolean().catch(DEFAULT_FORM_APPEARANCE.showProgress),
    highlights: z
        .array(
            z.object({
                id: z.string().catch(''),
                icon: z
                    .enum(['sparkle', 'shield', 'clock', 'check', 'users', 'chat'])
                    .catch('check'),
                text: z.string().catch(''),
            })
        )
        // No .max(): the editor caps adding at MAX_FORM_HIGHLIGHTS and
        // applyFormAppearance slices on the way out.
        .catch([]),
    footerNote: z.string().catch(''),
    heroHtml: z.string().catch(''),
    customCss: z.string().catch(''),
});

// Only `campaign_name`, `campaign_type`, `start_date_local`, `end_date_local`, and
// `default_initial_score` have validation rules that can actually fail (and are rendered via
// `errors.<field>.message` in CreateCampaignForm.tsx / CampaignTypeDropdown / StatusDropdown).
// `description` and `status` are also read from `errors` there but have no constraint capable
// of failing (plain optional string / `.toUpperCase().default()` with no `.min()`), so they
// never produce a message and need no translated string. Converted to a factory so the sole
// real consumer (useAudienceCampaignForm.ts) can rebuild it from a component-scoped `t`,
// recomputed whenever the active locale changes — see the buildAddDiscountSchema precedent in
// manage-students/invite/-components/create-invite/GenerateInviteLinkSchema.ts.
export const buildAudienceCampaignSchema = (t: TFunction, campaignTypeTerm: string) =>
    z
        .object({
            campaign_name: z
                .string()
                .min(1, t('audienceManagerAudienceCampaignSchema:validation.campaignNameRequired'))
                .min(3, t('audienceManagerAudienceCampaignSchema:validation.campaignNameMinLength')),
            campaign_type: z
                .string()
                .toUpperCase()
                .min(
                    1,
                    t('audienceManagerAudienceCampaignSchema:validation.campaignTypeRequired', {
                        term: campaignTypeTerm,
                    })
                ),
            description: z.string().optional(),
            campaign_objective: z.string().optional().default(''),
            to_notify: z.string().optional(),
            send_respondent_email: z.boolean().optional(),
            start_date_local: z
                .string()
                .min(1, t('audienceManagerAudienceCampaignSchema:validation.startDateRequired')),
            end_date_local: z
                .string()
                .min(1, t('audienceManagerAudienceCampaignSchema:validation.endDateRequired')),
            status: z.string().toUpperCase().default('Active'),
            sub_org_id: z.string().optional(),
            json_web_metadata: z.string().optional(),
            institute_custom_fields: z.string().optional(),
            // What the respondent sees the instant the form is submitted. Persisted
            // inside the campaign's `setting_json` — mirrors the enroll invite's
            // `postformfillConfiguration`. See services/audience-post-submit-settings.ts.
            postSubmitConfiguration: postSubmitConfigurationSchema.default(
                DEFAULT_POST_SUBMIT_CONFIGURATION
            ),
            // How the public response form LOOKS while it is being filled in.
            // Same storage as the block above — `setting_json` → `formAppearance`.
            // See services/audience-form-appearance.ts.
            formAppearance: formAppearanceSchema.default(DEFAULT_FORM_APPEARANCE),
            custom_fields: z.array(testInputFieldSchema).default([]),
            customHtml: z.string().default(''),
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
            default_initial_score: z
                .number()
                .min(0, t('audienceManagerAudienceCampaignSchema:validation.initialScoreMin'))
                .max(50, t('audienceManagerAudienceCampaignSchema:validation.initialScoreMax'))
                .default(20),
            campaign_image: z.string().optional(),
            campaign_imageBlob: z.string().optional(),
            uploadingStates: z
                .object({
                    campaign_image: z.boolean().default(false),
                })
                .default({ campaign_image: false }),
        })
        .catchall(z.any()); // Allow additional fields for preview (e.g., preview_Gender_0)

export type AudienceCampaignForm = z.infer<ReturnType<typeof buildAudienceCampaignSchema>>;

// Set start date to today (date only, no time)
const today = new Date();
const todayDateOnly = today.toISOString().split('T')[0] || today.toISOString().substring(0, 10); // Format: YYYY-MM-DD
const oneWeekLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const oneWeekLaterDateOnly =
    oneWeekLater.toISOString().split('T')[0] || oneWeekLater.toISOString().substring(0, 10); // Format: YYYY-MM-DD

export const defaultFormValues: AudienceCampaignForm = {
    campaign_name: '',
    campaign_type: '',
    description: '',
    campaign_objective: '',
    to_notify: '',
    send_respondent_email: false,
    start_date_local: todayDateOnly,
    end_date_local: oneWeekLaterDateOnly,
    status: 'ACTIVE',
    sub_org_id: '',
    json_web_metadata: '',
    institute_custom_fields: '',
    // Fresh `buttons` array: a shallow spread would share the module-level
    // DEFAULT's array, so one stray mutation would poison every new form.
    postSubmitConfiguration: { ...DEFAULT_POST_SUBMIT_CONFIGURATION, buttons: [] },
    // Fresh `highlights` array for the same reason as `buttons` above — a
    // shallow spread would share the module-level DEFAULT's array.
    formAppearance: { ...DEFAULT_FORM_APPEARANCE, highlights: [] },
    // custom_fields are loaded dynamically from settings via getCampaignCustomFields()
    // If no fields are configured in settings, the form will start with an empty array
    // Users can add fields manually or configure them in settings
    custom_fields: [],
    customHtml: '',
    selectedOptionValue: 'textfield',
    textFieldValue: '',
    dropdownOptions: [],
    isDialogOpen: false,
    default_initial_score: 20,
    campaign_image: '',
    campaign_imageBlob: '',
    uploadingStates: {
        campaign_image: false,
    },
};
