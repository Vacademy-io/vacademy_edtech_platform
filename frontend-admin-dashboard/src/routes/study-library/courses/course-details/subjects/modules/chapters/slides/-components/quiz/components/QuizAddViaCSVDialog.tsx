import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { FileCsv, FileXls, DownloadSimple, UploadSimple, X } from '@phosphor-icons/react';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import * as XLSX from 'xlsx';

interface QuizAddViaCSVDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onQuestionsReady: (questions: UploadQuestionPaperFormType['questions']) => void;
}

const CSV_TEMPLATE_HEADER =
    'question_text,question_type,option_a,option_b,option_c,option_d,correct_answer,explanation';

const CSV_SAMPLE_ROWS = [
    'What is 2 + 2?,MCQS,1,2,4,8,C,2 + 2 equals 4 by basic arithmetic.',
    'Is the Earth flat?,TRUE_FALSE,True,False,,,B,The Earth is an oblate spheroid.',
    'Which planet is closest to the Sun?,MCQS,Venus,Mercury,Mars,Earth,B,Mercury is the closest planet to the Sun.',
    'Which of these are prime numbers?,MCQM,2,3,4,6,"A,B",Both 2 and 3 are prime numbers.',
    'Which are primary colours?,,Red,Green,Blue,Orange,"A,B,C","Red, green and blue are all primary colours."',
];

const EXCEL_TEMPLATE_HEADERS = [
    'question_text',
    'question_type',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'correct_answer',
    'explanation',
];

const EXCEL_TEMPLATE_DATA = [
    ['What is 2 + 2?', 'MCQS', '1', '2', '4', '8', 'C', '2 + 2 equals 4 by basic arithmetic.'],
    [
        'Is the Earth flat?',
        'TRUE_FALSE',
        'True',
        'False',
        '',
        '',
        'B',
        'The Earth is an oblate spheroid.',
    ],
    [
        'Which planet is closest to the Sun?',
        'MCQS',
        'Venus',
        'Mercury',
        'Mars',
        'Earth',
        'B',
        'Mercury is the closest planet to the Sun.',
    ],
    [
        'Which of these are prime numbers?',
        'MCQM',
        '2',
        '3',
        '4',
        '6',
        'A,B',
        'Both 2 and 3 are prime numbers.',
    ],
    [
        'Which are primary colours?',
        '',
        'Red',
        'Green',
        'Blue',
        'Orange',
        'A,B,C',
        'Red, green and blue are primary colours.',
    ],
];

const OPTION_HEADER_REGEX = /^option_([a-z])$/;

// correct_answer may list several letters: "A,C" / "A;C" / "A|C" / "A C"
const ANSWER_SEPARATOR_REGEX = /[,;|/\s]+/;

interface ParseError {
    row: number;
    message: string;
}

