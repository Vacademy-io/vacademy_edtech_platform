import { useTranslation } from 'react-i18next';
import { Plus, Trash } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { MultiSelect } from '@/components/design-system/multi-select';
import { BatchPicker } from '@/routes/announcement/create/-components/BatchPicker';
import type {
    Audience,
    AudienceCondition,
    AudienceConditionKind,
    CheckIssue,
} from '../../-types/learner-home-types';
import {
    AUDIENCE_CONDITION_KINDS,
    conditionIds,
    emptyCondition,
    withConditionIds,
} from '../../-utils/audience';
import { LIMITS } from '../../-utils/publish-checks';
import {
    useBatchOptions,
    useCourseOptions,
    useLearnerTagOptions,
} from '../../-hooks/usePickerOptions';
import { FieldIssues } from './FieldIssues';
import { exact, under } from './issues';

/**
 * "Show to: Everyone / Learners who match all of these" (spec 3.2). Batch rows
 * reuse the announcement BatchPicker; course and tag rows are multi-selects.
 */
export function AudienceEditor({
    id,
    value,
    onChange,
    issues,
}: {
    id: string;
    value: Audience;
    onChange: (next: Audience) => void;
    issues: CheckIssue[];
}) {
    const { t } = useTranslation('learnerHome');
    const batches = useBatchOptions();
    const courses = useCourseOptions();
    const rules = value.mode === 'RULES' ? value.all_of : [];
    const needsTags = rules.some((c) => c.kind === 'USER_TAG');
    const tags = useLearnerTagOptions(needsTags);

    const setRules = (all_of: AudienceCondition[]) => onChange({ mode: 'RULES', all_of });
    const setRow = (i: number, next: AudienceCondition) =>
        setRules(rules.map((c, j) => (j === i ? next : c)));

    const picker = (c: AudienceCondition, i: number) => {
        const ids = conditionIds(c);
        const set = (next: string[]) => setRow(i, withConditionIds(c, next));
        switch (c.kind) {
            case 'PACKAGE_SESSION':
                return (
                    <BatchPicker
                        batches={batches}
                        selected={ids}
                        onChange={set}
                        noun={t('audience.batch')}
                        nounPlural={t('audience.batches')}
                    />
                );
            case 'USER_TAG':
                return (tags.data ?? []).length === 0 && !tags.isLoading ? (
                    <p className="text-caption text-neutral-500">{t('audience.noTags')}</p>
                ) : (
                    <MultiSelect
                        options={(tags.data ?? []).map((o) => ({ label: o.label, value: o.value }))}
                        selected={ids}
                        onChange={set}
                        placeholder={t('audience.pickTags')}
                        checkboxes
                    />
                );
            default:
                return (
                    <MultiSelect
                        options={courses}
                        selected={ids}
                        onChange={set}
                        placeholder={t('audience.pickCourses')}
                        checkboxes
                    />
                );
        }
    };

    return (
        <div className="space-y-3">
            <RadioGroup
                value={value.mode}
                onValueChange={(mode) =>
                    onChange(
                        mode === 'EVERYONE'
                            ? { mode: 'EVERYONE' }
                            : { mode: 'RULES', all_of: [emptyCondition('PACKAGE_SESSION')] }
                    )
                }
                aria-label={t('audience.label')}
            >
                <div className="flex items-center gap-2">
                    <RadioGroupItem id={`${id}-everyone`} value="EVERYONE" />
                    <Label htmlFor={`${id}-everyone`} className="font-normal">
                        {t('audience.everyone')}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <RadioGroupItem id={`${id}-rules`} value="RULES" />
                    <Label htmlFor={`${id}-rules`} className="font-normal">
                        {t('audience.rules')}
                    </Label>
                </div>
            </RadioGroup>

            {value.mode === 'RULES' && (
                <div className="space-y-3 border-s-2 border-primary-100 ps-3">
                    {rules.map((c, i) => (
                        <div key={i} className="space-y-2 rounded-md border border-neutral-200 p-3">
                            <div className="flex items-center gap-2">
                                <Select
                                    value={c.kind}
                                    onValueChange={(k) =>
                                        setRow(i, emptyCondition(k as AudienceConditionKind))
                                    }
                                >
                                    <SelectTrigger
                                        className="flex-1"
                                        aria-label={t('audience.label')}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {AUDIENCE_CONDITION_KINDS.map((k) => (
                                            <SelectItem key={k} value={k}>
                                                {t(`audience.kinds.${k}`)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    layoutVariant="icon"
                                    scale="medium"
                                    aria-label={t('audience.removeRule')}
                                    onClick={() => {
                                        const next = rules.filter((_, j) => j !== i);
                                        onChange(
                                            next.length
                                                ? { mode: 'RULES', all_of: next }
                                                : { mode: 'EVERYONE' }
                                        );
                                    }}
                                >
                                    <Trash className="size-4" />
                                </MyButton>
                            </div>
                            {picker(c, i)}
                            <p className="text-caption text-neutral-500">{t('audience.anyOf')}</p>
                            <FieldIssues issues={under(issues, `audience.all_of[${i}]`)} />
                        </div>
                    ))}
                    {rules.length < LIMITS.audienceConditions ? (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() =>
                                setRules([...rules, emptyCondition('ENROLLED_IN_COURSE')])
                            }
                        >
                            <Plus className="me-1 size-3.5" aria-hidden />
                            {t('audience.addRule')}
                        </MyButton>
                    ) : (
                        <p className="text-caption text-neutral-500">{t('audience.maxRules')}</p>
                    )}
                </div>
            )}
            <FieldIssues issues={exact(issues, 'audience')} />
        </div>
    );
}
