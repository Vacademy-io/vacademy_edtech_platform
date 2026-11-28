package vacademy.io.admin_core_service.features.engagement.report;

import java.util.List;
import java.util.Map;

/**
 * GET /admin-core-service/v1/engagement/reports/diagnosis: where the lead-to-demo chain is breaking
 * and what to change. Field names and nesting are the contract the dashboard reads
 * (docs/engagement/ENGAGEMENT_DIAGNOSIS.md); JSON is camelCase and nulls are written out. Rates are
 * fractions 0..1, null when they have no base. A number whose read failed is null, never 0: its
 * section is named in {@code errors} and its stage reads UNAVAILABLE.
 */
public record EngagementDiagnosis(
        /** DAILY or WEEKLY. */
        String view,
        /** The period, YYYY-MM-DD inclusive, institute time zone. */
        String from,
        String to,
        int days,
        String timezone,
        String engineId,
        String generatedAt,
        /** Ranked; at most 5 on DAILY, 10 on WEEKLY. One code can repeat, once per source, hour, template or subject. */
        List<Problem> problems,
        /** How many the cap cut. */
        int moreProblems,
        /** One row per stage, in stage order. */
        List<StageStatus> stages,
        List<DataGap> dataGaps,
        /** WEEKLY only. */
        Weekly weekly,
        Map<String, String> errors) {

    /**
     * @param numbers per code, see the catalogue in {@link EngagementDiagnosisRules}
     * @param names   per code: agent names, a source, a template, a subject, an objection
     * @param link    null when the problem has nowhere to open
     */
    public record Problem(String code, String stage, String severity, long affected, Map<String, Object> numbers,
                          List<BreakdownRow> breakdown, List<String> names, Link link) {
    }

    public record BreakdownRow(String key, long count) {
    }

    /** target: OUTCOMES (with channel, outcome) or ITEMS (with kind); the unused fields are null. */
    public record Link(String target, String channel, String outcome, String kind) {
    }

    /** status: PROBLEM | UNAVAILABLE | NO_ACTIVITY | NOT_ENOUGH_DATA | OK. */
    public record StageStatus(String stage, String status) {
    }

    /** What the report cannot see, so a 0 isn't read as a real 0. names: sender addresses, when the code has any. */
    public record DataGap(String code, List<String> names) {
    }

    /**
     * Lists are empty and objects null when their section failed (named in errors).
     * callLengths and callInsights are null then, as is each engineChecks number that could not be read.
     */
    public record Weekly(Minimums minimums, List<LeadSourceRow> leadSources, List<CallHourRow> callHours,
                         CallLengths callLengths, CallInsights callInsights, List<WhatsAppFailureRow> whatsappFailures,
                         List<WhatsAppTemplateRow> whatsappTemplates, List<EmailSubjectRow> emailSubjects,
                         List<PromptChangeRow> promptChanges, EngineChecks engineChecks) {
    }

    public record Minimums(int leadsPerSource, int callsPerHour, int sendsPerRow) {
    }

    /**
     * People added in the period, grouped by where they came from, and what became of them. contacted:
     * got a message or a dialled call in the period. responded: answered one of those messages or picked
     * up a call. demosBooked: bookings of these people in the period. A column whose section failed is
     * null, with its rate.
     */
    public record LeadSourceRow(String source, long leads, Long contacted, Long responded, Long demosBooked,
                                Double contactRate, Double responseRate, boolean enough) {
    }

    /** Dialled, finished calls per institute-local hour; only hours with calls, in hour order. */
    public record CallHourRow(int hour, long placed, long connected, Double connectRate, boolean enough) {
    }

    public record CallLengths(long connected, long under20s, long s20to60, long over60) {
    }

    public record CallInsights(long analysed, Map<String, Long> sentiment, List<OutcomeCount> outcomes,
                               long highLikelihood, List<ObjectionCount> topObjections) {
    }

    public record OutcomeCount(String status, long count) {
    }

    public record ObjectionCount(String text, long count) {
    }

    /** code: Meta's error code as stored; null for REJECTED_AT_SEND. */
    public record WhatsAppFailureRow(String reason, String code, long count) {
    }

    /** verdict: BEST | WORST | OK | NOT_ENOUGH_DATA. */
    public record WhatsAppTemplateRow(String name, long sent, long delivered, long read, long replied,
                                      Double replyRate, String verdict) {
    }

    /**
     * replied and replyRate are null when no send of this row could report a reply (its senders' replies
     * cannot reach us); replyRate is over the sends that could. clickRate is over the sends SES tracked.
     */
    public record EmailSubjectRow(String name, long sent, long delivered, long clicked, long bounced, Long replied,
                                  Double clickRate, Double replyRate, String verdict) {
    }

    /** A prompt version with emails or WhatsApp messages sent in the period; newest first. */
    public record PromptChangeRow(String engineId, String engineName, int version, String createdAt, String source,
                                  String change, long sends, Long replies, Double replyRate, Long demosBooked,
                                  boolean enough) {
    }

    public record EngineChecks(Long doubleContact, Long sentAfterReply, Long stuckMembers) {
    }
}
