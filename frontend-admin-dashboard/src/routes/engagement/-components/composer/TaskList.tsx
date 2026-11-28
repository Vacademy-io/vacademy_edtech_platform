import { useEffect, useId, useMemo, useState } from 'react';
import {
    get,
    useFieldArray,
    useFormState,
    useWatch,
    type Control,
    type UseFormGetValues,
    type UseFormSetFocus,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowCounterClockwise,
    ArrowDown,
    ArrowUp,
    CalendarBlank,
    CaretDown,
    CheckCircle,
    CopySimple,
    DotsSixVertical,
    DotsThreeVertical,
    Lock,
    Plus,
    Trash,
    Warning,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import type { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { EngagementItemType } from '../../-types/types';
import { authorableTypes, typeMeta } from '../../-utils/type-meta';
import {
    changeItemType,
    countFormErrors,
    isBlankRichText,
    newItemForm,
    type ComposerForm,
    type ItemForm,
} from '../forms/composer-schema';
import { ItemEditor } from '../items/ItemEditor';
import { detachItem } from './use-composer-save';

/**
 * The selected day's tasks, as an accordion: one compact row per task (drag handle,
 * type, title, points, problems, "n answered"), and one task's editor open at a time.
 *
 * Reorder by dragging the handle, or with Move up / Move down in the row menu (the
 * keyboard path). The menu also has Duplicate, Move to day… and Delete, which offers
 * Undo. A task learners have already finished can't change type: the server would
 * reject it, and their results were earned against the old type.
 */

export interface DayOption {
    index: number;
    label: string;
}

export interface TaskListProps {
    control: Control<ComposerForm>;
    getValues: UseFormGetValues<ComposerForm>;
    setFocus: UseFormSetFocus<ComposerForm>;
    dayIndex: number;
    /** Every day, for "Move to day…". */
    days: DayOption[];
    /** The open (and previewed) task's key. */
    openKey: string | null;
    onOpenKeyChange: (key: string | null) => void;
    activeCardId?: string | null;
    onActiveCardChange?: (id: string | null) => void;
    /** Append a task to another day (the caller owns the other days' arrays). */
    onMoveToDay: (item: ItemForm, targetDay: number) => void;
    /** The batch course-content tasks pick lessons from. */
    packageSessionId?: string | null;
}

type ItemPath = `slots.${number}.items.${number}`;

/** How long the inline Undo stays after a task is removed. */
const UNDO_MS = 10_000;

/** True when a task holds authored content its new type can't carry. */
function losesContent(item: ItemForm, next: EngagementItemType): boolean {
    const prose = (type: EngagementItemType) => type === 'READING_HTML' || type === 'VISUAL_NOTE';
    const question = (type: EngagementItemType) => type === 'QUESTION_OF_DAY' || type === 'POLL';
    if (prose(item.itemType) && prose(next)) return false;
    if (question(item.itemType) && question(next)) return false;
    switch (item.itemType) {
        case 'READING_HTML':
        case 'VISUAL_NOTE':
            return !isBlankRichText(item.contentHtml);
        case 'GAME':
            return Boolean(item.contentHtml?.trim());
        case 'QUESTION_OF_DAY':
        case 'POLL':
            return (
                !isBlankRichText(item.question.prompt) ||
                item.question.options.some((option) => option.text.trim().length > 0)
            );
        case 'FLASHCARDS':
            return item.flashcards.cards.length > 0;
        case 'COURSE_SLIDE':
            return Boolean(item.slideId);
        default:
            return false;
    }
}

/** A saved task learners have finished: its type is locked. */
function isAnsweredSaved(item: ItemForm | undefined): boolean {
    return Boolean(item?.id) && (item?.completedCount ?? 0) > 0;
}

function points(item: ItemForm): number {
    const bonus =
        item.itemType === 'QUESTION_OF_DAY' && item.question.format === 'MCQ'
            ? item.correctPoints ?? 0
            : 0;
    return (item.completionPoints ?? 0) + bonus;
}

type Pending =
    | { kind: 'type'; index: number; type: EngagementItemType; title: string }
    | { kind: 'move'; index: number; target: number; title: string; answered: number }
    | { kind: 'delete'; index: number; title: string; answered: number };

export function TaskList({
    control,
    getValues,
    setFocus,
    dayIndex,
    days,
    openKey,
    onOpenKeyChange,
    activeCardId,
    onActiveCardChange,
    onMoveToDay,
    packageSessionId,
}: TaskListProps) {
    const { t } = useTranslation('engagement');
    const arrayName = `slots.${dayIndex}.items` as const;
    const { fields, append, insert, remove, move, update } = useFieldArray({
        control,
        name: arrayName,
        keyName: 'rhfKey',
    });
    const [pending, setPending] = useState<Pending | null>(null);
    /**
     * The last removed task, for Undo. Shown inline rather than in a toast: the dialog
     * is modal, so a toast's button outside it can't be clicked.
     */
    const [removed, setRemoved] = useState<{ item: ItemForm; index: number } | null>(null);

    useEffect(() => {
        if (!removed) return;
        const timer = window.setTimeout(() => setRemoved(null), UNDO_MS);
        return () => window.clearTimeout(timer);
    }, [removed]);

    const sortable = useMemo(() => fields.map((field) => ({ id: field.rhfKey })), [fields]);
    const types = authorableTypes();

    function pathOf(index: number): ItemPath {
        return `slots.${dayIndex}.items.${index}`;
    }

    function addTask(type: EngagementItemType) {
        const item = newItemForm(type);
        append(item);
        onOpenKeyChange(item.key);
        const index = fields.length;
        window.requestAnimationFrame(() => {
            try {
                setFocus(`${pathOf(index)}.title` as `${ItemPath}.title`);
            } catch {
                // The editor may not register a focusable title; nothing to do.
            }
        });
    }

    function duplicate(index: number) {
        const copy = detachItem(getValues(pathOf(index)));
        insert(index + 1, copy);
        onOpenKeyChange(copy.key);
    }

    function removeNow(index: number) {
        const snapshot = getValues(pathOf(index));
        remove(index);
        if (snapshot.key === openKey) onOpenKeyChange(null);
        setRemoved({ item: snapshot, index });
    }

    function undoRemove() {
        if (!removed) return;
        insert(Math.min(removed.index, fields.length), removed.item);
        onOpenKeyChange(removed.item.key);
        setRemoved(null);
    }

    function moveNow(index: number, target: number) {
        const item = getValues(pathOf(index));
        // A saved task moves as a new task: the server keeps an unchanged task on its
        // original day, so re-sending its id under another day would lose it.
        const moved = item.id ? detachItem(item) : item;
        remove(index);
        if (item.key === openKey) onOpenKeyChange(null);
        onMoveToDay(moved, target);
        const label = days.find((day) => day.index === target)?.label ?? '';
        toast.success(t('composer.taskList.moved', { day: label }));
    }

    function changeTypeNow(index: number, type: EngagementItemType) {
        const current = getValues(pathOf(index));
        update(index, changeItemType(current, type));
    }

    function requestType(index: number, type: EngagementItemType) {
        const current = getValues(pathOf(index));
        if (current.itemType === type || isAnsweredSaved(current)) return;
        if (losesContent(current, type)) {
            setPending({ kind: 'type', index, type, title: current.title });
            return;
        }
        changeTypeNow(index, type);
    }

    function requestMove(index: number, target: number) {
        const current = getValues(pathOf(index));
        const answered = current.id ? current.completedCount ?? 0 : 0;
        if (answered > 0) {
            setPending({ kind: 'move', index, target, title: current.title, answered });
            return;
        }
        moveNow(index, target);
    }

    function requestDelete(index: number) {
        const current = getValues(pathOf(index));
        const answered = current.id ? current.completedCount ?? 0 : 0;
        if (answered > 0) {
            setPending({ kind: 'delete', index, title: current.title, answered });
            return;
        }
        removeNow(index);
    }

    function confirmPending() {
        if (!pending) return;
        if (pending.kind === 'type') changeTypeNow(pending.index, pending.type);
        if (pending.kind === 'move') moveNow(pending.index, pending.target);
        if (pending.kind === 'delete') removeNow(pending.index);
        setPending(null);
    }

    const addMenu: DropdownItem[] = types.map((type) => {
        const meta = typeMeta(type);
        const Icon = meta.icon;
        return { label: t(meta.labelKey), value: type, icon: <Icon size={16} /> };
    });

    return (
        <section
            aria-labelledby={`tasks-${dayIndex}`}
            data-composer-path={arrayName}
            className="space-y-3"
        >
            <div className="flex items-center justify-between gap-3">
                <h3
                    id={`tasks-${dayIndex}`}
                    className="text-subtitle font-semibold text-neutral-900"
                >
                    {t('composer.tasks')}
                    <span className="ms-2 text-body font-regular text-neutral-500">
                        {t('composer.rail.tasks', { count: fields.length })}
                    </span>
                </h3>
                {fields.length > 0 && (
                    <MyDropdown
                        dropdownList={addMenu}
                        onSelect={(value) => addTask(value as EngagementItemType)}
                    >
                        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-300 px-3 text-body font-semibold text-primary-500 hover:bg-primary-50">
                            <Plus size={16} aria-hidden /> {t('composer.addTask')}
                        </span>
                    </MyDropdown>
                )}
            </div>

            <TaskListError control={control} name={arrayName} />

            {removed && (
                <div
                    role="status"
                    className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
                >
                    <Trash size={16} className="shrink-0 text-neutral-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-body text-neutral-700">
                        {t('composer.taskList.removed', {
                            title: removed.item.title.trim() || t('preview.untitled'),
                        })}
                    </span>
                    <MyButton type="button" buttonType="text" scale="small" onClick={undoRemove}>
                        <ArrowCounterClockwise size={14} aria-hidden />{' '}
                        {t('composer.taskList.undo')}
                    </MyButton>
                </div>
            )}

            {fields.length === 0 ? (
                <div className="rounded-lg border border-dashed border-neutral-300 p-5">
                    <p className="text-body font-semibold text-neutral-900">
                        {t('composer.taskList.emptyTitle')}
                    </p>
                    <p className="mt-0.5 text-caption text-neutral-500">
                        {t('composer.taskList.emptyHint')}
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {types.map((type) => {
                            const meta = typeMeta(type);
                            const Icon = meta.icon;
                            return (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => addTask(type)}
                                    className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2 text-start hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                >
                                    <span
                                        className={cn(
                                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                                            meta.accent.soft
                                        )}
                                    >
                                        <Icon size={16} aria-hidden />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-body font-semibold text-neutral-900">
                                            {t(meta.labelKey)}
                                        </span>
                                        <span className="block truncate text-caption text-neutral-500">
                                            {t(meta.hintKey)}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <Sortable
                    value={sortable}
                    onMove={({ activeIndex, overIndex }) => move(activeIndex, overIndex)}
                >
                    <ol className="flex flex-col gap-2">
                        {fields.map((field, index) => (
                            <SortableItem key={field.rhfKey} value={field.rhfKey} asChild>
                                <li data-composer-path={pathOf(index)}>
                                    <TaskRow
                                        control={control}
                                        path={pathOf(index)}
                                        index={index}
                                        count={fields.length}
                                        itemKey={field.key}
                                        openKey={openKey}
                                        onToggle={(key) =>
                                            onOpenKeyChange(openKey === key ? null : key)
                                        }
                                        onActivate={(key) => {
                                            if (openKey !== key) onOpenKeyChange(key);
                                        }}
                                        days={days.filter((day) => day.index !== dayIndex)}
                                        types={types}
                                        activeCardId={activeCardId}
                                        onActiveCardChange={onActiveCardChange}
                                        onMoveUp={() => move(index, index - 1)}
                                        onMoveDown={() => move(index, index + 1)}
                                        onDuplicate={() => duplicate(index)}
                                        onMoveToDay={(target) => requestMove(index, target)}
                                        onDelete={() => requestDelete(index)}
                                        onChangeType={(type) => requestType(index, type)}
                                        onReplaceItem={(item) => update(index, item)}
                                        onInsertItemAfter={(item) => {
                                            insert(index + 1, item);
                                            onOpenKeyChange(item.key);
                                        }}
                                        packageSessionId={packageSessionId}
                                    />
                                </li>
                            </SortableItem>
                        ))}
                    </ol>
                </Sortable>
            )}

            <AlertDialog
                open={pending !== null}
                onOpenChange={(next) => {
                    if (!next) setPending(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-start">
                            {pending?.kind === 'type' && t('composer.taskList.confirmType.title')}
                            {pending?.kind === 'move' && t('composer.taskList.confirmMove.title')}
                            {pending?.kind === 'delete' &&
                                t('composer.taskList.confirmDelete.title', {
                                    title: pending.title || t('preview.untitled'),
                                })}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-start">
                            {pending?.kind === 'type' &&
                                t('composer.taskList.confirmType.description', {
                                    type: t(typeMeta(pending.type).labelKey),
                                })}
                            {pending?.kind === 'move' &&
                                t('composer.taskList.confirmMove.description', {
                                    count: pending.answered,
                                    day:
                                        days.find((day) => day.index === pending.target)?.label ??
                                        '',
                                })}
                            {pending?.kind === 'delete' &&
                                t('composer.taskList.confirmDelete.description', {
                                    count: pending.answered,
                                })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('composer.discard.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            className={cn(
                                pending?.kind === 'delete' && 'bg-danger-600 hover:bg-danger-500'
                            )}
                            onClick={confirmPending}
                        >
                            {pending?.kind === 'type' && t('composer.taskList.confirmType.confirm')}
                            {pending?.kind === 'move' && t('composer.taskList.confirmMove.confirm')}
                            {pending?.kind === 'delete' &&
                                t('composer.taskList.confirmDelete.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}

/** The day-level "Add at least one task." error, when there is one. */
function TaskListError({
    control,
    name,
}: {
    control: Control<ComposerForm>;
    name: `slots.${number}.items`;
}) {
    const { t } = useTranslation('engagement');
    const { errors } = useFormState({ control, name });
    const error = get(errors, name) as
        | { message?: string; root?: { message?: string } }
        | undefined;
    const message = error?.message ?? error?.root?.message;
    if (!message) return null;
    return (
        <p className="flex items-center gap-1.5 text-caption text-danger-600" role="alert">
            <WarningCircle size={14} aria-hidden /> {t(message)}
        </p>
    );
}

interface TaskRowProps {
    control: Control<ComposerForm>;
    path: ItemPath;
    index: number;
    count: number;
    itemKey: string;
    openKey: string | null;
    onToggle: (key: string) => void;
    onActivate: (key: string) => void;
    days: DayOption[];
    types: EngagementItemType[];
    activeCardId?: string | null;
    onActiveCardChange?: (id: string | null) => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDuplicate: () => void;
    onMoveToDay: (target: number) => void;
    onDelete: () => void;
    onChangeType: (type: EngagementItemType) => void;
    onReplaceItem: (item: ItemForm) => void;
    onInsertItemAfter: (item: ItemForm) => void;
    packageSessionId?: string | null;
}

function TaskRow({
    control,
    path,
    index,
    count,
    itemKey,
    openKey,
    onToggle,
    onActivate,
    days,
    types,
    activeCardId,
    onActiveCardChange,
    onMoveUp,
    onMoveDown,
    onDuplicate,
    onMoveToDay,
    onDelete,
    onChangeType,
    onReplaceItem,
    onInsertItemAfter,
    packageSessionId,
}: TaskRowProps) {
    const { t } = useTranslation('engagement');
    const uid = useId();
    const item = useWatch({ control, name: path }) as ItemForm | undefined;
    const { errors } = useFormState({ control, name: path });
    const errorCount = countFormErrors(get(errors, path));

    if (!item) return null;
    const key = item.key || itemKey;
    const open = openKey !== null && openKey === key;
    const meta = typeMeta(item.itemType);
    const Icon = meta.icon;
    const answered = item.id ? item.completedCount ?? 0 : 0;
    const locked = isAnsweredSaved(item);
    const needsTopScore = item.itemType === 'GAME' && item.maxScore == null;
    // A type the flag hides still shows on the task that already has it. A locked task
    // shows only its own type: five disabled cards would just push the editor down.
    const chipTypes = locked
        ? [item.itemType]
        : types.includes(item.itemType)
          ? types
          : [...types, item.itemType];

    const menu: DropdownItem[] = [];
    if (index > 0) {
        menu.push({ label: t('composer.rail.moveUp'), value: 'up', icon: <ArrowUp size={16} /> });
    }
    if (index < count - 1) {
        menu.push({
            label: t('composer.rail.moveDown'),
            value: 'down',
            icon: <ArrowDown size={16} />,
        });
    }
    menu.push({
        label: t('composer.taskList.duplicate'),
        value: 'duplicate',
        icon: <CopySimple size={16} />,
    });
    if (days.length > 0) {
        menu.push({
            label: t('composer.taskList.moveToDay'),
            value: 'move',
            icon: <CalendarBlank size={16} />,
            subItems: days.map((day) => ({ label: day.label, value: `day:${day.index}` })),
        });
    }
    menu.push({
        label: t('composer.taskList.delete'),
        value: 'delete',
        icon: <Trash size={16} className="text-danger-600" />,
    });

    function handleMenu(value: string) {
        if (value === 'up') onMoveUp();
        else if (value === 'down') onMoveDown();
        else if (value === 'duplicate') onDuplicate();
        else if (value === 'delete') onDelete();
        else if (value.startsWith('day:')) onMoveToDay(Number(value.slice(4)));
    }

    const bodyId = `${uid}-body`;

    return (
        <div
            className={cn(
                'rounded-lg border bg-white transition-colors',
                open
                    ? 'border-primary-300 shadow-sm'
                    : errorCount > 0
                      ? 'border-danger-300'
                      : 'border-neutral-200 hover:border-neutral-300'
            )}
        >
            <div className="flex items-center gap-1 pe-1">
                <SortableDragHandle
                    variant="ghost"
                    aria-label={t('composer.taskList.drag', { n: index + 1 })}
                    className="h-12 w-7 shrink-0 rounded-none rounded-s-lg p-0 text-neutral-400 hover:bg-transparent hover:text-neutral-600"
                >
                    <DotsSixVertical size={16} />
                </SortableDragHandle>
                <button
                    type="button"
                    onClick={() => onToggle(key)}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                    <span
                        className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                            meta.accent.soft
                        )}
                    >
                        <Icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span
                            className={cn(
                                'block truncate text-body font-semibold',
                                item.title.trim() ? 'text-neutral-900' : 'text-neutral-400'
                            )}
                        >
                            {item.title.trim() || t('preview.untitled')}
                        </span>
                        <span className="block truncate text-caption text-neutral-500">
                            {[
                                t(meta.labelKey),
                                t('composer.taskList.points', { count: points(item) }),
                                item.isRequired ? t('composer.required') : '',
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                    </span>
                    {answered > 0 && (
                        <span className="hidden shrink-0 items-center gap-1 rounded-md bg-success-50 px-2 py-0.5 text-caption font-semibold text-success-700 sm:inline-flex">
                            <CheckCircle size={12} aria-hidden />
                            {t('composer.taskList.answered', { count: answered })}
                        </span>
                    )}
                    {needsTopScore && errorCount === 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warning-50 px-2 py-0.5 text-caption font-semibold text-warning-700">
                            <Warning size={12} aria-hidden />
                            {t('composer.taskList.needsTopScore')}
                        </span>
                    )}
                    {errorCount > 0 && (
                        <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-danger-50 px-2 py-0.5 text-caption font-semibold text-danger-600"
                            aria-label={t('composer.rail.problems', { count: errorCount })}
                        >
                            <WarningCircle size={12} aria-hidden />
                            {errorCount}
                        </span>
                    )}
                    <CaretDown
                        size={16}
                        aria-hidden
                        className={cn(
                            'shrink-0 text-neutral-500 transition-transform',
                            open && 'rotate-180'
                        )}
                    />
                </button>
                <MyDropdown dropdownList={menu} onSelect={handleMenu}>
                    <span className="flex size-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100">
                        <DotsThreeVertical size={18} aria-hidden />
                        <span className="sr-only">
                            {t('composer.taskList.actions', {
                                title: item.title.trim() || t('preview.untitled'),
                            })}
                        </span>
                    </span>
                </MyDropdown>
            </div>

            {open && (
                <div
                    id={bodyId}
                    className="space-y-4 border-t border-neutral-100 p-4"
                    onFocusCapture={() => onActivate(key)}
                >
                    {answered > 0 && (
                        <p className="flex items-center gap-1.5 text-caption text-neutral-600 sm:hidden">
                            <CheckCircle size={14} className="text-success-600" aria-hidden />
                            {t('composer.taskList.answered', { count: answered })}
                        </p>
                    )}
                    <div className="space-y-2">
                        <p
                            id={`${uid}-type`}
                            className="text-caption font-semibold text-neutral-700"
                        >
                            {t('composer.taskList.type')}
                        </p>
                        <RadioGroup
                            value={item.itemType}
                            onValueChange={(value) => onChangeType(value as EngagementItemType)}
                            aria-labelledby={`${uid}-type`}
                            disabled={locked}
                            className={cn(
                                'grid gap-2',
                                locked ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 xl:grid-cols-3'
                            )}
                        >
                            {chipTypes.map((type) => {
                                const chip = typeMeta(type);
                                const ChipIcon = chip.icon;
                                const checked = item.itemType === type;
                                const id = `${uid}-type-${type}`;
                                return (
                                    <label
                                        key={type}
                                        htmlFor={id}
                                        className={cn(
                                            'flex items-start gap-2 rounded-lg border p-2',
                                            locked ? 'cursor-not-allowed' : 'cursor-pointer',
                                            checked
                                                ? 'border-primary-300 bg-primary-50'
                                                : 'border-neutral-200 hover:border-neutral-300'
                                        )}
                                    >
                                        <RadioGroupItem id={id} value={type} className="mt-1" />
                                        <ChipIcon
                                            size={16}
                                            aria-hidden
                                            className="mt-1 shrink-0 text-neutral-600"
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-body font-semibold text-neutral-900">
                                                {t(chip.labelKey)}
                                            </span>
                                            <span className="block text-caption text-neutral-500">
                                                {t(chip.hintKey)}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </RadioGroup>
                        {locked && (
                            <p className="flex items-start gap-1.5 text-caption text-neutral-600">
                                <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
                                {t('composer.taskList.typeLocked')}
                            </p>
                        )}
                    </div>

                    <ItemEditor
                        key={item.itemType}
                        control={control}
                        name={path}
                        onActivate={() => onActivate(key)}
                        activeCardId={activeCardId}
                        onActiveCardChange={onActiveCardChange}
                        onReplaceItem={onReplaceItem}
                        onInsertItemAfter={onInsertItemAfter}
                        packageSessionId={packageSessionId}
                    />
                </div>
            )}
        </div>
    );
}