const QuizAddViaCSVDialog = ({
    open,
    onOpenChange,
    onQuestionsReady,
}: QuizAddViaCSVDialogProps) => {
    const { t } = useTranslation('studyLibraryQuizAddViaCSVDialog');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
    const [parsedCount, setParsedCount] = useState<number | null>(null);

    const handleDownloadCSVTemplate = () => {
        const content = [CSV_TEMPLATE_HEADER, ...CSV_SAMPLE_ROWS].join('\n');
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'quiz_questions_template.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadExcelTemplate = () => {
        const ws = XLSX.utils.aoa_to_sheet([EXCEL_TEMPLATE_HEADERS, ...EXCEL_TEMPLATE_DATA]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Questions');
        XLSX.writeFile(wb, 'quiz_questions_template.xlsx');
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setParseErrors([]);
            setParsedCount(null);
        }
    };

    const isExcelFile = (file: File): boolean => {
        return file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    };

    const parseExcel = async (file: File): Promise<string[][]> => {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]!]!;
        const rows: string[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
        return rows.map((row) => row.map((cell) => String(cell).trim()));
    };

    // Quote-aware CSV parser — a quoted field may itself contain commas ("A,C" for
    // multi-correct answers) or line breaks, so we cannot simply split on ','.
    const parseCSVText = (text: string): string[][] => {
        const rows: string[][] = [];
        let row: string[] = [];
        let field = '';
        let inQuotes = false;

        const pushField = () => {
            row.push(field.trim());
            field = '';
        };
        const pushRow = () => {
            pushField();
            if (row.some((c) => c !== '')) rows.push(row);
            row = [];
        };

        for (let i = 0; i < text.length; i++) {
            const ch = text[i]!;

            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') {
                        field += '"'; // escaped quote
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field += ch;
                }
                continue;
            }

            if (ch === '"' && field.trim() === '') {
                inQuotes = true;
                field = '';
            } else if (ch === ',') {
                pushField();
            } else if (ch === '\n') {
                pushRow();
            } else if (ch !== '\r') {
                field += ch;
            }
        }

        if (field !== '' || row.length > 0) pushRow();
        return rows;
    };

    // Recovery for hand-written CSVs where the multi-answer cell was left unquoted
    // (…,option_d,A,C,explanation). The row then has more cells than the header, and the
    // surplus cells sitting right after correct_answer are all bare option letters.
    const mergeUnquotedAnswerCells = (
        cols: string[],
        headerLength: number,
        correctIdx: number,
        validLetters: string[]
    ): string[] => {
        const surplus = cols.length - headerLength;
        if (surplus <= 0) return cols;

        const slice = cols.slice(correctIdx, correctIdx + surplus + 1);
        const isBareLetter = (v: string) => validLetters.includes((v || '').trim().toUpperCase());
        if (slice.length !== surplus + 1 || !slice.every(isBareLetter)) return cols;

        return [
            ...cols.slice(0, correctIdx),
            slice.map((v) => v.trim()).join(','),
            ...cols.slice(correctIdx + surplus + 1),
        ];
    };

    const parseRows = (
        rows: string[][]
    ): { questions: UploadQuestionPaperFormType['questions']; errors: ParseError[] } => {
        const questions: UploadQuestionPaperFormType['questions'] = [];
        const errors: ParseError[] = [];

        if (rows.length === 0) {
            return { questions, errors: [{ row: 0, message: t('errors.fileEmpty') }] };
        }

        const headerRow = rows[0]!.map((h) => h.trim().toLowerCase());
        const headerIndex: Record<string, number> = {};
        headerRow.forEach((h, i) => {
            if (h && headerIndex[h] === undefined) headerIndex[h] = i;
        });

        const qTextIdx = headerIndex['question_text'];
        const qTypeIdx = headerIndex['question_type'];
        const correctIdx = headerIndex['correct_answer'];
        const explIdx = headerIndex['explanation'];

        const missing: string[] = [];
        if (qTextIdx === undefined) missing.push('question_text');
        if (qTypeIdx === undefined) missing.push('question_type');
        if (correctIdx === undefined) missing.push('correct_answer');
        if (missing.length > 0) {
            return {
                questions,
                errors: [
                    {
                        row: 1,
                        message: t('errors.missingColumns', { columns: missing.join(', ') }),
                    },
                ],
            };
        }

        const optionColumns: { letter: string; index: number }[] = [];
        headerRow.forEach((h, i) => {
            const m = h.match(OPTION_HEADER_REGEX);
            if (m) optionColumns.push({ letter: m[1]!.toUpperCase(), index: i });
        });
        optionColumns.sort((a, b) => a.letter.localeCompare(b.letter));

        if (optionColumns.length === 0) {
            return {
                questions,
                errors: [
                    {
                        row: 1,
                        message: t('errors.noOptionColumns'),
                    },
                ],
            };
        }

        const validLetters = optionColumns.map((c) => c.letter);
        const correctAnswerMap: Record<string, number> = {};
        validLetters.forEach((letter, i) => {
            correctAnswerMap[letter] = i;
        });

        for (let i = 1; i < rows.length; i++) {
            const rowNum = i + 1; // 1-based for display
            const cols = mergeUnquotedAnswerCells(
                rows[i]!,
                headerRow.length,
                correctIdx!,
                validLetters
            );

            // Skip fully empty rows
            if (cols.every((c) => !c)) continue;

            const questionText = (cols[qTextIdx!] || '').trim();
            const declaredType = (cols[qTypeIdx!] || '').trim().toUpperCase();
            const correctAnswerRaw = (cols[correctIdx!] || '').trim();
            const explanation = explIdx !== undefined ? (cols[explIdx] || '').trim() : '';

            if (!questionText) {
                errors.push({ row: rowNum, message: t('errors.questionTextEmpty') });
                continue;
            }

            // "A,C" (or "A;C" / "A|C" / "A C") means several correct options.
            const answerLetters = [
                ...new Set(
                    correctAnswerRaw
                        .split(ANSWER_SEPARATOR_REGEX)
                        .map((token) => token.trim().toUpperCase())
                        .filter(Boolean)
                ),
            ];

            // question_type may be left blank — infer it from how many answers were given.
            // An explicit MCQS with several correct answers is upgraded to MCQM.
            let questionType = declaredType;
            if (!questionType) {
                questionType = answerLetters.length > 1 ? 'MCQM' : 'MCQS';
            } else if (questionType === 'MCQS' && answerLetters.length > 1) {
                questionType = 'MCQM';
            }

            if (
                questionType !== 'MCQS' &&
                questionType !== 'MCQM' &&
                questionType !== 'TRUE_FALSE'
            ) {
                errors.push({
                    row: rowNum,
                    message: t('errors.unsupportedQuestionType', {
                        type: (cols[qTypeIdx!] || '').trim(),
                    }),
                });
                continue;
            }

            if (questionType === 'MCQS' || questionType === 'MCQM') {
                const invalidLetters = answerLetters.filter(
                    (l) => correctAnswerMap[l] === undefined
                );
                if (answerLetters.length === 0 || invalidLetters.length > 0) {
                    errors.push({
                        row: rowNum,
                        message: t('errors.invalidCorrectAnswer', {
                            value: correctAnswerRaw,
                            letters: validLetters.join(', '),
                        }),
                    });
                    continue;
                }

                const answerIndexes = answerLetters
                    .map((l) => correctAnswerMap[l]!)
                    .sort((a, b) => a - b);

                const rawOptions = optionColumns.map((c) => (cols[c.index] || '').trim());

                const emptyAnswerLetters = answerIndexes
                    .filter((idx) => !rawOptions[idx])
                    .map((idx) => validLetters[idx]!);
                if (emptyAnswerLetters.length > 0) {
                    const emptyColumns = emptyAnswerLetters
                        .map((l) => `option_${l.toLowerCase()}`)
                        .join(', ');
                    errors.push({
                        row: rowNum,
                        message: t('errors.referencedOptionsEmpty', {
                            count: emptyAnswerLetters.length,
                            letters: emptyAnswerLetters.join(', '),
                            columns: emptyColumns,
                        }),
                    });
                    continue;
                }

                const options = rawOptions
                    .map((name, idx) => ({ id: '', name, isSelected: answerIndexes.includes(idx) }))
                    .filter((opt) => opt.name !== '');

                if (options.length < 2) {
                    errors.push({
                        row: rowNum,
                        message: t('errors.needsAtLeastTwoOptions', { questionType }),
                    });
                    continue;
                }

                // Indexes must be re-derived after empty option columns are dropped.
                const validAnswers = options
                    .map((opt, idx) => (opt.isSelected ? idx : -1))
                    .filter((idx) => idx >= 0);

                questions.push({
                    questionName: questionText,
                    questionType,
                    questionMark: '1',
                    questionPenalty: '0',
                    questionDuration: { hrs: '0', min: '0' },
                    explanation,
                    tags: [],
                    canSkip: false,
                    validAnswers,
                    parentRichTextContent: '',
                    subjectiveAnswerText: '',
                    decimals: 0,
                    numericType: '',
                    ...(questionType === 'MCQM'
                        ? { multipleChoiceOptions: options }
                        : { singleChoiceOptions: options }),
                });
            } else {
                // TRUE_FALSE — exactly one answer, no multi-correct upgrade.
                const correctAnswer = answerLetters.length === 1 ? answerLetters[0]! : '';
                if (correctAnswer !== 'A' && correctAnswer !== 'B') {
                    errors.push({
                        row: rowNum,
                        message: t('errors.invalidTrueFalseAnswer', { value: correctAnswerRaw }),
                    });
                    continue;
                }
                const isTrue = correctAnswer === 'A';
                questions.push({
                    questionName: questionText,
                    questionType: 'TRUE_FALSE',
                    questionMark: '1',
                    questionPenalty: '0',
                    questionDuration: { hrs: '0', min: '0' },
                    explanation,
                    tags: [],
                    canSkip: false,
                    validAnswers: [isTrue ? 0 : 1],
                    parentRichTextContent: '',
                    subjectiveAnswerText: '',
                    decimals: 0,
                    numericType: '',
                    trueFalseOptions: [
                        { id: '', name: 'True', isSelected: isTrue },
                        { id: '', name: 'False', isSelected: !isTrue },
                    ],
                });
            }
        }

        return { questions, errors };
    };

    const handleUpload = async () => {
        if (!selectedFile) return;

        let rows: string[][];

        if (isExcelFile(selectedFile)) {
            rows = await parseExcel(selectedFile);
        } else {
            const text = await selectedFile.text();
            rows = parseCSVText(text);
        }

        const { questions, errors } = parseRows(rows);
        setParseErrors(errors);
        setParsedCount(questions.length);

        if (questions.length > 0) {
            onQuestionsReady(questions);
            if (errors.length === 0) {
                handleReset();
                onOpenChange(false);
            }
        }
    };

    const handleReset = () => {
        setSelectedFile(null);
        setParseErrors([]);
        setParsedCount(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleClose = (nextOpen: boolean) => {
        if (!nextOpen) handleReset();
        onOpenChange(nextOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="no-scrollbar !m-0 flex h-auto !w-full !max-w-lg flex-col !gap-0 overflow-y-auto !rounded-lg !p-0">
                {/* Header */}
                <div className="flex items-center justify-between bg-primary-50 px-5 py-4">
                    <h1 className="font-semibold text-primary-500">{t('uploadQuestions')}</h1>
                    <button
                        type="button"
                        className="text-neutral-500 hover:text-neutral-700"
                        onClick={() => onOpenChange(false)}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex flex-col gap-5 p-5">
                    {/* Template downloads */}
                    <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                        <div>
                            <p className="text-sm font-medium text-neutral-700">
                                {t('downloadTemplate')}
                            </p>
                            <p className="text-xs text-neutral-500">
                                {t('supportedQuestionTypes')}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                onClick={handleDownloadCSVTemplate}
                            >
                                <DownloadSimple size={14} />
                                {t('csv')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                onClick={handleDownloadExcelTemplate}
                            >
                                <DownloadSimple size={14} />
                                {t('excel')}
                            </MyButton>
                        </div>
                    </div>

                    {/* Column reference */}
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-600">
                        <p className="mb-1 font-medium">{t('columnsLabel')}</p>
                        <code className="block text-neutral-500">
                            question_text, question_type, option_a, option_b, option_c, option_d,
                            correct_answer, explanation
                        </code>
                        <p className="mt-2 text-neutral-400">{t('columnsHelp')}</p>
                        <p className="mt-2 text-neutral-400">
                            <span className="font-medium text-neutral-500">
                                {t('multipleCorrectAnswersLabel')}
                            </span>{' '}
                            {t('multipleCorrectAnswersHelpBefore')}{' '}
                            <code className="text-neutral-500">&quot;A,C&quot;</code>{' '}
                            {t('multipleCorrectAnswersHelpAfter')}
                        </p>
                    </div>

                    {/* File drop zone */}
                    <div
                        className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-8 transition-colors hover:border-primary-400 hover:bg-primary-50"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div className="flex gap-2">
                            <FileCsv size={36} className="text-primary-400" />
                            <FileXls size={36} className="text-green-500" />
                        </div>
                        {selectedFile ? (
                            <div className="text-center">
                                <p className="text-sm font-medium text-primary-600">
                                    {selectedFile.name}
                                </p>
                                <p className="text-xs text-neutral-500">
                                    {(selectedFile.size / 1024).toFixed(1)} KB
                                </p>
                            </div>
                        ) : (
                            <div className="text-center">
                                <p className="text-sm font-medium text-neutral-700">
                                    {t('clickToSelectFile')}
                                </p>
                                <p className="text-xs text-neutral-400">
                                    {t('supportedFileTypes')}
                                </p>
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                    </div>

                    {/* Parse summary */}
                    {parsedCount !== null && parsedCount > 0 && parseErrors.length > 0 && (
                        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2">
                            <p className="text-sm font-medium text-yellow-700">
                                {t('parseSummary.added', { count: parsedCount })}{' '}
                                {t('parseSummary.skipped', { count: parseErrors.length })}
                            </p>
                        </div>
                    )}

                    {/* Parse errors */}
                    {parseErrors.length > 0 && (
                        <div className="max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 px-3 py-2">
                            <p className="mb-1 text-sm font-medium text-red-700">
                                {t('parseErrorsHeading', { count: parseErrors.length })}
                            </p>
                            {parseErrors.map((err, i) => (
                                <p key={i} className="text-xs text-red-600">
                                    {t('rowError', { row: err.row, message: err.message })}
                                </p>
                            ))}
                            {parsedCount !== null && parsedCount === 0 && (
                                <p className="mt-1 text-xs font-medium text-red-700">
                                    {t('noValidQuestionsFound')}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 border-t border-neutral-200 px-5 py-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={handleUpload}
                        disabled={!selectedFile}
                    >
                        <UploadSimple size={16} />
                        {t('parseAndPreview')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default QuizAddViaCSVDialog;
