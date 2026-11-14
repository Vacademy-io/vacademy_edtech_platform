import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowDown,
    ArrowUp,
    CaretDown,
    CaretRight,
    FileArrowUp,
    FileText,
    GridFour,
    LockSimple,
    Paperclip,
    Trash,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { getUserId } from '@/utils/userDetails';
import { UploadFileInS3 } from '@/services/upload_file';
import { SpreadsheetEditor, loadDocumentEditor, loadXlsxImport } from '@/components/cbe';
import { CbeErrorBoundary } from '@/components/cbe/cbe-error-boundary';
import {
    emptyCbeSheet,
    type CbeMarkingLine,
    type CbePart,
    type CbeSheet,
} from '@/components/cbe/types';
import { cbeSchemeTotal } from '../../../-utils/cbe-question';
import { CbeMarkingSchemeEditor } from './cbe-marking-scheme-editor';

const lazyDocumentEditor = () =>
    lazy(() => loadDocumentEditor().then((m) => ({ default: m.DocumentEditor })));

/** Largest workbook the editor imports (the config travels in the question JSON). */
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const XLSX_ACCEPT =
    '.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

type Target = 'template' | 'solution';

export type CbePartEditorProps = {
    part: CbePart;
    index: number;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    /** Applies a change to the latest copy of this part. */
    onUpdate: (fn: (part: CbePart) => CbePart) => void;
    onMove: (direction: -1 | 1) => void;
    onDelete: () => void;
    /** False while a question slide's stored solution is not loaded: solution + scheme are locked. */
    secretEditable: boolean;
    /** Shown in place of the solution / scheme while they are locked. */
    lockedNotice?: React.ReactNode;
};

