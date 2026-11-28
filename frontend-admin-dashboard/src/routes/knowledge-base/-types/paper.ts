/** Question papers generated from a knowledge base — mirrors ai_service kb/paper.py. */

export type PaperQuestionType =
    | 'MCQS'
    | 'MCQM'
    | 'TRUE_FALSE'
    | 'ONE_WORD'
    | 'LONG_ANSWER'
    | 'NUMERIC'
    /** Stored as MCQS, with a source-grounded comprehension passage in its stem. */
    | 'PASSAGE'
    /** Stored as MCQS using the standard four Assertion–Reason alternatives. */
    | 'ASSERTION_REASON';
export type PaperDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface BlueprintRow {
    id: string;
    section: string;
    topic: string;
    /** Summary-tree anchors. A row with none of these cannot be generated. */
    node_ids: string[];
    page_start: number | null;
    page_end: number | null;
    question_type: PaperQuestionType;
    count: number;
    marks_each: number;
    difficulty: PaperDifficulty;
    instruction: string | null;
    total_marks: number;
}

export interface Blueprint {
    title: string;
    rows: BlueprintRow[];
    duration_minutes: number | null;
    instructions: string[];
    language: string | null;
    /** Coverage warnings from the planner — e.g. "chapter 4 has little numerical material". */
    notes: string[];
    total_questions: number;
    total_marks: number;
}

/** A topic in the KB's topic tree (the "outline" / mind map). */
export interface KbTopic {
    id: string;
    parent_id: string | null;
    level: 'topic' | 'subtopic';
    title: string;
    summary: string | null;
    keywords: string[];
    page_start: number | null;
    page_end: number | null;
    ordinal: number;
    subtopics?: KbTopic[];
}

/** One line of the teacher's question mix: "10 × MCQ, 1 mark each". */
export interface TypePlanEntry {
    /** Stable key of the subtype card that produced it (UI only). */
    key: string;
    question_type: PaperQuestionType;
    count: number;
    marks_each: number;
    /** Printed name, e.g. "Short answer". */
    label: string;
    /** Line printed under the section heading. */
    instruction?: string;
}

export interface PaperSpec {
    /** What a teacher actually asks for; marks follow from the blueprint. */
    total_questions?: number;
    total_marks?: number;
    duration_minutes?: number;
    difficulty?: string;
    question_types?: PaperQuestionType[];
    grade?: string;
    language?: string;
    exam_style?: string;
    /** Exam date as typed in the date field (YYYY-MM-DD); printed on the sheet. */
    exam_date?: string;
    /** The teacher's own title; blank lets the planner name the paper. */
    title?: string;
    /** Fixed mix in paper order. Counts and marks are enforced server-side. */
    type_plan?: Array<Omit<TypePlanEntry, 'key'>>;
    /** Share of questions per chapter/topic id, in percent. Guidance only. */
    weightage?: Record<string, number>;
    /** The teacher's own "General Instructions" lines; replace the planner's. */
    instructions?: string[];
    /** Draw a figure for questions that need one and the book lacks (slow, billed per image). */
    generate_diagrams?: boolean;
}

export interface CreditEstimate {
    tool_key: string;
    estimated_credits: number;
    current_balance: number | null;
    balance_after: number | null;
    sufficient: boolean | null;
}

export interface BlueprintResponse {
    blueprint: Blueprint;
    /** What generating THIS plan will cost — shown on the button before committing. */
    generation_estimate: CreditEstimate;
}

/** The rich-text wrapper assessment_service stores. */
export interface RichText {
    id?: string | null;
    type?: string | null;
    content?: string | null;
}

