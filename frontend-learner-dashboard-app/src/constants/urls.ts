import { BACKEND_BASE_URL } from "../config/baseUrl";

export const BASE_URL = BACKEND_BASE_URL;
export const BASE_URL_LEARNER_DASHBOARD =
  import.meta.env.VITE_LEARNER_DASHBOARD_URL || "https://learner.vacademy.io";
export const BASE_URL_TEACHER_DASHBOARD =
  import.meta.env.VITE_TEACHER_DASHBOARD_URL || "https://dash.vacademy.io";
export const AI_SERVICE_BASE_URL = `${BACKEND_BASE_URL}/ai-service`;
//urls
export const INSTITUTE_ID =
  import.meta.env.VITE_INSTITUTE_ID || "c70f40a5-e4d3-4b6c-a498-e612d0d4b133";
export const CODE_CIRCLE_INSTITUTE_ID =
  import.meta.env.VITE_CODE_CIRCLE_INSTITUTE_ID ||
  "dd9b9687-56ee-467a-9fc4-8c5835eae7f9";
// Deprecated: subdomain-or-id API removed in favor of domain routing /resolve

export const GET_SLIDES_COUNT = `${BASE_URL}/admin-core-service/open/slide/v1/slide-counts-by-source-type`;
export const SUBMIT_RATING_URL = `${BASE_URL}/admin-core-service/rating`;
export const GET_ALL_USER_RATINGS = `${BASE_URL}/admin-core-service/open/rating/get-source-ratings`;
export const GET_ALL_RATING_SUMMARY = `${BASE_URL}/admin-core-service/open/rating/summary`;
export const GET_COURSE_DETAILS = `${BASE_URL}/admin-core-service/open/packages/v1/package-detail`;
/** @deprecated Use GET_COURSE_INIT instead - this fetches ALL courses */
export const GET_ALL_COURSE_DETAILS = `${BASE_URL}/admin-core-service/open/v1/learner-study-library/init`;
/** New scalable endpoint - fetches single course by courseId */
export const GET_COURSE_INIT = `${BASE_URL}/admin-core-service/v1/study-library/course-init`;
export const HOLISTIC_INSTITUTE_ID =
  import.meta.env.VITE_HOLISTIC_INSTITUTE_ID ||
  "bd9f2362-84d1-4e01-9762-a5196f9bac80";

export const LOGIN_URL = `${BASE_URL}/auth-service/learner/v1/login`;

export const LOGIN_URL_GOOGLE_GITHUB = `${BASE_URL}/auth-service/oauth2/authorization`;
// Native iOS "Sign in with Apple" — the app POSTs the Apple identityToken here
// (the native sheet returns it directly, so there is no browser-redirect round-trip).
export const LOGIN_URL_APPLE_NATIVE = `${BASE_URL}/auth-service/learner/v1/oauth/apple/native`;
export const LOGIN_USING_USERNAME = `${BASE_URL}/auth-service/open/user-details/by-username`;
export const LOGIN_USING_OTP = `${BASE_URL}/auth-service/learner/v1/login-otp-ten-days`;

export const REQUEST_OTP = `${BASE_URL}/auth-service/learner/v1/request-otp`;
export const LOGIN_OTP = `${BASE_URL}/auth-service/learner/v1/login-otp`;
export const FORGOT_PASSWORD = `${BASE_URL}/auth-service/v1/send-password`;
// Temporary endpoint for login without OTP when email service is down
export const LOGIN_BY_USERNAME_TRUSTED = `${BASE_URL}/auth-service/learner/v1/login-by-username-trusted`;

export const REFRESH_TOKEN_URL = `${BASE_URL}/auth-service/learner/v1/refresh-token`;
export const INSTITUTE_DETAIL = `${BASE_URL}/admin-core-service/learner/v1/details-without-batches`;
export const INSTITUTE_COMPLETE_DETAILS = `${BASE_URL}/admin-core-service/learner/v1/details`;
export const STUDENT_DETAIL = `${BASE_URL}/admin-core-service/learner/info/v1/details`;

