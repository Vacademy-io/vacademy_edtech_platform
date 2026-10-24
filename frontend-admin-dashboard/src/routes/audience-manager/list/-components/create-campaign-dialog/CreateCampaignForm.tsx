import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import { useAudienceCampaignForm } from '../../-hooks/useAudienceCampaignForm';
import { AudienceCampaignForm, defaultFormValues } from '../../-schema/AudienceCampaignSchema';
import { useCreateAudienceCampaign } from '../../-hooks/useCreateAudienceCampaign';
import { useUpdateAudienceCampaign } from '../../-hooks/useUpdateAudienceCampaign';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import CampaignCustomFieldsCard from './CampaignCustomFieldsCard';
import type { DropdownOption } from '@/components/common/custom-fields/AddCustomFieldDialog';
import { useFileUpload } from '@/hooks/use-file-upload';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { ImageSquare, PencilSimpleLine } from '@phosphor-icons/react';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { Info } from '@phosphor-icons/react';
import MultiEmailInput, {
    MultiEmailInputHandle,
} from '../audience-invite/components/MultiEmailInput';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import CampaignTypeDropdown from './CampaignTypeDropdown';
import StatusDropdown from './StatusDropdown';
import { useQuery } from '@tanstack/react-query';
import { listAccessibleSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import createCampaignLink from '../../-utils/createCampaignLink';
import CampaignLink from './CampaignLink';
import { CampaignItem } from '../../-services/get-campaigns-list';
import { getCampaignCustomFieldsAsync } from '../../-utils/getCampaignCustomFields';
import {
    convertExistingCustomFields,
    convertFieldsToPayload,
    isDropdownFieldType,
    nextFieldId,
    retargetDependentFields,
    savedFieldKeyOf,
} from '../../-utils/campaignFormFields';
import { useGetCampaignById } from '../../-hooks/useGetCampaignById';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import PostSubmitConfigurationEditor from '@/components/audience/PostSubmitConfigurationEditor';
import {
    applyPostSubmitConfiguration,
    DEFAULT_POST_SUBMIT_CONFIGURATION,
    fetchAudienceFormSettings,
    parsePostSubmitConfiguration,
    validatePostSubmitConfiguration,
    type AudiencePostSubmitConfiguration,
} from '@/services/audience-post-submit-settings';
import FormAppearanceEditor from '@/components/audience/FormAppearanceEditor';
import FormTemplatePicker from '@/components/audience/FormTemplatePicker';
import FormTextEditor from '@/components/audience/FormTextEditor';
import { AUDIENCE_FORM_SETTINGS_QUERY_KEY } from '@/routes/settings/-components/AudienceFormSettings';
import {
    applyFormAppearance,
    DEFAULT_FORM_APPEARANCE,
    parseFormAppearance,
    validateFormAppearance,
} from '@/services/audience-form-appearance';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import CampaignTagsEditor from './CampaignTagsEditor';
import {
    campaignTagSummaryKey,
    campaignTagsKey,
    fetchCampaignTagSummary,
    fetchCampaignTags,
} from '../../-services/campaign-tags';
import {
    rowsFromTags,
    tagsFromRows,
    type TagRow,
    type TagRowsError,
} from '../../-utils/campaign-tags';

const parseEmailsFromCsv = (value?: string | null) => {
    if (!value) return [];
    return value
        .split(',')
        .map((email) => email.trim())
        .filter((email) => email.length > 0);
};

const formatDateToDateInput = (value?: string | null, fallback?: string) => {
    if (!value) return fallback || '';
    const [datePart] = value.split('T');
    return datePart || value || fallback || '';
};

const formatDateTimeForPayload = (value?: string, isEndOfDay = false) => {
    if (!value) return '';
    if (value.includes('T')) return value;
    return `${value}${isEndOfDay ? 'T23:59:59' : 'T00:00:00'}`;
};

const getCampaignIdentifier = (campaign?: CampaignItem | null) =>
    campaign?.campaign_id || campaign?.id || campaign?.audience_id || '';

const buildInitialFormValues = (
    campaign?: CampaignItem | null
): AudienceCampaignForm | undefined => {
    if (!campaign) return undefined;

    // Convert existing custom fields from campaign
    const existingCustomFields = convertExistingCustomFields(campaign.institute_custom_fields);

    // Use existing fields from the campaign if available. If none saved,
    // start empty — the useEffect will async-load defaults from the API.
    let customFieldsToUse: any[] = [];
    if (existingCustomFields && existingCustomFields.length > 0) {
        customFieldsToUse = existingCustomFields;
    }

    const initialValues = {
        ...defaultFormValues,
        campaign_name: campaign.campaign_name || '',
        campaign_type: campaign.campaign_type || '',
        description: campaign.description || '',
        campaign_objective: campaign.campaign_objective || '',
        to_notify: campaign.to_notify || '',
        send_respondent_email:
            typeof campaign.send_respondent_email === 'boolean'
                ? campaign.send_respondent_email
                : defaultFormValues.send_respondent_email,
        start_date_local:
            formatDateToDateInput(campaign.start_date_local, defaultFormValues.start_date_local) ||
            defaultFormValues.start_date_local,
        end_date_local:
            formatDateToDateInput(campaign.end_date_local, defaultFormValues.end_date_local) ||
            defaultFormValues.end_date_local,
        status: campaign.status?.toUpperCase?.() || defaultFormValues.status,
        sub_org_id: campaign.sub_org_id || '',
        json_web_metadata: campaign.json_web_metadata || '',
        // Thank-you screen config lives inside the campaign's setting_json blob.
        // parse* tolerates a missing/legacy/unparsable blob and returns defaults,
        // so campaigns created before this feature still open with a full card.
        postSubmitConfiguration: parsePostSubmitConfiguration(campaign.setting_json),
        // Same blob, different key. Also tolerant of a missing/legacy/unparsable
        // setting_json, so campaigns created before this feature open on the
        // shipped defaults rather than a blank card.
        formAppearance: parseFormAppearance(campaign.setting_json),
        default_initial_score:
            typeof campaign.default_initial_score === 'number'
                ? campaign.default_initial_score
                : defaultFormValues.default_initial_score,
        // Include existing custom fields, or load from settings if none exist
        custom_fields: customFieldsToUse || [],
    };

    return initialValues;
};

interface CreateCampaignFormProps {
    onSuccess?: () => void;
    campaign?: CampaignItem | null;
    /** Section to scroll to on open (0 = Basics) — used by the list detail tabs' Edit links. */
    initialStep?: number;
}

/**
 * The create / edit form is one page. These are its sections, indexed the way
 * `initialStep` is; `fields` maps a validation error back to the section that
 * shows it, so a failed save scrolls there.
 */
const FORM_SECTIONS: ReadonlyArray<{ key: string; fields: readonly string[] }> = [
    {
        key: 'basics',
        fields: [
            'campaign_name',
            'campaign_type',
            'campaign_objective',
            'sub_org_id',
            'description',
            'start_date_local',
            'end_date_local',
            'status',
        ],
    },
    { key: 'fields', fields: ['custom_fields'] },
    { key: 'afterSubmit', fields: ['postSubmitConfiguration'] },
    { key: 'appearance', fields: ['formAppearance'] },
    { key: 'notify', fields: ['to_notify', 'send_respondent_email', 'default_initial_score'] },
];
const SECTION_BASICS = 0;
const SECTION_AFTER_SUBMIT = 2;
const SECTION_APPEARANCE = 3;

export const CreateCampaignForm: React.FC<CreateCampaignFormProps> = ({
    onSuccess,
    campaign,
    initialStep,
}) => {
    const { t } = useTranslation('audienceManagerCreateCampaignForm');
    const { campaignType: term } = useLeadTerminology();
    const { t: tUpdateAudienceCampaign } = useTranslation(
        'audienceManagerUseUpdateAudienceCampaign'
    );
    const { t: tCreateAudienceCampaign } = useTranslation(
        'audienceManagerUseCreateAudienceCampaign'
    );
    const { instituteDetails } = useInstituteDetailsStore();
    const isEditMode = Boolean(campaign);
    const editingCampaignId = useMemo(() => getCampaignIdentifier(campaign), [campaign]);

    // Fetch campaign data when in edit mode
    const { data: fetchedCampaign, isLoading: isLoadingCampaign } = useGetCampaignById({
        instituteId: instituteDetails?.id || '',
        audienceId: editingCampaignId || '',
        enabled: isEditMode && !!instituteDetails?.id && !!editingCampaignId,
    });

    // Use fetched campaign data if available, otherwise use passed campaign prop
    const campaignData = useMemo(() => {
        if (fetchedCampaign) {
            return fetchedCampaign as CampaignItem;
        }
        return campaign;
    }, [fetchedCampaign, campaign]);

    const initialFormValues = useMemo(
        () => buildInitialFormValues(campaignData as CampaignItem),
        [campaignData]
    );
    const [emails, setEmails] = useState<string[]>(() =>
        parseEmailsFromCsv((campaignData?.to_notify as string) || '')
    );
    const multiEmailRef = useRef<MultiEmailInputHandle>(null);
    const [latestCampaignShareLink, setLatestCampaignShareLink] = useState<string | null>(null);
    // Kept beside the link purely so the "share link ready" panel can offer a
    // short URL: shortening is keyed on the campaign id, and the panel is handed
    // a presetLink that carries no id of its own.
    const [latestCampaignId, setLatestCampaignId] = useState<string | null>(null);
    const { form, handleDateChange, handleSubmit, handleReset, isSubmitting } =
        useAudienceCampaignForm(initialFormValues);
    const {
        control,
        register,
        watch,
        setValue,
        getValues,
        formState: { errors },
    } = form;
    const submitCount = form.formState.submitCount;

    // ── Sections ──────────────────────────────────────────────
    const sectionRefs = useRef<Array<HTMLDivElement | null>>([]);
    const scrollToSection = useCallback((index: number) => {
        sectionRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);
    // After a failed save, scroll to the first section that has an error.
    const handledSubmitRef = useRef(0);
    useEffect(() => {
        if (!submitCount || handledSubmitRef.current === submitCount) return;
        const errorKeys = Object.keys(errors);
        if (errorKeys.length === 0) return;
        handledSubmitRef.current = submitCount;
        const firstSection = FORM_SECTIONS.findIndex((s) =>
            s.fields.some((f) => errorKeys.includes(f))
        );
        if (firstSection >= 0) scrollToSection(firstSection);
    }, [submitCount, errors, scrollToSection]);
    const createCampaign = useCreateAudienceCampaign(tCreateAudienceCampaign);
    const updateCampaign = useUpdateAudienceCampaign(tUpdateAudienceCampaign);

    // ── Tags ──────────────────────────────────────────────────
    // Edit mode reads the list's saved tags from their own endpoint (the campaign GET used
    // above is the public form endpoint and does not carry them). Until they have loaded,
    // the save leaves the saved tags untouched by not sending `tags` at all.
    const {
        data: savedTags,
        isLoading: isLoadingTags,
        isError: tagsLoadFailed,
    } = useQuery({
        queryKey: campaignTagsKey(instituteDetails?.id || '', editingCampaignId),
        queryFn: () => fetchCampaignTags(instituteDetails?.id || '', editingCampaignId),
        enabled: isEditMode && !!instituteDetails?.id && !!editingCampaignId,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    const { data: tagSummary } = useQuery({
        queryKey: campaignTagSummaryKey(instituteDetails?.id || ''),
        queryFn: () => fetchCampaignTagSummary(instituteDetails?.id || ''),
        enabled: !!instituteDetails?.id,
        staleTime: 5 * 60 * 1000,
    });
    const tagsReady = !isEditMode || savedTags !== undefined;
    const [tagRows, setTagRows] = useState<TagRow[]>(() => rowsFromTags(campaign?.tags));
    const [tagsError, setTagsError] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (savedTags) setTagRows(rowsFromTags(savedTags));
    }, [savedTags]);
    const handleTagRowsChange = (rows: TagRow[]) => {
        setTagRows(rows);
        setTagsError(undefined);
    };
    const tagsErrorMessage = (error: TagRowsError) =>
        error.code === 'tooMany'
            ? t('tags.errors.tooMany')
            : t(`tags.errors.${error.code}`, { key: error.key });

    // Sub-org options for the optional Sub-Org picker. Reuses the same accessible-sub-orgs
    // endpoint as the rest of the app ({id = child-institute id, name}).
    const { data: accessibleSubOrgs } = useQuery({
        queryKey: ['ACCESSIBLE_SUB_ORGS', instituteDetails?.id],
        queryFn: () => listAccessibleSubOrgs(instituteDetails?.id || ''),
        enabled: !!instituteDetails?.id,
        staleTime: 5 * 60 * 1000,
    });
    const subOrgDropdownOptions = useMemo(
        () => [
            { value: '', label: t('subOrg.noneOption') },
            ...(accessibleSubOrgs ?? []).map((so) => ({ value: so.id, label: so.name })),
        ],
        [accessibleSubOrgs, t]
    );
    const existingCustomFields = useMemo(
        () => convertExistingCustomFields(campaignData?.institute_custom_fields),
        [campaignData?.institute_custom_fields]
    );
    const statusValue = watch('status');
    const isStatusActive = statusValue?.toUpperCase?.() === 'ACTIVE';

    // Store initial custom fields for create mode (from settings) so we can restore them on reset
    const initialCreateModeCustomFields = useRef<any[] | null>(null);
    // Same idea for the post-submit block: the institute-wide default fetched
    // once in create mode, kept so Reset restores it without a second fetch.
    const initialCreateModePostSubmit = useRef<AudiencePostSubmitConfiguration | null>(null);

    useEffect(() => {
        if (campaignData) {
            setEmails(parseEmailsFromCsv(campaignData.to_notify));
        } else {
            setEmails([]);
        }
    }, [campaignData]);

    useEffect(() => {
        if (campaignData && editingCampaignId) {
            const shareLink = createCampaignLink(
                editingCampaignId,
                instituteDetails?.learner_portal_base_url
            );
            setLatestCampaignShareLink(shareLink);
            setLatestCampaignId(editingCampaignId);
        } else if (!campaignData) {
            setLatestCampaignShareLink(null);
            setLatestCampaignId(null);
        }
    }, [campaignData, editingCampaignId, instituteDetails?.learner_portal_base_url]);

    // Set start date to today (date only) when form initializes (create mode only)
    useEffect(() => {
        if (campaignData) return;
        const today = new Date();
        const todayDateOnly =
            today.toISOString().split('T')[0] || today.toISOString().substring(0, 10); // Format: YYYY-MM-DD
        if (todayDateOnly) {
            setValue('start_date_local', todayDateOnly, { shouldValidate: false });
        }
    }, [campaignData, setValue]);

    // File upload setup
    const { uploadFile, getPublicUrl } = useFileUpload();
    const campaignImageRef = useRef<HTMLInputElement>(null);
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities || {})[0];
    const userId =
        (tokenData as any)?.sub || (tokenData as any)?.userId || (tokenData as any)?.id || '';

    // Handle file upload for campaign image
    const handleCampaignImageUpload = async (file: File) => {
        try {
            const prev = getValues('uploadingStates');
            setValue('uploadingStates', { ...prev, campaign_image: true });

            const uploadedFileId = await uploadFile({
                file,
                setIsUploading: (state: boolean | ((prev: boolean) => boolean)) => {
                    const currentState = prev.campaign_image;
                    const newState = typeof state === 'function' ? state(currentState) : state;
                    setValue('uploadingStates', { ...prev, campaign_image: newState });
                },
                userId: 'your-user-id',
                source: INSTITUTE_ID,
                sourceId: 'CAMPAIGNS',
            });

            const publicUrl = await getPublicUrl(uploadedFileId || '');

            if (uploadedFileId) {
                setValue('campaign_image', uploadedFileId);
                setValue('campaign_imageBlob', publicUrl);
            }
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error(t('errors.uploadImageFailed'));
        } finally {
            const prev = getValues('uploadingStates');
            setValue('uploadingStates', { ...prev, campaign_image: false });
        }
    };

    // Update form when campaign data is fetched
    useEffect(() => {
        if (isEditMode && isLoadingCampaign) {
            return; // Don't update form while loading
        }

        if (initialFormValues) {
            form.reset(initialFormValues);
            // In edit mode, ensure custom fields are set immediately from initial values
            if (
                isEditMode &&
                initialFormValues.custom_fields &&
                initialFormValues.custom_fields.length > 0
            ) {
                // Use a longer timeout to ensure form.reset() has fully completed
                setTimeout(() => {
                    setValue('custom_fields', initialFormValues.custom_fields, {
                        shouldDirty: false,
                        shouldTouch: false,
                    });
                }, 50);
            }
        } else {
            form.reset(defaultFormValues);
        }
    }, [form, initialFormValues, isEditMode, isLoadingCampaign, setValue]);

    // Async-load institute defaults directly from the live backend endpoint.
    //
    // This is the SINGLE source of truth for custom_fields in create mode.
    // Mirrors the working invite pattern:
    //   1. Fetch fresh DEFAULT_CUSTOM_FIELD mappings from the API.
    //   2. `getCampaignCustomFieldsAsync` guarantees Full Name / Email /
    //      Phone Number are present (as seeded defaults) and dedupes by key
    //      so historical duplicates in the settings blob can't leak through.
    //   3. Store the result in `initialCreateModeCustomFields.current` so the
    //      Reset button can restore it without re-fetching.
    //
    // In edit mode this effect is a no-op — initialFormValues already has the
    // saved fields from the campaign (populated in buildInitialFormValues).
    useEffect(() => {
        if (isEditMode) return;
        if (isLoadingCampaign) return;

        let cancelled = false;
        const SEEDED = ['full_name', 'email', 'phone_number'];

        getCampaignCustomFieldsAsync().then((fields) => {
            if (cancelled || !fields || fields.length === 0) return;

            // Final safety dedupe by key at the form boundary
            const seen = new Set<string>();
            const normalized = fields
                .filter((f) => {
                    if (seen.has(f.key)) return false;
                    seen.add(f.key);
                    return true;
                })
                .map((field, index) => {
                    const isSeeded = SEEDED.includes(field.key);
                    return {
                        id: field.id || String(index),
                        type: field.type,
                        name: field.name,
                        oldKey: isSeeded, // lock Full Name / Email / Phone Number
                        isRequired: field.isRequired ?? isSeeded,
                        key: field.key,
                        order: index,
                        _id: field._id,
                        fieldKey: field.fieldKey,
                        options: field.options,
                        config: field.config,
                    };
                });

            initialCreateModeCustomFields.current = normalized;
            setValue('custom_fields', normalized, {
                shouldDirty: false,
                shouldTouch: false,
            });
        });

        return () => {
            cancelled = true;
        };
    }, [isEditMode, isLoadingCampaign, setValue]);

    // Create mode: seed the post-submit block from the institute-wide default
    // (Settings → Lead Settings → Forms) so an admin configures the thank-you
    // screen once instead of retyping it per campaign. Edit mode is a no-op —
    // the campaign's own saved block already came through initialFormValues,
    // and a later change to the institute default must not rewrite it.
    useEffect(() => {
        if (isEditMode) return;
        if (isLoadingCampaign) return;

        let cancelled = false;
        fetchAudienceFormSettings().then((settings) => {
            if (cancelled) return;
            initialCreateModePostSubmit.current = settings.postSubmit;
            setValue('postSubmitConfiguration', settings.postSubmit, {
                shouldDirty: false,
                shouldTouch: false,
            });
        });

        return () => {
            cancelled = true;
        };
    }, [isEditMode, isLoadingCampaign, setValue]);

    // Institute feature switch for the Form Appearance card. Unlike the
    // post-submit default above this is needed in edit mode too, so it is a
    // query rather than a create-mode-only effect — and it shares the settings
    // page's cache key, so flipping the switch there is reflected here without
    // a reload. Defaults to hidden while it loads.
    const { data: audienceFormSettings } = useQuery({
        queryKey: AUDIENCE_FORM_SETTINGS_QUERY_KEY,
        queryFn: fetchAudienceFormSettings,
        staleTime: 5 * 60 * 1000,
    });
    const formAppearanceEnabled = audienceFormSettings?.formAppearanceEnabled === true;

    // Custom fields array management. keyName: with the default ('id') RHF puts
    // its own generated key on every row's `id`, and the handlers below wrote
    // those rows back with setValue — replacing each field's real id on every
    // delete / Required toggle / edit. CampaignCustomFieldsCard uses the same key.
    useFieldArray({
        control,
        name: 'custom_fields',
        keyName: '_rhfKey',
    });
    const customFields = getValues('custom_fields');

    // NOTE (2026-04): `getInitialCustomFieldsFromSettings` + `applyDefaultCustomFields`
    // were removed. They read from the stale localStorage settings cache,
    // hardcoded Full Name / Email, and explicitly filtered out Phone Number
    // — causing three bugs:
    //
    //   1. Cache bled into new campaigns (showed all historical feature fields)
    //   2. Phone Number missing on localhost (explicit filter)
    //   3. Duplicates in prod (hardcoded seeded fields + API response both appeared)
    //
    // Default loading is now entirely handled by the `useEffect` above that
    // calls `getCampaignCustomFieldsAsync`, which matches the working invite
    // flow — single async source of truth with hardcoded fallback that
    // includes Full Name + Email + Phone Number, deduped by key.

    const setCustomFieldsFromExisting = useCallback(
        (fields: any[]) => {
            const normalizedFields = fields.map((field, index) => ({
                ...field,
                order: index,
                id: field.id ?? String(index),
                isRequired: field.isRequired ?? true,
                oldKey: field.oldKey ?? false,
            }));
            setValue('custom_fields', normalizedFields, {
                shouldDirty: false,
                shouldTouch: false,
            });
        },
        [setValue]
    );

    // Edit mode: ensure fields from initialFormValues land on the form if the
    // parent `form.reset(initialFormValues)` was skipped for any reason.
    //
    // Create mode: no-op. The async useEffect above (`getCampaignCustomFieldsAsync`)
    // is the single source of truth for default fields.
    useEffect(() => {
        if (!isEditMode) return;
        if (!initialFormValues) return;

        const currentFields = getValues('custom_fields');
        if (
            initialFormValues.custom_fields &&
            initialFormValues.custom_fields.length > 0 &&
            (!currentFields || currentFields.length === 0)
        ) {
            setValue('custom_fields', initialFormValues.custom_fields, {
                shouldDirty: false,
                shouldTouch: false,
            });
        }
    }, [isEditMode, initialFormValues, getValues, setValue]);

    const handleFormReset = () => {
        setTagRows(rowsFromTags(isEditMode ? savedTags : undefined));
        setTagsError(undefined);
        if (isEditMode && existingCustomFields && existingCustomFields.length > 0) {
            // In edit mode, reset to original campaign data
            handleReset();
            setCustomFieldsFromExisting(existingCustomFields);
            setEmails(parseEmailsFromCsv(campaignData?.to_notify));
        } else {
            // In create mode, reset form values but preserve the initial custom
            // fields that were loaded via getCampaignCustomFieldsAsync.
            const fieldsToRestore = initialCreateModeCustomFields.current;
            const postSubmitToRestore = initialCreateModePostSubmit.current;

            handleReset();

            setTimeout(() => {
                // Reset means "back to the institute defaults", not "back to the
                // hardcoded blank" — restore the fetched post-submit default too.
                if (postSubmitToRestore) {
                    setValue('postSubmitConfiguration', postSubmitToRestore, {
                        shouldDirty: false,
                        shouldTouch: false,
                    });
                }
                if (fieldsToRestore && fieldsToRestore.length > 0) {
                    setValue('custom_fields', fieldsToRestore, {
                        shouldDirty: false,
                        shouldTouch: false,
                    });
                } else {
                    // Fallback: re-fetch from the live API. This path should
                    // almost never hit because the mount-time useEffect already
                    // populated the ref — but keep it as a safety net in case
                    // the user hits Reset before the initial fetch resolves.
                    getCampaignCustomFieldsAsync().then((fields) => {
                        const SEEDED = ['full_name', 'email', 'phone_number'];
                        const seen = new Set<string>();
                        const normalized = (fields || [])
                            .filter((f) => {
                                if (seen.has(f.key)) return false;
                                seen.add(f.key);
                                return true;
                            })
                            .map((field, index) => {
                                const isSeeded = SEEDED.includes(field.key);
                                return {
                                    id: field.id || String(index),
                                    type: field.type,
                                    name: field.name,
                                    oldKey: isSeeded,
                                    isRequired: field.isRequired ?? isSeeded,
                                    key: field.key,
                                    order: index,
                                    _id: field._id,
                                    fieldKey: field.fieldKey,
                                    options: field.options,
                                    config: field.config,
                                };
                            });
                        initialCreateModeCustomFields.current = normalized;
                        setValue('custom_fields', normalized, {
                            shouldDirty: false,
                            shouldTouch: false,
                        });
                    });
                }
                setEmails([]);
            }, 50);
        }
    };

    // Custom field handlers
    const updateFieldOrders = () => {
        const currentFields = getValues('custom_fields');
        if (!currentFields) return;
        const updatedFields = currentFields.map((field, index) => ({
            ...field,
            order: index,
        }));
        setValue('custom_fields', updatedFields, {
            shouldDirty: true,
            shouldTouch: true,
        });
    };

    // The handlers below read the form value, not the field-array rows: those
    // carry RHF's `_rhfKey`, which must not be written back into the value.
    const handleDeleteOpenField = (id: number) => {
        const currentFields = getValues('custom_fields') ?? [];
        // Instead of removing the field, set its status to DELETED
        const updatedFields = currentFields.map((field, idx) => {
            if (idx === id) {
                return {
                    ...field,
                    status: 'DELETED',
                };
            }
            return field;
        });
        // Dropdowns that depended on the removed field become plain dropdowns again.
        setValue(
            'custom_fields',
            retargetDependentFields(
                updatedFields,
                savedFieldKeyOf(currentFields[id], instituteDetails?.id ?? ''),
                null
            )
        );
    };

    const toggleIsRequired = (id: number) => {
        const updatedFields = (getValues('custom_fields') ?? []).map((field, idx) =>
            idx === id ? { ...field, isRequired: !field.isRequired } : field
        );
        setValue('custom_fields', updatedFields);
    };

    // Index-based to match toggleIsRequired/handleDeleteOpenField in this file.
    const patchFieldAt = (index: number, patch: Record<string, unknown>) => {
        const currentFields = getValues('custom_fields') ?? [];
        const updatedFields = currentFields.map((field, idx) =>
            idx === index ? { ...field, ...patch } : field
        );
        // Dependent dropdowns store their parent's field_key. An unsaved parent is
        // keyed from its label, so a rename moves them along; a parent that is no
        // longer a dropdown releases them.
        const instituteId = instituteDetails?.id ?? '';
        const oldKey = savedFieldKeyOf(currentFields[index], instituteId);
        const edited = updatedFields[index];
        const newKey = isDropdownFieldType(edited?.type)
            ? savedFieldKeyOf(edited, instituteId)
            : null;
        setValue(
            'custom_fields',
            retargetDependentFields(updatedFields, oldKey, newKey) as typeof customFields
        );
    };

    /**
     * Applies an edit made in the (prefilled) custom-field dialog. Type, label, options and
     * required come back together, so they are written in one patch.
     */
    const handleEditFieldAt = (
        index: number,
        type: string,
        name: string,
        options?: DropdownOption[],
        config?: Record<string, unknown>
    ) =>
        patchFieldAt(index, {
            type,
            name,
            isRequired: (config?.isRequired as boolean | undefined) ?? true,
            // The dialog only returns options for choice types, so switching away from one
            // clears them instead of leaving stale values to reappear.
            options: options?.map((opt, i) => ({
                id: String(i),
                value: opt.value,
                ...(opt.parent ? { parent: opt.parent } : {}),
            })),
            // Always an object once the dialog has run, so "edited to nothing"
            // is distinguishable from "never touched" on save.
            config: config ?? {},
        });

    const handleAddGender = (type: string, name: string, oldKey: boolean) => {
        const newField = {
            id: nextFieldId(customFields),
            type,
            name,
            oldKey,
            ...(type === 'dropdown' && {
                options: [
                    { id: '0', value: 'MALE', disabled: true },
                    { id: '1', value: 'FEMALE', disabled: true },
                    { id: '2', value: 'OTHER', disabled: true },
                ],
            }),
            isRequired: true,
            key: '',
            order: customFields.length,
        };
        const updatedFields = [...customFields, newField];
        setValue('custom_fields', updatedFields);
    };

    const handleAddOpenFieldValues = (type: string, name: string, oldKey: boolean) => {
        const updatedFields = [
            ...customFields,
            {
                id: nextFieldId(customFields),
                type,
                name,
                oldKey,
                isRequired: true,
                key: '',
                order: customFields.length,
            },
        ];
        setValue('custom_fields', updatedFields);
    };

    // Handler for adding Phone Number (similar to handleAddGender)
    const handleAddPhoneNumber = (type: string, name: string, oldKey: boolean) => {
        const newField = {
            id: nextFieldId(customFields),
            type,
            name,
            oldKey,
            isRequired: true,
            key: 'phone_number',
            order: customFields.length,
        };
        const updatedFields = [...customFields, newField];
        setValue('custom_fields', updatedFields);
    };

    const handleValueChange = (id: string, newValue: string) => {
        const prevOptions = getValues('dropdownOptions');
        setValue(
            'dropdownOptions',
            prevOptions.map((option) =>
                option.id === id ? { ...option, value: newValue } : option
            )
        );
    };

    const handleEditClick = (id: number) => {
        const prevOptions = getValues('dropdownOptions');
        setValue(
            'dropdownOptions',
            prevOptions.map((option, idx) =>
                idx === id ? { ...option, disabled: !option.disabled } : option
            )
        );
    };

    const handleDeleteOptionField = (id: number) => {
        const prevOptions = getValues('dropdownOptions');
        setValue(
            'dropdownOptions',
            prevOptions.filter((field, idx) => idx !== id)
        );
    };

    const handleAddDropdownOptions = () => {
        const prevOptions = getValues('dropdownOptions');
        setValue('dropdownOptions', [
            ...prevOptions,
            {
                id: String(prevOptions.length),
                value: t('customField.newOptionDefault', { number: prevOptions.length + 1 }),
                disabled: true,
            },
        ]);
    };

    const handleCloseDialog = (
        type: string,
        name: string,
        oldKey: boolean,
        options?: DropdownOption[],
        config?: Record<string, unknown>
    ) => {
        const rawOptions =
            options ??
            (type === 'dropdown' || type === 'radio' ? getValues('dropdownOptions') : undefined);
        const resolvedOptions = rawOptions?.map((opt) => ({
            id: String(opt.id),
            value: opt.value,
            ...('parent' in opt && opt.parent ? { parent: opt.parent } : {}),
        }));
        const newField = {
            id: nextFieldId(customFields),
            type,
            name,
            oldKey,
            ...(resolvedOptions && { options: resolvedOptions }),
            // Carried through so help text, file limits and the verification gate
            // survive the save — the dialog collected them, this dropped them.
            config: config ?? {},
            isRequired: (config?.isRequired as boolean | undefined) ?? true,
            key: '',
            order: customFields.length,
        };
        const updatedFields = [...customFields, newField];
        setValue('custom_fields', updatedFields as typeof customFields);
        setValue('isDialogOpen', false);
        setValue('textFieldValue', '');
        setValue('dropdownOptions', []);
    };

    const onFormSubmit = handleSubmit(async (data: AudienceCampaignForm) => {
        if (!instituteDetails?.id) {
            toast.error(t('errors.instituteContextUnavailable'));
            return;
        }

        // Create only: a new campaign cannot start before today. This was the
        // Start Date input's native `min`, which the form's `noValidate` now
        // skips. Edit mode is exempt — a running campaign started in the past.
        // Same UTC "today" as that `min`.
        if (!isEditMode) {
            const todayDateOnly = new Date().toISOString().split('T')[0] ?? '';
            const startDateOnly = (data.start_date_local || '').split('T')[0] ?? '';
            if (startDateOnly && startDateOnly < todayDateOnly) {
                toast.error(t('errors.startDateInPast'));
                scrollToSection(SECTION_BASICS);
                return;
            }
        }

        // A bad redirect/CTA link only fails on the public form, long after the
        // admin has left this dialog — block the save instead.
        const postSubmitError = validatePostSubmitConfiguration(
            data.postSubmitConfiguration ?? DEFAULT_POST_SUBMIT_CONFIGURATION
        );
        if (postSubmitError) {
            toast.error(postSubmitError);
            return;
        }

        // Same reasoning for the cover image — a broken src only shows itself on
        // the public form, after the admin has closed this dialog.
        const appearanceError = validateFormAppearance(
            data.formAppearance ?? DEFAULT_FORM_APPEARANCE
        );
        if (appearanceError) {
            toast.error(appearanceError);
            return;
        }

        // Tags: validated here so the admin sees which one is wrong before the round-trip.
        // Not sent while an edited list's saved tags are unknown (still loading / failed),
        // which the backend reads as "leave them unchanged".
        let tagsToSend: Record<string, string> | undefined;
        if (tagsReady) {
            const tagResult = tagsFromRows(tagRows);
            if (tagResult.error) {
                const message = tagsErrorMessage(tagResult.error);
                setTagsError(message);
                toast.error(message);
                scrollToSection(SECTION_BASICS);
                return;
            }
            tagsToSend = tagResult.tags;
        }

        // Flush any half-typed email in the Team Notifications box into the
        // committed list before building the payload. Returns the final list
        // synchronously so we don't depend on React state having re-rendered
        // (the `emails` closure below could otherwise be one keystroke stale).
        const notifyEmails = multiEmailRef.current?.flush() ?? emails;

        let parsedCustomFields: unknown = undefined;
        if (data.institute_custom_fields) {
            try {
                const parsed = JSON.parse(data.institute_custom_fields);
                if (parsed !== null && !Array.isArray(parsed)) {
                    toast.error(t('errors.customFieldsMustBeArray'));
                    return;
                }
                parsedCustomFields = parsed;
            } catch (error) {
                toast.error(t('errors.customFieldsInvalidJson'));
                console.error('Invalid custom fields JSON:', error);
                return;
            }
        }

        const hasCustomFieldShape = Array.isArray(parsedCustomFields)
            ? (parsedCustomFields as any[]).every((field) => field && field.custom_field)
            : false;

        const transformedCustomFields = convertFieldsToPayload(
            data.custom_fields || [],
            instituteDetails.id
        );

        const customFieldsFromJson =
            Array.isArray(parsedCustomFields) && parsedCustomFields.length > 0
                ? hasCustomFieldShape
                    ? (parsedCustomFields as any[])
                    : convertFieldsToPayload(parsedCustomFields as any[], instituteDetails.id)
                : [];

        const customFieldsToSend =
            customFieldsFromJson.length > 0 ? customFieldsFromJson : transformedCustomFields;

        // Only include ACTIVE fields in the payload. Fields the user
        // deleted (status=DELETED) are excluded — the backend's
        // syncFeatureCustomFields will soft-delete any previously-saved
        // mapping that is no longer in the incoming list.
        const activeFields = (data.custom_fields || []).filter(
            (field: any) => field.status !== 'DELETED'
        );
        const allCustomFieldsPayload = convertFieldsToPayload(activeFields, instituteDetails.id);

        // Debug logging
        console.log('Custom Fields Debug:', {
            'data.custom_fields': data.custom_fields,
            transformedCustomFields,
            parsedCustomFields,
            customFieldsToSend,
            allCustomFieldsPayload,
        });

        const payload = {
            id: editingCampaignId || undefined,
            institute_id: instituteDetails.id,
            campaign_name: data.campaign_name.trim(),
            campaign_type: data.campaign_type.trim(),
            description: data.description?.trim() || '',
            campaign_objective: data.campaign_objective?.trim() || '',
            to_notify: notifyEmails.join(', '),
            send_respondent_email: Boolean(data.send_respondent_email),
            json_web_metadata: data.json_web_metadata?.trim() || '',
            // Merge into (not replace) the existing blob — setting_json also
            // carries other per-campaign settings the backend writes. Chained,
            // because each helper spreads what it was given and overwrites only
            // its own key.
            setting_json: applyFormAppearance(
                applyPostSubmitConfiguration(
                    campaignData?.setting_json,
                    data.postSubmitConfiguration ?? DEFAULT_POST_SUBMIT_CONFIGURATION
                ),
                data.formAppearance ?? DEFAULT_FORM_APPEARANCE
            ),
            created_by_user_id: userId,
            start_date_local: formatDateTimeForPayload(data.start_date_local, false),
            end_date_local: formatDateTimeForPayload(data.end_date_local, true),
            status: data.status?.toUpperCase?.() || data.status,
            default_initial_score: data.default_initial_score,
            // Empty string (no sub-org selected) → undefined so the backend stores null / clears it.
            sub_org_id: data.sub_org_id ? data.sub_org_id : undefined,
            institute_custom_fields:
                allCustomFieldsPayload.length > 0 ? allCustomFieldsPayload : customFieldsToSend,
            tags: tagsToSend,
        };

        try {
            if (isEditMode && editingCampaignId) {
                await updateCampaign.mutateAsync({
                    audienceId: editingCampaignId,
                    payload,
                });
                const shareLink = createCampaignLink(
                    editingCampaignId,
                    instituteDetails?.learner_portal_base_url
                );
                setLatestCampaignShareLink(shareLink);
                setLatestCampaignId(editingCampaignId);
                onSuccess?.();
            } else {
                const createdCampaign = await createCampaign.mutateAsync(payload);
                const createdCampaignId = createdCampaign?.id || createdCampaign?.campaign_id;
                if (createdCampaignId) {
                    const shareLink = createCampaignLink(
                        createdCampaignId,
                        instituteDetails?.learner_portal_base_url
                    );
                    setLatestCampaignShareLink(shareLink);
                    setLatestCampaignId(createdCampaignId);
                }
                handleFormReset();
                onSuccess?.();
            }
        } catch (error) {
            console.error('Error saving campaign:', error);
            if (!isEditMode) {
                setLatestCampaignShareLink(null);
                // Cleared together with the link, always. The panel is guarded on
                // the link alone, so a stale id is invisible today — but the two
                // are one fact ("the campaign we just saved"), and letting them
                // drift is how a later change ends up shortening the wrong one.
                setLatestCampaignId(null);
            }
        }
    });

    useEffect(() => {
        setValue('to_notify', emails.join(', '));
    }, [emails, setValue]);

    const isSaving = isSubmitting || createCampaign.isPending || updateCampaign.isPending;
    const primaryButtonLabel = isEditMode
        ? isSaving
            ? t('actions.saving')
            : t('actions.save')
        : isSaving
          ? t('actions.creating')
          : t('actions.create', {
                term: getTerminology(OtherTerms.AudienceList, SystemTerms.AudienceList),
            });

    // Opened from an Edit link: scroll to that section once the form is on screen.
    const scrolledToInitialRef = useRef(false);
    const isFormReady = !(isEditMode && isLoadingCampaign);
    useEffect(() => {
        if (scrolledToInitialRef.current || !isFormReady || !initialStep) return;
        scrolledToInitialRef.current = true;
        const frame = requestAnimationFrame(() => scrollToSection(initialStep));
        return () => cancelAnimationFrame(frame);
    }, [isFormReady, initialStep, scrollToSection]);

    // Show loading state while fetching campaign data
    if (isEditMode && isLoadingCampaign) {
        return (
            <div className="flex items-center justify-center py-8">
                <DashboardLoader />
            </div>
        );
    }

    return (
        // noValidate: zod owns validation. The browser's own checks (e.g. Start
        // Date `min` = today on a campaign that started earlier) fire on inputs in
        // collapsed cards, where Chrome cannot show its bubble — so Save
        // silently did nothing.
        <form
            noValidate
            onSubmit={onFormSubmit}
            className="w-full min-w-0 space-y-6 overflow-hidden"
        >
            {isStatusActive && latestCampaignShareLink && (
                <div className="rounded-lg border border-primary-100 bg-primary-50 p-4">
                    <p className="text-sm font-semibold text-primary-700">{t('shareLink.ready')}</p>
                    <CampaignLink
                        presetLink={latestCampaignShareLink}
                        campaignId={latestCampaignId ?? undefined}
                        enableShortLink
                        className="mt-2"
                        label={undefined}
                    />
                </div>
            )}
            <div
                ref={(el) => {
                    sectionRefs.current[0] = el;
                }}
                className="space-y-6"
            >
                {/* Campaign Name */}
                <div>
                    <label className="block text-sm font-semibold text-neutral-700">
                        {t('campaignName.label')} <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        placeholder={t('campaignName.placeholder')}
                        {...register('campaign_name')}
                        className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                    {errors.campaign_name && (
                        <span className="mt-1 block text-sm text-red-500">
                            {errors.campaign_name.message as string}
                        </span>
                    )}
                </div>

                {/* Campaign Image */}

                {/* Campaign Type & Objective Row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label className="block text-sm font-semibold text-neutral-700">
                            {t('campaignType.label', { term })}{' '}
                            <span className="text-red-500">*</span>
                        </label>
                        <div className="mt-2">
                            <CampaignTypeDropdown
                                value={watch('campaign_type')}
                                error={errors.campaign_type?.message as string}
                                onChange={(val) => {
                                    setValue('campaign_type', val, {
                                        shouldValidate: true,
                                        shouldDirty: true,
                                    });
                                }}
                            />
                        </div>
                    </div>
                    {/* CampaignObjective */}
                    <div>
                        <label className="block text-sm font-semibold text-neutral-700">
                            {t('campaignObjective.label')}
                            {/* <span className="text-red-500">*</span> */}
                        </label>
                        <input
                            type="text"
                            placeholder={t('campaignObjective.placeholder')}
                            {...register('campaign_objective')}
                            className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        />
                        {/* {errors.campaign_objective && (
                        <span className="mt-1 block text-sm text-red-500">
                            {errors.campaign_objective.message as string}
                        </span>
                    )} */}
                    </div>
                </div>

                {/* Sub-Org (optional) — only shown when the institute has sub-orgs */}
                {subOrgDropdownOptions.length > 1 && (
                    <div>
                        <label className="block text-sm font-semibold text-neutral-700">
                            {t('subOrg.label')}
                        </label>
                        <div className="mt-2">
                            <StatusDropdown
                                value={watch('sub_org_id') || ''}
                                initialOptions={subOrgDropdownOptions}
                                placeholder={t('subOrg.placeholder')}
                                onChange={(val) => {
                                    setValue('sub_org_id', val, { shouldDirty: true });
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Description */}
                <div>
                    <label className="block text-sm font-semibold text-neutral-700">
                        {t('description.label')}
                    </label>
                    <textarea
                        placeholder={t('description.placeholder')}
                        rows={3}
                        {...register('description')}
                        className="mt-2 w-full resize-none rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                    {errors.description && (
                        <span className="mt-1 block text-sm text-red-500">
                            {errors.description.message as string}
                        </span>
                    )}
                </div>

                {/* Start & End Date Row */}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Start Date */}
                    <div>
                        <label className="block text-sm font-semibold text-neutral-700">
                            {t('startDate.label')} <span className="text-red-500">*</span>
                        </label>
                        <Controller
                            name="start_date_local"
                            control={control}
                            render={({ field }) => {
                                const rawValue = field.value as unknown;
                                let dateValue = '';

                                // Handle different input types (string date, Date object, or ISO string)
                                if (typeof rawValue === 'string' && rawValue !== '') {
                                    // If it's already in YYYY-MM-DD format, use it directly
                                    if (rawValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                        dateValue = rawValue;
                                    } else {
                                        // If it's an ISO string, extract just the date part
                                        const date = new Date(rawValue);
                                        if (!Number.isNaN(date.getTime())) {
                                            dateValue =
                                                date.toISOString().split('T')[0] ||
                                                date.toISOString().substring(0, 10);
                                        }
                                    }
                                } else if (
                                    rawValue &&
                                    typeof rawValue === 'object' &&
                                    typeof (rawValue as Date).toISOString === 'function'
                                ) {
                                    const isoString = (rawValue as Date).toISOString();
                                    dateValue =
                                        isoString.split('T')[0] || isoString.substring(0, 10);
                                }

                                // Set minimum date to today (date only)
                                const today = new Date();
                                const minDate =
                                    today.toISOString().split('T')[0] ||
                                    today.toISOString().substring(0, 10); // Format: YYYY-MM-DD

                                return (
                                    <input
                                        type="date"
                                        value={dateValue}
                                        min={minDate}
                                        onChange={(e) => {
                                            const selectedDate = e.target.value; // Already in YYYY-MM-DD format
                                            setValue('start_date_local', selectedDate, {
                                                shouldValidate: true,
                                                shouldDirty: true,
                                            });
                                        }}
                                        className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                    />
                                );
                            }}
                        />
                        {errors.start_date_local && (
                            <span className="mt-1 block text-sm text-red-500">
                                {errors.start_date_local.message as string}
                            </span>
                        )}
                    </div>

                    {/* End Date */}
                    <div>
                        <label className="block text-sm font-semibold text-neutral-700">
                            {t('endDate.label')} <span className="text-red-500">*</span>
                        </label>
                        <Controller
                            name="end_date_local"
                            control={control}
                            render={({ field }) => {
                                const rawValue = field.value as unknown;
                                let dateValue = '';

                                // Handle different input types (string date, Date object, or ISO string)
                                if (typeof rawValue === 'string' && rawValue !== '') {
                                    // If it's already in YYYY-MM-DD format, use it directly
                                    if (rawValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                        dateValue = rawValue;
                                    } else {
                                        // If it's an ISO string, extract just the date part
                                        const date = new Date(rawValue);
                                        if (!Number.isNaN(date.getTime())) {
                                            dateValue =
                                                date.toISOString().split('T')[0] ||
                                                date.toISOString().substring(0, 10);
                                        }
                                    }
                                } else if (
                                    rawValue &&
                                    typeof rawValue === 'object' &&
                                    typeof (rawValue as Date).toISOString === 'function'
                                ) {
                                    const isoString = (rawValue as Date).toISOString();
                                    dateValue =
                                        isoString.split('T')[0] || isoString.substring(0, 10);
                                }

                                // Compute minimum End Date = Start Date + 1 day (date only)
                                const startDateValue = watch('start_date_local');
                                let minEndDate: string;

                                if (startDateValue) {
                                    const start = new Date(startDateValue);
                                    const nextDay = new Date(start);
                                    nextDay.setDate(start.getDate() + 1); // Move to the next day
                                    const nextDayIso = nextDay.toISOString();
                                    minEndDate = (nextDayIso.split('T')[0] ||
                                        nextDayIso.substring(0, 10)) as string; // Format: YYYY-MM-DD
                                } else {
                                    // Fallback: today + 1 day
                                    const tomorrow = new Date();
                                    tomorrow.setDate(tomorrow.getDate() + 1);
                                    const tomorrowIso = tomorrow.toISOString();
                                    minEndDate = (tomorrowIso.split('T')[0] ||
                                        tomorrowIso.substring(0, 10)) as string; // Format: YYYY-MM-DD
                                }

                                return (
                                    <input
                                        type="date"
                                        value={dateValue}
                                        min={minEndDate}
                                        onChange={(e) => {
                                            const selectedDate = e.target.value; // Already in YYYY-MM-DD format
                                            setValue('end_date_local', selectedDate, {
                                                shouldValidate: true,
                                                shouldDirty: true,
                                            });
                                        }}
                                        className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                    />
                                );
                            }}
                        />
                        {errors.end_date_local && (
                            <span className="mt-1 block text-sm text-red-500">
                                {errors.end_date_local.message as string}
                            </span>
                        )}
                    </div>
                </div>

                {/* Status */}
                <div>
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            {t('status.label')}
                        </label>
                        <TooltipProvider>
                            <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600 focus:outline-none"
                                        aria-label={t('status.infoAriaLabel')}
                                    >
                                        <Info className="size-4" weight="bold" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs bg-neutral-800 text-xs text-white">
                                    <p>{t('status.tooltip')}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <div className="mt-2">
                        <StatusDropdown
                            value={watch('status')}
                            error={errors.status?.message as string}
                            onChange={(val) => {
                                setValue('status', val, {
                                    shouldValidate: true,
                                    shouldDirty: true,
                                });
                            }}
                        />
                    </div>
                </div>

                {/* Tags — key/value labels reports can group this list's leads by */}
                <CampaignTagsEditor
                    rows={tagRows}
                    onChange={handleTagRowsChange}
                    suggestions={tagSummary}
                    isLoading={isEditMode && isLoadingTags}
                    loadFailed={isEditMode && tagsLoadFailed}
                    error={tagsError}
                />
            </div>

            <div
                ref={(el) => {
                    sectionRefs.current[4] = el;
                }}
                className="space-y-6"
            >
                {/* Emails & Share Analytics */}
                <div className="  w-full  gap-2 rounded-lg border border-neutral-300 px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            {' '}
                            {t('teamNotifications.label')}{' '}
                        </label>
                        <TooltipProvider>
                            <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600 focus:outline-none"
                                        aria-label={t('teamNotifications.infoAriaLabel')}
                                    >
                                        <Info className="size-4" weight="bold" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs bg-neutral-800 text-xs text-white">
                                    <p>{t('teamNotifications.tooltip')}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <MultiEmailInput
                        ref={multiEmailRef}
                        value={emails}
                        onChange={setEmails}
                        placeholder={t('teamNotifications.placeholder')}
                        error={errors?.to_notify?.message}
                    />

                    {/* Share Campaign Analytics */}
                    <div className="flex items-center justify-between gap-2 p-2">
                        <div className="flex items-center gap-2">
                            <label className="block text-sm font-semibold text-neutral-700">
                                {t('shareAnalytics.label')}
                            </label>
                            <TooltipProvider>
                                <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="inline-flex items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600 focus:outline-none"
                                            aria-label={t('shareAnalytics.infoAriaLabel')}
                                        >
                                            <Info className="size-4" weight="regular" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs bg-neutral-800 text-xs text-white">
                                        <p>{t('shareAnalytics.tooltip')}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <Switch
                            checked={watch('send_respondent_email')}
                            onCheckedChange={(checked: boolean) =>
                                setValue('send_respondent_email', checked)
                            }
                        />
                    </div>
                </div>

                {/* Initial Lead Score */}
                <div>
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            {t('initialLeadScore.label')}
                        </label>
                        <TooltipProvider>
                            <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600 focus:outline-none"
                                        aria-label={t('initialLeadScore.infoAriaLabel')}
                                    >
                                        <Info className="size-4" weight="bold" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs bg-neutral-800 text-xs text-white">
                                    <p>{t('initialLeadScore.tooltip')}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <Controller
                        name="default_initial_score"
                        control={control}
                        render={({ field }) => (
                            <input
                                type="number"
                                min={0}
                                max={50}
                                value={field.value ?? 20}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                                className="mt-2 w-32 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                            />
                        )}
                    />
                    {errors.default_initial_score && (
                        <span className="mt-1 block text-sm text-red-500">
                            {errors.default_initial_score.message as string}
                        </span>
                    )}
                </div>
            </div>

            <div
                ref={(el) => {
                    sectionRefs.current[1] = el;
                }}
                className="space-y-6"
            >
                {/* Customize Campaign Form - Custom Fields Card */}
                <CampaignCustomFieldsCard
                    form={form}
                    updateFieldOrders={updateFieldOrders}
                    handleDeleteOpenField={handleDeleteOpenField}
                    toggleIsRequired={toggleIsRequired}
                    handleAddGender={handleAddGender}
                    handleAddOpenFieldValues={handleAddOpenFieldValues}
                    handleValueChange={handleValueChange}
                    handleEditClick={handleEditClick}
                    handleDeleteOptionField={handleDeleteOptionField}
                    handleAddDropdownOptions={handleAddDropdownOptions}
                    handleEditFieldAt={handleEditFieldAt}
                    campaignId={editingCampaignId}
                    handleCloseDialog={handleCloseDialog}
                    handleAddPhoneNumber={handleAddPhoneNumber}
                />
            </div>

            <div
                ref={(el) => {
                    sectionRefs.current[2] = el;
                }}
                className="space-y-6"
            >
                {/* Post Submit Configuration — the thank-you screen / redirect the
                respondent gets. Mirrors the enroll invite's Post Form Fill card. */}
                <Controller
                    name="postSubmitConfiguration"
                    control={control}
                    render={({ field }) => (
                        <PostSubmitConfigurationEditor
                            // `?? DEFAULT` guards the window between a form.reset()
                            // and the async default landing — the editor is fully
                            // controlled and would crash on an undefined value.
                            value={field.value ?? DEFAULT_POST_SUBMIT_CONFIGURATION}
                            onChange={field.onChange}
                            // Collapsed like the other optional cards, unless the
                            // admin came here from its Edit link.
                            collapsible={initialStep !== SECTION_AFTER_SUBMIT}
                            previewCampaignName={
                                watch('campaign_name') ||
                                t('postSubmit.previewCampaignNameFallback')
                            }
                            description={t('postSubmit.description')}
                        />
                    )}
                />
            </div>

            <div
                ref={(el) => {
                    sectionRefs.current[3] = el;
                }}
                className="space-y-6"
            >
                {/* Form Template — the whole-page look of the public form. Not
                behind the Form Appearance institute switch: picking a look is
                a per-campaign choice. Writes `formAppearance.template`. */}
                <Controller
                    name="formAppearance"
                    control={control}
                    render={({ field }) => (
                        <FormTemplatePicker
                            value={field.value ?? DEFAULT_FORM_APPEARANCE}
                            onChange={field.onChange}
                            title={t('formTemplate.title')}
                            description={t('formTemplate.description')}
                        />
                    )}
                />

                {/* Form Heading & Text — the page heading (defaults to this list's
                name) and the form card's heading + sub-heading, with alignment.
                Deliberately NOT behind the Form Appearance institute switch:
                every campaign can reword its own form. Writes into the same
                `formAppearance` value, so the save path is unchanged. */}
                <Controller
                    name="formAppearance"
                    control={control}
                    render={({ field }) => (
                        <FormTextEditor
                            value={field.value ?? DEFAULT_FORM_APPEARANCE}
                            onChange={field.onChange}
                            // Collapsed like the other optional cards, unless the
                            // admin came here from its Edit link.
                            collapsible={initialStep !== SECTION_APPEARANCE}
                            previewCampaignName={
                                watch('campaign_name') ||
                                t('postSubmit.previewCampaignNameFallback')
                            }
                            previewCampaignDescription={watch('description') || ''}
                            previewCampaignObjective={watch('campaign_objective') || ''}
                            previewInstituteName={
                                instituteDetails?.institute_name || 'Your Institute'
                            }
                            previewFields={(watch('custom_fields') || [])
                                .filter((customField) => customField?.status !== 'DELETED')
                                .map((customField) => ({
                                    name: customField?.name || '',
                                    required: Boolean(customField?.isRequired),
                                }))}
                            title={t('formText.title')}
                            description={t('formText.description')}
                        />
                    )}
                />

                {/* Form Appearance — how the public response form looks while it is
                being filled in. Next to the heading text, because it is about
                the form itself, not what follows it. */}
                {/* Hidden until an institute turns it on in Settings → Lead
                Settings → Forms. A campaign that already has a saved
                formAppearance keeps it either way — this hides the editor, it
                does not clear the stored config. */}
                {formAppearanceEnabled && (
                    <Controller
                        name="formAppearance"
                        control={control}
                        render={({ field }) => (
                            <FormAppearanceEditor
                                // `?? DEFAULT` guards the window between a form.reset()
                                // and the value landing — the editor is fully controlled
                                // and would crash on an undefined value.
                                value={field.value ?? DEFAULT_FORM_APPEARANCE}
                                onChange={field.onChange}
                                // Collapsed by default: the create form must look the way
                                // it always did for admins who don't need this.
                                collapsible
                                previewCampaignName={
                                    watch('campaign_name') ||
                                    t('postSubmit.previewCampaignNameFallback')
                                }
                                previewCampaignDescription={watch('description') || ''}
                                previewCampaignObjective={watch('campaign_objective') || ''}
                                previewInstituteName={
                                    instituteDetails?.institute_name || 'Your Institute'
                                }
                                // The campaign's own fields, so the preview shows real
                                // labels instead of placeholder rows. Deleted rows are
                                // excluded because they are not sent to the API either.
                                previewFields={(watch('custom_fields') || [])
                                    .filter((field) => field?.status !== 'DELETED')
                                    .map((field) => ({
                                        name: field?.name || '',
                                        required: Boolean(field?.isRequired),
                                    }))}
                                title={t('formAppearance.title')}
                                description={t('formAppearance.description')}
                            />
                        )}
                    />
                )}
            </div>

            {/* Custom HTML Card */}
            {/* <CustomHTMLCard form={form} /> */}

            {/* Form Actions */}
            <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-6">
                <MyButton
                    type="button"
                    onClick={handleFormReset}
                    buttonType="secondary"
                    scale="medium"
                >
                    {t('actions.reset')}
                </MyButton>
                <span className="flex-1" />
                <MyButton type="submit" disabled={isSaving} buttonType="primary" scale="medium">
                    {primaryButtonLabel}
                </MyButton>
            </div>
        </form>
    );
};
