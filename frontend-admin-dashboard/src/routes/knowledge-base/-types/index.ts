/** Knowledge Base types — mirror of the ai_service V435 schema. */

export type KbPurpose = 'general' | 'teaching' | 'question_bank' | 'institute_info';
export type KbOwnerType = 'INSTITUTE' | 'PLATFORM';
export type KbStatus = 'ACTIVE' | 'ARCHIVED';

export type SourceKind = 'PDF' | 'URL' | 'YOUTUBE' | 'TEXT';
export type SourceStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'PARTIAL' | 'FAILED';

export interface KbStats {
    sources?: number;
    pages?: number;
    chunks?: number;
    figures?: number;
}

export interface KnowledgeBase {
    id: string;
    institute_id: string;
    name: string;
    description: string | null;
    purpose: KbPurpose;
    language_hint: string | null;
    owner_type: KbOwnerType;
    embedding_model: string;
    embedding_dim: number;
    status: KbStatus;
    stats: KbStats;
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
    source_count: number;
    /** Sources still parsing/embedding — drives the "working on it" state. */
    processing_count: number;
    /** Pages the parser flagged as unreliable, summed across sources. */
    review_pages: number;
    /** Present on the detail response; PLATFORM libraries are read-only. */
    writable?: boolean;
    sources?: KnowledgeSource[];
    /** Free-form per-base metadata (V517), e.g. topic_tree_mode. */
    meta?: Record<string, unknown>;
    /**
     * Set only for pre-loaded curriculum libraries (NCERT etc.). Access to
     * these is granted by the institute's CURRICULUM_LIBRARY_SETTING, not by
     * an unlock; the picker groups them Board → Class → Subject.
     */
    curriculum?: CurriculumFacets | null;
}

export interface CurriculumFacets {
    board: string;
    /** Class as a string ("6" … "12", or "UG" for entrance exams). */
    class: string;
    subject: string;
    medium: string | null;
    /** "SYLLABUS" when the base is the board's syllabus rather than a textbook. */
    kind?: 'SYLLABUS' | null;
    /** Listing title — distinguishes several books of one class+subject. */
    book: string | null;
}

export interface KnowledgeSource {
    id: string;
    knowledge_base_id: string;
    institute_id: string;
    source_kind: SourceKind;
    title: string;
    file_id: string | null;
    source_url: string | null;
    status: SourceStatus;
    progress: number;
    stage: string | null;
    is_active: boolean;
    page_count: number;
    pages_low_confidence: number;
    chunk_count: number;
    figure_count: number;
    detected_languages: string[];
    parser: string | null;
    /** Pages that actually went through paid OCR, for cost transparency. */
    ocr_pages: number;
    credits_charged: number;
    error_message: string | null;
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
    meta?: Record<string, unknown>;
}

export interface ReviewPage {
    id: string;
    source_id: string;
    source_title: string;
    page_number: number;
    confidence: number | null;
    parser: string | null;
    text_chars: number;
    preview_url: string | null;
}

export interface KbFigure {
    id: string;
    page_number: number | null;
    kind: string;
    image_url: string;
    caption: string | null;
    alt_text: string | null;
}

export interface AskCitation {
    label: string;
    source_id: string;
    source_title: string | null;
    page_start: number | null;
    page_end: number | null;
    similarity: number;
    figures: KbFigure[];
}

export interface AskResponse {
    answer: string;
    grounded: boolean;
    confident?: boolean;
    follow_up_questions?: string[];
    citations: AskCitation[];
    hits: Array<{
        source_title: string | null;
        page_start: number | null;
        page_end: number | null;
        similarity: number | null;
        preview: string;
    }>;
    model: string | null;
}

export interface OutlineNode {
    id: string;
    source_id: string | null;
    parent_id: string | null;
    level: 'book' | 'chapter' | 'section';
    title: string | null;
    summary: string | null;
    keywords: string[];
    page_start: number | null;
    page_end: number | null;
    source_title: string | null;
}

/** Estimate returned by the pre-ingest credit preview. */
export interface IngestEstimate {
    tool_key: string;
    estimated_credits: number;
    current_balance: number | null;
    balance_after: number | null;
    sufficient: boolean | null;
    num_pages?: number;
    breakdown?: Array<{ component: string; detail: string; credits: number }>;
}

export interface AddSourceResult {
    source: KnowledgeSource;
    task_id: string | null;
    /** True when identical bytes were already ingested — nothing re-processed or charged. */
    deduplicated: boolean;
    message?: string;
}
