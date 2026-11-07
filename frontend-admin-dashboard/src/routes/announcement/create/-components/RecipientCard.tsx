import { useState } from 'react';
import {
    CaretDown,
    Funnel,
    Prohibit,
    Trash,
    UserCircle,
    UsersThree,
    X,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/design-system/multi-select';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import type { TagItem } from '@/services/tag-management';
import type { CampaignItem } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { BatchPicker } from './BatchPicker';
import { FieldError, FieldHint, LoadFailure } from './primitives';
import type {
    AudienceRule,
    AudienceRuleType,
    BatchOption,
    CustomFieldOption,
    ExclusionType,
    FieldErrors,
    FieldFilter,
    RuleExclusion,
} from '../-types';

function buildRuleTypeLabels(t: TFunction): Record<AudienceRuleType, string> {
    return {
        ROLE: t('ruleTypes.role'),
        PACKAGE_SESSION: t('ruleTypes.packageSession'),
        USER: t('ruleTypes.user'),
        TAG: t('ruleTypes.tag'),
        AUDIENCE: t('ruleTypes.audience'),
        CUSTOM_FIELD_FILTER: t('ruleTypes.customFieldFilter'),
    };
}

let idSeq = 0;
const nextId = (prefix: string) => `${prefix}-${++idSeq}-${Math.random().toString(36).slice(2, 7)}`;

interface RecipientCardProps {
    rule: AudienceRule;
    index: number;
    errors: FieldErrors;
    showErrors: boolean;
    batches: BatchOption[];
    batchesLoading: boolean;
    batchNoun: string;
    batchNounPlural: string;
    learnerNounPlural: string;
    teacherNounPlural: string;
    tags: TagItem[];
    tagsLoading: boolean;
    tagsError: string | null;
    onReloadTags: () => void;
    campaigns: CampaignItem[];
    campaignsLoading: boolean;
    campaignsError: string | null;
    onReloadCampaigns: () => void;
    customFields: CustomFieldOption[];
    tagReach: number | null;
    tagReachLoading: boolean;
    onChange: (patch: Partial<AudienceRule>) => void;
    onRemove: () => void;
}

export function RecipientCard(props: RecipientCardProps) {
    const { t, i18n } = useTranslation('announcementRecipientCard');
    const RULE_TYPE_LABELS = buildRuleTypeLabels(t);
    const {
        rule,
        index,
        errors,
        showErrors,
        batches,
        batchesLoading,
        batchNoun,
        batchNounPlural,
        learnerNounPlural,
        teacherNounPlural,
        tags,
        tagsLoading,
        tagsError,
        onReloadTags,
        campaigns,
        campaignsLoading,
        campaignsError,
        onReloadCampaigns,
        customFields,
        onChange,
        onRemove,
    } = props;

    const [refineOpen, setRefineOpen] = useState(
        rule.fieldFilters.length > 0 || rule.exclusions.length > 0
    );
    const [userDraft, setUserDraft] = useState('');
    const err = (suffix: string) => (showErrors ? errors[`rule.${rule.key}.${suffix}`] : undefined);

    const tagOptions = tags
        .filter((tag) => {
            if (rule.tagScope === 'ALL') return true;
            if (rule.tagScope === 'DEFAULT') return Boolean(tag.defaultTag);
            return !tag.defaultTag;
        })
        .map((tag) => ({ label: tag.tagName, value: tag.id }));

    const needsOrgRole = rule.packageSessionIds.some((id) =>
        batches.find((b) => b.id === id && b.isOrgAssociated)
    );

    const addUserTokens = () => {
        // One paste of comma/space/newline separated ids should become many chips, not one.
        const parts = userDraft
            .split(/[\s,;]+/)
            .map((p) => p.trim())
            .filter(Boolean);
        if (parts.length === 0) return;
        onChange({ userIds: [...new Set([...rule.userIds, ...parts])] });
        setUserDraft('');
    };

    const updateFilter = (key: string, patch: Partial<FieldFilter>) =>
        onChange({
            fieldFilters: rule.fieldFilters.map((f) => (f.key === key ? { ...f, ...patch } : f)),
        });

    const updateExclusion = (key: string, patch: Partial<RuleExclusion>) =>
        onChange({
            exclusions: rule.exclusions.map((e) => (e.key === key ? { ...e, ...patch } : e)),
        });

    return (
        <div
            className={cn(
                'rounded-lg border bg-card p-4 shadow-sm transition-colors',
                showErrors &&
                    Object.keys(errors).some((k) => k.startsWith(`rule.${rule.key}.`)) &&
                    'border-danger-400'
            )}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-600">
                        {index + 1}
                    </span>
                    <Select
                        value={rule.type}
                        onValueChange={(value) =>
                            // Switching the rule type clears the previous type's selections so a
                            // hidden leftover value can never reach the payload.
                            onChange({
                                type: value as AudienceRuleType,
                                roleId: value === 'ROLE' ? 'STUDENT' : '',
                                packageSessionIds: [],
                                orgRole: undefined,
                                userIds: [],
                                tagIds: [],
                                campaignIds: [],
                                campaignNames: {},
                                fieldFilters:
                                    value === 'CUSTOM_FIELD_FILTER' ? rule.fieldFilters : [],
                            })
                        }
                    >
                        <SelectTrigger className="w-full sm:w-64">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(Object.keys(RULE_TYPE_LABELS) as AudienceRuleType[])
                                .filter(
                                    (type) =>
                                        type !== 'CUSTOM_FIELD_FILTER' || customFields.length > 0
                                )
                                .map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {type === 'PACKAGE_SESSION'
                                            ? t('ruleTypes.packageSessionSpecific', {
                                                  batchNounPlural,
                                              })
                                            : RULE_TYPE_LABELS[type]}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="icon"
                    aria-label={t('removeAudience', { index: index + 1 })}
                    onClick={onRemove}
                >
                    <Trash className="size-4" />
                </MyButton>
            </div>

            <div className="mt-4 space-y-3">
                {rule.type === 'ROLE' && (
                    <div className="space-y-1">
                        <Label className="text-caption font-semibold">{t('role.label')}</Label>
                        <Select
                            value={rule.roleId}
                            onValueChange={(value) => onChange({ roleId: value })}
                        >
                            <SelectTrigger className={cn(err('role') && 'border-danger-400')}>
                                <SelectValue placeholder={t('role.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="STUDENT">{learnerNounPlural}</SelectItem>
                                <SelectItem value="TEACHER">{teacherNounPlural}</SelectItem>
                                <SelectItem value="ADMIN">{t('role.admins')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <FieldError message={err('role')} />
                    </div>
                )}

                {rule.type === 'PACKAGE_SESSION' && (
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label className="text-caption font-semibold">
                                {batchNounPlural.charAt(0).toUpperCase() + batchNounPlural.slice(1)}
                            </Label>
                            <BatchPicker
                                batches={batches}
                                loading={batchesLoading}
                                selected={rule.packageSessionIds}
                                onChange={(ids) =>
                                    onChange({
                                        packageSessionIds: ids,
                                        orgRole: ids.some((id) =>
                                            batches.find((b) => b.id === id && b.isOrgAssociated)
                                        )
                                            ? rule.orgRole
                                            : undefined,
                                    })
                                }
                                invalid={!!err('batches')}
                                noun={batchNoun}
                                nounPlural={batchNounPlural}
                            />
                            <FieldError message={err('batches')} />
                        </div>
                        {needsOrgRole && (
                            <div className="space-y-1">
                                <Label className="text-caption font-semibold">
                                    {t('packageSession.orgRoleLabel')}
                                </Label>
                                <Select
                                    value={rule.orgRole ?? ''}
                                    onValueChange={(value) =>
                                        onChange({ orgRole: value as 'ADMIN' | 'LEARNER' })
                                    }
                                >
                                    <SelectTrigger
                                        className={cn(err('orgRole') && 'border-danger-400')}
                                    >
                                        <SelectValue
                                            placeholder={t('packageSession.orgRolePlaceholder')}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="LEARNER">
                                            {t('packageSession.orgRoleLearners')}
                                        </SelectItem>
                                        <SelectItem value="ADMIN">
                                            {t('packageSession.orgRoleAdmins')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <FieldHint>
                                    {t('packageSession.orgRoleHint', { batchNounPlural })}
                                </FieldHint>
                                <FieldError message={err('orgRole')} />
                            </div>
                        )}
                    </div>
                )}

                {rule.type === 'USER' && (
                    <div className="space-y-2">
                        <Label className="text-caption font-semibold">{t('user.label')}</Label>
                        <div className="flex flex-wrap items-start gap-2">
                            {/* MyInput caps itself at sm:w-60; the wrapper plus sm:w-full lets it
                                fill the row instead of collapsing to that cap. */}
                            <div className="min-w-0 flex-1">
                                <MyInput
                                    inputType="text"
                                    input={userDraft}
                                    onChangeFunction={(e) => setUserDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addUserTokens();
                                        }
                                    }}
                                    inputPlaceholder={t('user.placeholder')}
                                    className="sm:w-full"
                                    size="medium"
                                />
                            </div>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={addUserTokens}
                                disable={!userDraft.trim()}
                            >
                                {t('user.add')}
                            </MyButton>
                        </div>
                        {rule.userIds.length > 0 && (
                            <ul className="flex flex-wrap gap-1.5">
                                {rule.userIds.map((id) => (
                                    <li key={id}>
                                        <span className="flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-0.5 pl-2 pr-1 text-caption text-primary-600">
                                            <UserCircle className="size-3.5 shrink-0" />
                                            <span className="max-w-xs truncate">{id}</span>
                                            <button
                                                type="button"
                                                aria-label={t('user.remove', { id })}
                                                onClick={() =>
                                                    onChange({
                                                        userIds: rule.userIds.filter(
                                                            (u) => u !== id
                                                        ),
                                                    })
                                                }
                                                className="rounded-full p-0.5 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            >
                                                <X className="size-3" weight="bold" />
                                            </button>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <FieldError message={err('users')} />
                    </div>
                )}

                {rule.type === 'TAG' && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <Label className="text-caption font-semibold">{t('tag.label')}</Label>
                            <Select
                                value={rule.tagScope}
                                onValueChange={(value) =>
                                    onChange({
                                        tagScope: value as AudienceRule['tagScope'],
                                    })
                                }
                            >
                                <SelectTrigger className="h-8 w-40 text-caption">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">{t('tag.scopeAll')}</SelectItem>
                                    <SelectItem value="DEFAULT">{t('tag.scopeDefault')}</SelectItem>
                                    <SelectItem value="INSTITUTE">
                                        {t('tag.scopeInstitute')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {tagsError ? (
                            <LoadFailure message={tagsError} onRetry={onReloadTags} />
                        ) : (
                            <MultiSelect
                                options={tagOptions}
                                selected={rule.tagIds}
                                onChange={(ids) => onChange({ tagIds: ids })}
                                checkboxes
                                placeholder={tagsLoading ? t('tag.loading') : t('tag.placeholder')}
                                disabled={tagsLoading}
                            />
                        )}
                        <FieldHint>
                            {t('tag.hintPrefix')}{' '}
                            <span className="font-semibold">{t('tag.hintAny')}</span>{' '}
                            {t('tag.hintSuffix')}
                        </FieldHint>
                        <FieldError message={err('tags')} />
                    </div>
                )}

                {rule.type === 'AUDIENCE' && (
                    <div className="space-y-1">
                        <Label className="text-caption font-semibold">{t('audience.label')}</Label>
                        {campaignsError ? (
                            <LoadFailure message={campaignsError} onRetry={onReloadCampaigns} />
                        ) : (
                            <MultiSelect
                                options={campaigns
                                    .filter((c) => !!(c.id || c.campaign_id))
                                    .map((c) => ({
                                        value: (c.id || c.campaign_id) as string,
                                        label: `${c.campaign_name} · ${c.status}`,
                                    }))}
                                selected={rule.campaignIds}
                                checkboxes
                                onChange={(ids) => {
                                    // Keep a name for every picked id so the payload and summary
                                    // can label it even before (or without) the campaign list.
                                    const campaignNames: Record<string, string> = {};
                                    ids.forEach((id) => {
                                        const campaign = campaigns.find(
                                            (c) => (c.id || c.campaign_id) === id
                                        );
                                        campaignNames[id] =
                                            campaign?.campaign_name ?? rule.campaignNames[id] ?? '';
                                    });
                                    onChange({ campaignIds: ids, campaignNames });
                                }}
                                placeholder={
                                    campaignsLoading
                                        ? t('audience.loading')
                                        : t('audience.placeholder')
                                }
                                disabled={campaignsLoading}
                                className={cn(err('campaign') && 'border-danger-400')}
                            />
                        )}
                        <FieldHint>{t('audience.hint')}</FieldHint>
                        <FieldError message={err('campaign')} />
                    </div>
                )}

                {rule.type === 'CUSTOM_FIELD_FILTER' && (
                    <FieldHint>
                        {t('customFieldFilter.hintPrefix')}{' '}
                        <span className="font-semibold">{t('customFieldFilter.hintRefine')}</span>
                        .
                    </FieldHint>
                )}
                {rule.type === 'CUSTOM_FIELD_FILTER' && <FieldError message={err('filters')} />}
            </div>

            {/* ---------------------------------------------------------- refine */}
            <div className="mt-4 border-t pt-3">
                <button
                    type="button"
                    onClick={() => setRefineOpen((open) => !open)}
                    aria-expanded={refineOpen}
                    className="flex w-full items-center justify-between gap-2 rounded-sm py-1 text-caption font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <span className="flex items-center gap-2">
                        <Funnel className="size-4" />
                        {t('refine.toggle')}
                        {(rule.fieldFilters.length > 0 || rule.exclusions.length > 0) && (
                            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-primary-600">
                                {rule.fieldFilters.length + rule.exclusions.length}
                            </span>
                        )}
                    </span>
                    <CaretDown
                        className={cn('size-4 transition-transform', refineOpen && 'rotate-180')}
                    />
                </button>

                {refineOpen && (
                    <div className="mt-3 space-y-4">
                        {/* field filters */}
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-caption font-semibold">
                                    {t('refine.fieldFiltersLabel')}
                                </span>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    disable={customFields.length === 0}
                                    onClick={() =>
                                        onChange({
                                            fieldFilters: [
                                                ...rule.fieldFilters,
                                                {
                                                    key: nextId('filter'),
                                                    fieldId: '',
                                                    fieldName: '',
                                                    fieldType: 'text',
                                                    filterValue: '',
                                                    operator: 'equals',
                                                },
                                            ],
                                        })
                                    }
                                >
                                    {t('refine.addFilter')}
                                </MyButton>
                            </div>
                            {customFields.length === 0 ? (
                                <FieldHint>{t('refine.noCustomFields')}</FieldHint>
                            ) : rule.fieldFilters.length === 0 ? (
                                <FieldHint>{t('refine.noFilters')}</FieldHint>
                            ) : (
                                rule.fieldFilters.map((filter) => {
                                    const field = customFields.find((f) => f.id === filter.fieldId);
                                    return (
                                        <div
                                            key={filter.key}
                                            className="space-y-2 rounded-md border bg-muted/30 p-3"
                                        >
                                            <div className="flex items-start gap-2">
                                                <Select
                                                    value={filter.fieldId}
                                                    onValueChange={(fieldId) => {
                                                        const picked = customFields.find(
                                                            (f) => f.id === fieldId
                                                        );
                                                        updateFilter(filter.key, {
                                                            fieldId,
                                                            fieldName: picked?.name ?? '',
                                                            fieldType: picked?.type ?? 'text',
                                                            filterValue:
                                                                picked?.type === 'dropdown'
                                                                    ? []
                                                                    : '',
                                                            operator:
                                                                picked?.type === 'text'
                                                                    ? 'equals'
                                                                    : undefined,
                                                        });
                                                    }}
                                                >
                                                    <SelectTrigger className="flex-1">
                                                        <SelectValue
                                                            placeholder={t('refine.chooseField')}
                                                        />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {customFields.map((f) => (
                                                            <SelectItem key={f.id} value={f.id}>
                                                                {f.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    layoutVariant="icon"
                                                    aria-label={t('refine.removeFilter')}
                                                    onClick={() =>
                                                        onChange({
                                                            fieldFilters: rule.fieldFilters.filter(
                                                                (f) => f.key !== filter.key
                                                            ),
                                                        })
                                                    }
                                                >
                                                    <X className="size-4" />
                                                </MyButton>
                                            </div>

                                            {field?.type === 'dropdown' ? (
                                                <MultiSelect
                                                    options={(field.options ?? []).map((o) => ({
                                                        label: o,
                                                        value: o,
                                                    }))}
                                                    selected={
                                                        Array.isArray(filter.filterValue)
                                                            ? filter.filterValue
                                                            : []
                                                    }
                                                    onChange={(values) =>
                                                        updateFilter(filter.key, {
                                                            filterValue: values,
                                                        })
                                                    }
                                                    placeholder={t('refine.selectValues')}
                                                />
                                            ) : field?.type === 'number' ? (
                                                <Input
                                                    type="number"
                                                    value={
                                                        Array.isArray(filter.filterValue)
                                                            ? ''
                                                            : filter.filterValue
                                                    }
                                                    onChange={(e) =>
                                                        updateFilter(filter.key, {
                                                            filterValue: e.target.value,
                                                        })
                                                    }
                                                    placeholder={t('refine.enterNumber')}
                                                />
                                            ) : (
                                                <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                                                    <Select
                                                        value={filter.operator ?? 'equals'}
                                                        onValueChange={(operator) =>
                                                            updateFilter(filter.key, {
                                                                operator:
                                                                    operator as FieldFilter['operator'],
                                                            })
                                                        }
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="equals">
                                                                {t('refine.operatorEquals')}
                                                            </SelectItem>
                                                            <SelectItem value="contains">
                                                                {t('refine.operatorContains')}
                                                            </SelectItem>
                                                            <SelectItem value="starts_with">
                                                                {t('refine.operatorStartsWith')}
                                                            </SelectItem>
                                                            <SelectItem value="ends_with">
                                                                {t('refine.operatorEndsWith')}
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <Input
                                                        value={
                                                            Array.isArray(filter.filterValue)
                                                                ? ''
                                                                : filter.filterValue
                                                        }
                                                        onChange={(e) =>
                                                            updateFilter(filter.key, {
                                                                filterValue: e.target.value,
                                                            })
                                                        }
                                                        placeholder={t('refine.valueToMatch')}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* exclusions */}
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-caption font-semibold">
                                    <Prohibit className="size-4" />
                                    {t('refine.exclusionsLabel')}
                                </span>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() =>
                                        onChange({
                                            exclusions: [
                                                ...rule.exclusions,
                                                {
                                                    key: nextId('exclusion'),
                                                    exclusionType: 'ROLE',
                                                    exclusionId: '',
                                                },
                                            ],
                                        })
                                    }
                                >
                                    {t('refine.addExclusion')}
                                </MyButton>
                            </div>
                            {rule.exclusions.length === 0 ? (
                                <FieldHint>{t('refine.noExclusions')}</FieldHint>
                            ) : (
                                rule.exclusions.map((exclusion) => (
                                    <div
                                        key={exclusion.key}
                                        className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/30 p-3"
                                    >
                                        <Select
                                            value={exclusion.exclusionType}
                                            onValueChange={(value) =>
                                                updateExclusion(exclusion.key, {
                                                    exclusionType: value as ExclusionType,
                                                    exclusionId: '',
                                                    exclusionName: '',
                                                })
                                            }
                                        >
                                            <SelectTrigger className="w-full sm:w-40">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ROLE">
                                                    {t('refine.exclusionRole')}
                                                </SelectItem>
                                                <SelectItem value="PACKAGE_SESSION">
                                                    {batchNoun.charAt(0).toUpperCase() +
                                                        batchNoun.slice(1)}
                                                </SelectItem>
                                                <SelectItem value="TAG">
                                                    {t('refine.exclusionTag')}
                                                </SelectItem>
                                                <SelectItem value="USER">
                                                    {t('refine.exclusionUser')}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>

                                        <div className="min-w-0 flex-1">
                                            {exclusion.exclusionType === 'ROLE' ? (
                                                <Select
                                                    value={exclusion.exclusionId}
                                                    onValueChange={(value) =>
                                                        updateExclusion(exclusion.key, {
                                                            exclusionId: value,
                                                            exclusionName: value,
                                                        })
                                                    }
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue
                                                            placeholder={t('refine.selectRole')}
                                                        />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="STUDENT">
                                                            {learnerNounPlural}
                                                        </SelectItem>
                                                        <SelectItem value="TEACHER">
                                                            {teacherNounPlural}
                                                        </SelectItem>
                                                        <SelectItem value="ADMIN">
                                                            {t('role.admins')}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            ) : exclusion.exclusionType === 'PACKAGE_SESSION' ? (
                                                <SearchableSelect
                                                    value={exclusion.exclusionId}
                                                    onChange={(value) =>
                                                        updateExclusion(exclusion.key, {
                                                            exclusionId: value,
                                                            exclusionName:
                                                                batches.find((b) => b.id === value)
                                                                    ?.label ?? '',
                                                        })
                                                    }
                                                    options={batches.map((b) => ({
                                                        value: b.id,
                                                        label: b.label,
                                                    }))}
                                                    placeholder={t('refine.selectBatch', {
                                                        batchNoun,
                                                    })}
                                                    searchPlaceholder={t('refine.searchBatches', {
                                                        batchNounPlural,
                                                    })}
                                                    emptyText={t('refine.noBatchesFound', {
                                                        batchNounPlural,
                                                    })}
                                                />
                                            ) : exclusion.exclusionType === 'TAG' ? (
                                                <SearchableSelect
                                                    value={exclusion.exclusionId}
                                                    onChange={(value) =>
                                                        updateExclusion(exclusion.key, {
                                                            exclusionId: value,
                                                            exclusionName:
                                                                tags.find((tg) => tg.id === value)
                                                                    ?.tagName ?? '',
                                                        })
                                                    }
                                                    options={tags.map((tg) => ({
                                                        value: tg.id,
                                                        label: tg.tagName,
                                                    }))}
                                                    placeholder={t('refine.selectTag')}
                                                    searchPlaceholder={t('refine.searchTags')}
                                                    emptyText={t('refine.noTagsFound')}
                                                />
                                            ) : (
                                                <Input
                                                    value={exclusion.exclusionId}
                                                    onChange={(e) =>
                                                        updateExclusion(exclusion.key, {
                                                            exclusionId: e.target.value,
                                                        })
                                                    }
                                                    placeholder={t('refine.userIdOrEmail')}
                                                />
                                            )}
                                        </div>

                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            layoutVariant="icon"
                                            aria-label={t('refine.removeExclusion')}
                                            onClick={() =>
                                                onChange({
                                                    exclusions: rule.exclusions.filter(
                                                        (e) => e.key !== exclusion.key
                                                    ),
                                                })
                                            }
                                        >
                                            <X className="size-4" />
                                        </MyButton>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>

            {rule.type === 'TAG' && rule.tagIds.length > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-caption text-muted-foreground">
                    <UsersThree className="size-4" />
                    {props.tagReachLoading
                        ? t('reach.estimating')
                        : props.tagReach !== null
                          ? t('reach.summary', {
                                count: props.tagReach,
                                formattedCount: props.tagReach.toLocaleString(i18n.language),
                            })
                          : t('reach.unavailable')}
                </p>
            )}
        </div>
    );
}