function PartMarksInput({
    value,
    onChange,
    label,
    invalid,
}: {
    value: number;
    onChange: (n: number) => void;
    label: string;
    invalid: boolean;
}) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => {
        if (Number(draft) !== value) setDraft(String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    return (
        <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.5"
            aria-label={label}
            aria-invalid={invalid}
            value={draft}
            className={cn('h-9 w-24 text-body', invalid && 'border-danger-600')}
            onChange={(e) => {
                setDraft(e.target.value);
                const n = Number(e.target.value);
                onChange(e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : 0);
            }}
        />
    );
}

const EditorFallback = () => <Skeleton className="h-72 w-full rounded-md" />;

export function CbePartEditor({
    part,
    index,
    count,
    expanded,
    onToggle,
    onUpdate,
    onMove,
    onDelete,
    secretEditable,
    lockedNotice,
}: CbePartEditorProps) {
    const { t } = useTranslation('assessmentCbeQP');
    const [confirmDelete, setConfirmDelete] = useState(false);
    // Re-created on "Try again" so a chunk that failed to load is fetched again.
    const [DocumentEditor, setDocumentEditor] = useState(lazyDocumentEditor);
    const [busy, setBusy] = useState<Target | 'upload' | null>(null);
    const templateInput = useRef<HTMLInputElement>(null);
    const solutionInput = useRef<HTMLInputElement>(null);

    const kindLabel = t(`part.kind.${part.kind}`);
    const scheme = part.markingScheme ?? [];
    const isSheet = part.kind === 'SPREADSHEET';
    const templateSheet = part.template && 'sheet' in part.template ? part.template.sheet : null;
    const templateHtml = part.template && 'html' in part.template ? part.template.html : '';
    const solutionSheet = part.solution && 'sheet' in part.solution ? part.solution.sheet : null;
    const solutionHtml = part.solution && 'html' in part.solution ? part.solution.html : '';
    const marksInvalid = !(part.marks > 0);

    const readWorkbook = async (file: File): Promise<CbeSheet | null> => {
        if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
            toast.error(t('import.wrongType'));
            return null;
        }
        if (file.size > MAX_XLSX_BYTES) {
            toast.error(t('import.tooLarge'));
            return null;
        }
        const { readXlsxFile } = await loadXlsxImport();
        return readXlsxFile(file);
    };

    const importTemplate = async (file: File) => {
        setBusy('template');
        try {
            const sheet = await readWorkbook(file);
            if (!sheet) return;
            onUpdate((p) => ({ ...p, template: { sheet } }));
            toast.success(t('import.templateDone', { count: sheet.sheets.length }));
        } catch (error) {
            console.error('[cbe] template import failed', error);
            toast.error(t('import.failed'));
        } finally {
            setBusy(null);
        }
    };

    const importSolution = async (file: File) => {
        setBusy('solution');
        let sheet: CbeSheet | null = null;
        try {
            sheet = await readWorkbook(file);
            if (!sheet) return;
            const { extractMarkingScheme } = await loadXlsxImport();
            const lines = extractMarkingScheme(sheet);
            const imported = sheet;
            onUpdate((p) => ({
                ...p,
                solution: { sheet: imported },
                // The scheme is re-read from the new solution; a solution with no
                // "Marks" column keeps the lines already entered.
                markingScheme: lines.length > 0 ? lines : p.markingScheme ?? [],
                solutionFileId: null,
            }));
            toast.success(
                lines.length > 0
                    ? t('import.solutionDone', {
                          count: lines.length,
                          marks: cbeSchemeTotal(lines),
                      })
                    : t('import.solutionNoScheme')
            );
        } catch (error) {
            console.error('[cbe] solution import failed', error);
            toast.error(t('import.failed'));
            return;
        } finally {
            setBusy(null);
        }

        // Keep the original workbook too (graders and support can open it). Best effort:
        // the solution itself is already in the question.
        setBusy('upload');
        try {
            const fileId = await UploadFileInS3(
                file,
                undefined,
                getUserId(),
                getInstituteId(),
                'CBE_SOLUTION',
                false
            );
            if (fileId) onUpdate((p) => ({ ...p, solutionFileId: fileId }));
        } catch (error) {
            console.warn('[cbe] original solution file was not uploaded', error);
            toast.warning(t('import.uploadFailed'));
        } finally {
            setBusy(null);
        }
    };

    const extractFromSolution = async () => {
        if (!solutionSheet) return;
        try {
            const { extractMarkingScheme } = await loadXlsxImport();
            const lines = extractMarkingScheme(solutionSheet);
            if (lines.length === 0) {
                toast.warning(t('scheme.extractNone'));
                return;
            }
            onUpdate((p) => ({ ...p, markingScheme: lines }));
            toast.success(
                t('import.solutionDone', { count: lines.length, marks: cbeSchemeTotal(lines) })
            );
        } catch (error) {
            console.error('[cbe] marking scheme extraction failed', error);
            toast.error(t('import.failed'));
        }
    };

    const fileInput = (ref: React.RefObject<HTMLInputElement>, onFile: (f: File) => void) => (
        <input
            ref={ref}
            type="file"
            accept={XLSX_ACCEPT}
            className="hidden"
            onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void onFile(file);
            }}
        />
    );

    const documentEditor = (
        value: string,
        onChange: (html: string) => void,
        label: string,
        placeholder: string
    ) => (
        <CbeErrorBoundary
            label={t('documentEditorName')}
            onRetry={() => setDocumentEditor(lazyDocumentEditor)}
        >
            <Suspense fallback={<EditorFallback />}>
                <DocumentEditor
                    value={value}
                    onChange={onChange}
                    label={label}
                    placeholder={placeholder}
                />
            </Suspense>
        </CbeErrorBoundary>
    );

    return (
        <div
            className={cn(
                'w-full rounded-lg border bg-white',
                expanded ? 'border-primary-200' : 'border-neutral-200'
            )}
        >
            {/* Header: summary + ordering + delete */}
            <div className="flex flex-wrap items-center gap-2 p-3">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    {expanded ? (
                        <CaretDown size={16} className="shrink-0 text-neutral-500" />
                    ) : (
                        <CaretRight size={16} className="shrink-0 text-neutral-500" />
                    )}
                    {isSheet ? (
                        <GridFour size={18} className="shrink-0 text-success-600" />
                    ) : (
                        <FileText size={18} className="shrink-0 text-info-600" />
                    )}
                    <span className="truncate text-subtitle font-semibold text-neutral-700">
                        {t('part.summary', {
                            label: part.label || `#${index + 1}`,
                            kind: kindLabel,
                            count: part.marks,
                        })}
                    </span>
                    {scheme.length > 0 && (
                        <Badge variant="outline" className="shrink-0">
                            {t('part.schemeBadge', { count: scheme.length })}
                        </Badge>
                    )}
                </button>
                <div className="flex items-center gap-1">
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('part.moveUp')}
                        disable={index === 0}
                        onClick={() => onMove(-1)}
                    >
                        <ArrowUp size={16} />
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('part.moveDown')}
                        disable={index === count - 1}
                        onClick={() => onMove(1)}
                    >
                        <ArrowDown size={16} />
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('part.delete')}
                        onClick={() => setConfirmDelete(true)}
                    >
                        <Trash size={16} className="text-danger-600" />
                    </MyButton>
                </div>
            </div>

            {expanded && (
                <div className="flex flex-col gap-4 border-t border-neutral-200 p-4">
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="flex flex-col gap-1">
                            <Label htmlFor={`cbe-part-label-${part.id}`} className="text-body">
                                {t('part.label')}
                            </Label>
                            <Input
                                id={`cbe-part-label-${part.id}`}
                                value={part.label}
                                className="h-9 w-28 text-body"
                                onChange={(e) => {
                                    const label = e.target.value;
                                    onUpdate((p) => ({ ...p, label }));
                                }}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-body">{t('part.marks')}</Label>
                            <PartMarksInput
                                value={part.marks}
                                label={t('part.marks')}
                                invalid={marksInvalid}
                                onChange={(marks) => onUpdate((p) => ({ ...p, marks }))}
                            />
                        </div>
                        <Badge variant="secondary" className="mb-2">
                            {kindLabel}
                        </Badge>
                    </div>
                    {marksInvalid && (
                        <p className="text-caption text-danger-600">{t('part.marksRequired')}</p>
                    )}

                    <div className="flex flex-col gap-1">
                        <span className="text-body font-semibold text-neutral-700">
                            {t('part.prompt')}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {t('part.promptHint')}
                        </span>
                        <RichTextEditor
                            value={part.promptHtml ?? ''}
                            onChange={(html: string) =>
                                onUpdate((p) => ({ ...p, promptHtml: html }))
                            }
                            minHeight={80}
                            placeholder={t('part.promptPlaceholder')}
                        />
                    </div>

                    <Tabs defaultValue="template" className="w-full">
                        <TabsList className="flex w-full flex-wrap justify-start">
                            <TabsTrigger value="template">{t('part.tabs.template')}</TabsTrigger>
                            <TabsTrigger value="solution">
                                {!secretEditable && <LockSimple size={14} className="mr-1" />}
                                {t('part.tabs.solution')}
                            </TabsTrigger>
                            <TabsTrigger value="scheme">
                                {!secretEditable && <LockSimple size={14} className="mr-1" />}
                                {t('part.tabs.scheme', { count: scheme.length })}
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="template" className="flex flex-col gap-3 pt-3">
                            <p className="text-caption text-neutral-500">
                                {isSheet ? t('template.sheetHint') : t('template.docHint')}
                            </p>
                            {isSheet ? (
                                <>
                                    <div className="flex flex-wrap gap-2">
                                        {fileInput(templateInput, importTemplate)}
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="small"
                                            disable={busy !== null}
                                            onClick={() => templateInput.current?.click()}
                                        >
                                            <FileArrowUp size={14} />
                                            {busy === 'template'
                                                ? t('import.reading')
                                                : t('template.import')}
                                        </MyButton>
                                        {templateSheet && (
                                            <MyButton
                                                type="button"
                                                buttonType="text"
                                                scale="small"
                                                onClick={() =>
                                                    onUpdate((p) => ({ ...p, template: null }))
                                                }
                                            >
                                                {t('template.clear')}
                                            </MyButton>
                                        )}
                                    </div>
                                    <SpreadsheetEditor
                                        value={templateSheet ?? emptyCbeSheet()}
                                        onChange={(sheet) =>
                                            onUpdate((p) => ({ ...p, template: { sheet } }))
                                        }
                                        height={360}
                                        label={t('template.gridLabel', { label: part.label })}
                                    />
                                </>
                            ) : (
                                documentEditor(
                                    templateHtml,
                                    (html) => onUpdate((p) => ({ ...p, template: { html } })),
                                    t('template.docLabel', { label: part.label }),
                                    t('template.docPlaceholder')
                                )
                            )}
                        </TabsContent>

                        <TabsContent value="solution" className="flex flex-col gap-3 pt-3">
                            {!secretEditable ? (
                                lockedNotice
                            ) : (
                                <>
                                    <p className="text-caption text-neutral-500">
                                        {isSheet ? t('solution.sheetHint') : t('solution.docHint')}
                                    </p>
                                    {isSheet ? (
                                        <>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {fileInput(solutionInput, importSolution)}
                                                <MyButton
                                                    type="button"
                                                    buttonType="secondary"
                                                    scale="small"
                                                    disable={busy !== null}
                                                    onClick={() => solutionInput.current?.click()}
                                                >
                                                    <FileArrowUp size={14} />
                                                    {busy === 'solution'
                                                        ? t('import.reading')
                                                        : t('solution.import')}
                                                </MyButton>
                                                {busy === 'upload' && (
                                                    <span className="text-caption text-neutral-500">
                                                        {t('solution.uploading')}
                                                    </span>
                                                )}
                                                {part.solutionFileId && busy !== 'upload' && (
                                                    <span className="flex items-center gap-1 text-caption text-neutral-500">
                                                        <Paperclip size={14} />
                                                        {t('solution.fileAttached')}
                                                    </span>
                                                )}
                                            </div>
                                            <SpreadsheetEditor
                                                value={solutionSheet ?? emptyCbeSheet()}
                                                onChange={(sheet) =>
                                                    onUpdate((p) => ({ ...p, solution: { sheet } }))
                                                }
                                                height={360}
                                                label={t('solution.gridLabel', {
                                                    label: part.label,
                                                })}
                                            />
                                        </>
                                    ) : (
                                        documentEditor(
                                            solutionHtml,
                                            (html) =>
                                                onUpdate((p) => ({ ...p, solution: { html } })),
                                            t('solution.docLabel', { label: part.label }),
                                            t('solution.docPlaceholder')
                                        )
                                    )}
                                </>
                            )}
                        </TabsContent>

                        <TabsContent value="scheme" className="pt-3">
                            {!secretEditable ? (
                                lockedNotice
                            ) : (
                                <CbeMarkingSchemeEditor
                                    lines={scheme}
                                    partMarks={part.marks}
                                    onChange={(lines: CbeMarkingLine[]) =>
                                        onUpdate((p) => ({ ...p, markingScheme: lines }))
                                    }
                                    onExtract={solutionSheet ? extractFromSolution : undefined}
                                />
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            )}

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('part.deleteTitle', { label: part.label || `#${index + 1}` })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>{t('part.deleteBody')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('part.deleteCancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-500"
                            onClick={() => {
                                setConfirmDelete(false);
                                onDelete();
                            }}
                        >
                            {t('part.deleteConfirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
