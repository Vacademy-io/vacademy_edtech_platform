package vacademy.io.admin_core_service.features.marketing.service;

import com.fasterxml.jackson.databind.JsonNode;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Pure mapping from platform report rows to {@link SpendRow}s (one per campaign per day), the
 * shape written into ad_spend_daily. No I/O, so the parsing rules are unit-tested directly.
 *
 * <ul>
 *   <li>Meta insights (level=campaign, time_increment=1): day = date_start, spend/impressions/clicks
 *       come back as strings, platform leads = the MAX of the lead action types (they overlap: a
 *       lead form submit is counted as both "lead" and "onsite_conversion.lead_grouped").</li>
 *   <li>Google Ads GAQL rows (REST JSON, camelCase, int64 as strings): spend = cost_micros / 1e6
 *       rounded HALF_UP to 2 decimals, channel = advertising_channel_type, leads = conversions.</li>
 * </ul>
 * Rows without a campaign id or a day are skipped, rows with every metric at zero are skipped,
 * and repeated (campaign, day) keys are summed so the upsert never sees the same key twice.
 */
public final class AdSpendRowMapper {

    /** Meta action types that mean "a lead"; they overlap, so take the max, never the sum. */
    static final Set<String> META_LEAD_ACTION_TYPES = Set.of(
            "lead", "onsite_conversion.lead_grouped", "leadgen_grouped");

    private static final BigDecimal MICROS = BigDecimal.valueOf(1_000_000L);

    private AdSpendRowMapper() {
    }

    /** One campaign on one day, ready for AdSpendDailyRepository#upsert. */
    public record SpendRow(String campaignId, String campaignName, String channel, LocalDate day,
                           BigDecimal spend, String currency, long impressions, long clicks,
                           BigDecimal platformLeads) {

        boolean isEmpty() {
            return spend.signum() == 0 && impressions == 0 && clicks == 0 && platformLeads.signum() == 0;
        }

        String key() {
            return campaignId + "|" + day;
        }
    }

    // ── Meta ─────────────────────────────────────────────────────────────────

    public static List<SpendRow> fromMetaInsights(Collection<JsonNode> rows, String fallbackCurrency) {
        Map<String, SpendRow> byKey = new LinkedHashMap<>();
        if (rows == null) return List.of();
        for (JsonNode row : rows) {
            String campaignId = text(row, "campaign_id");
            LocalDate day = date(text(row, "date_start"));
            if (campaignId == null || day == null) continue;
            String currency = text(row, "account_currency");
            SpendRow mapped = new SpendRow(
                    campaignId,
                    text(row, "campaign_name"),
                    MarketingConstants.CHANNEL_META,
                    day,
                    money(decimal(row.path("spend"))),
                    currency != null ? currency : fallbackCurrency,
                    integer(row.path("impressions")),
                    integer(row.path("clicks")),
                    leads(metaLeads(row.path("actions"))));
            merge(byKey, mapped);
        }
        return new ArrayList<>(byKey.values());
    }

    /** Max value among the lead action types of a Meta {@code actions} array (0 when none). */
    public static BigDecimal metaLeads(JsonNode actions) {
        BigDecimal best = BigDecimal.ZERO;
        if (actions == null || !actions.isArray()) return best;
        for (JsonNode action : actions) {
            String type = action.path("action_type").asText("");
            if (!META_LEAD_ACTION_TYPES.contains(type)) continue;
            BigDecimal value = decimal(action.path("value"));
            if (value.compareTo(best) > 0) best = value;
        }
        return best;
    }

    // ── Google ───────────────────────────────────────────────────────────────

    public static List<SpendRow> fromGoogleSearch(Collection<JsonNode> rows, String currency) {
        Map<String, SpendRow> byKey = new LinkedHashMap<>();
        if (rows == null) return List.of();
        for (JsonNode row : rows) {
            JsonNode campaign = row.path("campaign");
            JsonNode metrics = row.path("metrics");
            String campaignId = text(campaign, "id");
            LocalDate day = date(text(row.path("segments"), "date"));
            if (campaignId == null || day == null) continue;
            BigDecimal micros = decimal(metrics.path("costMicros"));
            SpendRow mapped = new SpendRow(
                    campaignId,
                    text(campaign, "name"),
                    text(campaign, "advertisingChannelType"),
                    day,
                    micros.divide(MICROS, 2, RoundingMode.HALF_UP),
                    currency,
                    integer(metrics.path("impressions")),
                    integer(metrics.path("clicks")),
                    leads(decimal(metrics.path("conversions"))));
            merge(byKey, mapped);
        }
        return new ArrayList<>(byKey.values());
    }

    /** The GAQL query for daily campaign spend over [from, to] (inclusive). */
    public static String googleSpendQuery(LocalDate from, LocalDate to) {
        return "SELECT campaign.id, campaign.name, campaign.advertising_channel_type, segments.date, "
                + "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions "
                + "FROM campaign WHERE segments.date BETWEEN '" + from + "' AND '" + to + "'";
    }

    // ── Request windows ──────────────────────────────────────────────────────

    /**
     * Splits [from, to] (inclusive) for Meta insights: one request when the window is at most
     * {@code singleRequestMaxDays} long, else consecutive {@code chunkDays}-day windows (the last
     * one shorter). Daily campaign insights over months in one request are slow and can be refused
     * by Meta ("reduce the amount of data").
     */
    public static List<LocalDate[]> metaRequestWindows(LocalDate from, LocalDate to,
                                                       int singleRequestMaxDays, int chunkDays) {
        List<LocalDate[]> windows = new ArrayList<>();
        if (from == null || to == null || from.isAfter(to)) return windows;
        long days = ChronoUnit.DAYS.between(from, to) + 1;
        if (days <= singleRequestMaxDays) {
            windows.add(new LocalDate[]{from, to});
            return windows;
        }
        int step = Math.max(1, chunkDays);
        LocalDate start = from;
        while (!start.isAfter(to)) {
            LocalDate end = start.plusDays(step - 1L);
            if (end.isAfter(to)) end = to;
            windows.add(new LocalDate[]{start, end});
            start = end.plusDays(1);
        }
        return windows;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static void merge(Map<String, SpendRow> byKey, SpendRow row) {
        if (row.isEmpty()) return;
        byKey.merge(row.key(), row, (a, b) -> new SpendRow(
                a.campaignId(),
                b.campaignName() != null ? b.campaignName() : a.campaignName(),
                a.channel() != null ? a.channel() : b.channel(),
                a.day(),
                a.spend().add(b.spend()),
                a.currency() != null ? a.currency() : b.currency(),
                a.impressions() + b.impressions(),
                a.clicks() + b.clicks(),
                a.platformLeads().add(b.platformLeads())));
    }

    private static String text(JsonNode node, String field) {
        if (node == null) return null;
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) return null;
        String s = value.asText();
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static LocalDate date(String raw) {
        if (raw == null) return null;
        try {
            return LocalDate.parse(raw.length() > 10 ? raw.substring(0, 10) : raw);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** Numeric JSON value or numeric string; 0 when missing or not a number. */
    private static BigDecimal decimal(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) return BigDecimal.ZERO;
        if (node.isNumber()) return node.decimalValue();
        String s = node.asText("").trim();
        if (s.isEmpty()) return BigDecimal.ZERO;
        try {
            return new BigDecimal(s);
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    private static long integer(JsonNode node) {
        return decimal(node).setScale(0, RoundingMode.HALF_UP).longValue();
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    private static BigDecimal leads(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }
}