/** QuestionDTO — the shape the assessment builder and question bank consume. */
export interface PaperQuestion {
    preview_id?: string | null;
    text?: RichText | null;
    explanation_text?: RichText | null;
    question_type?: string | null;
    question_response_type?: string | null;
    access_level?: string | null;
    auto_evaluation_json?: string | null;
    /**
     * The paper's marking scheme as the AI evaluator's rubric
     * ({max_marks, rubric:[…]}). Passed through untouched on save so a
     * Manual Upload Exam is checked against the scheme the teacher reviewed.
     */
    evaluation_criteria_json?: string | null;
    options?: Array<{
        preview_id?: string | null;
        text?: RichText | null;
        explanation_text?: RichText | null;
    }>;
    tags?: string[];
    level?: string | null;
    /** KNOWLEDGE_BASE for anything generated here. Persisted by assessment_service V42. */
    source_type?: string | null;
    /**
     * JSON string: kb_id, generation_id, topic, node_ids, source_page, figures.
     * Kept as a string because that is what the question bank stores and returns.
     */
    source_meta?: string | null;
    [key: string]: unknown;
}

/** The raw generator output, kept alongside so the review board can show provenance. */
export interface RawPaperQuestion {
    question_number?: number;
    question?: { type?: string; content?: string };
    options?: Array<{ preview_id?: string; content?: string }>;
    correct_options?: string[];
    ans?: string;
    exp?: string;
    question_type?: string;
    level?: string;
    tags?: string[];
    source_page?: number;
    kb_meta?: {
        row_id?: string;
        section?: string;
        topic?: string;
        marks?: number;
        source_page?: number;
        figures?: Array<{ image_url: string; page_number: number | null; generated?: boolean }>;
        /** The writer asked for a figure and it was drawn (description). */
        diagram_generated?: string;
        /** The writer asked for a figure and none could be drawn (description). */
        diagram_missing?: string;
    };
}

export interface PaperIssue {
    question_number: number | null;
    severity: 'error' | 'warning';
    kind: string;
    message: string;
}

export interface PaperResult {
    blueprint: Blueprint;
    questions: PaperQuestion[];
    raw_questions: RawPaperQuestion[];
    issues: PaperIssue[];
    warnings: string[];
    delivered: number;
    planned: number;
}

export interface PaperJob {
    task_id: string;
    status: string;
    status_message: string | null;
    result: PaperResult | null;
}

/** A PDF of a paper published behind a public link. */
export interface PublishedPaperLink {
    variant: 'question_paper' | 'with_answer_key';
    /** Layout it was printed in (classic | compact | coaching). */
    theme?: string;
    title: string;
    /** Long public-bucket URL; always present. */
    file_url: string;
    /** u.vacademy.io/s/… when media_service could make one. */
    short_url: string | null;
    /** What to hand out: the short link when there is one. */
    url: string;
    size_bytes: number;
    published_at: string;
}

/** One artifact created from a knowledge base — a paper today, a course later. */
export type ArtifactType =
    | 'QUESTION_PAPER'
    | 'COURSE'
    | 'PRESENTATION'
    | 'QUIZ'
    | 'ASSESSMENT'
    | 'NOTES'
    | 'SUMMARY'
    | 'LESSON_PLAN'
    | 'WORKSHEET';

export type GenerationStatus = 'DRAFT' | 'GENERATING' | 'READY' | 'SAVED' | 'FAILED';

export interface KbGeneration {
    id: string;
    knowledge_base_id: string;
    artifact_type: ArtifactType;
    title: string;
    status: GenerationStatus;
    progress: number;
    external_id: string | null;
    external_type: string | null;
    ai_task_id: string | null;
    items_planned: number;
    items_delivered: number;
    credits_charged: number;
    error_message: string | null;
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
    /** Links already published for this paper, keyed by variant. */
    published?: Partial<Record<PublishedPaperLink['variant'], PublishedPaperLink>>;
}

/** The single-record read: adds the payloads Resume needs. */
export interface KbGenerationDetail extends KbGeneration {
    input: { blueprint?: Blueprint; grade?: string; [k: string]: unknown };
    result: PaperResult | null;
}
