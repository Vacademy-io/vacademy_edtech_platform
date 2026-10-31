import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Warning, WarningCircle, Copy, CheckCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { QuestionIssue } from '../-utils/validate-uploaded-questions';

interface GroupedIssues {
    questionIndex: number;
    questionPreview: string;
    questionType: string;
    issues: QuestionIssue[];
    hasError: boolean;
}

interface UploadDiagnosticsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    issues: QuestionIssue[];
    totalQuestions: number;
    onSkipAndProceed: (skipIndices: Set<number>) => void;
    onKeepAllAndEdit: () => void;
    onCancel: () => void;
}

const groupByQuestion = (issues: QuestionIssue[]): GroupedIssues[] => {
    const map = new Map<number, GroupedIssues>();
    issues.forEach((iss) => {
        const existing = map.get(iss.questionIndex);
        if (existing) {
            existing.issues.push(iss);
            if (iss.severity === 'error') existing.hasError = true;
        } else {
            map.set(iss.questionIndex, {
                questionIndex: iss.questionIndex,
                questionPreview: iss.questionPreview,
                questionType: iss.questionType,
                issues: [iss],
                hasError: iss.severity === 'error',
            });
        }
    });
    return Array.from(map.values()).sort((a, b) => a.questionIndex - b.questionIndex);
};

export const UploadDiagnosticsDialog = ({
    open,
    onOpenChange,
    issues,
    totalQuestions,
    onSkipAndProceed,
    onKeepAllAndEdit,
    onCancel,
}: UploadDiagnosticsDialogProps) => {
    const { t } = useTranslation('assessmentUploadDiagnosticsDialog');
    const grouped = useMemo(() => groupByQuestion(issues), [issues]);
    const [skipChecked, setSkipChecked] = useState<Set<number>>(new Set());

    // Default to all errors checked (skipped); warnings unchecked.
    useEffect(() => {
        if (!open) return;
        const initial = new Set<number>();
        grouped.forEach((g) => {
            if (g.hasError) initial.add(g.questionIndex);
        });
        setSkipChecked(initial);
    }, [open, grouped]);

    const toggleSkip = (idx: number) => {
        setSkipChecked((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    const checkAll = () => {
        setSkipChecked(new Set(grouped.map((g) => g.questionIndex)));
    };

    const uncheckAll = () => {
        setSkipChecked(new Set());
    };

    const copyDiagnostics = async () => {
        const payload = {
            totalQuestions,
            totalIssues: issues.length,
            questionsWithIssues: grouped.length,
            issues: issues.map((i) => ({
                questionIndex: i.questionIndex,
                questionType: i.questionType,
                severity: i.severity,
                code: i.code,
                message: i.message,
                questionPreview: i.questionPreview,
            })),
        };
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            toast.success(t('toasts.copySuccess'));
        } catch {
            toast.error(t('toasts.copyFailed'));
        }
    };

    const skipCount = skipChecked.size;
    const proceedCount = totalQuestions - skipCount;
    const errorCount = grouped.filter((g) => g.hasError).length;
    const warningOnlyCount = grouped.length - errorCount;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-dialog-xl max-w-none gap-0 overflow-hidden p-0">
                <DialogHeader className="bg-primary-50 px-6 py-4 pr-12">
                    <DialogTitle className="flex items-center gap-2 text-primary-500">
                        <Warning size={22} weight="fill" className="text-warning-500" />
                        {t('header.title')}
                    </DialogTitle>
                    <p className="text-sm text-neutral-600">
                        {t('header.summary', { count: totalQuestions, grouped: grouped.length })}
                        {errorCount > 0 && (
                            <>
                                {' '}
                                <span className="font-medium text-danger-600">
                                    {t('header.errorsCount', { count: errorCount })}
                                </span>
                            </>
                        )}
                        {warningOnlyCount > 0 && (
                            <>
                                <span className="font-medium text-warning-600">
                                    {t('header.warningsCount', { count: warningOnlyCount })}
                                </span>
                            </>
                        )}
                        .
                    </p>
                </DialogHeader>

                <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-6 py-2 text-xs text-neutral-600">
                    <span>
                        {t('actionsBar.summary', { skipCount, proceedCount })}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={checkAll}
                        >
                            {t('actionsBar.skipAll')}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={uncheckAll}
                        >
                            {t('actionsBar.skipNone')}
                        </Button>
                    </div>
                </div>

                <ScrollArea className="max-h-[55vh]"> {/* design-lint-ignore: viewport-relative scroll-area height inside dialog, no token exists */}
                    <ul className="divide-y divide-neutral-100">
                        {grouped.map((g) => {
                            const isSkipped = skipChecked.has(g.questionIndex);
                            return (
                                <li
                                    key={g.questionIndex}
                                    className={`flex gap-3 px-6 py-3 ${isSkipped ? 'bg-neutral-50' : ''}`}
                                >
                                    <Checkbox
                                        id={`skip-${g.questionIndex}`}
                                        checked={isSkipped}
                                        onCheckedChange={() => toggleSkip(g.questionIndex)}
                                        className="mt-1"
                                    />
                                    <label
                                        htmlFor={`skip-${g.questionIndex}`}
                                        className="flex-1 cursor-pointer"
                                    >
                                        <div className="mb-1 flex items-center gap-2">
                                            <span className="text-xs font-medium text-neutral-500">
                                                {t('listItem.questionNumber', {
                                                    number: g.questionIndex + 1,
                                                })}
                                            </span>
                                            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs font-medium uppercase text-neutral-600">
                                                {g.questionType}
                                            </span>
                                            {g.hasError ? (
                                                <span className="rounded bg-danger-50 px-1.5 py-0.5 text-2xs font-medium uppercase text-danger-600">
                                                    {t('listItem.errorBadge')}
                                                </span>
                                            ) : (
                                                <span className="rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-medium uppercase text-warning-600">
                                                    {t('listItem.warningBadge')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mb-2 line-clamp-2 text-sm text-neutral-800">
                                            {g.questionPreview}
                                        </p>
                                        <ul className="space-y-1.5">
                                            {g.issues.map((iss, idx) => (
                                                <li key={idx} className="flex gap-2 text-xs">
                                                    <WarningCircle
                                                        size={14}
                                                        className={`mt-0.5 shrink-0 ${
                                                            iss.severity === 'error'
                                                                ? 'text-danger-500'
                                                                : 'text-warning-500'
                                                        }`}
                                                    />
                                                    <div>
                                                        <span className="font-medium text-neutral-700">
                                                            {iss.message}
                                                        </span>{' '}
                                                        <span className="text-neutral-500">
                                                            {iss.hint}
                                                        </span>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </ScrollArea>

                <DialogFooter className="flex flex-col gap-3 border-t border-neutral-200 px-6 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 self-start text-xs text-neutral-600 sm:self-auto"
                        onClick={copyDiagnostics}
                    >
                        <Copy size={14} />
                        {t('footer.copyDiagnostics')}
                    </Button>
                    <div className="flex flex-wrap justify-end gap-2">
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="secondary"
                            layoutVariant="default"
                            onClick={onCancel}
                        >
                            {t('footer.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="secondary"
                            layoutVariant="default"
                            onClick={onKeepAllAndEdit}
                        >
                            {t('footer.keepAllAndEdit')}
                        </MyButton>
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="primary"
                            layoutVariant="default"
                            onClick={() => onSkipAndProceed(skipChecked)}
                            disabled={proceedCount === 0}
                        >
                            <CheckCircle size={16} weight="fill" />
                            {t('footer.skipAndProceed', { count: proceedCount })}
                        </MyButton>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
