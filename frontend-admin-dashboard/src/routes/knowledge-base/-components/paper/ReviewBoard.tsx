import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowClockwise,
    ArrowDown,
    ArrowUp,
    BookOpen,
    CheckCircle,
    PencilSimple,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { MathHtml } from './MathHtml';
import type { Blueprint, PaperIssue, PaperResult, RawPaperQuestion } from '../../-types/paper';

interface ReviewBoardProps {
    result: PaperResult;
    blueprint: Blueprint;
    issuesByQuestion: Map<number, PaperIssue[]>;
    regeneratingNumber: number | null;
    onRegenerate: (raw: RawPaperQuestion, instruction?: string) => void;
    /** Hand-edit a question (text, options, answer, scheme). */
    onEdit?: (index: number) => void;
    /** Drop a question from the paper. */
    onDelete?: (index: number) => void;
    /** Move a question one place up or down within the paper. */
    onMove?: (index: number, direction: -1 | 1) => void;
}

const buildNudges = (t: TFunction) => [
    { label: t('nudges.harder.label'), instruction: 'Make this question harder.' },
    { label: t('nudges.easier.label'), instruction: 'Make this question easier.' },
    {
        label: t('nudges.moreApplication.label'),
        instruction: 'Make this test application rather than recall.',
    },
];

/**
 * One card per question, each showing the page it came from.
 *
 * The citation is not decoration: it is the only way a teacher can check a
 * question against the book without hunting for it, and an unverifiable question
 * paper does not get used a second time.
 */
