import { useTranslation } from 'react-i18next';
import { ArrowCounterClockwise, PencilSimple, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';
import type { AnnotationEdit } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';

/** A pen mark as stored with the AI verdict. */
export interface StoredAnnotation {
    style?: string | null;
    target?: string | null;
    page_id?: string | null;
    text?: string | null;
}

/** What the teacher wants for one mark: keep it, leave it off, or write something else. */
export interface NoteChoice {
    action: 'KEEP' | 'DELETE' | 'EDIT';
    newText: string;
}

/** Marks the teacher changes through the marks box, not here. */
const MARK_ONLY_STYLES = new Set(['score', 'total']);
const KNOWN_STYLES = new Set([
    'tick',
    'cross',
    'circle',
    'strike',
    'strikethrough',
    'underline',
    'margin_note',
    'region_note',
    'brace',
    'summary',
    'feedback',
    'deduction_reason',
    'language',
]);

export const editableNotes = (annotations: StoredAnnotation[] | null | undefined) =>
    (annotations ?? [])
        .map((a, index) => ({ a, index }))
        .filter(({ a }) => !MARK_ONLY_STYLES.has(String(a.style ?? '').toLowerCase()));

const same = (a: StoredAnnotation, e: AnnotationEdit) =>
    (e.style ?? null) === (a.style ?? null) &&
    (e.target ?? null) === (a.target ?? null) &&
    (e.page_id ?? null) === (a.page_id ?? null) &&
    (e.text ?? null) === (a.text ?? null);

/** The teacher's saved choices, keyed by the mark's index in the verdict. */
export const initialNoteChoices = (
    annotations: StoredAnnotation[] | null | undefined,
    saved: AnnotationEdit[] | null | undefined
): Record<number, NoteChoice> => {
    const out: Record<number, NoteChoice> = {};
    const left = [...(saved ?? [])];
    for (const { a, index } of editableNotes(annotations)) {
        const i = left.findIndex((e) => same(a, e));
        if (i < 0) continue;
        const e = left.splice(i, 1)[0]!;
        out[index] = { action: e.action, newText: e.new_text ?? '' };
    }
    return out;
};

/** The edit list sent to the server: every mark not kept as the AI wrote it. */
export const buildAnnotationEdits = (
    annotations: StoredAnnotation[] | null | undefined,
    choices: Record<number, NoteChoice>
): AnnotationEdit[] =>
    editableNotes(annotations).flatMap(({ a, index }) => {
        const c = choices[index];
        if (!c || c.action === 'KEEP') return [];
        if (c.action === 'EDIT' && !c.newText.trim()) return [];
        return [
            {
                style: a.style ?? null,
                target: a.target ?? null,
                page_id: a.page_id ?? null,
                text: a.text ?? null,
                action: c.action,
                ...(c.action === 'EDIT' ? { new_text: c.newText.trim() } : {}),
            },
        ];
    });

/**
 * The AI's pen notes for one question: the teacher can leave any of them off
 * the copy or rewrite its words. Applied when the checked copy is re-drawn.
 */
export const PenNotesEditor = ({
    annotations,
    value,
    onChange,
    disabled,
}: {
    annotations: StoredAnnotation[] | null | undefined;
    value: Record<number, NoteChoice>;
    onChange: (value: Record<number, NoteChoice>) => void;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('copyCheckReview');
    const notes = editableNotes(annotations);
    const set = (index: number, choice: NoteChoice) => onChange({ ...value, [index]: choice });

    return (
        <div className="flex flex-col gap-2">
            <div>
                <p className="text-body font-medium text-neutral-700">{t('notes.title')}</p>
                <p className="text-caption text-neutral-500">{t('notes.hint')}</p>
            </div>
            {notes.length === 0 ? (
                <p className="text-caption text-neutral-500">{t('notes.empty')}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {notes.map(({ a, index }) => {
                        const choice = value[index] ?? { action: 'KEEP', newText: '' };
                        const style = String(a.style ?? '').toLowerCase();
                        const label = t(
                            `notes.styles.${KNOWN_STYLES.has(style) ? style : 'other'}`
                        );
                        const removed = choice.action === 'DELETE';
                        const editing = choice.action === 'EDIT';
                        return (
                            <li
                                key={index}
                                className={cn(
                                    'flex flex-col gap-2 rounded-md border bg-white p-2',
                                    removed ? 'border-neutral-200 opacity-60' : 'border-neutral-200'
                                )}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-caption font-semibold uppercase text-neutral-500">
                                            {label}
                                            {removed && ` · ${t('notes.removed')}`}
                                        </p>
                                        {a.text && (
                                            <p
                                                className={cn(
                                                    'break-words text-body text-neutral-800',
                                                    (removed || editing) && 'line-through'
                                                )}
                                            >
                                                {a.text}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        {a.text && !removed && (
                                            <MyButton
                                                type="button"
                                                buttonType="text"
                                                scale="small"
                                                disabled={disabled}
                                                onClick={() =>
                                                    set(
                                                        index,
                                                        editing
                                                            ? { action: 'KEEP', newText: '' }
                                                            : {
                                                                  action: 'EDIT',
                                                                  newText: a.text ?? '',
                                                              }
                                                    )
                                                }
                                            >
                                                <PencilSimple size={14} className="mr-1" />
                                                {editing ? t('notes.undo') : t('notes.edit')}
                                            </MyButton>
                                        )}
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            disabled={disabled}
                                            onClick={() =>
                                                set(
                                                    index,
                                                    removed
                                                        ? { action: 'KEEP', newText: '' }
                                                        : { action: 'DELETE', newText: '' }
                                                )
                                            }
                                        >
                                            {removed ? (
                                                <ArrowCounterClockwise size={14} className="mr-1" />
                                            ) : (
                                                <Trash size={14} className="mr-1" />
                                            )}
                                            {removed ? t('notes.undo') : t('notes.remove')}
                                        </MyButton>
                                    </div>
                                </div>
                                {editing && (
                                    <MyInput
                                        inputType="text"
                                        size="medium"
                                        className="sm:w-full"
                                        inputPlaceholder={t('notes.editPlaceholder')}
                                        input={choice.newText}
                                        disabled={disabled}
                                        onChangeFunction={(e) =>
                                            set(index, { action: 'EDIT', newText: e.target.value })
                                        }
                                    />
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default PenNotesEditor;
