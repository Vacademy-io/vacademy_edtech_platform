'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
    Gear as Settings,
    UploadSimple as Upload,
    CaretLeft as ChevronLeft,
    CaretRight as ChevronRight,
    CircleNotch as Loader2,
    Trash as Trash2,
} from '@phosphor-icons/react';
import { PaperSet } from './preview/paper-set';
import { ExportHandler } from './preview/export-handler';
import { ExportSettingsDialog } from './dialog/export-settings-dialog';
import { ExportSettingsProvider, useExportSettings } from './contexts/export-settings-context';
import { Toaster as Sonner } from 'sonner';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import {
    getFullQuestionsOfSections,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { Question } from './types/question';
// eslint-disable-next-line
import { Instructions, Section, Steps } from "@/types/assessments/assessment-data-type";
import { parseHtmlToString } from './utils/utils';
import { omrSetNumber, orderSectionsForOmrSet, type OmrPaperOrder } from './utils/omr-set-order';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

function shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = newArray[i] as T;
        newArray[i] = newArray[j] as T;
        newArray[j] = temp;
    }
    return newArray;
}

function PreviewWithSettings({
    assessmentId,
    sectionIds,

    allSections,
    assessmentDetails,
    omrPaper,
}: {
    assessmentId: string;
    sectionIds: string[];

    allSections: Section[];
    assessmentDetails: Steps;
    /** A saved OMR set: print exactly that set, in its saved question and option order. */
    omrPaper?: OmrPaperOrder;
}) {
    const [showSettings, setShowSettings] = useState(false);
    const [currentSetIndex, setCurrentSetIndex] = useState(0);
    const { settings, updateSettings } = useExportSettings();
    const { data: questionData, isLoading } = useSuspenseQuery(
        getQuestionDataForSection({ assessmentId, sectionIds: sectionIds.join(',') })
    );
    // The preview shape above has no explanation; the full DTOs do. Optional, so a
    // failure here only drops explanations from the answer key.
    const { data: fullQuestions } = useQuery({
        queryKey: ['GET_FULL_QUESTIONS_OF_SECTIONS', assessmentId, sectionIds.join(',')],
        queryFn: () =>
            getFullQuestionsOfSections({ assessmentId, sectionIds: sectionIds.join(',') }),
    });
    const explanationById = useMemo(() => {
        const map: Record<string, string> = {};
        Object.values(fullQuestions ?? {})
            .flat()
            .forEach((q) => {
                const content = q.explanation_text?.content || q.explanation_text_data?.content;
                if (q.id && content) map[q.id] = content;
            });
        return map;
    }, [fullQuestions]);

    // Determine padding based on settings
    const getPadding = () => {
        switch (settings.pagePadding) {
            case 'low':
                return '10mm';
            case 'high':
                return '30mm';
            default:
                return '20mm'; // medium
        }
    };

    // Transform questions into sections
    const sections = useMemo(() => {
        return Object.entries(questionData).map(([sectionId, questions]) => ({
            id: sectionId,
            title: allSections.find((section) => section.id === sectionId)?.name || '',
            description: parseHtmlToString(
                allSections.find((section) => section.id === sectionId)?.description?.content ?? ''
            ),
            totalMarks: allSections.find((section) => section.id === sectionId)?.total_marks || 0,
            duration: allSections.find((section) => section.id === sectionId)?.duration || 0,
            questions: (settings.randomizeQuestions && !omrPaper
                ? shuffleArray(questions as Question[])
                : (questions as Question[])
            ).map((q) => ({ ...q, explanation_text: explanationById[q.question_id] })),
        }));
    }, [settings.randomizeQuestions, explanationById, omrPaper]);

    // Generate paper sets. An OMR set is exactly one set in its saved order (never
    // the random shuffle below): its answer key and bubble sheet depend on it.
    const paperSets = useMemo(() => {
        if (omrPaper) {
            return [
                {
                    setNumber: omrSetNumber(omrPaper.set_code),
                    sections: orderSectionsForOmrSet(sections, omrPaper),
                },
            ];
        }
        return Array.from({ length: settings.questionPaperSets }, (_, i) => ({
            setNumber: i,
            sections: settings.randomizeQuestions
                ? sections.map((section) => ({
                      ...section,
                      questions: shuffleArray(section.questions as Question[]),
                  }))
                : sections,
        }));
    }, [sections, settings.questionPaperSets, settings.randomizeQuestions, omrPaper]);

    const handleNextSet = () => {
        if (currentSetIndex < paperSets.length - 1) {
            setCurrentSetIndex(currentSetIndex + 1);
        }
    };

    const handlePreviousSet = () => {
        if (currentSetIndex > 0) {
            setCurrentSetIndex(currentSetIndex - 1);
        }
    };

    const currentPaperSet = paperSets[currentSetIndex];
    const paperTitle = assessmentDetails[0]?.saved_data?.name;
    const paperDuration = assessmentDetails[0]?.saved_data?.duration;
    const paperInstructions =
        assessmentDetails[0]?.saved_data?.instructions ??
        assessmentDetails[1]?.saved_data?.instructions;

    const handleLetterheadUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const imageDataUrl = reader.result as string;
                updateSettings({
                    customLetterheadImage: imageDataUrl,
                });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleDeleteLetterhead = () => {
        updateSettings({
            customLetterheadImage: undefined,
        });
    };

    if (isLoading) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="flex w-80 flex-col items-center gap-4 rounded-lg bg-white p-6 shadow-xl">
                    <Loader2 className="size-12 animate-spin text-primary-500" />
                    <h2 className="text-lg font-semibold">Generating Preview</h2>
                    <p className="text-sm text-muted-foreground">
                        Fetching questions and preparing paper...
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen min-w-full bg-slate-50/50" style={{ boxSizing: 'border-box' }}>
            <style>{`
                .page {
                    width: 210mm;
                    min-height: 297mm;
                    padding: ${getPadding()};
                    padding-bottom:  2mm;
                    margin: 0 auto;
                    border: 1px #d3d3d3 solid; /* design-lint-ignore: print-page CSS for the PDF capture, no Tailwind here */
                    border-radius: 5px;
                    line-height: 1.5;
                    background: white;
                    box-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
                }
            `}</style>

            <div className="no-print sticky top-0 z-10 border-b bg-white">
                <div className="flex items-center justify-between p-4">
                    <Button
                        variant="outline"
                        onClick={() => setShowSettings(true)}
                        className="gap-2"
                    >
                        <Settings className="size-4" />
                        Export Settings
                    </Button>

                    {omrPaper && (
                        <span className="text-sm font-medium">
                            OMR Set {omrPaper.set_code} · saved order
                        </span>
                    )}
                    {paperSets.length > 1 && (
                        <div className="flex items-center gap-4">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={handlePreviousSet}
                                disabled={currentSetIndex === 0}
                            >
                                <ChevronLeft className="size-4" />
                            </Button>
                            <span className="text-sm font-medium">
                                Set {currentSetIndex + 1} of {paperSets.length}
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={handleNextSet}
                                disabled={currentSetIndex === paperSets.length - 1}
                            >
                                <ChevronRight className="size-4" />
                            </Button>
                        </div>
                    )}
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Switch
                                id="export-answer-key"
                                checked={settings.exportSolutionKey}
                                onCheckedChange={(checked) =>
                                    updateSettings({ exportSolutionKey: checked })
                                }
                            />
                            <Label htmlFor="export-answer-key">With answer key</Label>
                        </div>
                        <input
                            type="file"
                            id="letterhead-upload"
                            accept="image/*"
                            className="hidden"
                            onChange={handleLetterheadUpload}
                        />
                        {settings.showInstitutionLetterhead && (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() =>
                                        document.getElementById('letterhead-upload')?.click()
                                    }
                                >
                                    <Upload />
                                    Letterhead
                                </Button>
                                {settings.customLetterheadImage && (
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        onClick={handleDeleteLetterhead}
                                        title="Delete Letterhead"
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                )}
                            </div>
                        )}
                        <ExportHandler
                            // @ts-expect-error:Type 'undefined' is not assignable to type 'Section[]'.
                            sections={currentPaperSet?.sections}
                            settings={settings}
                            title={paperTitle}
                            durationMins={paperDuration}
                            instructions={paperInstructions}
                            {...(paperSets.length > 1 || omrPaper
                                ? { setNumber: currentPaperSet?.setNumber }
                                : {})}
                        />
                    </div>
                </div>
            </div>

            {showSettings && (
                <ExportSettingsDialog
                    open={showSettings}
                    onOpenChange={setShowSettings}
                    sections={sections}
                    lockedSetCode={omrPaper?.set_code}
                />
            )}

            <div className="container mx-auto py-4">
                <PaperSet
                    sections={currentPaperSet?.sections ?? []}
                    settings={settings}
                    setNumber={currentPaperSet?.setNumber ?? 0}
                    title={paperTitle}
                    durationMins={paperDuration}
                    instructions={paperInstructions}
                />
            </div>
            <Sonner />
        </div>
    );
}

export default function PreviewAndExport({
    assessmentId,
    sectionIds,
    sections,
    assessmentDetails,
    omrPaper,
    omrAnswerKey = false,
}: {
    assessmentId: string;
    sectionIds: string[];

    sections: Section[];
    assessmentDetails: Steps;
    /** Print one saved OMR set (question + option order from the backend) instead of random sets. */
    omrPaper?: OmrPaperOrder;
    /** With omrPaper: open on the answer key, lettered as the set's bubble sheet. */
    omrAnswerKey?: boolean;
}) {
    return (
        <ExportSettingsProvider
            initialSettings={
                omrPaper
                    ? {
                          questionPaperSets: 1,
                          randomizeQuestions: false,
                          randomizeOptions: false,
                          includeQuestionSetCode: true,
                          exportSolutionKey: omrAnswerKey,
                      }
                    : undefined
            }
        >
            <PreviewWithSettings
                assessmentId={assessmentId}
                sectionIds={sectionIds}
                allSections={sections}
                assessmentDetails={assessmentDetails}
                omrPaper={omrPaper}
            />
        </ExportSettingsProvider>
    );
}