export const ReviewBoard = ({
    result,
    blueprint,
    issuesByQuestion,
    regeneratingNumber,
    onRegenerate,
    onEdit,
    onDelete,
    onMove,
}: ReviewBoardProps) => {
    const { t } = useTranslation('knowledgeBaseReviewBoard');
    const [openNudge, setOpenNudge] = useState<number | null>(null);
    const nudges = buildNudges(t);

    if (result.raw_questions.length === 0) {
        return (
            <Card className="flex flex-col items-center gap-2 p-8 text-center">
                <WarningCircle className="size-6 text-warning-600" />
                <p className="text-body text-neutral-600">{t('emptyState.title')}</p>
                <p className="text-caption text-neutral-500">{t('emptyState.description')}</p>
            </Card>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {result.raw_questions.map((raw, index) => {
                const num = raw.question_number ?? index + 1;
                const issues = issuesByQuestion.get(num) ?? [];
                const errors = issues.filter((i) => i.severity === 'error');
                const warnings = issues.filter((i) => i.severity === 'warning');
                const meta = raw.kb_meta ?? {};
                const page = meta.source_page ?? raw.source_page;
                const busy = regeneratingNumber === num;

                return (
                    <Card
                        key={`${num}-${index}`}
                        className={
                            errors.length
                                ? 'flex flex-col gap-3 border-danger-200 p-4'
                                : 'flex flex-col gap-3 p-4'
                        }
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-2">
                                <span className="shrink-0 text-body font-semibold text-neutral-500">
                                    Q{num}.
                                </span>
                                <MathHtml
                                    html={raw.question?.content ?? ''}
                                    className="min-w-0 flex-1 break-words text-body text-neutral-700 [&_img]:my-2 [&_img]:max-h-56 [&_img]:rounded [&_img]:border [&_img]:border-neutral-200"
                                />
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {meta.marks != null && (
                                    <span className="text-caption text-neutral-500">
                                        {t('marks', { count: meta.marks })}
                                    </span>
                                )}
                                {errors.length > 0 ? (
                                    <StatusChip
                                        status="DANGER"
                                        text={t('status.needsFixing')}
                                        textSize="text-caption"
                                        showIcon={false}
                                    />
                                ) : warnings.length > 0 ? (
                                    <StatusChip
                                        status="WARNING"
                                        text={t('status.check')}
                                        textSize="text-caption"
                                        showIcon={false}
                                    />
                                ) : (
                                    <CheckCircle className="size-4 text-success-600" />
                                )}
                            </div>
                        </div>

                        {(raw.options?.length ?? 0) > 0 && (
                            <ol className="ml-8 flex flex-col gap-1">
                                {raw.options?.map((opt, oi) => {
                                    const correct = (raw.correct_options ?? []).includes(
                                        String(opt.preview_id ?? oi + 1)
                                    );
                                    return (
                                        <li
                                            key={`${opt.preview_id}-${oi}`}
                                            className={
                                                correct
                                                    ? 'flex items-start gap-2 text-body text-success-700'
                                                    : 'flex items-start gap-2 text-body text-neutral-600'
                                            }
                                        >
                                            <span className="shrink-0">
                                                {String.fromCharCode(65 + oi)}.
                                            </span>
                                            <MathHtml
                                                html={opt.content ?? ''}
                                                className="min-w-0 break-words [&_img]:max-h-40 [&_img]:rounded [&_img]:border [&_img]:border-neutral-200"
                                            />
                                            {correct && (
                                                <CheckCircle className="mt-0.5 size-3.5 shrink-0" />
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        )}

                        {raw.exp && (
                            <div className="ml-8 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                                <p className="text-caption font-semibold text-neutral-600">
                                    {t('markingScheme')}
                                </p>
                                <MathHtml
                                    html={raw.exp}
                                    className="mt-0.5 break-words text-caption text-neutral-600"
                                />
                            </div>
                        )}

                        {meta.diagram_missing && (
                            <p className="ml-8 flex items-start gap-1.5 text-caption text-warning-700">
                                <WarningCircle className="mt-0.5 size-3.5 shrink-0" />
                                {t('diagramMissing', { description: meta.diagram_missing })}
                            </p>
                        )}
                        {issues.length > 0 && (
                            <ul className="ml-8 flex flex-col gap-0.5">
                                {issues.map((issue, ii) => (
                                    <li
                                        key={ii}
                                        className={
                                            issue.severity === 'error'
                                                ? 'text-caption text-danger-600'
                                                : 'text-caption text-warning-600'
                                        }
                                    >
                                        {issue.message}
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div className="ml-8 flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-caption text-neutral-500">
                                <BookOpen className="size-3.5" />
                                {meta.topic ? `${meta.topic} · ` : ''}
                                {page ? t('pageLabel', { page }) : t('noPageRecorded')}
                                {(meta.figures?.length ?? 0) > 0 &&
                                    ` · ${t('diagramsFromBook', { count: meta.figures?.length ?? 0 })}`}
                            </span>
                            <div className="flex flex-wrap items-center gap-1">
                                {onMove && (
                                    <>
                                        <MyButton
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="small"
                                            disable={busy || index === 0}
                                            aria-label={t('actions.moveUp')}
                                            onClick={() => onMove(index, -1)}
                                        >
                                            <ArrowUp className="size-3.5" />
                                        </MyButton>
                                        <MyButton
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="small"
                                            disable={
                                                busy || index === result.raw_questions.length - 1
                                            }
                                            aria-label={t('actions.moveDown')}
                                            onClick={() => onMove(index, 1)}
                                        >
                                            <ArrowDown className="size-3.5" />
                                        </MyButton>
                                    </>
                                )}
                                {onEdit && (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        disable={busy}
                                        onClick={() => onEdit(index)}
                                    >
                                        <PencilSimple className="mr-1 size-3.5" />
                                        {t('actions.edit')}
                                    </MyButton>
                                )}
                                {onDelete && (
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        className="text-danger-600"
                                        disable={busy}
                                        onClick={() => onDelete(index)}
                                    >
                                        <Trash className="mr-1 size-3.5" />
                                        {t('actions.delete')}
                                    </MyButton>
                                )}
                                {openNudge === num &&
                                    nudges.map((n) => (
                                        <MyButton
                                            key={n.label}
                                            buttonType="secondary"
                                            scale="small"
                                            disable={busy}
                                            onClick={() => {
                                                setOpenNudge(null);
                                                onRegenerate(raw, n.instruction);
                                            }}
                                        >
                                            {n.label}
                                        </MyButton>
                                    ))}
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    disable={
                                        busy || !blueprint.rows.some((r) => r.id === meta.row_id)
                                    }
                                    onClick={() => {
                                        if (!blueprint.rows.some((r) => r.id === meta.row_id)) {
                                            toast.error(t('errors.sectionRemoved'));
                                            return;
                                        }
                                        setOpenNudge(openNudge === num ? null : num);
                                    }}
                                >
                                    <ArrowClockwise
                                        className={
                                            busy ? 'mr-1 size-3.5 animate-spin' : 'mr-1 size-3.5'
                                        }
                                    />
                                    {busy ? t('actions.rewriting') : t('actions.rewrite')}
                                </MyButton>
                            </div>
                        </div>
                    </Card>
                );
            })}
        </div>
    );
};
