import { AccessControlFormSchema } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/access-control-form-schema';
import testAccessSchema from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/add-participants-schema';
import { BasicInfoFormSchema } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/basic-info-form-schema';
import sectionDetailsSchema from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/section-details-schema';
import { z } from 'zod';

export type BasicSectionFormType = z.infer<typeof BasicInfoFormSchema>;
export type SectionFormType = z.infer<typeof sectionDetailsSchema>;
export type TestAccessFormType = z.infer<typeof testAccessSchema>;
export type AccessControlFormValues = z.infer<typeof AccessControlFormSchema>;

export interface Section {
    id: string;
    name: string;
    description: { id: string; type: string; content: string } | null;
    section_type: string | null;
    duration: number;
    total_marks: number;
    cutoff_marks: number;
    section_order: number;
    problem_randomization: boolean | null | string;
    created_at: string; // ISO date string
    updated_at: string; // ISO date string
}

export interface SectionsResponse {
    sections: Section[];
}

interface Question {
    id: string;
    type: string;
    content: string;
}

export interface QuestionData {
    question_id: string;
    question: Question;
    section_id: string;
    question_duration: number;
    question_order: number;
    marking_json: string; // Serialized JSON string
    evaluation_criteria_json: string | null;
    criteria_template_id: string | null;
    question_type: string;
    evaluation_json?: string | null;
    // questions-of-sections fills options_with_explanation; `options` stays empty.
    options?: Array<{ id?: string | null; text?: { content?: string | null } | null }>;
    options_with_explanation?: Array<{
        id?: string | null;
        text?: { content?: string | null } | null;
    }>;
}

export type QuestionDataObject = Record<string, QuestionData[]>;
