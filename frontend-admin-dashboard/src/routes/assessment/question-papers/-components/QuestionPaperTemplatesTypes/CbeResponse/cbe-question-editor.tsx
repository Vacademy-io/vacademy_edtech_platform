/**
 * Editor of a Spreadsheet & Written Response (CBE_RESPONSE) question,
 * shared by the question-paper editor, the assessment editor and LMS question
 * slides. Bound to any react-hook-form form through `basePath`
 * (`questions.3`, `sections.1.questions.2`), it edits:
 *  - `parentRichTextContent`  scenario (left pane for the learner)
 *  - `questionName`           requirements
 *  - `cbeConfig`              parts, templates, solutions, marking schemes, grading notes
 *  - `questionMark`           kept equal to the sum of part marks
 */
import { useCallback, useEffect, useState } from 'react';
import { useFormState, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
    ArrowsClockwise,
    FileText,
    GridFour,
    Info,
    LockSimple,
    WarningCircle,
} from '@phosphor-icons/react';
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import {
    parseCbeConfig,
    type CbeConfig,
    type CbePart,
    type CbePartKind,
} from '@/components/cbe/types';
import {
    cbeQuestionMark,
    ensureCbeConfig,
    newCbePart,
    validateCbeConfig,
    type CbeSecretStatus,
} from '../../../-utils/cbe-question';
import { QuestionSectionHeader } from '../QuestionEditorParts';
import { CbePartEditor } from './cbe-part-editor';
import { useCbeSlideSecret } from './cbe-slide-secret-context';

export type CbeQuestionEditorProps = {
    // The editor serves several form schemas; it only touches the fields listed above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form: UseFormReturn<any>;
    /** Path of the question in the form, e.g. `questions.0` or `sections.1.questions.2`. */
    basePath: string;
    /** Heading for the requirements, e.g. "Question 3". */
    questionTitle?: string;
    examType?: string;
    className?: string;
};

