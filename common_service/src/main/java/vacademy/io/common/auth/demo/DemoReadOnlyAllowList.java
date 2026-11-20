package vacademy.io.common.auth.demo;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Path lists for the read-only demo user ({@link DemoReadOnlyGate}). One place for every
 * Spring service; ai_service keeps its own in {@code app/core/demo_read_only.py}.
 *
 * <p>{@link #READS}: the only non-GET requests the demo user may make. Each entry is a
 * POST/PUT that only reads (search, list, filter, paged fetch, report query), checked by
 * reading its controller and the service behind it. Default is deny, so a missing entry
 * shows an error on one demo screen; a wrong entry is a hole. When unsure, leave it out.
 * The evidence for each entry, and the notable ones left out, is in
 * docs/demo-stage/READ_ALLOWLIST.md. Keep the two in step.
 *
 * <p>{@link #BLOCKED_GETS}: GETs that change data, send something, start a call or job,
 * spend AI credits or hand out a credential. GET passes by default, so these are refused
 * by name.
 *
 * <p>Pattern syntax: literal segments, {@code *} for exactly one segment, and (blocked GETs
 * only) a trailing {@code **} for any remainder.
 */
public final class DemoReadOnlyAllowList {

    private record Entry(String method, String[] segments, String queryMarker) {
    }

    private static final List<Entry> READS = new ArrayList<>();
    private static final List<Entry> BLOCKED_GETS = new ArrayList<>();

    private static void read(String method, String pattern) {
        READS.add(new Entry(method, split(pattern), null));
    }

    private static void blockGet(String pattern) {
        BLOCKED_GETS.add(new Entry("GET", split(pattern), null));
    }

    /** Blocked only when the query string contains {@code marker} (compared in lower case). */
    private static void blockGetWithQuery(String pattern, String marker) {
        BLOCKED_GETS.add(new Entry("GET", split(pattern), marker.toLowerCase(Locale.ROOT)));
    }

    static {

        // ───── admin-core-service ─────
        // Fee tracking: search, collection dashboard, adjustment lists
        read("POST", "/admin-core-service/v1/admin/student-fee/adjustment/history");
        read("POST", "/admin-core-service/v1/admin/student-fee/adjustment/pending");
        read("POST", "/admin-core-service/v1/admin/student-fee/dashboard/collection");
        read("POST", "/admin-core-service/v1/admin/student-fee/search");
        // Admissions: paged list of admission responses
        read("POST", "/admin-core-service/v1/admission/responses/list");
        // Leads, enquiries, campaigns: lists and analytics that post a filter body
        read("POST", "/admin-core-service/v1/audience/campaigns");
        read("POST", "/admin-core-service/v1/audience/center-heatmap");
        read("POST", "/admin-core-service/v1/audience/distinct-institute-users-and-audience");
        read("POST", "/admin-core-service/v1/audience/enquiries");
        read("POST", "/admin-core-service/v1/audience/leads");
        read("POST", "/admin-core-service/v1/audience/user-lead-profiles/batch");
        // Batches: search
        read("POST", "/admin-core-service/batch/v1/search");
        // CRM dashboard query
        read("POST", "/admin-core-service/v1/crm-dashboard");
        // Enrol invites: list and lookup by payment option
        read("POST", "/admin-core-service/v1/enroll-invite/get-by-payment-option-ids");
        read("POST", "/admin-core-service/v1/enroll-invite/get-enroll-invite");
        // Live classes: session search
        read("POST", "/admin-core-service/get-sessions/search");
        // Institute: batches by id
        read("POST", "/admin-core-service/institute/v1/batches-by-ids/*");
        // Doubts: filtered list
        read("POST", "/admin-core-service/institute/v1/doubts/get-all");
        // Faculty: filtered list
        read("POST", "/admin-core-service/institute/v1/faculty/faculty/get-all");
        // Learners: v1 list (no credentials) and learner stats. The v2 list is NOT here: it returns learner passwords
        read("POST", "/admin-core-service/institute/institute_learner/get/v1/all");
        read("POST", "/admin-core-service/institute/institute_learner/stats/users");
        // Bulk upload: returns the CSV column layout only
        read("POST", "/admin-core-service/institute/institute_learner-bulk/v1/init-institute_learner-upload");
        // Templates: search
        read("POST", "/admin-core-service/institute/template/v1/search");
        // Invoices: lookup by payment logs
        read("POST", "/admin-core-service/v1/invoices/by-payment-logs");
        // Lead status: admission check lookup
        read("POST", "/admin-core-service/v1/lead-status/admission-check");
        // Learner invitations: lists
        read("POST", "/admin-core-service/learner-invitation/invitation-details");
        read("POST", "/admin-core-service/learner-invitation/invitation-responses");
        // Learner and batch progress reports (JSON; the PDF exports are not here)
        read("POST", "/admin-core-service/learner-management/batch-report");
        read("POST", "/admin-core-service/learner-management/batch-report/leaderboard");
        read("POST", "/admin-core-service/learner-management/learner-report");
        read("POST", "/admin-core-service/learner-management/learner-report/slide-wise-progress");
        // Courses: catalogue search
        read("POST", "/admin-core-service/learner-packages/v1/search");
        read("POST", "/admin-core-service/learner-packages/v1/search-by-user-id");
        // Learner activity: daily time spent
        read("POST", "/admin-core-service/learner-tracking/activity-log/learner/v1/daily-time-spent");
        // Live class reports and dashboard
        read("POST", "/admin-core-service/live-session-report/all-attendance");
        read("POST", "/admin-core-service/live-session-report/dashboard");
        read("POST", "/admin-core-service/live-session-report/dashboard/at-risk");
        read("POST", "/admin-core-service/live-session-report/dashboard/class-learners");
        read("POST", "/admin-core-service/live-session-report/dashboard/feedback-comments");
        read("POST", "/admin-core-service/live-session-report/feedback/search");
        // Coupon check (no redemption)
        read("POST", "/admin-core-service/open/v1/coupon/validate");
        // Public course catalogue search
        read("POST", "/admin-core-service/open/packages/v1/search");
        read("POST", "/admin-core-service/open/packages/v2/search");
        // Public ratings list
        read("POST", "/admin-core-service/open/rating/get-source-ratings");
        // Batch seat availability
        read("POST", "/admin-core-service/package-session/inventory/batch-availability");
        // Courses: catalogue search
        read("POST", "/admin-core-service/packages/v1/search");
        // Payment options: list
        read("POST", "/admin-core-service/v1/payment-option/get-payment-options");
        // Payment plan markdown lookup
        read("POST", "/admin-core-service/v1/payment-plan/markdown/lookup");
        // Planning logs: list
        read("POST", "/admin-core-service/planning-logs/v1/list");
        // Domain routing lookup used when the app boots
        read("POST", "/admin-core-service/public/domain-routing/v1/resolve");
        // Ratings: lists
        read("POST", "/admin-core-service/rating/get-source-ratings");
        read("POST", "/admin-core-service/rating/get-source-ratings-admin");
        // Custom report run (read-only transaction, SELECT only)
        read("POST", "/admin-core-service/v1/reports/custom/run");
        // Sub-organisation team list
        read("POST", "/admin-core-service/sub-org/v1/team/list");
        // Subjects by id
        read("POST", "/admin-core-service/subject/v1/subjects-by-ids");
        // System files: lists
        read("POST", "/admin-core-service/system-files/v1/list");
        read("POST", "/admin-core-service/system-files/v1/my-files");
        // Tags: learner counts and lookups by tag
        read("POST", "/admin-core-service/tag-management/institutes/*/tags/user-counts");
        read("POST", "/admin-core-service/tag-management/institutes/*/tags/users");
        read("POST", "/admin-core-service/tag-management/institutes/*/tags/users/details");
        // Call dashboard: call search and disposition counts
        read("POST", "/admin-core-service/v1/telephony/calls/dispositions/counts");
        read("POST", "/admin-core-service/v1/telephony/calls/search");
        // Lead timeline: batched journey and latest notes
        read("POST", "/admin-core-service/timeline/v1/student/journey-batch");
        read("POST", "/admin-core-service/timeline/v1/student/latest-notes-batch");
        // Payments and memberships: paged logs and dashboard summaries
        read("POST", "/admin-core-service/v1/user-plan/all");
        read("POST", "/admin-core-service/v1/user-plan/membership-details");
        read("POST", "/admin-core-service/v1/user-plan/payment-logs");
        read("POST", "/admin-core-service/v1/user-plan/payment-logs/billing-summary");
        read("POST", "/admin-core-service/v1/user-plan/payment-logs/collection-summary");
        read("POST", "/admin-core-service/v1/user-plan/payment-logs/dashboard");
        read("POST", "/admin-core-service/v1/user-plan/payment-logs/instalment-forecast");
        read("POST", "/admin-core-service/v1/user-plan/payment-logs/learner-plan-breakdown");
        read("POST", "/admin-core-service/v1/user-plan/payment-logs/outstanding-learners");
        // Workflows: list with schedules
        read("POST", "/admin-core-service/v1/workflow/institute/workflows-with-schedules/list");
        // Workflow runs: list
        read("POST", "/admin-core-service/v1/workflow-execution/list");

        // ───── assessment-service ─────
        // Assessments: admin list, participants, leaderboard, reports, dashboard
        read("POST", "/assessment-service/assessment/admin-participants/all/respondent-list");
        read("POST", "/assessment-service/assessment/admin/assessment-admin-list-filter");
        read("POST", "/assessment-service/assessment/admin/dashboard/insights");
        read("POST", "/assessment-service/assessment/admin/get-leaderboard");
        read("POST", "/assessment-service/assessment/admin/get-student-report");
        read("POST", "/assessment-service/assessment/manual-evaluation/attempts/file-status");
        // Question bank: filter
        read("POST", "/assessment-service/question-bank/v1/questions/filter");
        // Question library: filter
        read("POST", "/assessment-service/question-library/v1/questions/filter");
        // Question papers: filter
        read("POST", "/assessment-service/question-paper/public/view/v1/get-with-filters");
        read("POST", "/assessment-service/question-paper/view/v1/get-with-filters");

        // ───── auth-service ─────
        // Session: the demo user renews its own access token
        read("POST", "/auth-service/v1/refresh-token");
        // Users: names and avatars by id
        read("POST", "/auth-service/v1/user-details/get-basic-details");

        // ───── community-service ─────
        // Tags and entities filter
        read("POST", "/community-service/get-entity");

        // ───── notification-service ─────
        // Messaging analytics queries
        read("POST", "/notification-service/analytics/completion-cohort");
        read("POST", "/notification-service/analytics/daily-participation");
        read("POST", "/notification-service/analytics/engagement-leaderboard");
        read("POST", "/notification-service/analytics/lead-journey-funnel");
        // Chat: batch search
        read("POST", "/notification-service/v1/chat/batches/search");

        // ═════ GETs refused for the demo user ═════

        // Credentials: stored passwords, sign-in links or tokens for other users
        blockGet("/auth-service/v1/user/user-credentials/*");
        blockGet("/admin-core-service/admin/learner-portal/v1/access");
        blockGet("/admin-core-service/parent-link/v1/export-credentials");
        blockGet("/admin-core-service/learner/lms/v1/landing");
        blockGet("/community-service/super-admin/v1/onboarding/demo-accounts");
        // Sends a message
        blockGet("/admin-core-service/admin/learner-portal/v1/send-cred");
        blockGet("/admin-core-service/assignment-ai-evaluation/v1/latest");
        // Spends AI credits
        blockGet("/admin-core-service/v1/engagement/template-proposals/brief-check");
        blockGet("/assessment-service/assessment/export/pdf/ai-student-report");
        blockGet("/assessment-service/assessment/export/pdf/ai-assessment-report");
        blockGet("/assessment-service/assessment/learner/report/ai-pdf");
        // Live classes: creates or starts meetings, writes attendance, returns host links and SDK tokens
        blockGet("/admin-core-service/live-sessions/provider/meeting/join");
        blockGet("/admin-core-service/live-sessions/provider/meeting/google-meet-join");
        blockGet("/admin-core-service/live-sessions/provider/meeting/zoom-join-payload");
        blockGet("/admin-core-service/live-sessions/provider/meeting/zoom-sdk-signature");
        blockGet("/admin-core-service/live-sessions/provider/meeting/session-links");
        blockGet("/admin-core-service/live-session/guest/bbb-join");
        // Payment status poll that can mark a payment paid and enrol
        blockGet("/admin-core-service/payments/user-plan/*/status/*");
        // Creates and stores a document, a page or a record on first read
        blockGet("/admin-core-service/commerce/v1/invoices/*/pdf");
        blockGet("/admin-core-service/commerce/v1/credit-notes/*/pdf");
        blockGet("/admin-core-service/api/v1/hr/payslips/*/download");
        blockGet("/admin-core-service/v1/invoices/*/download");
        blockGet("/admin-core-service/v1/invoices/institute/*/bulk-download");
        blockGet("/admin-core-service/credits/packs/invoices");
        blockGet("/admin-core-service/v1/student-analysis/report/*/pdf");
        blockGet("/admin-core-service/v1/referral-link/member");
        blockGet("/admin-core-service/mentorship/v1/my-booking-page");
        blockGet("/admin-core-service/scorm/tracking/v1/*/initialize");
        // Learner engagement: opening the feed or an item writes points and attempts
        blockGet("/admin-core-service/engagement/learner/v1/feed");
        blockGet("/admin-core-service/engagement/learner/v1/item/*");
        // Syncs with an outside system and saves the result
        blockGet("/admin-core-service/v1/audience/campaign/*/communications");
        blockGet("/admin-core-service/v1/marketing/oauth/session/*/options");
        blockGet("/admin-core-service/institute/white-label/v1/status");
        // Exports that also write an audit row
        blockGet("/admin-core-service/commerce/v1/products/export");
        blockGet("/admin-core-service/commerce/v1/redirects/export");
        blockGetWithQuery("/admin-core-service/commerce/v1/audit", "format");
        blockGetWithQuery("/admin-core-service/commerce/v1/reports/*", "format");
        // Reads unless a flag in the query asks for a write
        blockGetWithQuery("/assessment-service/assessment/manual-evaluation/get/attempt-data", "markevaluating");
        // Runs a scheduled job by hand
        blockGet("/assessment-service/scheduler/test/update-attempt");
        // Super-admin store sync (the demo user is not a super admin; refused here as well)
        blockGet("/community-service/super-admin/v1/app-registry/providers/**");
    }

    private DemoReadOnlyAllowList() {
    }

    /**
     * True when {@code method} + {@code requestUri} is on the read allow-list. Strict on
     * purpose: a URI with an escape, a path parameter, a backslash, an empty or dot segment
     * never matches, so nothing can be dressed up as an allow-listed path.
     */
    public static boolean isAllowedRead(String method, String requestUri) {
        if (method == null || requestUri == null || !requestUri.startsWith("/")
                || requestUri.indexOf('%') >= 0 || requestUri.indexOf(';') >= 0
                || requestUri.indexOf('\\') >= 0) {
            return false;
        }
        String[] segments = split(requestUri);
        if (requestUri.endsWith("/")) {
            return false;
        }
        for (String segment : segments) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) {
                return false;
            }
        }
        for (Entry entry : READS) {
            if (entry.method().equals(method) && matches(entry.segments(), segments)) {
                return true;
            }
        }
        return false;
    }

    /**
     * True when a GET (or HEAD) of {@code requestUri} is refused. Lenient on purpose: the
     * path is unescaped and cleaned first, and anything that cannot be cleaned is refused.
     */
    public static boolean isBlockedGet(String requestUri, String queryString) {
        String path = normalise(requestUri);
        if (path == null) {
            return true;
        }
        String[] segments = split(path);
        String query = null;
        for (Entry entry : BLOCKED_GETS) {
            if (!matches(entry.segments(), segments)) {
                continue;
            }
            if (entry.queryMarker() == null) {
                return true;
            }
            if (query == null) {
                String decoded = queryString == null ? "" : percentDecode(queryString);
                // An undecodable query on a flag-dependent route is refused.
                if (decoded == null) {
                    return true;
                }
                query = decoded.toLowerCase(Locale.ROOT);
            }
            if (query.contains(entry.queryMarker())) {
                return true;
            }
        }
        return false;
    }

    /** Number of read allow-list entries (for the docs and tests). */
    public static int readCount() {
        return READS.size();
    }

    /** Number of blocked GET entries. */
    public static int blockedGetCount() {
        return BLOCKED_GETS.size();
    }

    private static String[] split(String path) {
        String trimmed = path.startsWith("/") ? path.substring(1) : path;
        return trimmed.split("/", -1);
    }

    private static boolean matches(String[] pattern, String[] path) {
        int last = pattern.length - 1;
        boolean open = last >= 0 && "**".equals(pattern[last]);
        if (open ? path.length < last : path.length != pattern.length) {
            return false;
        }
        int fixed = open ? last : pattern.length;
        for (int i = 0; i < fixed; i++) {
            if ("*".equals(pattern[i])) {
                if (path[i].isEmpty()) {
                    return false;
                }
            } else if (!pattern[i].equals(path[i])) {
                return false;
            }
        }
        return true;
    }

    /**
     * The path as the framework will route it: unescaped, path parameters dropped, repeated
     * and trailing slashes removed. Null when it cannot be read or still holds a dot segment.
     */
    private static String normalise(String requestUri) {
        if (requestUri == null) {
            return null;
        }
        String decoded = percentDecode(requestUri);
        if (decoded == null) {
            return null;
        }
        StringBuilder out = new StringBuilder();
        for (String segment : decoded.replace('\\', '/').split("/")) {
            int params = segment.indexOf(';');
            String name = params >= 0 ? segment.substring(0, params) : segment;
            if (name.isEmpty()) {
                continue;
            }
            if (".".equals(name) || "..".equals(name)) {
                return null;
            }
            out.append('/').append(name);
        }
        return out.length() == 0 ? "/" : out.toString();
    }

    /** Percent-decoding as UTF-8 ('+' is left alone); null when an escape is malformed. */
    private static String percentDecode(String value) {
        if (value.indexOf('%') < 0) {
            return value;
        }
        byte[] in = value.getBytes(StandardCharsets.UTF_8);
        byte[] out = new byte[in.length];
        int n = 0;
        for (int i = 0; i < in.length; i++) {
            if (in[i] != '%') {
                out[n++] = in[i];
                continue;
            }
            if (i + 2 >= in.length) {
                return null;
            }
            int hi = Character.digit(in[i + 1], 16);
            int lo = Character.digit(in[i + 2], 16);
            if (hi < 0 || lo < 0) {
                return null;
            }
            out[n++] = (byte) ((hi << 4) | lo);
            i += 2;
        }
        String decoded = new String(out, 0, n, StandardCharsets.UTF_8);
        // A second layer of escapes is not something the framework would route; refuse it.
        return decoded.indexOf('%') >= 0 ? null : decoded;
    }
}
