import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Spinner, Trash } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import type { RawPaperQuestion } from '../../-types/paper';

interface EditQuestionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    question: RawPaperQuestion | null;
    /** Receives the edited raw question; the caller re-formats and stores it. */
    onSave: (next: RawPaperQuestion) => Promise<void>;
}

const OPTION_TYPES = new Set(['MCQS', 'MCQM', 'TRUE_FALSE', 'PASSAGE', 'ASSERTION_REASON']);

/**
 * Hand-edit one generated question: its text, the options and which are
 * correct, the model answer, and the marking scheme. Plain text/HTML areas —
 * a teacher fixing a wrong unit or a clumsy sentence does not need a rich
 * editor, and `$…$` maths keeps working exactly as generated.
 */
export const EditQuestionDialog = ({
    open,
    onOpenChange,
    question,
    onSave,
}: EditQuestionDialogProps) => {
    const { t } = useTranslation('knowledgeBaseEditQuestion');
    const [text, setText] = useState('');
    const [options, setOptions] = useState<Array<{ preview_id: string; content: string }>>([]);
    const [correct, setCorrect] = useState<Set<string>>(new Set());
    const [answer, setAnswer] = useState('');
    const [scheme, setScheme] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !question) return;
        setText(question.question?.content ?? '');
        setOptions(
            (question.options ?? []).map((o, i) => ({
                preview_id: String(o.preview_id ?? i + 1),
                content: o.content ?? '',
            }))
        );
        setCorrect(new Set((question.correct_options ?? []).map(String)));
        setAnswer(question.ans ?? '');
        setScheme(question.exp ?? '');
        setError(null);
    }, [open, question]);

    if (!question) return null;
    const hasOptions = OPTION_TYPES.has(String(question.question_type ?? '').toUpperCase());
    const single = String(question.question_type).toUpperCase() !== 'MCQM';

    const toggleCorrect = (id: string) => {
        setCorrect((prev) => {
            if (single) return new Set([id]);
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const save = async () => {
        if (!text.trim()) {
            setError(t('errors.emptyQuestion'));
            return;
        }
        if (hasOptions && (options.length < 2 || correct.size === 0)) {
            setError(t('errors.optionsAndAnswer'));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const correctIds = [...correct].filter((id) =>
                options.some((o) => o.preview_id === id)
            );
            const next: RawPaperQuestion = {
                ...question,
                question: { ...(question.question ?? {}), type: 'HTML', content: text },
                options: hasOptions ? options.map((o) => ({ ...o, type: 'HTML' })) : [],
                correct_options: hasOptions ? correctIds : [],
                ans: hasOptions
                    ? options
                          .filter((o) => correctIds.includes(o.preview_id))
                          .map((o) => o.content)
                          .join('; ')
                    : answer,
                exp: scheme,
            };
            await onSave(next);
            onOpenChange(false);
        } catch (e) {
            const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data
                ?.detail;
            setError(typeof detail === 'string' ? detail : t('errors.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <MyDialog
            heading={t('heading', { number: question.question_number ?? '' })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
        >
            <div className="flex flex-col gap-4 p-6">
                <label className="flex flex-col gap-1">
                    <span className="text-subtitle text-neutral-600">{t('fields.question')}</span>
                    <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
                    <span className="text-caption text-neutral-400">{t('fields.htmlHint')}</span>
                </label>

                {hasOptions && (
                    <div className="flex flex-col gap-2">
                        <span className="text-subtitle text-neutral-600">
                            {t('fields.options')}
                            <span className="ml-2 text-caption text-neutral-400">
                                {single ? t('fields.tickOne') : t('fields.tickAll')}
                            </span>
                        </span>
                        {options.map((opt, i) => (
                            <div key={opt.preview_id} className="flex items-start gap-2">
                                <Checkbox
                                    checked={correct.has(opt.preview_id)}
                                    onCheckedChange={() => toggleCorrect(opt.preview_id)}
                                    aria-label={t('fields.markCorrect', {
                                        letter: String.fromCharCode(65 + i),
                                    })}
                                    className="mt-2.5"
                                />
                                <span className="mt-2 w-5 shrink-0 text-body text-neutral-500">
                                    {String.fromCharCode(65 + i)}.
                                </span>
                                <Textarea
                                    value={opt.content}
                                    rows={1}
                                    onChange={(e) =>
                                        setOptions((prev) =>
                                            prev.map((o) =>
                                                o.preview_id === opt.preview_id
                                                    ? { ...o, content: e.target.value }
                                                    : o
                                            )
                                        )
                                    }
                                    className="min-h-9 flex-1"
                                />
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    layoutVariant="icon"
                                    scale="small"
                                    className="mt-1 text-danger-600"
                                    disable={options.length <= 2}
                                    aria-label={t('fields.removeOption')}
                                    onClick={() => {
                                        setOptions((prev) =>
                                            prev.filter((o) => o.preview_id !== opt.preview_id)
                                        );
                                        setCorrect((prev) => {
                                            const next = new Set(prev);
                                            next.delete(opt.preview_id);
                                            return next;
                                        });
                                    }}
                                >
                                    <Trash className="size-4" />
                                </MyButton>
                            </div>
                        ))}
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            className="self-start"
                            disable={options.length >= 6}
                            onClick={() =>
                                setOptions((prev) => [
                                    ...prev,
                                    {
                                        preview_id: String(
                                            Math.max(
                                                0,
                                                ...prev.map((o) => Number(o.preview_id) || 0)
                                            ) + 1
                                        ),
                                        content: '',
                                    },
                                ])
                            }
                        >
                            <Plus className="mr-1 size-4" />
                            {t('fields.addOption')}
                        </MyButton>
                    </div>
                )}

                {!hasOptions && (
                    <label className="flex flex-col gap-1">
                        <span className="text-subtitle text-neutral-600">{t('fields.answer')}</span>
                        <Textarea
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
                            rows={3}
                        />
                    </label>
                )}

                <label className="flex flex-col gap-1">
                    <span className="text-subtitle text-neutral-600">{t('fields.scheme')}</span>
                    <Textarea value={scheme} onChange={(e) => setScheme(e.target.value)} rows={3} />
                    <span className="text-caption text-neutral-400">{t('fields.schemeHint')}</span>
                </label>

                {error && <p className="text-caption text-danger-600">{error}</p>}

                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                        disable={saving}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => void save()}
                        disable={saving}
                    >
                        {saving && <Spinner className="mr-1 size-4 animate-spin" />}
                        {saving ? t('actions.saving') : t('actions.save')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};