export const Assessment_List_Filter = `${BASE_URL}/assessment-service/assessment/learner/assessment-list-filter`;
export const GET_TEXT_VIA_IDS = `${BASE_URL}/assessment-service/assessment/rich-text/by-ids`;
export const ASSESSMENT_PREVIEW = `${BASE_URL}/assessment-service/assessment/learner/assessment-start-preview`;
export const START_ASSESSMENT = `${BASE_URL}/assessment-service/assessment/learner/assessment-start-assessment`;
export const ASSESSMENT_SAVE = `${BASE_URL}/assessment-service/assessment/learner/status/update`;
export const ASSESSMENT_SUBMIT = `${BASE_URL}/assessment-service/assessment/learner/status/submit`;
export const RESTART_ASSESSMENT = `${BASE_URL}/assessment-service/assessment/learner/status/restart`;
// Proctoring (assessment_service V48): per-assessment config, batched device events.
export const PROCTORING_CONFIG = `${BASE_URL}/assessment-service/assessment/learner/proctoring/config`;
export const PROCTORING_EVENTS = `${BASE_URL}/assessment-service/assessment/learner/proctoring/events`;
// Learner-raised reattempt / time-extension requests, reviewed by an admin.
export const REATTEMPT_REQUEST = `${BASE_URL}/assessment-service/learner/reattempt-request/v1`;
export const REATTEMPT_REQUEST_MINE = `${BASE_URL}/assessment-service/learner/reattempt-request/v1/mine`;
// Learner-scoped report endpoints (properly authorized)
export const STUDENT_REPORT_URL = `${BASE_URL}/assessment-service/assessment/learner/report/list`;
export const STUDENT_REPORT_DETAIL_URL = `${BASE_URL}/assessment-service/assessment/learner/report/detail`;
export const LEARNER_REPORT_COMPARISON_URL = `${BASE_URL}/assessment-service/assessment/learner/report/comparison`;
export const LEARNER_OPTION_DISTRIBUTION_URL = `${BASE_URL}/assessment-service/assessment/learner/report/option-distribution`;
export const LEARNER_ANNOTATED_COPY_URL = `${BASE_URL}/assessment-service/assessment/learner/report/annotated-copy`;
export const LEARNER_REPORT_LEADERBOARD_URL = `${BASE_URL}/assessment-service/assessment/learner/report/leaderboard`;
export const SURVEY_STUDENT_REPORT_URL = `${BASE_URL}/assessment-service/assessment/survey/student-report`;
export const GET_ASSESSMENT_DETAILS = `${BASE_URL}/assessment-service/assessment/create/v1/status`;
export const GET_ASSESSMENT_MARKS = `${BASE_URL}/assessment-service/assessment/admin/init/total-marks`;
export const GET_QUESTIONS_OF_SECTIONS = `${BASE_URL}/assessment-service/assessment/add-questions/create/v1/questions-of-sections`;
export const UPDATE_ROLE = `${BASE_URL}/auth-service/v1/user-roles/update-role-status`;
export const GET_ENROLL_DETAILS = `${BASE_URL}/admin-core-service/learner-invitation-response/form`;
export const ENROLL_OPEN_STUDENT_URL = `${BASE_URL}/admin-core-service/open/learner/enroll-invite`;
export const ENROLLMENT_FORM_SUBMIT = `${BASE_URL}/admin-core-service/open/v1/enrollment/form-submit`;
export const CPO_OPEN_DUES_URL = `${BASE_URL}/admin-core-service/open/v1/fee/cpo-dues`;
export const CPO_OPEN_PAY_INSTALLMENTS_URL = `${BASE_URL}/admin-core-service/open/v1/fee/cpo-pay-installments`;
export const CPO_OPEN_SCHEDULE_URL = `${BASE_URL}/admin-core-service/open/v1/fee/cpo-schedule`;
export const CPO_ENROLL_WITHOUT_PAYMENT_URL = `${BASE_URL}/admin-core-service/v1/learner/enroll`;
export const PEYMENT_LOG_STATUS_URL = `${BASE_URL}/admin-core-service/open/v1/payment-log`;
export const GET_PAYMENT_GATEWAY_DETAILS_URL = `${BASE_URL}/admin-core-service/open/v1/institute/payment-setting/payment-gateway-details`;
export const ENROLLMENT_INVITE_URL = `${BASE_URL}/admin-core-service/open/learner/enroll-invite`;
// learner/v1/enroll + Cashfree status – localhost:8072 in dev, BASE_URL in production (override via VITE_ENROLL_API_BASE_URL)
const ENROLL_API_BASE =
  import.meta.env.VITE_ENROLL_API_BASE_URL ||
  (import.meta.env.PROD ? BASE_URL : "http://localhost:8072");
export const ENROLL_USER_INVITE_PAYMENT_URL = `${BASE_URL}/admin-core-service/v1/learner/enroll`;
export const ENROLL_DETAILS_RESPONSE = `${BASE_URL}/admin-core-service/learner-invitation-response/record`;
export const STUDENT_DETAIL_EDIT = `${BASE_URL}/admin-core-service/learner/info/v1/edit`;
/** Per-enrollment detail: carries the learner's enrollment date for one batch. */
export const LEARNER_BATCH_DETAIL = `${BASE_URL}/admin-core-service/learner/info/v1/batch-details`;
// Learner self-service payment method (saved card + billing details)
export const LEARNER_PAYMENT_METHOD_SUMMARY = `${BASE_URL}/admin-core-service/learner/payment-method/v1/summary`;
export const LEARNER_PAYMENT_METHOD_SETUP_INTENT = `${BASE_URL}/admin-core-service/learner/payment-method/v1/stripe/setup-intent`;
export const LEARNER_PAYMENT_METHOD_CONFIRM_CARD = `${BASE_URL}/admin-core-service/learner/payment-method/v1/confirm-card-update`;
export const LEARNER_PAYMENT_METHOD_BILLING_DETAILS = `${BASE_URL}/admin-core-service/learner/payment-method/v1/billing-details`;

