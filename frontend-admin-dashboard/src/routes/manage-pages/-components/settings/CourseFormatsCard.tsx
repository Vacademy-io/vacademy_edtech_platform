import { useRef, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    FORMAT_TAG_PREFIX,
    MAX_COURSE_FORMATS,
    addFormat,
    carryLabelTranslations,
    formatDef,
    formatLabel,
    moveFormat,
    newFormatIssue,
    orderedFormatIds,
    removeFormat,
    sanitizeFormatId,
    setFormatLabel,
    suggestFormatId,
    type CourseFormats,
    type CourseFormatsEdit,
} from './course-formats';

export interface CourseFormatsCardProps {
    /** globalSettings.courseFormats (the card is only mounted when it exists). */
    formats: CourseFormats;
    /** globalSettings.courseFormatOrder, when set. */
    order: string[] | undefined;
    /**
     * Writes the given globalSettings keys (courseFormats and/or
     * courseFormatOrder) in one edit; keys left out are not touched.
     */
    onChange: (next: CourseFormatsEdit) => void;
    /** globalSettings.courseFormatsFromTags: { enabled, skipPrefixes, skip }. */
    fromTags?: unknown;
    /** Writes globalSettings.courseFormatsFromTags. */
    onFromTagsChange?: (next: Record<string, unknown>) => void;
    /** globalSettings.i18n: a rename copies the old name's translations to the new name. */
    i18n?: unknown;
    /**
     * Editing another site language: names are the base text, so they are
     * shown read-only here (translated in Translations) and nothing is added.
     */
    readOnlyNames?: boolean;
}

const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];

const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

const splitList = (text: string): string[] =>
    [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];

/** A comma-separated list, saved when the field loses focus (so typing ", " is not eaten). */
const CommaListField: FC<{
    id: string;
    label: string;
    value: string[];
    placeholder: string;
    disabled: boolean;
    onCommit: (next: string[]) => void;
}> = ({ id, label, value, placeholder, disabled, onCommit }) => {
    const [text, setText] = useState<string | null>(null);
    return (
        <div>
            <Label htmlFor={id} className="text-caption">
                {label}
            </Label>
            <Input
                id={id}
                value={text ?? value.join(', ')}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => {
                    if (text !== null) onCommit(splitList(text));
                    setText(null);
                }}
            />
        </div>
    );
};

/** True when some language has at least one translation. */
const hasTranslations = (i18n: unknown): boolean =>
    isObject(i18n) &&
    isObject(i18n.strings) &&
    Object.values(i18n.strings).some((d) => isObject(d) && Object.keys(d).length > 0);

/**
 * Global Settings → Course formats ("E-books", "Live sessions"…), shown on
 * course cards and in the Format filter. Each format keeps its name, its
 * place in the list, and the level names / tags it was authored with
 * (shown, not edited here). A course joins a format through its
 * `format-<id>` tag, so adding one reminds the editor to tag the courses.
 */
