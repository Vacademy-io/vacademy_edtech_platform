import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowLeft,
    FileArrowUp,
    PencilSimpleLine,
    Sparkle,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { QuestionEditor } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/AssessmentQuestionEditDialog';
import type { QuestionResponse } from '@/types/assessments/question-paper-template';
import type { QuestionBankQuestion } from '@/routes/assessment/question-papers/-utils/question-bank-services';
import {
    importLibraryQuestions,
    libraryErrorMessage,
    nodePath,
    type LibraryNode,
    type LibraryTagKind,
} from '../-services/question-library-services';
import { generateTopicQuestions, parseWordFile } from '../-services/library-add-services';
import {
    batchTags,
    blankQuestion,
    chunk,
    draftKey,
    ownDifficulty,
    toImportItem,
    type DraftQuestion,
} from '../-utils/library-import';
import { DIFFICULTIES } from './library-constants';
import { LibraryQuestionCard } from './LibraryQuestionCard';

type Step = 'choose' | 'upload' | 'ai' | 'write' | 'review';

const AI_TYPES = ['MCQS', 'MCQM', 'ONE_WORD', 'LONG_ANSWER'] as const;
const WRITE_TYPES = ['MCQS', 'MCQM', 'TRUE_FALSE', 'NUMERIC', 'ONE_WORD', 'LONG_ANSWER'] as const;
const LANGUAGES = ['english', 'hindi'] as const;
const MAX_AI_PER_LEVEL = 20;
const SAVE_CHUNK = 200;

