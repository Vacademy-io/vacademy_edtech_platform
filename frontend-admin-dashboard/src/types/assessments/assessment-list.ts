interface TestContent {
    assessment_id: string;
    name: string;
    about: string | null;
    play_mode: string;
    evaluation_type: string;
    submission_type: string;
    duration: number;
    assessment_visibility: string;
    status: string;
    registration_close_date: string | null;
    registration_open_date: string | null;
    expected_participants: number | null;
    cover_file_id: string | null;
    bound_start_time: string;
    bound_end_time: string;
    user_registrations: number;
    batch_ids: string[];
    admin_accesses: string | null;
    created_at: string;
    updated_at: string;
    join_link: string;
    subject_id: string;
    /** 'API' for exams created through the AI Evaluation API; NULL/other = dashboard. */
    source?: string | null;
}

export interface ScheduleTestTab {
    value: string;
    message: string;
    data: {
        content: TestContent[];
        last: boolean;
        page_no: number;
        page_size: number;
        total_elements: number;
        total_pages: number;
    };
}
