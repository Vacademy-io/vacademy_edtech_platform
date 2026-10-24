import type { TFunction } from 'i18next';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { FilterConfig } from '@/routes/manage-students/students-list/-types/students-list-types';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { InstituteDetailsType } from '@/schemas/student/student-list/institute-schema';
import { removeDefaultPrefix } from '@/utils/helpers/removeDefaultPrefix';
import { getBatchOwnName } from '@/utils/helpers/student-management/batch-display-name';
import {
    ALL_SESSIONS_ID,
    TERMINATED_STATUS,
} from '@/routes/manage-students/students-list/-hooks/useStudentFilters';
import { CustomFieldSetupItem } from '@/routes/audience-manager/list/-services/get-custom-field-setup';

export const GetFilterData = (
    t: TFunction,
    instituteDetails: InstituteDetailsType,
    _currentSession: string,
    campaigns?: { id?: string; campaign_name: string }[],
    subOrgs?: { id: string; name: string }[],
    // Free-text (non-DROPDOWN) custom fields, e.g. VetEducation's "Practice Type" —
    // rendered as a searchable multi-select instead of a static option list, since
    // they have no fixed `config` to draw options from.
    textCustomFields?: CustomFieldSetupItem[],
    // Institute-wide gate from Settings → Display Settings → "List Filters &
    // Sorting — Custom Fields" (STUDENTS surface). null/undefined = surface not
    // configured yet → legacy behavior (every dropdown + text field exposed).
    allowedCustomFieldIds?: Set<string> | null,
    // DATE/NUMBER custom fields to expose as range popovers. Already gated by
    // the caller (only enabled fields are passed) — range fields have no legacy
    // auto-expose, so an empty/absent list simply renders none.
    rangeCustomFields?: CustomFieldSetupItem[],
    // From the list response: whether this institute runs trials at all. False hides the
    // Membership filter, so an institute with no trial memberships is never offered a
    // Trial/Paid distinction that means nothing there.
    membershipTypesAvailable = false
) => {
    // TERMINATED is offered on top of the institute's default roster statuses, but never
    // applied by default — the normal list stays Active/Inactive, and an admin picks it to
    // see members who were removed (e.g. terminated out of a practice).
    const statusLabels: string[] = [...(instituteDetails?.student_statuses || [])];
    if (!statusLabels.includes(TERMINATED_STATUS)) statusLabels.push(TERMINATED_STATUS);
    const statuses = statusLabels.map((status, index) => ({
        id: index.toString(),
        label: status,
    }));

    const genders = instituteDetails?.genders.map((gender, index) => ({
        id: index.toString(),
        label: gender,
    }));

    const sessionExpiry = instituteDetails?.session_expiry_days.map((days, index) => ({
        id: index.toString(),
        label: t('sessionExpiry.optionLabel', { days }),
    }));

    // Check if any batch has is_org_associated = true
    const hasOrgAssociatedBatches = instituteDetails?.batches_for_sessions.some(
        (batch) => batch.is_org_associated === true
    );

    // When the "all sessions" sentinel is selected (or no session yet), don't filter
    // batches by session — that filter is the reason the batch chip used to show empty
    // on first load. The chip's own async autocomplete (PACKAGE_AUTOCOMPLETE_URL) still
    // takes over once admin types a search term.
    const showAllSessionsBatches = !_currentSession || _currentSession === ALL_SESSIONS_ID;
    const batchesInScope = (instituteDetails?.batches_for_sessions || []).filter((batch) =>
        showAllSessionsBatches ? true : batch.session.id === _currentSession
    );

    const filterData: FilterConfig[] = [
        {
            id: 'batch',
            title: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
            // Label by the batch's own name where it has one. Composing it from
            // course + level gave an institute whose batches share a course ten
            // identical entries, with no way to tell which one you were picking.
            filterList: batchesInScope
                .map((batch) => ({
                    id: batch.id,
                    label:
                        getBatchOwnName(batch) ||
                        `${removeDefaultPrefix(batch.package_dto.package_name)}${batch.level.level_name && batch.level.level_name !== 'DEFAULT' ? ` - ${removeDefaultPrefix(batch.level.level_name)}` : ''}`.trim(),
                }))
                .slice(0, 10),
        },
        {
            id: 'statuses',
            title: t('statuses.title'),
            filterList: statuses || [],
        },
        {
            id: 'gender',
            title: t('gender.title'),
            filterList: genders || [],
        },
        {
            id: 'session_expiry_days',
            title: `${getTerminology(ContentTerms.Session, SystemTerms.Session)} ${t('sessionExpiry.titleSuffix')}`,
            filterList: sessionExpiry || [],
        },
        ...(membershipTypesAvailable
            ? [
                  {
                      id: 'membership_types',
                      // Not "Membership": that word already names the sidebar section for
                      // plans and invites, so reusing it here read as the same thing.
                      title: 'Member Type',
                      filterList: [
                          { id: 'TRIAL', label: 'Trial' },
                          { id: 'TRIAL_ENDED', label: 'Trial ended' },
                          { id: 'PAID', label: 'Paid' },
                      ],
                  },
              ]
            : []),
        {
            id: 'joined_range',
            title: 'Joined',
            kind: 'DATE_RANGE' as const,
            filterList: [],
        },
        {
            id: 'payment_statuses',
            title: t('paymentStatus.title'),
            filterList: [
                { id: 'PAID', label: t('paymentStatus.paid') },
                { id: 'FAILED', label: t('paymentStatus.failed') },
                { id: 'PAYMENT_FAILED', label: t('paymentStatus.paymentFailed') },
            ],
        },
        {
            id: 'approval_statuses',
            title: t('approvalStatus.title'),
            filterList: [
                { id: 'PENDING_FOR_APPROVAL', label: t('approvalStatus.pendingForApproval') },
                { id: 'INVITED', label: t('approvalStatus.invited') },
            ],
        },
        {
            id: 'learner_type',
            title: t('cartStatus.title'),
            filterList: [
                { id: 'ABANDONED_CART', label: t('cartStatus.abandonedCart') },
            ],
        },
    ];

    // Add role filter if org-associated batches exist
    if (hasOrgAssociatedBatches && instituteDetails?.sub_org_roles) {
        const roles = instituteDetails.sub_org_roles.map((role, index) => ({
            id: role,
            label: role.replace(/_/g, ' '),
        }));

        filterData.push({
            id: 'sub_org_user_types',
            title: t('role.title'),
            filterList: roles,
        });
    }

    // Add sub-org filter — restricts to learners enrolled under the selected sub-org(s)
    // (matched server-side on ssigm.sub_org_id). Option id is the child-institute id.
    if (subOrgs && subOrgs.length > 0) {
        filterData.push({
            id: 'sub_org_ids',
            title: t('subOrg.title'),
            filterList: subOrgs.map((so) => ({ id: so.id, label: so.name })),
        });
    }

    // Add audience (campaign) filter — joins audience_response when applied
    if (campaigns && campaigns.length > 0) {
        const audienceOptions = campaigns
            .filter((c) => c.id)
            .map((c) => ({ id: c.id!, label: c.campaign_name }));
        if (audienceOptions.length > 0) {
            filterData.push({
                id: 'audience_ids',
                title: t('audience.title'),
                filterList: audienceOptions,
            });
        }
    }

    // Add custom field filters
    if (instituteDetails?.dropdown_custom_fields) {
        instituteDetails.dropdown_custom_fields
            .filter((customField) => !allowedCustomFieldIds || allowedCustomFieldIds.has(customField.id))
            .forEach((customField) => {
            try {
                const config = JSON.parse(customField.config);
                const options = config.map((option: any) => ({
                    id: option.value,
                    label: option.label,
                }));

                filterData.push({
                    id: customField.fieldKey,
                    title: customField.fieldName,
                    filterList: options,
                });
            } catch (error) {
                console.error(`Error parsing custom field config for ${customField.fieldName}:`, error);
            }
        });
    }

    // Add free-text custom field filters — searchable multi-select over the
    // distinct values actually stored, since there's no fixed option list.
    if (textCustomFields && textCustomFields.length > 0) {
        textCustomFields
            .filter(
                (customField) =>
                    !allowedCustomFieldIds || allowedCustomFieldIds.has(customField.custom_field_id)
            )
            .forEach((customField) => {
                filterData.push({
                    id: customField.field_key,
                    title: customField.field_name,
                    filterList: [],
                    kind: 'CUSTOM_FIELD_SEARCH',
                    customFieldId: customField.custom_field_id,
                });
            });
    }

    // DATE/NUMBER custom fields — range popover (typed operators) instead of a
    // value multi-select.
    if (rangeCustomFields && rangeCustomFields.length > 0) {
        rangeCustomFields.forEach((customField) => {
            filterData.push({
                id: customField.field_key,
                title: customField.field_name,
                filterList: [],
                kind: 'CUSTOM_FIELD_RANGE',
                customFieldId: customField.custom_field_id,
                fieldType: customField.field_type,
            });
        });
    }

    return filterData;
};
