package vacademy.io.admin_core_service.features.ai_usage.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * DTOs for the per-user AI credit usage views (academy-credits).
 * All values are derived from credit_transactions (net of refunds) joined to
 * the institute user directory (users / user_role / roles).
 */
public class CreditUsageDtos {

    /** One row in the per-user usage list. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UserUsageRow {
        private String userId;
        private String name;
        private String email;
        /** Comma-separated role names the user holds in this institute. */
        private String roles;
        private double totalCredits;
        private long requestCount;
    }

    /** One credit deduction in a user's drill-down log. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UsageLogRow {
        private String id;
        /** Epoch millis. */
        private Long createdAt;
        private String requestType;
        private String model;
        private double credits;
        private String description;
    }

    /** Per-role rollup used to build the role sub-tabs (with counts). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RoleSummaryRow {
        private String role;
        private long userCount;
        private double totalCredits;
    }

    /**
     * One Student-AI chat session in a learner's conversation drill-down.
     * Sourced from chat_sessions (+ a cheap COUNT/first-message subquery on
     * chat_messages). These tables are written by the Python ai_service into
     * the SAME database admin_core uses, so we read them with a native query —
     * the same posture as the credit_transactions reader.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ConversationRow {
        private String sessionId;
        /** slide | question | course_details | general etc. */
        private String contextType;
        /** Best-effort human label pulled from context_meta (may be null). */
        private String contextTitle;
        /** text | voice_interview | voice_doubt | voice_oral_test */
        private String sessionMode;
        private String status;
        /** Epoch millis. */
        private Long createdAt;
        /** Epoch millis. */
        private Long lastActive;
        private long messageCount;
        /** First learner message, trimmed — a preview for the session list. */
        private String preview;
    }

    /** One message inside a chat session transcript. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChatMessageRow {
        private String id;
        /** user | assistant | tool_call | tool_result */
        private String type;
        private String content;
        /** Raw metadata JSON (intent, quiz payload, …) — may be null. */
        private String metadata;
        /** Epoch millis. */
        private Long createdAt;
    }

    /**
     * One credit deduction across the whole institute, with the member it's
     * attributed to resolved — a flat row for the admin "Activity Log" export.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FlatLogRow {
        /** Epoch millis. */
        private Long createdAt;
        private String userId;
        private String name;
        private String email;
        /** Comma-separated role names. */
        private String roles;
        private String requestType;
        private String model;
        private double credits;
        private String description;
    }

    /** One Student-AI chat session, user-attributed — flat row for the "Chat Sessions" export sheet. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FlatSessionRow {
        /** Epoch millis (session created). */
        private Long createdAt;
        /** Epoch millis (last activity). */
        private Long lastActive;
        private String userId;
        private String name;
        private String email;
        private String roles;
        private String sessionId;
        private String contextType;
        private String contextTitle;
        private String sessionMode;
        private String status;
        private long messageCount;
        private String preview;
    }

    /** One chat message (prompt or answer), user-attributed — flat row for the "Chat Messages" export sheet. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FlatMessageRow {
        /** Epoch millis. */
        private Long createdAt;
        private String userId;
        private String name;
        private String email;
        private String sessionId;
        private String contextType;
        private String contextTitle;
        private String sessionMode;
        /** user | assistant | tool_call | tool_result */
        private String messageType;
        private String content;
    }

    // ── Chatbot Analysis (LMS -> Student AI -> Chatbot Analysis) ─────────────

    /**
     * One Student-AI chat in the institute-wide "recent chats" table, with the
     * learner resolved from the `student` table.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChatbotSessionRow {
        private String sessionId;
        private String userId;
        private String studentName;
        private String studentEmail;
        /** slide | course_details | general */
        private String contextType;
        /** Best-effort human label pulled from context_meta (may be null). */
        private String contextTitle;
        /** text | voice_interview | voice_doubt | voice_oral_test */
        private String sessionMode;
        private String status;
        /** Epoch millis. */
        private Long createdAt;
        /** Epoch millis. */
        private Long lastActive;
        private long messageCount;
        private long studentMessageCount;
        /** Most recent learner message, trimmed. */
        private String lastStudentMessage;
        /** How many practice quizzes the learner completed in this chat. */
        private long quizCount;
    }

    /** A {label, count} pair for the summary breakdowns. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CountByValue {
        private String value;
        private long count;
    }

    /** A topic students asked about, with the event kind it came from. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TopicCount {
        private String topic;
        /** doubt | quiz_score */
        private String eventType;
        private long count;
    }

    /** One day in the activity trend (zero-filled by the query). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DailyActivityRow {
        /** yyyy-MM-dd */
        private String date;
        private long sessions;
        private long studentMessages;
    }

    /**
     * Aggregate Student-AI data points for the window, driving the summary
     * cards on the Chatbot Analysis screen.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChatbotSummary {
        private long sessions;
        private long activeSessions;
        private long uniqueStudents;
        private long sessionsAllTime;
        private long uniqueStudentsAllTime;
        private long totalMessages;
        private long studentMessages;
        private long aiMessages;
        private long quizzesGenerated;
        private long quizzesSubmitted;
        private long toolCalls;
        private double avgMessagesPerSession;
        private long doubtsAsked;
        private long quizzesTaken;
        /** Null when no quiz was submitted in the window. */
        private Double avgQuizScorePct;
        private List<CountByValue> modeBreakdown;
        private List<CountByValue> contextBreakdown;
        private List<TopicCount> topTopics;
        private List<DailyActivityRow> dailyActivity;
    }

    // ── Automations chatbot (WhatsApp flow AI replies) credit usage ──────────
    // Distinct from the ChatbotSummary/ChatbotSessionRow types above, which
    // describe the in-app Student AI. These read credit_transactions rows with
    // request_type='chatbot', written by ChatbotAiService when a flow's
    // AI_RESPONSE node answers someone.

    /** Credits one Automations flow's AI replies consumed in the window. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FlowAiUsageRow {
        /** chatbot_flow id — carried on the transaction as batch_id. Null for pre-V495 rows. */
        private String flowId;
        /** Flow name as it was when the turn was charged (parsed from the description). */
        private String flowName;
        private double totalCredits;
        /** Number of AI turns charged. */
        private long turnCount;
        /** Distinct people the bot replied to. */
        private long userCount;
        /** Epoch millis of the most recent charged turn. */
        private Long lastUsedAt;
    }

    /** One charged AI turn in the Automations chatbot drill-down. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FlowAiUsageLogRow {
        private String id;
        /** Epoch millis. */
        private Long createdAt;
        private String flowId;
        private String userId;
        /** Resolved from auth-service; null when the number never matched a user. */
        private String name;
        private String email;
        private String model;
        private double credits;
        private String description;
    }

    /** Header figures for the Automations chatbot AI usage panel. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FlowAiUsageSummary {
        private double totalCredits;
        private long turnCount;
        private long userCount;
        private long flowCount;
        /** Current institute balance, so the panel can show the funding state in one call. */
        private Double currentBalance;
        /**
         * False when the balance is exhausted (or unreadable) — the same gate
         * ChatbotAiService applies, so the UI can show the feature as paused
         * instead of guessing from the number.
         */
        private boolean aiEnabled;
        private List<FlowAiUsageRow> byFlow;
    }
}