export const CourseFormatsCard: FC<CourseFormatsCardProps> = ({
    formats,
    order,
    onChange,
    fromTags,
    onFromTagsChange,
    i18n,
    readOnlyNames = false,
}) => {
    const tagSetting = isObject(fromTags) ? fromTags : {};
    const setTagSetting = (patch: Record<string, unknown>) =>
        onFromTagsChange?.({ ...tagSetting, ...patch });
    const { t } = useTranslation('managePagesPropertyPanel');
    const ids = orderedFormatIds(formats, order);
    // The name a field had when it was focused; its translations are copied
    // to the name it has on blur (each keystroke is saved, only the last counts).
    const renameFrom = useRef('');
    const [newLabel, setNewLabel] = useState('');
    const [newId, setNewId] = useState('');
    const [idTouched, setIdTouched] = useState(false);
    const [added, setAdded] = useState<{ id: string; label: string } | null>(null);

    const id = idTouched ? newId : suggestFormatId(newLabel);
    const issue = newFormatIssue(formats, id, newLabel);
    // Nothing typed yet is not an error; a full list always says so.
    const showIssue =
        issue === 'tooMany' || (!!issue && issue !== 'noName' && !!(newLabel.trim() || newId));

    const move = (formatId: string, delta: -1 | 1) => {
        const edit = moveFormat(formats, order, formatId, delta);
        if (edit) onChange(edit);
    };

    const carryTranslations = (newName: string) => {
        const next = carryLabelTranslations(i18n, renameFrom.current, newName);
        if (next) onChange({ i18n: next });
    };

    const remove = (formatId: string, name: string) => {
        const tag = `${FORMAT_TAG_PREFIX}${formatId}`;
        if (!window.confirm(t('global.courseFormats.confirmRemove', { name, tag }))) return;
        onChange(removeFormat(formats, order, formatId));
    };

    const add = () => {
        if (issue || readOnlyNames) return;
        onChange(addFormat(formats, order, id, newLabel));
        setAdded({ id, label: newLabel.trim() });
        setNewLabel('');
        setNewId('');
        setIdTouched(false);
    };

    return (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <h4 className="font-medium text-neutral-700">{t('global.courseFormats.heading')}</h4>
            <p className="text-caption text-neutral-500">{t('global.courseFormats.hint')}</p>
            {readOnlyNames ? (
                <p className="text-caption text-neutral-600">
                    {t('global.courseFormats.namesInTranslations')}
                </p>
            ) : (
                hasTranslations(i18n) && (
                    <p className="text-caption text-neutral-500">
                        {t('global.courseFormats.renameHint')}
                    </p>
                )
            )}

            {ids.map((formatId, i) => {
                const def = formatDef(formats, formatId);
                const label = formatLabel(formats, formatId);
                const matches = [...strings(def.levels), ...strings(def.tags)];
                const rowId = `course-format-${i}`;
                return (
                    <div
                        key={formatId}
                        className="space-y-2 rounded-md border border-neutral-200 bg-white p-3"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <code className="text-caption text-neutral-500">
                                {FORMAT_TAG_PREFIX}
                                {formatId}
                            </code>
                            <div className="flex items-center gap-0.5">
                                <button
                                    type="button"
                                    aria-label={t('global.courseFormats.moveUp', { name: label || formatId })}
                                    disabled={i === 0}
                                    onClick={() => move(formatId, -1)}
                                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                                >
                                    <ArrowUp className="size-3.5" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={t('global.courseFormats.moveDown', { name: label || formatId })}
                                    disabled={i === ids.length - 1}
                                    onClick={() => move(formatId, 1)}
                                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                                >
                                    <ArrowDown className="size-3.5" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={t('global.courseFormats.remove', {
                                        name: label || formatId,
                                    })}
                                    onClick={() => remove(formatId, label || formatId)}
                                    className="rounded p-1 text-neutral-400 hover:bg-danger-50 hover:text-danger-600"
                                >
                                    <Trash className="size-3.5" />
                                </button>
                            </div>
                        </div>
                        <div>
                            <Label htmlFor={`${rowId}-label`} className="text-caption">
                                {t('global.courseFormats.name')}
                            </Label>
                            <Input
                                id={`${rowId}-label`}
                                value={label}
                                readOnly={readOnlyNames}
                                onFocus={(e) => (renameFrom.current = e.currentTarget.value)}
                                onChange={(e) =>
                                    !readOnlyNames &&
                                    onChange(setFormatLabel(formats, formatId, e.target.value))
                                }
                                onBlur={(e) =>
                                    !readOnlyNames && carryTranslations(e.currentTarget.value)
                                }
                            />
                            {!label.trim() && (
                                <p className="mt-1 text-caption text-warning-600">
                                    {t('global.courseFormats.noNameWarning')}
                                </p>
                            )}
                            {matches.length > 0 && (
                                <p className="mt-1 text-caption text-neutral-400">
                                    {t('global.courseFormats.alsoMatches', {
                                        list: matches.join(', '),
                                    })}
                                </p>
                            )}
                        </div>
                    </div>
                );
            })}

            {added && formats[added.id] !== undefined && (
                <p className="rounded-md border border-primary-200 bg-primary-50 p-2 text-caption text-neutral-700">
                    {t('global.courseFormats.tagHint', {
                        tag: `${FORMAT_TAG_PREFIX}${added.id}`,
                        name: added.label,
                    })}
                </p>
            )}

            {onFromTagsChange && (
                <div className="space-y-2 rounded-md border border-neutral-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="course-formats-from-tags" className="text-caption font-semibold">
                            {t('global.courseFormats.fromTags.enable')}
                        </Label>
                        <Switch
                            id="course-formats-from-tags"
                            checked={tagSetting.enabled === true}
                            disabled={readOnlyNames}
                            onCheckedChange={(c) => setTagSetting({ enabled: c })}
                        />
                    </div>
                    <p className="text-caption text-neutral-500">{t('global.courseFormats.fromTags.hint')}</p>
                    {tagSetting.enabled === true && (
                        <>
                            <CommaListField
                                id="course-formats-skip-prefixes"
                                label={t('global.courseFormats.fromTags.skipPrefixes')}
                                value={strings(tagSetting.skipPrefixes)}
                                placeholder="for"
                                disabled={readOnlyNames}
                                onCommit={(next) => setTagSetting({ skipPrefixes: next })}
                            />
                            <CommaListField
                                id="course-formats-skip"
                                label={t('global.courseFormats.fromTags.skip')}
                                value={strings(tagSetting.skip)}
                                placeholder="bestseller, new"
                                disabled={readOnlyNames}
                                onCommit={(next) => setTagSetting({ skip: next })}
                            />
                        </>
                    )}
                </div>
            )}

            <div className="space-y-2 rounded-md border border-dashed border-neutral-300 p-3">
                <p className="text-caption font-semibold text-neutral-600">
                    {t('global.courseFormats.addHeading')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <Label htmlFor="course-format-new-label" className="text-caption">
                            {t('global.courseFormats.name')}
                        </Label>
                        <Input
                            id="course-format-new-label"
                            value={newLabel}
                            disabled={readOnlyNames}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder={t('global.courseFormats.namePlaceholder')}
                        />
                    </div>
                    <div>
                        <Label htmlFor="course-format-new-id" className="text-caption">
                            {t('global.courseFormats.id')}
                        </Label>
                        <Input
                            id="course-format-new-id"
                            value={id}
                            disabled={readOnlyNames}
                            onChange={(e) => {
                                setIdTouched(true);
                                setNewId(sanitizeFormatId(e.target.value));
                            }}
                            placeholder="audiobook"
                            className="font-mono"
                        />
                    </div>
                </div>
                {showIssue && !readOnlyNames && (
                    <p className="text-caption text-danger-600">
                        {t(`global.courseFormats.issue.${issue}`, { max: MAX_COURSE_FORMATS })}
                    </p>
                )}
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    disable={!!issue || readOnlyNames}
                    onClick={add}
                >
                    <Plus className="size-3.5" /> {t('global.courseFormats.add')}
                </MyButton>
            </div>
        </div>
    );
};
