import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretUp, Lock, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Pills, Section } from './PromoPopupEditor';
import {
    addField,
    addableKinds,
    canBeHalf,
    hasOptions,
    hasPlaceholder,
    isLockedKind,
    moveField,
    patchField,
    readFormFields,
    removeField,
    withFormFields,
    type ReviewFieldKind,
    type ReviewFormField,
} from '../-utils/review-form-fields';

/**
 * "Form fields" of the reviewCollector block: the visitor's form, field by
 * field, in order. Reorder, rename, set the placeholder, make it required,
 * half or full width, edit dropdown choices, delete, or add a built-in /
 * custom field. Stars and name stay (renamable, movable), a review needs both.
 * The first edit of an older block saves its fields as this list.
 */

const DEFAULT_LABEL_KEY: Partial<Record<ReviewFieldKind, string>> = {
    rating: 'editor.formFields.defaults.rating',
    reviewerName: 'editor.defaults.nameLabel',
    reviewText: 'editor.defaults.textLabel',
    courseName: 'editor.defaults.courseLabel',
    city: 'editor.defaults.cityLabel',
    designation: 'editor.defaults.designationLabel',
};

export const ReviewFormFieldsEditor = ({
    props,
    update,
}: {
    props: Record<string, any>;
    /** Replaces the block's props. */
    update: (next: Record<string, any>) => void;
}) => {
    const { t } = useTranslation('managePagesReviews');
    const fields = readFormFields(props);
    const [open, setOpen] = useState<string | null>(null);
    const save = (next: ReviewFormField[]) => update(withFormFields(props, next));
    const addable = addableKinds(fields);

    const defaultLabel = (f: ReviewFormField) =>
        t(DEFAULT_LABEL_KEY[f.kind] || 'editor.formFields.defaults.custom');
    const shownLabel = (f: ReviewFormField) => (f.label && f.label.trim()) || defaultLabel(f);

    return (
        <Section title={t('editor.formFields.title')}>
            <div className="flex items-center justify-between gap-2">
                <p className="text-caption text-gray-500">{t('editor.formFields.hint')}</p>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 shrink-0 text-xs">
                            <Plus className="me-1 size-3" /> {t('editor.formFields.add')}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        {addable.builtin.length > 0 && (
                            <>
                                <DropdownMenuLabel className="text-caption text-gray-500">
                                    {t('editor.formFields.builtinGroup')}
                                </DropdownMenuLabel>
                                {addable.builtin.map((k) => (
                                    <DropdownMenuItem key={k} onClick={() => save(addField(fields, k))}>
                                        {t(`editor.formFields.kinds.${k}`)}
                                    </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                            </>
                        )}
                        <DropdownMenuLabel className="text-caption text-gray-500">
                            {t('editor.formFields.customGroup')}
                        </DropdownMenuLabel>
                        {addable.custom.length === 0 ? (
                            <p className="px-2 py-1.5 text-caption text-gray-500">{t('editor.formFields.maxCustom')}</p>
                        ) : (
                            addable.custom.map((k) => (
                                <DropdownMenuItem
                                    key={k}
                                    onClick={() => {
                                        const next = addField(fields, k);
                                        save(next);
                                        setOpen(next[next.length - 1]!.id);
                                    }}
                                >
                                    {t(`editor.formFields.kinds.${k}`)}
                                </DropdownMenuItem>
                            ))
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <ol className="space-y-2">
                {fields.map((f, i) => {
                    const locked = isLockedKind(f.kind);
                    const expanded = open === f.id;
                    return (
                        <li key={f.id} className={cn('rounded-lg border bg-white', expanded && 'border-blue-300')}>
                            <div className="flex items-center gap-1 p-2">
                                <button
                                    type="button"
                                    className="min-w-0 flex-1 text-start"
                                    onClick={() => setOpen(expanded ? null : f.id)}
                                    aria-expanded={expanded}
                                >
                                    <span className="block truncate text-xs font-medium text-gray-800">
                                        {shownLabel(f)}
                                        {f.required && <span className="ms-0.5 text-danger-600">*</span>}
                                    </span>
                                    <span className="block text-caption text-gray-500">
                                        {t(`editor.formFields.kinds.${f.kind}`)}
                                        {f.width === 'half' ? ` · ${t('editor.formFields.widthHalf')}` : ''}
                                    </span>
                                </button>
                                {locked && (
                                    <Lock className="size-3 shrink-0 text-gray-400" aria-label={t('editor.formFields.lockedHint')} />
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0"
                                    onClick={() => setOpen(expanded ? null : f.id)}
                                    aria-label={t('editor.formFields.edit')}
                                >
                                    <PencilSimple className="size-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0"
                                    disabled={i === 0}
                                    onClick={() => save(moveField(fields, i, -1))}
                                    aria-label={t('editor.formFields.moveUp')}
                                >
                                    <CaretUp className="size-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0"
                                    disabled={i === fields.length - 1}
                                    onClick={() => save(moveField(fields, i, 1))}
                                    aria-label={t('editor.formFields.moveDown')}
                                >
                                    <CaretDown className="size-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0 text-danger-600"
                                    disabled={locked}
                                    title={locked ? t('editor.formFields.lockedHint') : undefined}
                                    onClick={() => {
                                        if (open === f.id) setOpen(null);
                                        save(removeField(fields, i));
                                    }}
                                    aria-label={t('editor.formFields.delete')}
                                >
                                    <Trash className="size-3" />
                                </Button>
                            </div>

                            {expanded && (
                                <div className="space-y-3 border-t p-2">
                                    <div>
                                        <Label className="text-xs">{t('editor.formFields.label')}</Label>
                                        <Input
                                            className="mt-1"
                                            value={f.label || ''}
                                            placeholder={defaultLabel(f)}
                                            maxLength={120}
                                            onChange={(e) => save(patchField(fields, i, { label: e.target.value }))}
                                        />
                                    </div>
                                    {hasPlaceholder(f.kind) && (
                                        <div>
                                            <Label className="text-xs">{t('editor.formFields.placeholder')}</Label>
                                            <Input
                                                className="mt-1"
                                                value={f.placeholder || ''}
                                                maxLength={160}
                                                onChange={(e) => save(patchField(fields, i, { placeholder: e.target.value }))}
                                            />
                                        </div>
                                    )}
                                    {hasOptions(f.kind) && (
                                        <div>
                                            <Label className="text-xs">{t('editor.formFields.options')}</Label>
                                            <Textarea
                                                className="mt-1"
                                                rows={3}
                                                value={(f.options || []).join('\n')}
                                                placeholder={t('editor.hints.courseOptionsPlaceholder')}
                                                onChange={(e) => save(patchField(fields, i, { options: e.target.value.split('\n') }))}
                                                onBlur={(e) =>
                                                    save(
                                                        patchField(fields, i, {
                                                            options: e.target.value
                                                                .split('\n')
                                                                .map((s) => s.trim())
                                                                .filter(Boolean),
                                                        })
                                                    )
                                                }
                                            />
                                            <p className="mt-1 text-caption text-gray-500">
                                                {f.kind === 'courseName'
                                                    ? t('editor.formFields.optionsCourseHint')
                                                    : t('editor.formFields.optionsHint')}
                                            </p>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between gap-3">
                                        <Label className="text-xs">{t('editor.formFields.required')}</Label>
                                        <Switch
                                            checked={!!f.required}
                                            disabled={locked}
                                            onCheckedChange={(c) => save(patchField(fields, i, { required: c }))}
                                        />
                                    </div>
                                    {locked && <p className="text-caption text-gray-500">{t('editor.formFields.lockedHint')}</p>}
                                    {canBeHalf(f.kind) && (
                                        <div>
                                            <Label className="text-xs">{t('editor.formFields.width')}</Label>
                                            <Pills
                                                value={f.width === 'half' ? 'half' : 'full'}
                                                onChange={(v) => save(patchField(fields, i, { width: v }))}
                                                options={[
                                                    { value: 'full', label: t('editor.formFields.widthFull') },
                                                    { value: 'half', label: t('editor.formFields.widthHalf') },
                                                ]}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>
        </Section>
    );
};

export default ReviewFormFieldsEditor;
