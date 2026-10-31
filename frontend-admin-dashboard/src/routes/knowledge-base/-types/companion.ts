/** Knowledge Base companions — mirror of ai_service `/kb-companion/v1` (V535 schema). */

export type CompanionLanguage = 'en' | 'hi' | 'kn';
export type CompanionMode = 'learn' | 'practice' | 'ask';
export type CompanionStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type CompanionTargetType = 'INSTITUTE' | 'BATCH' | 'LEARNER';
export type LessonStatus = 'GENERATING' | 'READY' | 'FAILED';

export interface CompanionAssignment {
    target_type: CompanionTargetType;
    target_id: string | null;
    /** Batch "Course · Level · Session" or learner full name; null for INSTITUTE. */
    label: string | null;
}

export interface Companion {
    id: string;
    institute_id: string;
    knowledge_base_id: string;
    kb_name: string | null;
    name: string;
    description: string | null;
    avatar_emoji: string | null;
    accent_color: string | null;
    persona: string | null;
    language: CompanionLanguage;
    modes: CompanionMode[];
    /** Empty = the whole knowledge base. A topic id implies all its subtopics. */
    scope_node_ids: string[];
    voice_enabled: boolean;
    voice_provider: string | null;
    voice_id: string | null;
    show_on_dashboard: boolean;
    daily_question_cap: number;
    status: CompanionStatus;
    starts_at: string | null;
    ends_at: string | null;
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
    assignments: CompanionAssignment[];
}

export interface LessonState {
    status: LessonStatus;
    cards_planned: number | null;
    cards: number | null;
    updated_at: string | null;
}

export interface CompanionLeaf {
    id: string;
    title: string | null;
    summary: string | null;
    /** True when the topic has no subtopics and is itself the lesson. */
    is_topic: boolean;
    lesson: LessonState | null;
}

export interface CompanionTopic {
    id: string;
    title: string | null;
    summary: string | null;
    leaves: CompanionLeaf[];
}

export interface CompanionDetail extends Companion {
    topics: CompanionTopic[];
    lessons_ready: number;
    leaves_total: number;
}

export interface CompanionTargetInput {
    target_type: CompanionTargetType;
    target_id?: string;
}

export interface CompanionPayload {
    name: string;
    description?: string | null;
    avatar_emoji?: string;
    accent_color?: string;
    persona?: string | null;
    language?: CompanionLanguage;
    modes?: CompanionMode[];
    scope_node_ids?: string[];
    voice_enabled?: boolean;
    show_on_dashboard?: boolean;
    daily_question_cap?: number;
    status?: Exclude<CompanionStatus, 'ARCHIVED'>;
    starts_at?: string | null;
    ends_at?: string | null;
    assignments?: CompanionTargetInput[];
}

export interface CreateCompanionPayload extends CompanionPayload {
    knowledge_base_id: string;
}

export interface PrepareResult {
    /** Leaves still without a READY/GENERATING lesson. */
    to_prepare: number;
    /** How many this call handles (server caps it at 40). */
    this_call: number;
    credits_per_lesson: number;
    estimated_credits: number;
    balance: number | null;
    started: number;
}

export interface CompanionInsights {
    nodes: Array<{
        node_id: string;
        title: string | null;
        started: number;
        completed: number;
        avg_mastery: number | null;
    }>;
    learners: Array<{
        user_id: string;
        name: string | null;
        started: number;
        completed: number;
        avg_mastery: number | null;
        last_active: string | null;
    }>;
    questions_asked: number;
    askers: number;
    leaves_total: number;
}

export interface LessonCheck {
    question: string;
    options: string[];
    answer_index: number;
    explanation: string | null;
}

export interface LessonCard {
    id: string;
    kind: string;
    title: string | null;
    say: string | null;
    citation: string | null;
    status: 'pending' | 'ready';
    check: LessonCheck | null;
    /** Complete sandboxed shell document for visual cards once rendered. */
    html_doc?: string;
}

export interface LessonResponse {
    status: 'MISSING' | LessonStatus;
    node_id: string;
    title: string | null;
    cards_planned?: number;
    cards: LessonCard[];
    error?: string | null;
}