// Learner self-service subscriptions + autopay mandate (list + cancel)
export const LEARNER_SUBSCRIPTION_LIST = `${BASE_URL}/admin-core-service/learner/subscription/v1`;
export const LEARNER_SUBSCRIPTION_RENEW_COMPLETE = (userPlanId: string) =>
  `${LEARNER_SUBSCRIPTION_LIST}/${userPlanId}/renew-complete`;
export const LEARNER_SUBSCRIPTION_CANCEL = (userPlanId: string) =>
  `${BASE_URL}/admin-core-service/learner/subscription/v1/${userPlanId}/cancel`;

// Plan change (upgrade / downgrade). The options endpoint prices every switchable plan
// for this learner at this moment; the change endpoint books it. Same path is used with
// DELETE to call off a downgrade that has not landed yet.
export const LEARNER_PLAN_CHANGE_OPTIONS = (userPlanId: string) =>
  `${BASE_URL}/admin-core-service/learner/subscription/v1/${userPlanId}/change-options`;
export const LEARNER_PLAN_CHANGE = (userPlanId: string) =>
  `${BASE_URL}/admin-core-service/learner/subscription/v1/${userPlanId}/change-plan`;

export const EXPORT_ASSESSMENT_REPORT = `${BASE_URL}/assessment-service/assessment/learner/report/pdf`;
export const EXPORT_AI_REPORT = `${BASE_URL}/assessment-service/assessment/learner/report/ai-pdf`;
export const ASSESSMENT_SUBMIT_MANUAL = `${BASE_URL}/assessment-service/assessment/learner/manual-status/submit`;

export const ADD_UPDATE_VIDEO_ACTIVITY = `${BASE_URL}/admin-core-service/learner-tracking/v1/add-or-update-video-activity`;
// NOTE: this used to point at /learner/activity/add-activity — a route that
// does not exist on any backend service, so every audio sync 404ed and audio
// progress never reached the server. The real endpoint mirrors video/document.
export const ADD_UPDATE_AUDIO_ACTIVITY = `${BASE_URL}/admin-core-service/learner-tracking/v1/add-or-update-audio-activity`;
export const ADD_UPDATE_DOCUMENT_ACTIVITY = `${BASE_URL}/admin-core-service/learner-tracking/v1/add-or-update-document-activity`;
// Per-learner interaction state for a document slide's interactive blocks
// (checklist ticks, fill-in-the-blank answers, inline MCQ choices). GET lists
// all blocks for the current learner; POST upserts one block.
export const SLIDE_INTERACTION = `${BASE_URL}/admin-core-service/learner-tracking/v1/slide-interaction`;
export const MARK_SLIDE_COMPLETION = `${BASE_URL}/admin-core-service/learner-tracking/v1/mark-slide-completion`;
export const SUBMIT_SLIDE_ANSWERS = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/video-question-slide/add-or-update`;
export const SUBMIT_ASSIGNMENT_SLIDE_ANSWERS = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/assignment-slide/add-or-update-assignment-slide-activity-log`;
export const GET_ASSIGNMENT_ACTIVITY_LOGS = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/assignment-slide/assignment-slide-activity-logs`;
export const SUBMIT_QUESTION_SLIDE_ANSWERS = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/question-slide/add-or-update-question-slide-activity-log`;
export const PRESENCE_HEARTBEAT = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/v1/presence-heartbeat`;
export const GET_QUESTION_SLIDE_ACTIVITY_LOGS = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/question-slide/question-slide-activity-logs`;
export const INIT_STUDY_LIBRARY = `${BASE_URL}/admin-core-service/v1/learner-study-library/init-details`;
export const MODULES_WITH_CHAPTERS = `${BASE_URL}/admin-core-service/open/v1/learner-study-library/modules-with-chapters`;
export const MODULES_WITH_CHAPTERS_PRIVATE = `${BASE_URL}/admin-core-service/v1/learner-study-library/modules-with-chapters`;
export const CHAPTERS_WITH_SLIDES = `${BASE_URL}/admin-core-service/open/v1/learner-study-library/chapters-with-slides`;
export const GET_SLIDES_PUBLIC = `${BASE_URL}/admin-core-service/open/v1/learner-study-library/slides`;
export const GET_SLIDES = `${BASE_URL}/admin-core-service/v1/learner-study-library/slides`;
export const GET_SLIDES_BY_PACKAGE_SESSION = `${BASE_URL}/admin-core-service/v1/learner-study-library/slides-by-package-session`;

// Offline content download & sync.
export const OFFLINE_MANIFEST_URL = `${BASE_URL}/admin-core-service/learner-offline/v1/manifest`;
export const OFFLINE_DOWNLOAD_URLS_URL = `${BASE_URL}/admin-core-service/learner-offline/v1/download-urls`;
export const OFFLINE_SYNC_BATCH_URL = `${BASE_URL}/admin-core-service/learner-tracking/offline-sync/v1/batch`;
export const OFFLINE_DEVICES_URL = `${BASE_URL}/admin-core-service/learner-offline/v1/devices`;
// Institute-level offline kill switch — the whole offline UI hangs off this.
export const OFFLINE_SETTINGS_URL = `${BASE_URL}/admin-core-service/learner-offline/v1/settings`;

