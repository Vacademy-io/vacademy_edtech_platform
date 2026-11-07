'use client';

import { createContext, useContext, useState } from 'react';
import { CustomField } from '../types/question';
import { HeaderSettings, defaultHeaderSettings } from '../types/header-settings';

const DEFAULT_FIELDS: CustomField[] = [
    { label: 'Name', enabled: true, type: 'blank' },
    { label: 'Roll Number', enabled: true, type: 'blank' },
    { label: 'Exam Centre Number', enabled: true, type: 'blank' },
    { label: 'Exam Centre Name', enabled: true, type: 'blank' },
    { label: 'Candidate Signature', enabled: true, type: 'blank' },
    { label: "Invigilator's Signature", enabled: true, type: 'blank' },
];
export interface ExportSettings {
    exportQuestionPaper: boolean;
    exportSolutionKey: boolean;
    exportFormat: 'pdf' | 'docx';
    columnsPerPage: number;
    questionsPerPage: number;
    showInstitutionLetterhead: boolean;
    showAdaptiveMarkingRules: boolean;
    showSectionInstructions: boolean;
    showSectionDuration: boolean;
    showMarksPerQuestion: boolean;
    showAdaptiveMarkingRulesSection: boolean;
    showCheckboxesBeforeOptions: boolean;
    spaceForRoughWork: 'none' | 'bottom' | 'right';
    questionPaperSets: number;
    includeQuestionSetCode: boolean;
    randomizeQuestions: boolean;
    randomizeOptions: boolean;
    showPageNumbers: boolean;
    pageNumbersPosition: 'left' | 'center' | 'right';
    includeCustomInputFields: boolean;
    customFields: CustomField[];
    pagePadding: 'low' | 'medium' | 'high';
    fontSize: 'small' | 'medium' | 'large';
    roughWorkSize: 'small' | 'medium' | 'large';
    customLetterheadImage?: string;
    showFirstPageInstructions: boolean;
    customImageSizes: { [imageUrl: string]: { width: number; height: number } };
    answerSpacings: { [questionId: string]: number };
    maintainImageAspectRatio: boolean;
    headerSettings: HeaderSettings;
}

const defaultSettings: ExportSettings = {
    exportQuestionPaper: true,
    exportSolutionKey: false,
    exportFormat: 'pdf',
    columnsPerPage: 1,
    questionsPerPage: 3,
    showInstitutionLetterhead: true,
    showAdaptiveMarkingRules: true,
    showSectionInstructions: true,
    showSectionDuration: true,
    showMarksPerQuestion: true,
    showAdaptiveMarkingRulesSection: true,
    showCheckboxesBeforeOptions: true,
    spaceForRoughWork: 'none',
    questionPaperSets: 1,
    includeQuestionSetCode: true,
    randomizeQuestions: false,
    randomizeOptions: false,
    showPageNumbers: true,
    pageNumbersPosition: 'right',
    includeCustomInputFields: true,
    pagePadding: 'medium',
    customFields: DEFAULT_FIELDS,
    fontSize: 'medium',
    roughWorkSize: 'medium',
    customLetterheadImage: undefined,
    showFirstPageInstructions: true,
    customImageSizes: {},
    answerSpacings: {},
    maintainImageAspectRatio: false,
    headerSettings: defaultHeaderSettings,
};

const ExportSettingsContext = createContext<{
    settings: ExportSettings;
    updateSettings: (settings: Partial<ExportSettings>) => void;
}>({
    settings: defaultSettings,
    updateSettings: () => {},
});

export function ExportSettingsProvider({
    children,
    initialSettings,
}: {
    children: React.ReactNode;
    /** Overrides applied on first render only (e.g. an OMR set's fixed single set + answer key). */
    initialSettings?: Partial<ExportSettings>;
}) {
    const [settings, setSettings] = useState<ExportSettings>(() => ({
        ...defaultSettings,
        ...initialSettings,
    }));

    const updateSettings = (newSettings: Partial<ExportSettings>) => {
        console.log('settings updated ');
        setSettings((prev) => ({ ...prev, ...newSettings }));
    };

    return (
        <ExportSettingsContext.Provider value={{ settings, updateSettings }}>
            {children}
        </ExportSettingsContext.Provider>
    );
}

export const useExportSettings = () => useContext(ExportSettingsContext);
