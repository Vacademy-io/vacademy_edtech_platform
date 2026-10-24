package vacademy.io.assessment_service.features.open_evaluation.error;

/**
 * Machine error codes of the partner API (spec 6.7 and 8.3, request errors). Partners
 * branch on these strings, so they never change once published.
 */
public final class ApiErrorCode {

    // 400
    public static final String MALFORMED_JSON = "malformed_json";
    public static final String INVALID_CURSOR = "invalid_cursor";
    // 401 / 403 (written by ApiKeyAuthFilter; repeated here for the advice and entry point)
    public static final String MISSING_API_KEY = "missing_api_key";
    public static final String INVALID_API_KEY = "invalid_api_key";
    public static final String PRODUCT_NOT_ENABLED = "product_not_enabled";
    public static final String INSUFFICIENT_SCOPE = "insufficient_scope";
    // 402
    public static final String INSUFFICIENT_CREDITS = "insufficient_credits";
    // 404
    public static final String NOT_FOUND = "not_found";
    public static final String EXAM_NOT_FOUND = "exam_not_found";
    public static final String QUESTION_NOT_FOUND = "question_not_found";
    public static final String CANDIDATE_NOT_FOUND = "candidate_not_found";
    public static final String SUBMISSION_NOT_FOUND = "submission_not_found";
    public static final String UPLOAD_NOT_FOUND = "upload_not_found";
    public static final String ENDPOINT_NOT_FOUND = "endpoint_not_found";
    public static final String CHECKED_COPY_NOT_FOUND = "checked_copy_not_found";
    // 405 / 415
    public static final String METHOD_NOT_ALLOWED = "method_not_allowed";
    public static final String UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type";
    // 409
    public static final String EXAM_EXISTS = "exam_exists";
    public static final String EXAM_OPEN = "exam_open";
    public static final String EXAM_NOT_OPEN = "exam_not_open";
    public static final String EXAM_FINALIZED = "exam_finalized";
    public static final String SUBMISSION_EXISTS = "submission_exists";
    public static final String SUBMISSION_FINALIZED = "submission_finalized";
    public static final String SUBMISSION_NOT_FINALIZED = "submission_not_finalized";
    public static final String EVALUATION_IN_PROGRESS = "evaluation_in_progress";
    public static final String REQUEST_IN_PROGRESS = "request_in_progress";
    public static final String CONFLICT = "conflict";
    public static final String EXAM_HAS_SUBMISSIONS = "exam_has_submissions";
    public static final String RUBRIC_LOCKED = "rubric_locked";
    public static final String CANDIDATE_HAS_SUBMISSION = "candidate_has_submission";
    public static final String ALREADY_COMPLETED = "already_completed";
    public static final String UPLOAD_ALREADY_USED = "upload_already_used";
    // 412
    public static final String RUBRIC_VERSION_MISMATCH = "rubric_version_mismatch";
    // 413
    public static final String PAYLOAD_TOO_LARGE = "payload_too_large";
    // 422
    public static final String VALIDATION_FAILED = "validation_failed";
    public static final String IDEMPOTENCY_KEY_REUSED = "idempotency_key_reused";
    public static final String FEATURE_NOT_AVAILABLE = "feature_not_available";
    public static final String LANGUAGE_NOT_SUPPORTED = "language_not_supported";
    public static final String RUBRIC_MARKS_MISMATCH = "rubric_marks_mismatch";
    public static final String RUBRIC_DUPLICATE_CRITERION = "rubric_duplicate_criterion";
    public static final String RUBRIC_GUIDANCE_HAS_MARKS = "rubric_guidance_has_marks";
    public static final String UNKNOWN_OPTION_LABEL = "unknown_option_label";
    public static final String EXAM_NOT_READY = "exam_not_ready";
    public static final String MODE_MISMATCH = "mode_mismatch";
    public static final String NO_GRADABLE_QUESTIONS = "no_gradable_questions";
    public static final String TOO_MANY_PAGES = "too_many_pages";
    public static final String UPLOAD_REJECTED = "upload_rejected";
    public static final String INVALID_MARKS = "invalid_marks";
    // 429
    public static final String RATE_LIMITED = "rate_limited";
    public static final String DAILY_QUOTA_EXCEEDED = "daily_quota_exceeded";
    // 5xx
    public static final String INTERNAL_ERROR = "internal_error";
    public static final String AUTH_UNAVAILABLE = "auth_unavailable";
    public static final String ENGINE_UNAVAILABLE = "engine_unavailable";

    private ApiErrorCode() {
    }
}