/** Three small buttons for EASY / MEDIUM / HARD. */
const DifficultyPicker = ({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    return (
        <div className="flex flex-wrap gap-2">
            {DIFFICULTIES.map((level) => (
                <button
                    key={level}
                    type="button"
                    onClick={() => onChange(level)}
                    aria-pressed={value === level}
                    className={cn(
                        'rounded-full border px-3 py-1 text-caption',
                        value === level
                            ? 'border-primary-400 bg-primary-50 text-primary-500'
                            : 'border-neutral-200 text-neutral-600 hover:border-primary-400'
                    )}
                >
                    {t(`difficulty.${level}`)}
                </button>
            ))}
        </div>
    );
};

const toDrafts = (questions: QuestionResponse[], difficulty?: string): DraftQuestion[] =>
    questions.map((question) => ({
        key: draftKey(),
        question,
        difficulty: difficulty ?? ownDifficulty(question as unknown as Record<string, unknown>),
        path: [],
        tags: [],
    }));

/**
 * Owner only: new questions straight into the open topic. Pick a source (Word file, AI,
 * or write one), check what came out, then save it all with difficulty and tags.
 */
export const AddQuestionsDialog = ({
    open,
    onOpenChange,
    instituteId,
    node,
    nodes,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    node: LibraryNode;
    nodes: LibraryNode[];
    onSaved: () => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const topicPath = nodePath(node.id, nodes);
    const [step, setStep] = useState<Step>('choose');
    const [drafts, setDrafts] = useState<DraftQuestion[]>([]);

    // Upload
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploading, setUploading] = useState(false);

    // AI
    const [counts, setCounts] = useState<Record<string, string>>({
        EASY: '5',
        MEDIUM: '5',
        HARD: '0',
    });
    const [aiType, setAiType] = useState<string>('MCQS');
    const [language, setLanguage] = useState<string>('english');
    const [notes, setNotes] = useState('');
    const [generating, setGenerating] = useState(false);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    // Write one
    const [writeType, setWriteType] = useState<string>('MCQS');
    const [writeDifficulty, setWriteDifficulty] = useState('MEDIUM');

    // Review
    const [concept, setConcept] = useState('');
    const [pyq, setPyq] = useState('');
    const [source, setSource] = useState('');

    const levelCounts = DIFFICULTIES.map((level) => ({
        level,
        count: Math.max(
            0,
            Math.min(MAX_AI_PER_LEVEL, Number.parseInt(counts[level] ?? '0', 10) || 0)
        ),
    }));
    const aiTotal = levelCounts.reduce((sum, item) => sum + item.count, 0);

    const onFile = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        setUploadProgress(0);
        try {
            const questions = await parseWordFile(file, setUploadProgress);
            if (questions.length === 0) {
                toast.error(t('add.upload.none'));
                return;
            }
            setDrafts(toDrafts(questions));
            setStep('review');
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('add.upload.failed')));
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const generate = async () => {
        setGenerating(true);
        try {
            const results = await Promise.all(
                levelCounts
                    .filter((item) => item.count > 0)
                    .map(async (item) => ({
                        level: item.level,
                        questions: await generateTopicQuestions({
                            topicPath,
                            notes,
                            count: item.count,
                            difficulty: item.level,
                            questionType: aiType,
                            language,
                            isAlive: () => alive.current,
                        }),
                    }))
            );
            if (!alive.current) return;
            const generated = results.flatMap((result) => toDrafts(result.questions, result.level));
            if (generated.length === 0) {
                toast.error(t('add.ai.none'));
                return;
            }
            setDrafts(generated);
            setStep('review');
        } catch (error) {
            if (alive.current) toast.error(libraryErrorMessage(error, t('add.ai.failed')));
        } finally {
            if (alive.current) setGenerating(false);
        }
    };

    const save = async () => {
        const shared = batchTags(concept, pyq, source);
        const items = drafts.map((draft) =>
            toImportItem({ ...draft, tags: [...draft.tags, ...shared] })
        );
        let created = 0;
        const errors: string[] = [];
        try {
            for (const part of chunk(items, SAVE_CHUNK)) {
                const result = await importLibraryQuestions(instituteId, {
                    parent_id: node.id,
                    items: part,
                });
                created += result.created;
                errors.push(...(result.errors ?? []));
            }
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('toasts.failed')));
            if (created === 0) return;
        }
        onSaved();
        if (created > 0) toast.success(t('add.saved', { count: created, name: node.name }));
        if (errors.length > 0) {
            toast.warning(t('add.someFailed', { count: errors.length }), {
                description: errors.slice(0, 3).join('\n'),
            });
        }
        onOpenChange(false);
    };

    const sourceCard = (target: Step, icon: ReactNode, title: string, text: string) => (
        <button
            type="button"
            onClick={() => setStep(target)}
            className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-4 text-left hover:border-primary-400 hover:bg-primary-50"
        >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                {icon}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
                <span className="text-subtitle font-semibold text-neutral-700">{title}</span>
                <span className="text-caption text-neutral-500">{text}</span>
            </span>
        </button>
    );

    const back = (
        <MyButton
            type="button"
            buttonType="text"
            scale="small"
            className="gap-1 self-start"
            onClick={() => setStep('choose')}
        >
            <ArrowLeft size={14} />
            {t('add.back')}
        </MyButton>
    );

    return (
        <MyDialog
            heading={t('add.title', { name: node.name })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth={step === 'write' || step === 'review' ? 'max-w-dialog-xl' : 'max-w-2xl'}
            footer={
                step === 'review' ? (
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                setDrafts([]);
                                setStep('choose');
                            }}
                        >
                            {t('add.startOver')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={drafts.length === 0}
                            onAsyncClick={save}
                        >
                            {t('add.save', { count: drafts.length })}
                        </MyButton>
                    </>
                ) : undefined
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-caption text-neutral-500">
                    {t('add.savingInto', { path: topicPath })}
                </p>

                {step === 'choose' && (
                    <div className="grid grid-cols-1 gap-3">
                        {sourceCard(
                            'upload',
                            <FileArrowUp size={18} />,
                            t('add.upload.title'),
                            t('add.upload.text')
                        )}
                        {sourceCard(
                            'ai',
                            <Sparkle size={18} />,
                            t('add.ai.title'),
                            t('add.ai.text')
                        )}
                        {sourceCard(
                            'write',
                            <PencilSimpleLine size={18} />,
                            t('add.write.title'),
                            t('add.write.text')
                        )}
                    </div>
                )}

                {step === 'upload' && (
                    <div className="flex flex-col gap-4">
                        {back}
                        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 p-8 text-center">
                            <FileArrowUp size={32} className="text-primary-400" />
                            <span className="text-body text-neutral-600">
                                {t('add.upload.hint')}
                            </span>
                            <ul className="flex flex-col gap-1 text-left text-caption text-neutral-500">
                                <li>{t('add.upload.format1')}</li>
                                <li>{t('add.upload.format2')}</li>
                                <li>{t('add.upload.format3')}</li>
                            </ul>
                            <input
                                ref={fileInput}
                                type="file"
                                accept=".docx"
                                className="hidden"
                                onChange={(event) => void onFile(event.target.files?.[0])}
                            />
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                disable={uploading}
                                onClick={() => fileInput.current?.click()}
                            >
                                {uploading ? t('add.upload.reading') : t('add.upload.choose')}
                            </MyButton>
                            {uploading && (
                                <Progress value={uploadProgress} className="h-2 max-w-xs" />
                            )}
                        </div>
                    </div>
                )}

                {step === 'ai' && (
                    <div className="flex flex-col gap-4">
                        {back}
                        <div className="flex flex-col gap-2">
                            <span className="text-caption font-semibold text-neutral-600">
                                {t('add.ai.howMany')}
                            </span>
                            <div className="grid grid-cols-3 gap-3">
                                {DIFFICULTIES.map((level) => (
                                    <MyInput
                                        key={level}
                                        label={t(`difficulty.${level}`)}
                                        inputType="number"
                                        input={counts[level] ?? '0'}
                                        onChangeFunction={(e) =>
                                            setCounts((prev) => ({
                                                ...prev,
                                                [level]: e.target.value,
                                            }))
                                        }
                                        className="sm:w-full"
                                    />
                                ))}
                            </div>
                            <span className="text-caption text-neutral-500">
                                {t('add.ai.max', { count: MAX_AI_PER_LEVEL })}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex flex-col gap-1">
                                <span className="text-caption font-semibold text-neutral-600">
                                    {t('add.ai.type')}
                                </span>
                                <MyDropdown
                                    currentValue={t(`types.${aiType}`)}
                                    dropdownList={AI_TYPES.map((value) => ({
                                        label: t(`types.${value}`),
                                        value,
                                    }))}
                                    handleChange={setAiType}
                                    className="w-full text-body"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-caption font-semibold text-neutral-600">
                                    {t('add.ai.language')}
                                </span>
                                <MyDropdown
                                    currentValue={t(`add.ai.languages.${language}`)}
                                    dropdownList={LANGUAGES.map((value) => ({
                                        label: t(`add.ai.languages.${value}`),
                                        value,
                                    }))}
                                    handleChange={setLanguage}
                                    className="w-full text-body"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-caption font-semibold text-neutral-600">
                                {t('add.ai.notes')}
                            </span>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder={t('add.ai.notesPlaceholder')}
                                rows={4}
                            />
                        </div>
                        {generating ? (
                            <div className="flex flex-col gap-2">
                                <span className="text-caption text-neutral-500">
                                    {t('add.ai.working')}
                                </span>
                                {[0, 1, 2].map((i) => (
                                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                                ))}
                            </div>
                        ) : (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className="gap-2 self-start"
                                disable={aiTotal === 0}
                                onAsyncClick={generate}
                            >
                                <Sparkle size={16} />
                                {t('add.ai.generate', { count: aiTotal })}
                            </MyButton>
                        )}
                        <span className="text-caption text-neutral-500">{t('add.ai.credits')}</span>
                    </div>
                )}

                {step === 'write' && (
                    <div className="flex flex-col gap-4">
                        {back}
                        <div className="flex flex-col gap-1 sm:max-w-xs">
                            <span className="text-caption font-semibold text-neutral-600">
                                {t('add.write.type')}
                            </span>
                            <MyDropdown
                                currentValue={t(`types.${writeType}`)}
                                dropdownList={WRITE_TYPES.map((value) => ({
                                    label: t(`types.${value}`),
                                    value,
                                }))}
                                handleChange={setWriteType}
                                className="w-full text-body"
                            />
                        </div>
                        <QuestionEditor
                            key={writeType}
                            source={blankQuestion(writeType)}
                            serializeAs="added"
                            onCancel={() => setStep('choose')}
                            extraFields={
                                <div className="flex flex-col gap-2">
                                    <span className="text-caption font-semibold text-neutral-600">
                                        {t('edit.difficulty')}
                                    </span>
                                    <DifficultyPicker
                                        value={writeDifficulty}
                                        onChange={setWriteDifficulty}
                                    />
                                </div>
                            }
                            onSubmit={async (updated) => {
                                const [question] = updated;
                                if (!question) return;
                                const result = await importLibraryQuestions(instituteId, {
                                    parent_id: node.id,
                                    items: [
                                        {
                                            path: [],
                                            question,
                                            difficulty: writeDifficulty,
                                            tags: [],
                                        },
                                    ],
                                });
                                if (result.created === 0) {
                                    throw new Error(result.errors?.[0] ?? 'not saved');
                                }
                            }}
                            onSaved={() => {
                                onSaved();
                                onOpenChange(false);
                            }}
                        />
                    </div>
                )}

                {step === 'review' && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-2 rounded-md border border-info-200 bg-info-50 p-3 text-body text-neutral-700">
                            <WarningCircle size={18} className="shrink-0 text-info-600" />
                            {t('add.reviewHint', { count: drafts.length })}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            {(
                                [
                                    ['CONCEPT', concept, setConcept],
                                    ['PYQ', pyq, setPyq],
                                    ['SOURCE', source, setSource],
                                ] as [LibraryTagKind, string, (value: string) => void][]
                            ).map(([kind, value, set]) => (
                                <MyInput
                                    key={kind}
                                    label={t('add.tagsForAll', { kind: t(`tags.kind.${kind}`) })}
                                    inputType="text"
                                    inputPlaceholder={t(`tags.namePlaceholder.${kind}`)}
                                    input={value}
                                    onChangeFunction={(e) => set(e.target.value)}
                                    className="sm:w-full"
                                />
                            ))}
                        </div>
                        <div className="flex flex-col gap-6">
                            {drafts.map((draft, i) => (
                                <div key={draft.key} className="flex flex-col gap-2">
                                    <LibraryQuestionCard
                                        item={{
                                            question:
                                                draft.question as unknown as QuestionBankQuestion,
                                            node_ids: [],
                                            assessment_count: 0,
                                        }}
                                        index={i + 1}
                                        nodes={[]}
                                        checked={false}
                                        hideTopics
                                    />
                                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                                        <DifficultyPicker
                                            value={draft.difficulty}
                                            onChange={(level) =>
                                                setDrafts((prev) =>
                                                    prev.map((item) =>
                                                        item.key === draft.key
                                                            ? { ...item, difficulty: level }
                                                            : item
                                                    )
                                                )
                                            }
                                        />
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            className="gap-1"
                                            onClick={() =>
                                                setDrafts((prev) =>
                                                    prev.filter((item) => item.key !== draft.key)
                                                )
                                            }
                                        >
                                            <Trash size={14} />
                                            {t('add.remove')}
                                        </MyButton>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </MyDialog>
    );
};
