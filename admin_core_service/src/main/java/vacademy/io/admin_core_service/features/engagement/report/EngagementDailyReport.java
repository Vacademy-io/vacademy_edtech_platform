package vacademy.io.admin_core_service.features.engagement.report;

import java.util.List;
import java.util.Map;

/**
 * GET /admin-core-service/v1/engagement/reports/daily: one engine's (or every engine's) day.
 * Field names and nesting are the contract the dashboard reads (design §5.1); JSON is camelCase
 * and nulls are written out. Counts are whole numbers, credits and money are decimals, rates are
 * fractions 0..1. {@code realCost} is filled for platform super admins only.
 */
public record EngagementDailyReport(
        String date,
        String timezone,
        String engineId,
        String generatedAt,
        List<EngineOption> engines,
        Summary summary,
        List<FunnelStage> funnel,
        List<TrendDay> trend,
        /** Only for "All engines" (engineId null); null for one engine. */
        List<EngineRow> perEngine,
        List<ListRow> lists,
        Runs runs,
        List<ChannelRow> channels,
        Calls calls,
        Email email,
        WhatsApp whatsapp,
        List<TemplateRow> templates,
        Outcomes outcomes,
        Costs costs,
        RealCost realCost,
        List<Health> health,
        Map<String, String> errors) {

    public record EngineOption(String id, String name, String status, boolean system) {
    }

    public record Summary(
            long leadsAdded, long newLeads, long existingLeads,
            long decisions, long waited, long failed,
            long contacted, long emailsSent, long whatsappSent, long inAppSent, long callsPlaced,
            long delivered, long replies, long callsConnected,
            long demosBooked, long demosScheduled, long demosDone, long conversions, long statusChanges, long optOuts,
            double creditsSpent,
            Money whatsappCost,
            Double costPerReply, Double costPerDemo, Double costPerConversion,
            Double creditBalance, Double creditRunwayDays) {
    }

    /**
     * estimated: some messages were priced without Meta's pricing (template category guessed).
     * partial: some billable messages could not be priced at all (no rate for the country or
     * category, or the rate card could not be read), so amount is a lower bound.
     */
    public record Money(double amount, String currency, boolean estimated, boolean partial) {
    }

    public record FunnelStage(String stage, long count) {
    }

    public record TrendDay(String date, long sent, long replies, long demosBooked, double credits, long statusChanges) {
    }

    public record EngineRow(String engineId, String name, boolean system, long leadsAdded, long sent, long replies,
                            double replyRate, long demosBooked, long conversions, double credits, Double costPerReply) {
    }

    public record ListRow(String listId, String name, String kind, long leadsAdded, long newLeads, long existingLeads,
                          LeadAgent leadAgent) {
    }

    public record LeadAgent(String agentId, String name, long discovered, long researched, long delivered, long review,
                            long rejected, long alreadyInCrm, long searches, long pages, double credits) {
    }

    /** byKind keys: SEND, TASK, NO_OP, REPLY. */
    public record Runs(long decisions, long membersEvaluated, Map<String, Long> byKind, long failed, long expired,
                       List<ErrorCount> topErrors) {
    }

    public record ErrorCount(String message, long count) {
    }

    public record ChannelRow(String channel, long sent, long delivered, long read, long replied, long failed,
                             double replyRate, double credits) {
    }

    public record Calls(long placed, long notDialled, long connected, long noAnswer, long busy, long failed,
                        long inProgress, double totalMinutes, long avgDurationSec, double credits) {
    }

    public record Email(long sent, long delivered, long opened, long clicked, long bounced, long complained,
                        double bounceRate, boolean tracked, boolean repliesTracked) {
    }

    public record WhatsApp(long sent, long delivered, long read, long failed, long replied, boolean deliveryTracked,
                           long billable, List<CategoryCost> byCategory) {
    }

    public record CategoryCost(String category, long count, double rate, double cost, String currency,
                               boolean estimated) {
    }

    public record TemplateRow(String channel, String name, long sent, long delivered, long read, long replied,
                              double replyRate, long bounced, double cost, String currency) {
    }

    public record Outcomes(long demosBooked, long demosScheduled, long demosDone, long demosNoShow,
                           long demosNotMarked, long conversions, List<StatusChange> statusChanges) {
    }

    /**
     * byTeam: a person moved it (lead page, bulk change, call disposition). byAutomation: anything
     * else but the engine (AI calling, workflows, WhatsApp flows, cold-email replies, backfills).
     */
    public record StatusChange(String from, String to, long byEngine, long byTeam, long byAutomation) {
    }

    public record Costs(CreditCosts credits, WhatsAppCost whatsapp, AiUsage ai) {
    }

    public record CreditCosts(double messages, double calls, double leadAgent, double total) {
    }

    /** partial: missingRate > 0, so amount is a lower bound (see Money). */
    public record WhatsAppCost(double amount, String currency, long billableMessages, long estimatedMessages,
                               long missingRate, boolean partial) {
    }

    /** trackedSince: first institute-local day with token data in the report's 90-day range, else null. */
    public record AiUsage(long tokensIn, long tokensOut, long decisionsWithUsage, String trackedSince) {
    }

    /** USD; callsUsd stays null until a call provider rate exists (design D12). */
    public record RealCost(double aiUsd, double leadAgentUsd, Double callsUsd, double totalUsd) {
    }

    /**
     * code: EMAIL_BOUNCE_HIGH | EMAIL_COMPLAINTS | WHATSAPP_FAILED_HIGH | OPT_OUTS | CREDITS_LOW | TRACKING_OFF;
     * severity: info | warning | critical. channel is set only for TRACKING_OFF (EMAIL or WHATSAPP).
     */
    public record Health(String code, String severity, double value, String channel) {
    }
}
