import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { computeToolCredits, useToolPricingQuery } from '@/services/ai-credits/get-ai-credits';
import type {
    AIPaperMarking,
    AIPaperSection,
} from '@/types/ai/generate-assessment/generate-complete-assessment';
import type { SectionMode } from '../-services/ai-center-service';

export interface PaperInfo {
    questionCount: number | null;
    estimatedCredits: number | null;
    pages: number | null;
    ocrPages: number;
    /** The paper's own sections (2+) and marking scheme, when it prints them. */
    sections?: AIPaperSection[];
    marking?: AIPaperMarking | null;
    durationMinutes?: number | null;
}

interface ExtractOptionsPanelProps {
    notes: string;
    setNotes: (value: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
    /** What the upload step found: question count and the exact credits (null while unknown). */
    paperInfo?: PaperInfo | null;
    /** Asked only when the paper has sections: one assessment section each, or all in one. */
    sectionMode?: SectionMode;
    setSectionMode?: (value: SectionMode) => void;
}

/** A typical paper, for the cost line shown before the real count is known. */
const TYPICAL_QUESTIONS = 30;

/**
 * What Vsmart Extract asks before reading a paper — which is almost nothing.
 *
 * The paper decides how many questions there are, of what type and how hard;
 * the tool's job is to read them all verbatim. The only input is optional
 * notes ("only Section B", "answers are in the margin"). The panel says what
 * will be captured and what it costs, so nobody expects a generator.
 */
export const ExtractOptionsPanel = ({
    notes,
    setNotes,
    onSubmit,
    disabled = false,
    paperInfo = null,
    sectionMode,
    setSectionMode,
}: ExtractOptionsPanelProps) => {
    const { t } = useTranslation('aiCenterExtractOptionsPanel');
    const { data: pricing } = useToolPricingQuery();
    const row = pricing?.tools?.find((r) => r.tool_key === 'extract_questions');
    const ocrRow = pricing?.tools?.find((r) => r.tool_key === 'extract_questions_ocr');
    const slabs = (row?.params?.slabs ?? null) as Array<{
        upto: number | null;
        credits: string | number;
    }> | null;
    const perQuestion = row ? Number(row.per_unit_credits) : null;
    const sections = paperInfo?.sections ?? [];
    const typical = computeToolCredits(row, { num_questions: TYPICAL_QUESTIONS });
    // "up to 20 → 1.5 · 21–50 → 3 · 51–100 → 4.5 · 100+ → 6.5"
    const bands = slabs
        ?.map((s, i) => {
            const from = i === 0 ? 1 : Number(slabs[i - 1]?.upto ?? 0) + 1;
            const label =
                s.upto == null
                    ? t('bandOpen', { from })
                    : i === 0
                      ? t('bandUpTo', { upto: s.upto })
                      : t('bandRange', { from, upto: s.upto });
            return `${label} → ${Number(s.credits)}`;
        })
        .join(' · ');

    return (
        <div className="flex flex-col gap-5 rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold text-gray-900">{t('title')}</h3>
                <p className="text-xs text-neutral-500">{t('subtitle')}</p>
            </div>

            {/* The exact bill, before the button: the paper was already read
                on upload, so the question count and the credits are known. */}
            {paperInfo && (
                <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-neutral-700">
                    {paperInfo.questionCount != null && paperInfo.estimatedCredits != null
                        ? t('found', {
                              questions: paperInfo.questionCount,
                              pages: paperInfo.pages ?? '?',
                              credits: paperInfo.estimatedCredits,
                          })
                        : t('foundScan', { pages: paperInfo.pages ?? '?' })}
                    {paperInfo.ocrPages > 0 && ' ' + t('foundOcr', { count: paperInfo.ocrPages })}
                    {paperInfo.marking?.marks != null &&
                        ' ' +
                            t('foundMarking', {
                                marks: paperInfo.marking.marks,
                                negative: paperInfo.marking.negative_marks ?? 0,
                            })}
                    {(paperInfo.durationMinutes ?? 0) > 0 &&
                        ' ' +
                            t('foundDuration', {
                                hrs: Math.floor(paperInfo.durationMinutes! / 60),
                                min: paperInfo.durationMinutes! % 60,
                            })}
                </div>
            )}

            {/* The paper has sections: the assessment can follow them or hold
                every question in one section. Asked here, before the credits
                are spent, because it changes what the preview builds. */}
            {sections.length >= 2 && setSectionMode && (
                <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 px-4 py-3">
                    <p className="text-sm font-medium text-neutral-700">
                        {t('sectionsQuestion', {
                            count: sections.length,
                            names: sections.map((s) => s.name).join(' · '),
                        })}
                    </p>
                    <RadioGroup
                        value={sectionMode ?? 'split'}
                        onValueChange={(value) => setSectionMode?.(value as SectionMode)}
                        className="gap-1.5"
                    >
                        <div className="flex items-start gap-2">
                            <RadioGroupItem
                                value="split"
                                id="extract-sections-split"
                                className="mt-0.5"
                            />
                            <Label
                                htmlFor="extract-sections-split"
                                className="text-xs font-normal text-neutral-600"
                            >
                                {t('sectionsSplit', { count: sections.length })}
                            </Label>
                        </div>
                        <div className="flex items-start gap-2">
                            <RadioGroupItem
                                value="single"
                                id="extract-sections-single"
                                className="mt-0.5"
                            />
                            <Label
                                htmlFor="extract-sections-single"
                                className="text-xs font-normal text-neutral-600"
                            >
                                {t('sectionsSingle')}
                            </Label>
                        </div>
                    </RadioGroup>
                </div>
            )}

            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(['questions', 'options', 'passages', 'key', 'solutions', 'marks'] as const).map(
                    (item) => (
                        <li key={item} className="flex items-start gap-2 text-xs text-neutral-600">
                            <CheckCircle
                                size={16}
                                weight="fill"
                                className="mt-px shrink-0 text-success-500"
                            />
                            {t(`captures.${item}`)}
                        </li>
                    )
                )}
            </ul>

            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-neutral-600" htmlFor="extract-notes">
                    {t('notesLabel')}
                </label>
                <Textarea
                    id="extract-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('notesPlaceholder')}
                    rows={2}
                    className="text-sm"
                />
            </div>

            <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                    type="button"
                    onClick={onSubmit}
                    disabled={disabled}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                    {t('cta')}
                    <ArrowRight size={16} weight="bold" />
                </button>
                {row && perQuestion != null && (
                    <p className="text-xs text-neutral-500">
                        {bands
                            ? t('costBands', { bands })
                            : t('cost', {
                                  base: Number(row.flat_base_credits),
                                  perQuestion,
                                  typical: typical ?? 0,
                                  typicalQuestions: TYPICAL_QUESTIONS,
                              })}
                        {ocrRow && Number(ocrRow.per_unit_credits) > 0 && (
                            <> {t('costOcr', { perPage: Number(ocrRow.per_unit_credits) })}</>
                        )}
                    </p>
                )}
            </div>
        </div>
    );
};