export function CbeQuestionEditor({
    form,
    basePath,
    questionTitle,
    examType,
    className,
}: CbeQuestionEditorProps) {
    const { t } = useTranslation('assessmentCbeQP');
    const slideSecret = useCbeSlideSecret();
    const configPath = `${basePath}.cbeConfig`;
    const rawConfig = useWatch({ control: form.control, name: configPath });
    const secretStatus = useWatch({
        control: form.control,
        name: `${basePath}.cbeSecretStatus`,
    }) as CbeSecretStatus | undefined;
    const { errors } = useFormState({ control: form.control, name: configPath });
    const config: CbeConfig = parseCbeConfig(rawConfig) ?? ensureCbeConfig(null);
    const parts = config.data.parts;
    const [openPartId, setOpenPartId] = useState<string | null>(parts[0]?.id ?? null);

    // A question that became CBE (new question, type switch) gets its default
    // config — one spreadsheet part worth 10 marks — and matching total marks.
    useEffect(() => {
        const current = parseCbeConfig(form.getValues(configPath));
        const next = current ?? ensureCbeConfig(null);
        if (!current) {
            form.setValue(configPath, next, { shouldDirty: false, shouldValidate: false });
        }
        // The editor can be reused for another question: open that question's first part.
        setOpenPartId(next.data.parts[0]?.id ?? null);
        const mark = cbeQuestionMark(next);
        if (form.getValues(`${basePath}.questionMark`) !== mark) {
            form.setValue(`${basePath}.questionMark`, mark, { shouldDirty: false });
        }
        // Once per question shown.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [basePath]);

    /** Applies `fn` to the latest config in the form (debounced grid edits arrive late). */
    const updateConfig = useCallback(
        (fn: (cfg: CbeConfig) => CbeConfig) => {
            const next = fn(ensureCbeConfig(form.getValues(configPath)));
            form.setValue(configPath, next, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
            });
            form.setValue(`${basePath}.questionMark`, cbeQuestionMark(next), { shouldDirty: true });
        },
        [form, configPath, basePath]
    );

    const updatePart = (partId: string, fn: (part: CbePart) => CbePart) =>
        updateConfig((cfg) => ({
            ...cfg,
            data: {
                ...cfg.data,
                parts: cfg.data.parts.map((p) => (p.id === partId ? fn(p) : p)),
            },
        }));

    const addPart = (kind: CbePartKind) => {
        const part = newCbePart(kind, ensureCbeConfig(form.getValues(configPath)).data.parts);
        updateConfig((cfg) => ({
            ...cfg,
            data: { ...cfg.data, parts: [...cfg.data.parts, part] },
        }));
        setOpenPartId(part.id);
    };

    const movePart = (partId: string, direction: -1 | 1) =>
        updateConfig((cfg) => {
            const list = [...cfg.data.parts];
            const from = list.findIndex((p) => p.id === partId);
            const to = from + direction;
            if (from < 0 || to < 0 || to >= list.length) return cfg;
            const [moved] = list.splice(from, 1);
            if (moved) list.splice(to, 0, moved);
            return { ...cfg, data: { ...cfg.data, parts: list } };
        });

    const deletePart = (partId: string) =>
        updateConfig((cfg) => ({
            ...cfg,
            data: { ...cfg.data, parts: cfg.data.parts.filter((p) => p.id !== partId) },
        }));

    if (examType === 'SURVEY') {
        return (
            <div className={className}>
                <p className="text-body text-neutral-500">{t('survey.notSupported')}</p>
            </div>
        );
    }

    // On a question slide the solution half is loaded separately; until it is
    // here it can be neither shown nor edited (saving then keeps the stored one).
    const secretEditable = !slideSecret || secretStatus === 'owned';
    const lockedNotice = slideSecret ? (
        secretStatus === 'failed' ? (
            <div
                role="alert"
                className="flex flex-wrap items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-body text-warning-700"
            >
                <WarningCircle size={18} className="mt-px shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="font-semibold">{t('secret.failedTitle')}</p>
                    <p>{t('secret.failedBody')}</p>
                </div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={slideSecret.retry}
                >
                    <ArrowsClockwise size={14} />
                    {t('secret.retry')}
                </MyButton>
            </div>
        ) : (
            <div
                role="status"
                className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-body text-neutral-600"
            >
                <LockSimple size={16} className="shrink-0" />
                {t('secret.loading')}
            </div>
        )
    ) : null;

    const { errors: blocking, warnings } = validateCbeConfig(config);
    const issueText = (issue: (typeof warnings)[number]) => {
        switch (issue.code) {
            case 'noParts':
                return t('validation.noParts');
            case 'partMarks':
                return t('validation.partMarks', { label: issue.label });
            case 'noSolution':
                return t('validation.noSolution', { label: issue.label });
            case 'schemeMismatch':
                return t('validation.schemeMismatch', {
                    label: issue.label,
                    scheme: issue.scheme,
                    marks: issue.marks,
                });
            case 'uncomputedSolution':
                return t('validation.uncomputedSolution', { label: issue.label });
        }
    };
    const configError = getError(errors, configPath);
    const total = Number(cbeQuestionMark(config));

    return (
        <div className={className}>
            {/* Scenario */}
            <div className="flex w-full flex-col !flex-nowrap items-start gap-2">
                <QuestionSectionHeader title={t('scenario.title')} hint={t('scenario.hint')} />
                <FormField
                    control={form.control}
                    name={`${basePath}.parentRichTextContent`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <RichTextEditor
                                    value={field.value ?? ''}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
                                    minHeight={120}
                                    placeholder={t('scenario.placeholder')}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>

            {/* Requirements (question text) */}
            <div className="flex w-full flex-col !flex-nowrap items-start gap-2">
                <QuestionSectionHeader
                    title={
                        questionTitle
                            ? t('requirements.titleNumbered', { title: questionTitle })
                            : t('requirements.title')
                    }
                    hint={t('requirements.hint')}
                />
                <FormField
                    control={form.control}
                    name={`${basePath}.questionName`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <RichTextEditor
                                    value={field.value ?? ''}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
                                    minHeight={100}
                                    placeholder={t('requirements.placeholder')}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>

            {/* Answer parts */}
            <div className="flex w-full flex-col gap-3">
                <QuestionSectionHeader
                    title={t('parts.title')}
                    hint={t('parts.hint')}
                    action={
                        <Badge variant="outline" className="shrink-0 text-body">
                            {t('parts.total', { count: total })}
                        </Badge>
                    }
                />
                {parts.length === 0 ? (
                    <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-body text-neutral-500">
                        {t('parts.empty')}
                    </p>
                ) : (
                    parts.map((part, index) => (
                        <CbePartEditor
                            key={part.id}
                            part={part}
                            index={index}
                            count={parts.length}
                            expanded={openPartId === part.id}
                            onToggle={() =>
                                setOpenPartId((open) => (open === part.id ? null : part.id))
                            }
                            onUpdate={(fn) => updatePart(part.id, fn)}
                            onMove={(direction) => movePart(part.id, direction)}
                            onDelete={() => deletePart(part.id)}
                            secretEditable={secretEditable}
                            lockedNotice={lockedNotice}
                        />
                    ))
                )}
                <div className="flex flex-wrap gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => addPart('SPREADSHEET')}
                    >
                        <GridFour size={16} />
                        {t('parts.addSpreadsheet')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => addPart('DOCUMENT')}
                    >
                        <FileText size={16} />
                        {t('parts.addDocument')}
                    </MyButton>
                </div>
            </div>

            {/* Checks */}
            {(blocking.length > 0 || warnings.length > 0 || configError) && (
                <div className="flex w-full flex-col gap-2">
                    {(blocking.length > 0 || configError) && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-body text-danger-700"
                        >
                            <WarningCircle size={18} className="mt-px shrink-0" />
                            <ul className="flex flex-col gap-1">
                                {blocking.map((issue, i) => (
                                    <li key={`e-${i}`}>{issueText(issue)}</li>
                                ))}
                                {blocking.length === 0 && configError && <li>{configError}</li>}
                            </ul>
                        </div>
                    )}
                    {warnings.length > 0 && (
                        <div
                            role="status"
                            className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-body text-warning-700"
                        >
                            <Info size={18} className="mt-px shrink-0" />
                            <ul className="flex flex-col gap-1">
                                {warnings.map((issue, i) => (
                                    <li key={`w-${i}`}>{issueText(issue)}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {/* Grading notes (secret) */}
            <div className="mb-6 flex w-full flex-col gap-2">
                <QuestionSectionHeader
                    title={t('gradingNotes.title')}
                    hint={t('gradingNotes.hint')}
                />
                {secretEditable ? (
                    <Textarea
                        value={config.data.gradingNotes ?? ''}
                        placeholder={t('gradingNotes.placeholder')}
                        aria-label={t('gradingNotes.title')}
                        className="min-h-24 text-body"
                        onChange={(e) => {
                            const gradingNotes = e.target.value;
                            updateConfig((cfg) => ({
                                ...cfg,
                                data: { ...cfg.data, gradingNotes },
                            }));
                        }}
                    />
                ) : (
                    lockedNotice
                )}
            </div>
        </div>
    );
}

/** The message of a nested react-hook-form error at `path`, if any. */
function getError(errors: unknown, path: string): string | null {
    let node: unknown = errors;
    for (const key of path.split('.')) {
        if (!node || typeof node !== 'object') return null;
        node = (node as Record<string, unknown>)[key];
    }
    if (node && typeof node === 'object' && 'message' in node) {
        const message = (node as { message?: unknown }).message;
        return typeof message === 'string' ? message : null;
    }
    return null;
}
