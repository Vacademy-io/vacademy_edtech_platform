import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, X } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MyButton } from '@/components/design-system/button';
import { MultiSelect } from '@/components/design-system/multi-select';
import type { CheckIssue, CourseShelfConfig, ShelfSource } from '../../-types/learner-home-types';
import { LIMITS } from '../../-utils/publish-checks';
import { useCourseOptions, useCourseTagOptions } from '../../-hooks/usePickerOptions';
import { FieldIssues } from '../shared/FieldIssues';
import { exact } from '../shared/issues';
import { LinkTargetPicker } from '../shared/LinkTargetPicker';
import { NumberField, SwitchField, TextField } from '../shared/fields';

const SOURCES: ShelfSource[] = ['NEWEST', 'TAG', 'HAND_PICKED', 'FREE'];

export function CourseShelfEditor({
    blockKey,
    config,
    onChange,
    issues,
}: {
    blockKey: string;
    config: CourseShelfConfig;
    onChange: (next: CourseShelfConfig) => void;
    issues: CheckIssue[];
}) {
    const { t } = useTranslation('learnerHome');
    const courses = useCourseOptions();
    const tags = useCourseTagOptions();
    const courseName = new Map(courses.map((c) => [c.value, c.label]));
    const picked = config.package_ids;
    const movePicked = (i: number, to: number) => {
        const ids = [...picked];
        const [x] = ids.splice(i, 1);
        ids.splice(to, 0, x!);
        onChange({ ...config, package_ids: ids });
    };

    return (
        <div className="space-y-4">
            <TextField
                id={`${blockKey}-title`}
                label={t('shelf.title')}
                value={config.title}
                onChange={(title) => onChange({ ...config, title })}
                max={LIMITS.shelf.title}
                issues={issues}
                path="config.title"
            />
            <fieldset className="space-y-2">
                <legend className="text-body font-semibold text-neutral-700">
                    {t('shelf.source')}
                </legend>
                <RadioGroup
                    value={config.source}
                    onValueChange={(source) =>
                        onChange({ ...config, source: source as ShelfSource })
                    }
                >
                    {SOURCES.map((s) => (
                        <div key={s} className="flex items-center gap-2">
                            <RadioGroupItem id={`${blockKey}-src-${s}`} value={s} />
                            <Label htmlFor={`${blockKey}-src-${s}`} className="font-normal">
                                {t(`shelf.sources.${s}`)}
                            </Label>
                        </div>
                    ))}
                </RadioGroup>
            </fieldset>

            {config.source === 'TAG' && (
                <div className="space-y-1">
                    <Label>{t('shelf.tags')}</Label>
                    {tags.length === 0 ? (
                        <p className="text-caption text-neutral-500">{t('shelf.noTags')}</p>
                    ) : (
                        <MultiSelect
                            options={tags}
                            selected={config.tags}
                            onChange={(next) =>
                                onChange({ ...config, tags: next.slice(0, LIMITS.shelf.tagsMax) })
                            }
                            placeholder={t('shelf.tagsPlaceholder')}
                            checkboxes
                        />
                    )}
                    <FieldIssues issues={exact(issues, 'config.tags')} />
                </div>
            )}

            {config.source === 'HAND_PICKED' && (
                <div className="space-y-2">
                    <Label>{t('shelf.courses')}</Label>
                    <MultiSelect
                        options={courses}
                        selected={picked}
                        onChange={(next) => {
                            // Keep the admin's order: existing ones first, new ones appended.
                            const kept = picked.filter((id) => next.includes(id));
                            const added = next.filter((id) => !picked.includes(id));
                            onChange({
                                ...config,
                                package_ids: [...kept, ...added].slice(0, LIMITS.shelf.pickedMax),
                            });
                        }}
                        placeholder={t('shelf.coursesPlaceholder')}
                        checkboxes
                    />
                    {picked.length > 0 && (
                        <ol className="space-y-1">
                            {picked.map((id, i) => (
                                <li
                                    key={id}
                                    className="flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1"
                                >
                                    <span className="w-5 text-caption text-neutral-500">
                                        {i + 1}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-body">
                                        {courseName.get(id) ?? t('link.unknownOption', { id })}
                                    </span>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="small"
                                        aria-label={t('list.moveUp')}
                                        disabled={i === 0}
                                        onClick={() => movePicked(i, i - 1)}
                                    >
                                        <ArrowUp className="size-3.5" />
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="small"
                                        aria-label={t('list.moveDown')}
                                        disabled={i === picked.length - 1}
                                        onClick={() => movePicked(i, i + 1)}
                                    >
                                        <ArrowDown className="size-3.5" />
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="small"
                                        aria-label={t('list.delete')}
                                        onClick={() =>
                                            onChange({
                                                ...config,
                                                package_ids: picked.filter((x) => x !== id),
                                            })
                                        }
                                    >
                                        <X className="size-3.5" />
                                    </MyButton>
                                </li>
                            ))}
                        </ol>
                    )}
                    <FieldIssues issues={exact(issues, 'config.package_ids')} />
                </div>
            )}

            <NumberField
                id={`${blockKey}-limit`}
                label={t('shelf.limit')}
                hint={t('shelf.limitHint')}
                value={config.limit}
                min={LIMITS.shelf.limitMin}
                max={LIMITS.shelf.limitMax}
                onChange={(limit) => onChange({ ...config, limit })}
                issues={issues}
                path="config.limit"
            />
            <SwitchField
                id={`${blockKey}-hide-owned`}
                label={t('shelf.hideOwned')}
                hint={t('shelf.hideOwnedHint')}
                checked={config.hide_owned}
                onChange={(hide_owned) => onChange({ ...config, hide_owned })}
            />
            <SwitchField
                id={`${blockKey}-price`}
                label={t('shelf.showPrice')}
                checked={config.show_price}
                onChange={(show_price) => onChange({ ...config, show_price })}
            />
            <LinkTargetPicker
                id={`${blockKey}-see-all`}
                label={t('shelf.seeAll')}
                value={config.see_all}
                onChange={(see_all) => onChange({ ...config, see_all })}
                issues={issues}
                path="config.see_all"
            />
            <p className="text-caption text-neutral-500">{t('shelf.seeAllHint')}</p>
            <p className="text-caption text-neutral-500">{t('shelf.visibilityNote')}</p>
        </div>
    );
}