export const GET_DETAILS = `${BASE_URL}/media-service/get-details/ids`;
export const GET_SIGNED_URL = `${BASE_URL}/media-service/get-signed-url`;
export const GET_SIGNED_URL_PUBLIC = `${BASE_URL}/media-service/public/get-signed-url`;
export const ACKNOWLEDGE = `${BASE_URL}/media-service/acknowledge`;
export const GET_PUBLIC_URL = `${BASE_URL}/media-service/get-public-url`;
export const GET_PUBLIC_URL_PUBLIC = `${BASE_URL}/media-service/public/get-public-url`;

export const ACKNOWLEDGE_FOR_PUBLIC_URL = `${BASE_URL}/media-service/acknowledge-get-details`;
export const GET_DASHBOARD_DATA = `${BASE_URL}/admin-core-service/learner/v1/get-dashboard-details`;
export const ACCEPT_TNC = `${BASE_URL}/admin-core-service/learner/v1/accept-tnc`;
export const GET_ASSESSMENT_COUNT = `${BASE_URL}/assessment-service/assessment/learner-assessment/v1/assessment-count-for-user-id`;
export const GET_NOTIFCATIONS = `${BASE_URL}/`;
export const GET_ANNOUNCEMENTS = `${BASE_URL}/`;
export const GET_OPEN_REGISTRATION_DETAILS = `${BASE_URL}/assessment-service/open-registrations/v1/assessment-page`;
export const GET_PARTICIPANTS_STATUS = `${BASE_URL}/assessment-service/open-registrations/v1/participant-status`;
export const REGISTER_PARTICIPANT_URL = `${BASE_URL}/assessment-service/open-registrations/register/v1/`;
export const GET_USERID_URL = `${BASE_URL}/admin-core-service/institute/open_learner/v1/add-institute_learner`;
export const GET_LAST_7_DAYS_PROGRESS = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/learner/v1/daily-time-spent`;

// Live session — Zoho Meeting integration
export const ZOHO_PARTICIPANT_JOIN_LINK = `${BASE_URL}/admin-core-service/live-sessions/provider/meeting/participant-join-link`;

// Live session — Zoom Meeting SDK signature (embedded join)
export const ZOOM_SDK_SIGNATURE_ENDPOINT = `${BASE_URL}/admin-core-service/live-sessions/provider/meeting/zoom-sdk-signature`;

// Live session
export const LIVE_SESSION_REQUEST_OTP = `${BASE_URL}/notification-service/v1/send-email-otp`;
export const LIVE_SESSION_VERIFY_OTP = `${BASE_URL}/notification-service/v1/verify-email-otp`;
export const REQUEST_WHATSAPP_OTP = `${BASE_URL}/auth-service/v1/request-generic-whatsapp-otp`;
export const VERIFY_WHATSAPP_OTP = `${BASE_URL}/auth-service/v1/verify-generic-whatsapp-otp`;
export const VERIFY_WHATSAPP_OTP_LOGIN = `${BASE_URL}/auth-service/v1/verify-generic-whatsapp-otp-login`;
export const LEAD_COLLECTION_ENROLL_URL = `${BASE_URL}/admin-core-service/v1/learner/enroll/detail`;
// Public catalogue/course "Get Started" lead capture → creates an audience_response
// (visible in admin Audience Manager → Recent Leads) and triggers lead workflows.
export const CATALOGUE_LEAD_SUBMIT_URL = `${BASE_URL}/admin-core-service/open/v1/audience/lead/submit-catalogue`;
export const LIVE_SESSION_GET_REGISTRATION_DATA = `${BASE_URL}/admin-core-service/live-session/get-registration-data`;
export const LIVE_SESSION_GET_LIVE_AND_UPCOMING = `${BASE_URL}/admin-core-service/get-sessions/learner/live-and-upcoming`;
export const LIVE_SESSION_GET_PAST = `${BASE_URL}/admin-core-service/get-sessions/learner/past`;
export const LIVE_SESSION_GET_SESSION_BY_SCHEDULE_ID = `${BASE_URL}/admin-core-service/get-sessions/by-schedule-id`;
export const LIVE_SESSION_GET_SESSION_BY_SCHEDULE_ID_FOR_GUEST = `${BASE_URL}/admin-core-service/live-session/guest/get-session-by-schedule-id`;
// Open schedule→session resolution, used to bounce unidentified guests from a
// 403'd embed/waiting-room deep link back to the registration page.
export const LIVE_SESSION_GET_SESSION_ID_BY_SCHEDULE_ID = `${BASE_URL}/admin-core-service/live-session/guest/session-id-by-schedule-id`;
export const LIVE_SESSION_CHECK_EMAIL_REGISTRATION = `${BASE_URL}/admin-core-service/live-session/check-email-registration`;
export const LIVE_SESSION_REGISTER_GUEST_USER = `${BASE_URL}/admin-core-service/live-session/register-guest-user`;
// Paid live sessions: registration + fee-invoice creation in one call, and payment state lookup
export const LIVE_SESSION_REGISTER_AND_PAY = `${BASE_URL}/admin-core-service/live-session/register-and-pay`;
// Gateway an invoice payment will charge through (open; same resolution the backend charge uses)
export const GET_INSTITUTE_DEFAULT_VENDOR = `${BASE_URL}/admin-core-service/open/v1/institute/payment-setting/default-vendor`;
export const LIVE_SESSION_PAYMENT_INFO = `${BASE_URL}/admin-core-service/live-session/payment-info`;
// Authenticated learner variants (private paid sessions)
export const LIVE_SESSION_PAYMENT_STATUS_AUTH = `${BASE_URL}/admin-core-service/live-sessions/v1/payment/status`;
export const LIVE_SESSION_REGISTER_AND_PAY_AUTH = `${BASE_URL}/admin-core-service/live-sessions/v1/payment/register-and-pay`;
export const LIVE_SESSION_MARK_ATTENDANCE = `${BASE_URL}/admin-core-service/live-session/mark-attendance`;
export const LIVE_SESSION_MARK_ATTENDANCE_FOR_GUEST = `${BASE_URL}/admin-core-service/live-session/mark-guest-attendance`;
export const LIVE_SESSION_GET_EARLIEST_SCHEDULE_ID = `${BASE_URL}/admin-core-service/live-session/get-earliest-schedule-id`;
export const ADD_DOUBT = `${BASE_URL}/admin-core-service/institute/v1/doubts/create`;
export const GET_DOUBTS = `${BASE_URL}/admin-core-service/institute/v1/doubts/get-all`;
export const GET_INSTITUTE_SETTING_DATA = `${BASE_URL}/admin-core-service/institute/setting/v1/data`;
// Open (unauthenticated) guest-query endpoints — used by the login page pre-auth.
export const OPEN_DOUBT_CONFIG = `${BASE_URL}/admin-core-service/open/institute/v1/doubts/config`;
export const OPEN_DOUBT_CREATE = `${BASE_URL}/admin-core-service/open/institute/v1/doubts/create`;
// Open (unauthenticated) read of STUDENT_DISPLAY_SETTINGS — lets pre-login screens
// (login page, public catalogue) honour learner display toggles such as signup.enabled.
export const OPEN_STUDENT_DISPLAY_SETTINGS = `${BASE_URL}/admin-core-service/open/institute/setting/v1/student-display`;
export const GET_USER_BASIC_DETAILS = `${BASE_URL}/auth-service/v1/user-details/get-basic-details`;
export const GET_USER_ROLES_DETAILS = `${BASE_URL}/auth-service/v1/user-details/get`;
export const UPDATE_USER_DETAILS = `${BASE_URL}/auth-service/v1/user-details/update-user`;

// Where a learner should land once their password is set, when their coursework lives on a
// connected WordPress/LearnDash site rather than in Vacademy. Takes no userId - it answers
// only for the caller, from their token.
export const LEARNER_LMS_LANDING = `${BASE_URL}/admin-core-service/learner/lms/v1/landing`;

// User enrollment check API endpoint (expects POST request with empty body)
export const GET_USER_DETAILS_BY_EMAIL = `${BASE_URL}/auth-service/open/user-details/by-email`;

// New signup API endpoint
export const REGISTER_USER = `${BASE_URL}/auth-service/learner/v1/register`;

export const urlInstituteDetails = `${BASE_URL}/admin-core-service/public/institute/v1/details-non-batches`;
// Lightweight public branding endpoint returning { institute_id, institute_name,
// logo_file_id, institute_theme_code }. Used as a fallback when the domain
// routing API (which normally populates InstituteDetails in Preferences)
// returns 404 — e.g. when the app is served from a pages.dev subdomain.
export const PUBLIC_INSTITUTE_BRANDING_URL = `${BASE_URL}/admin-core-service/public/institute/v1/branding`;
// Domain routing resolver: maps a (domain, subdomain) tuple to an institute.
// Called at app boot to populate InstituteDetails in Preferences. When this
// returns 404 (for example on pages.dev preview URLs) the register flow
// falls back to PUBLIC_INSTITUTE_BRANDING_URL with the assessment's
// institute_id.
export const DOMAIN_ROUTING_RESOLVE_URL = `${BASE_URL}/admin-core-service/public/domain-routing/v1/resolve`;
export const urlCourseDetails = `${BASE_URL}/admin-core-service/open/packages/v2/search`;
export const urlOpenLevels = `${BASE_URL}/admin-core-service/open/level/v1/get-levels`;
export const urlOpenInstituteTags = `${BASE_URL}/admin-core-service/open/packages/v1/tags`;
export const urlPublicCourseDetails = `${BASE_URL}/admin-core-service/learner-packages/v1/search`;
// export const urlInstructor = `${BASE_URL}/auth-service/public/v1/users-of-status`;
export const urlInstructor = `${BASE_URL}/admin-core-service/open/institute/v1/faculty/by-institute/only-creator`;
export const FEEDBACK_URL = `${BASE_URL}/admin-core-service/rating`;

export const SUBMIT_QUIZ_SLIDE_ACTIVITY_LOG = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/quiz-slide/add-or-update-quiz-slide-activity-log`;
export const GET_QUIZ_SLIDE_ACTIVITY_LOGS = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/quiz-slide/quiz-slide-activity-logs`;
export const SUBMIT_ASSESSMENT_SLIDE_ACTIVITY_LOG = `${BASE_URL}/admin-core-service/learner-tracking/activity-log/assessment-slide/add-or-update-assessment-slide-activity-log`;
export const CODING_SUBMISSIONS = `${BASE_URL}/admin-core-service/coding/submissions`;
export const LIVE_SESSION_ATTENDANCE_REPORT_BY_BATCH = `${BASE_URL}/admin-core-service/live-session-report/by-batch-session`;
export const LIVE_SESSION_ATTENDANCE_REPORT_BY_STUDENT = `${BASE_URL}/admin-core-service/live-session-report/student-report`;
export const LEARNER_FULL_ATTENDANCE_REPORT = `${BASE_URL}/admin-core-service/learner/reports/attendance`;

export const GET_BATCH_LIST = `${BASE_URL}/admin-core-service/batch/v1/batches-by-session`;
export const GET_COURSE_BATCHES = `${BASE_URL}/admin-core-service/course/v1`;

// Push notifications
export const PUSH_REGISTER_URL = `${BASE_URL}/notification-service/push-notifications/register`;
export const PUSH_DEACTIVATE_URL = `${BASE_URL}/notification-service/push-notifications/deactivate`;
export const USER_ANNOUNCEMENT_PREFERENCES_BASE_URL = `${BASE_URL}/notification-service/public/v1/user-announcement-preferences`;

// Enrollment API URLs
export const ENROLLMENT_PAYMENT_GATEWAY_DETAILS = `${BASE_URL}/admin-core-service/open/v1/institute/payment-setting/payment-gateway-details`;
export const ENROLLMENT_INVITE_DETAILS = `${BASE_URL}/admin-core-service/v1/enroll-invite`;
export const ENROLLMENT_PAYMENT_INITIATION = `${BASE_URL}/admin-core-service/v1/learner/enroll`;
export const ENROLLMENT_PAYMENT_INITIATION_V2 = `${BASE_URL}/admin-core-service/v2/learner/enroll`;
export const PAYMENT_LOGS_URL = `${BASE_URL}/admin-core-service/v1/user-plan/payment-logs`;
export const COLLECT_PUBLIC_USER_DATA = `${BASE_URL}/admin-core-service/v1/learner/enroll/detail`;

export const GENERATE_CERTIFICATE = `${BASE_URL}/admin-core-service/institute/v1/certificate/learner/get`;
// Whether certificates are on for a batch, and at what completion threshold.
// Resolved server-side from Certificate Settings (course override -> institute),
// replacing the duplicate copy that used to live in Student Display settings.
export const CERTIFICATE_CONFIG = `${BASE_URL}/admin-core-service/certificate/learner/v1/config`;

// Payment options API endpoint
export const GET_PAYMENT_OPTIONS = `${BASE_URL}/admin-core-service/open/v1/payment-option/default-payment-option`;
export const VERIFY_COUPON_URL = `${BASE_URL}/admin-core-service/open/v1/user-subscription/verify`;
export const GET_COUPON_CODE = `${BASE_URL}/admin-core-service/coupon/v1/by-source`;
export const GET_ENROLL_INVITES_BY_USER = `${BASE_URL}/admin-core-service/v1/enroll-invite/by-user-and-institute`;
export const GET_REFERRAL_BENEFITS = `${BASE_URL}/admin-core-service/v1/referral-detail/get-referral-detail-for-beneficiary`;
export const GET_POINTS_COUNTS = `${BASE_URL}/admin-core-service/v1/points/counts`;

export const ENROLLMENT_POLICY_URL = `${BASE_URL}/admin-core-service/enrollment-policy/package-session`;

// Cashfree user-plan payment (for learner invitation flow)
export const USER_PLAN_PAYMENT_URL = `${BASE_URL}/admin-core-service/payments/user-plan/user-plan-payment`;

// Cashfree payment status (no auth required) – uses same base as enroll API (localhost:8072)
export const CASHFREE_PAYMENT_STATUS_URL = `${ENROLL_API_BASE}/admin-core-service/payments/user-plan/CASHFREE/status`;

// PhonePe payment status (no auth required) – actively queries PhonePe and updates the payment log.
// Path: /admin-core-service/open/payments/PHONEPE/status/{orderId}?instituteId={instituteId}
export const PHONEPE_PAYMENT_STATUS_URL = `${BASE_URL}/admin-core-service/open/payments/PHONEPE/status`;

// Server time
export const GET_SERVER_TIME = `${BASE_URL}/auth-service/v1/server-time/utc`;

export const GET_CUSTOM_FIELDS = `${BASE_URL}/admin-core-service/open/common/custom-fields/setup`;
// Audience campaign API endpoint
export const GET_AUDIENCE_CAMPAIGN = `${BASE_URL}/admin-core-service/open/v1/audience/campaign`;
export const SUBMIT_AUDIENCE_LEAD = `${BASE_URL}/admin-core-service/open/v1/audience/lead/submit`;
export const SUBMIT_ENQUIRY_WITH_LEAD = `${BASE_URL}/admin-core-service/open/v1/audience/lead/submit-with-enquiry`;

// Public booking pages (open — no auth). Calendly-style scheduling:
// GET  {OPEN_BOOKING_BASE}/page/{instituteId}/{slug}            → page details
// GET  {OPEN_BOOKING_BASE}/page/{instituteId}/{slug}/slots      → available slots
// POST {OPEN_BOOKING_BASE}/page/{instituteId}/{slug}/book       → create booking
// GET  {OPEN_BOOKING_BASE}/manage/{token}                       → booking by manage token
// POST {OPEN_BOOKING_BASE}/manage/{token}/cancel|reschedule
export const OPEN_BOOKING_BASE = `${BASE_URL}/admin-core-service/open/v1/booking`;
// Authenticated booking-by-slug (ties invitee_user_id to the logged-in learner).
export const AUTHENTICATED_BOOKING_BASE = `${BASE_URL}/admin-core-service/v1/booking`;

// Mentorship — a learner's assigned mentors
export const MENTORSHIP_MY_MENTORS = `${BASE_URL}/admin-core-service/mentorship/v1/my-mentors`;
export const MENTORSHIP_DIRECTORY = `${BASE_URL}/admin-core-service/mentorship/v1/directory`;
export const MENTORSHIP_MY_REQUESTS = `${BASE_URL}/admin-core-service/mentorship/v1/my-requests`;
export const MENTORSHIP_MY_REQUEST_BY_ID = (id: string) =>
    `${BASE_URL}/admin-core-service/mentorship/v1/my-requests/${id}`;
export const MENTORSHIP_MY_PENDING_FEEDBACK = `${BASE_URL}/admin-core-service/mentorship/v1/my-pending-feedback`;
export const MENTORSHIP_MY_FEEDBACK = `${BASE_URL}/admin-core-service/mentorship/v1/my-feedback`;
// The learner's own 1:1 sessions — list, cancel, reschedule. Distinct from
// /my-sessions/*, which is the MENTOR's side of the same feature.
export const MENTORSHIP_MY_MENTOR_SESSIONS = `${BASE_URL}/admin-core-service/mentorship/v1/my-mentor-sessions`;
export const MENTORSHIP_MY_MENTOR_SESSION_CANCEL = `${MENTORSHIP_MY_MENTOR_SESSIONS}/cancel`;
export const MENTORSHIP_MY_MENTOR_SESSION_RESCHEDULE = `${MENTORSHIP_MY_MENTOR_SESSIONS}/reschedule`;
// A learner's own bookings (by invitee user id) — membership-scoped, self only.
export const MEETINGS_BY_LEAD = `${BASE_URL}/admin-core-service/v1/meetings/by-lead`;

// Sub-Organization Learner Management API endpoints
export const SUB_ORG_MEMBER_ADMIN_DETAILS = `${BASE_URL}/admin-core-service/sub-org/v1/member-admin-details`;
export const SUB_ORG_BASE = `${BASE_URL}/admin-core-service/sub-org/v1`;
export const SUB_ORG_MEMBERS = `${SUB_ORG_BASE}/members`;
export const SUB_ORG_ADD_MEMBER = `${SUB_ORG_BASE}/add-member`;
export const SUB_ORG_TERMINATE_MEMBER = `${SUB_ORG_BASE}/terminate-member`;

export const LIST_PLANNING_LOGS = `${BASE_URL}/admin-core-service/planning-logs/v1/list`;
export const GENERATE_INTERVAL_TYPE_ID = `${BASE_URL}/admin-core-service/planning-logs/v1/generate-interval-type-id`;

// Public Media
export const GET_PUBLIC_MEDIA_DETAILS = `${BASE_URL}/media-service/public/get-details/id`;

export const GET_AI_PROCESSED_LOGS = `${BASE_URL}/admin-core-service/llm-analytics/processed-logs`;
export const PROCESS_AI_REPORT_ON_DEMAND = `${BASE_URL}/admin-core-service/llm-analytics/process-on-demand`;

export const USER_LINKED_DATA = `${BASE_URL}/admin-core-service/v1/student-analysis/user-linked-data`;

export const USER_AI_KEY = `${BASE_URL}/ai-service/api-keys/v1/user`;
export const USER_TOKEN_USAGE = `${BASE_URL}/ai-service/token-usage/v1/user`;

export const GET_PARENT_DATA = `${BASE_URL}/admin-core-service/v1/applicant/parent`;

// Parent Portal API endpoints
export const SEARCH_ENQUIRY = `${BASE_URL}/admin-core-service/applicant/v1/enquiry/details`;
export const SUBMIT_APPLICATION = `${BASE_URL}/admin-core-service/v1/applicant/apply`;
export const GET_APPLICATION_STAGES = `${BASE_URL}/admin-core-service/v1/application/stages`;
export const GET_APPLICANT_STAGES = (applicantId: string) =>
  `${BASE_URL}/admin-core-service/v1/applicant/${applicantId}/stages`;

export const SUBMIT_ADMISSION = `${BASE_URL}/admin-core-service/v1/admission/submit`;

// Admission payment flow
// GET_ADMISSION_PAYMENT_OPTIONS: fetch available payment options for this institute (requires auth)
export const GET_ADMISSION_PAYMENT_OPTIONS = `${BASE_URL}/admin-core-service/v1/payment-option/get-payment-options`;
// INITIATE_APPLICANT_PAYMENT: POST /v1/applicant/{applicantId}/payment/initiate?paymentOptionId={id} (requires auth)
// body: { vendor, amount, currency, razorpay_request: {} }
// returns razorpay order details (razorpayKeyId, razorpayOrderId, amount, currency)
export const INITIATE_APPLICANT_PAYMENT = (applicantId: string) =>
  `${BASE_URL}/admin-core-service/v1/applicant/${applicantId}/payment/initiate`;

// Open (no-auth) admission payment endpoints — used by the public /admission/payment/:id link
// Fetch a single payment option by its ID (no JWT needed)
export const GET_PAYMENT_OPTION_BY_ID = (paymentOptionId: string) =>
  `${BASE_URL}/admin-core-service/open/v1/payment-option/${paymentOptionId}`;
// Initiate applicant payment without JWT — open variant
export const INITIATE_APPLICANT_PAYMENT_OPEN = (applicantId: string) =>
  `${BASE_URL}/admin-core-service/open/v1/applicant/${applicantId}/payment/initiate`;
// AI service base url
export const AI_SERVICE_URL = `${BASE_URL}/ai-service`;

// Short links
export const GET_OR_CREATE_SHORT_LINK = `${BASE_URL}/media-service/public/v1/short-link/get-or-create`;

// Session management
export const GET_ACTIVE_SESSIONS = `${BASE_URL}/auth-service/learner/v1/session/active`;
export const TERMINATE_SESSION = `${BASE_URL}/auth-service/learner/v1/session/logout`;
export const TERMINATE_CURRENT_SESSION = `${BASE_URL}/auth-service/learner/v1/session/logout-current`;
export const SELECT_INSTITUTE_SESSION = `${BASE_URL}/auth-service/learner/v1/session/select-institute`;
export const VALIDATE_SESSION = `${BASE_URL}/auth-service/learner/v1/session/validate`;

// Product Pages (open — no auth required)
export const PRODUCT_PAGE_OPEN_URL = `${BASE_URL}/admin-core-service/open/v1/product-page`;
export const GET_PRODUCT_PAGE_BY_CODE = (code: string, instituteId: string) =>
  `${PRODUCT_PAGE_OPEN_URL}/by-code?code=${code}&instituteId=${instituteId}`;
export const VALIDATE_PRODUCT_PAGE_COUPON = `${PRODUCT_PAGE_OPEN_URL}/validate-coupon`;
export const PRODUCT_PAGE_FORM_SUBMIT = `${PRODUCT_PAGE_OPEN_URL}/form-submit`;
export const PRODUCT_PAGE_ENROLL = `${PRODUCT_PAGE_OPEN_URL}/enroll`;
export const PRODUCT_PAGE_CPO_ENROLL = `${PRODUCT_PAGE_OPEN_URL}/cpo-enroll`;
export const PRODUCT_PAGE_LOGIN_CODE_EXCHANGE = `${PRODUCT_PAGE_OPEN_URL}/login-code/exchange`;

// Invoice payment (open — no auth required for viewing or initiating)
export const GET_INVOICE_PUBLIC = (invoiceId: string) =>
  `${BASE_URL}/admin-core-service/open/v1/invoices/${invoiceId}`;
export const INITIATE_INVOICE_PAYMENT = (invoiceId: string) =>
  `${BASE_URL}/admin-core-service/open/v1/invoices/${invoiceId}/initiate-payment`;
export const GET_PAYMENT_COMPLETION_STATUS = `${BASE_URL}/admin-core-service/open/v1/payment-log/status`;

// ── Parent Portal ("My Child" monitoring) ────────────────────────────────────
// Authenticated BFF. The guardian id comes from the JWT and the institute from
// the clientId header (set by the axios interceptor) — never a URL param. The
// only client-supplied id is childUserId, which the backend guard verifies is
// genuinely linked to the caller before returning anything.
const PARENT_PORTAL_V1 = `${BASE_URL}/admin-core-service/parent-portal/v1`;
export const PARENT_PORTAL_SETTINGS = `${PARENT_PORTAL_V1}/settings`;
export const PARENT_PORTAL_CHILDREN = `${PARENT_PORTAL_V1}/children`;
export const PARENT_PORTAL_CHILD_ATTENDANCE = (childUserId: string) =>
  `${PARENT_PORTAL_V1}/children/${childUserId}/attendance`;
export const PARENT_PORTAL_CHILD_INVOICES = (childUserId: string) =>
  `${PARENT_PORTAL_V1}/children/${childUserId}/payments/invoices`;
export const PARENT_PORTAL_CHILD_BADGES = (childUserId: string) =>
  `${PARENT_PORTAL_V1}/children/${childUserId}/badges`;
export const PARENT_PORTAL_CHILD_CERTIFICATES = (childUserId: string) =>
  `${PARENT_PORTAL_V1}/children/${childUserId}/certificates`;
