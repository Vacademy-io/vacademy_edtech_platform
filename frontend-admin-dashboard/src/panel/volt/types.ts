/**
 * Volt (live presentation) types for the panel. Wire shapes mirror the
 * community-service DTOs (snake_case JSON):
 *   AddPresentationDto, PresentationSlideDto, QuestionDTO, LiveSessionDto.
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';

// ------------------------------------------------------------------ wire ---

export interface VoltRichText {
    id?: string | null;
    type?: string | null;
    content?: string | null;
}

export interface VoltQuestionOption {
    id: string;
    preview_id?: string | null;
    text?: VoltRichText | null;
    option_order?: number | null;
}

export interface VoltQuestion {
    id: string;
    text?: VoltRichText | null;
    question_type?: string | null;
    auto_evaluation_json?: string | null;
    default_question_time_mins?: number | null;
    options?: VoltQuestionOption[] | null;
}

export interface VoltWireSlide {
    id: string;
    slide_order: number;
    title?: string | null;
    /** 'question' for quiz/feedback slides; Excalidraw slides carry a file id in `content`. */
    source?: string | null;
    content?: string | null;
    added_question?: VoltQuestion | null;
}

/** One row of GET presentation/get-all-presentation (AddPresentationDto). */
export interface VoltDeckSummary {
    id: string;
    title?: string | null;
    description?: string | null;
    status?: string | null;
    cover_file_id?: string | null;
    added_slides_count?: number | null;
    added_slides?: VoltWireSlide[] | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface VoltDeckDetail extends VoltDeckSummary {
    added_slides?: VoltWireSlide[] | null;
}

/** LiveSessionDto as returned by create / start / move / get-updated-details. */
export interface VoltLiveSession {
    session_id: string;
    invite_code: string;
    session_status?: string | null;
    show_results_at_last_slide?: boolean | null;
    default_seconds_for_question?: number | null;
    slide_start_timestamp?: number | null;
    current_slide_index?: number | null;
    slides?: { added_slides?: VoltWireSlide[] | null } | null;
}

export interface VoltSessionOptions {
    can_join_in_between: boolean;
    show_results_at_last_slide: boolean;
    is_session_recorded: boolean;
    allow_chat: boolean;
    default_seconds_for_question: number;
    student_attempts: number;
    points_per_correct_answer: number;
    negative_marking_enabled: boolean;
    negative_marks_per_wrong_answer: number;
}

/** A learner in the presenter SSE 'participants' event (ParticipantDto). */
export interface VoltParticipant {
    username: string;
    user_id?: string | null;
    name?: string | null;
    email?: string | null;
    status?: string | null;
    joined_at?: string | null;
    last_active_at?: string | null;
}

/** Presenter SSE 'session_state_presenter' payload. */
export interface VoltPresenterState {
    sessionStatus?: string;
    currentSlideIndex?: number;
    totalSlides?: number;
}

// ----------------------------------------------------------------- panel ---

export interface PanelSceneData {
    elements: readonly ExcalidrawElement[];
    appState: Partial<AppState>;
    files: BinaryFiles | null;
}

export interface PanelQuestionOption {
    id: string;
    name: string;
    isSelected: boolean;
}

/** Same field names as the admin QuizSlideData.elements (ResponseOverlay reads them). */
export interface PanelQuestionData {
    questionName: string;
    singleChoiceOptions: PanelQuestionOption[];
    feedbackAnswer: string;
    timeLimit: number;
}

export type PanelSlideKind = 'scene' | 'quiz' | 'feedback' | 'failed';

export interface PanelSlide {
    id: string;
    /** slide_order from the deck; sent as move_to (same as ActualPresentationDisplay). */
    order: number;
    kind: PanelSlideKind;
    title?: string;
    scene?: PanelSceneData;
    question?: PanelQuestionData;
}

export interface PanelDeck {
    id: string;
    title: string;
    slides: PanelSlide[];
    failedCount: number;
}

export interface DeckLoadProgress {
    done: number;
    total: number;
}
