package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.NormalizedLeadData;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;
import vacademy.io.admin_core_service.features.audience.repository.FormWebhookConnectorRepository;
import vacademy.io.admin_core_service.features.audience.strategy.MetaLeadAdsStrategy;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * One-time fill of the ad columns (campaign, ad set, ad, form) on Meta leads that arrived
 * before those columns existed (V672 added them with no backfill).
 *
 * <p>Our leads never stored Meta's lead id, so a lead cannot be read back by id. Instead this
 * reads each of the institute's Meta forms again through the poller's own read
 * ({@link MetaLeadAdsStrategy#fetchLeadsSince}, which asks for the ad fields; Meta keeps a form's
 * leads for 90 days) and matches every Meta lead to one of our Meta leads with no ad ids yet:
 * same phone (last 10 digits; email when the Meta lead has no phone), submitted at most
 * {@link #BEFORE_SECONDS} before to {@link #AFTER_SECONDS} after Meta's created_time (webhook and
 * poller delays), closest first. Each of our leads is used once.
 *
 * <p>Writes only the ad columns, only on rows whose campaign, ad set and ad ids are all still
 * empty, so it never overwrites what intake recorded and a second run changes nothing. No
 * trigger, workflow, notification or score is touched. {@code dryRun} (the default) only counts.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MetaAdAttributionBackfillService {

    static final String VENDOR = "META_LEAD_ADS";
    static final int MAX_DAYS = 90;
    static final int MAX_PAGES = 200;
    static final long BEFORE_SECONDS = 10 * 60;
    static final long AFTER_SECONDS = 72 * 3600;

    private static final DateTimeFormatter META_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssZ");

    private final JdbcTemplate jdbc;
    private final FormWebhookConnectorRepository connectorRepository;
    private final MetaLeadAdsStrategy metaLeadAdsStrategy;

    public record ConnectorResult(String connectorId, String formName, int fetched, int withAdIds,
                                  int matched, int updated, String error) {
    }

    public record Result(String instituteId, boolean dryRun, int days, int leadsWithoutAdIds,
                         int fetched, int withAdIds, int matched, int updated, int unmatched,
                         List<ConnectorResult> connectors) {
    }

    /** One of our Meta leads that has no ad ids yet. */
    record OurLead(String id, String phone10, String email, long createdAtEpoch) {
    }

    static final String OUR_LEADS_SQL = """
            SELECT ar.id,
                   RIGHT(regexp_replace(COALESCE(ar.parent_mobile, ''), '[^0-9]', '', 'g'), 10) AS phone10,
                   LOWER(TRIM(ar.parent_email)) AS email,
                   ar.created_at
            FROM audience_response ar
            JOIN audience a ON a.id = ar.audience_id
            WHERE a.institute_id = ?
              AND ar.source_type = 'META_LEAD_ADS'
              AND ar.ad_campaign_id IS NULL AND ar.ad_set_id IS NULL AND ar.ad_id IS NULL
              AND ar.created_at >= ?
            """;

    static final String CONNECTOR_IDS_SQL = """
            SELECT id FROM form_webhook_connector
            WHERE institute_id = ? AND vendor = ?
              AND oauth_access_token_enc IS NOT NULL
              AND platform_form_id IS NOT NULL AND platform_form_id <> ''
            """;

    static final String UPDATE_SQL = """
            UPDATE audience_response
               SET ad_campaign_id = ?, ad_campaign_name = ?, ad_set_id = ?, ad_set_name = ?,
                   ad_id = ?, ad_name = ?, ad_form_id = COALESCE(ad_form_id, ?)
             WHERE id = ? AND ad_campaign_id IS NULL AND ad_set_id IS NULL AND ad_id IS NULL
            """;

    public Result backfill(String instituteId, Integer daysParam, boolean dryRun) {
        int days = daysParam == null ? MAX_DAYS : Math.max(1, Math.min(MAX_DAYS, daysParam));
        long sinceEpoch = Instant.now().getEpochSecond() - days * 86400L;

        List<OurLead> ours = jdbc.query(OUR_LEADS_SQL, (rs, i) -> new OurLead(
                rs.getString("id"),
                emptyToNull(rs.getString("phone10")),
                emptyToNull(rs.getString("email")),
                rs.getTimestamp("created_at").toLocalDateTime().toEpochSecond(java.time.ZoneOffset.UTC)),
                instituteId, Timestamp.from(Instant.ofEpochSecond(sinceEpoch - 86400L)));
        Set<String> used = new HashSet<>();

        List<String> connectorIds = jdbc.queryForList(CONNECTOR_IDS_SQL, String.class, instituteId, VENDOR);
        List<ConnectorResult> perConnector = new ArrayList<>();
        int fetched = 0, withAd = 0, matched = 0, updated = 0;
        for (FormWebhookConnector connector : connectorRepository.findAllById(connectorIds)) {
            int cFetched = 0, cWithAd = 0, cMatched = 0, cUpdated = 0;
            String error = null;
            try {
                List<NormalizedLeadData> leads = metaLeadAdsStrategy
                        .fetchLeadsSince(connector, sinceEpoch, MAX_PAGES).leads();
                cFetched = leads.size();
                for (NormalizedLeadData lead : leads) {
                    if (!hasAdIds(lead)) continue;
                    cWithAd++;
                    OurLead match = match(lead, ours, used);
                    if (match == null) continue;
                    used.add(match.id());
                    cMatched++;
                    if (!dryRun) {
                        cUpdated += jdbc.update(UPDATE_SQL,
                                cut(lead.getAdCampaignId(), 100), cut(lead.getAdCampaignName(), 255),
                                cut(lead.getAdSetId(), 100), cut(lead.getAdSetName(), 255),
                                cut(lead.getAdId(), 100), cut(lead.getAdName(), 255),
                                cut(lead.getAdFormId(), 100), match.id());
                    }
                }
            } catch (Exception e) {
                error = e.getMessage();
                log.warn("Meta ad backfill: connector {} failed: {}", connector.getId(), e.getMessage());
            }
            perConnector.add(new ConnectorResult(connector.getId(), connector.getPlatformFormName(),
                    cFetched, cWithAd, cMatched, cUpdated, error));
            fetched += cFetched;
            withAd += cWithAd;
            matched += cMatched;
            updated += cUpdated;
        }
        log.info("Meta ad backfill institute={} dryRun={} days={}: fetched {}, with ad ids {}, matched {}, updated {}",
                instituteId, dryRun, days, fetched, withAd, matched, updated);
        return new Result(instituteId, dryRun, days, ours.size(), fetched, withAd, matched, updated,
                ours.size() - used.size(), perConnector);
    }

    /** Our closest unused lead with the same phone (or email when Meta has no phone) in the time window. */
    static OurLead match(NormalizedLeadData lead, List<OurLead> ours, Set<String> used) {
        Long metaTime = parseMetaTime(lead.getPlatformCreatedTime());
        if (metaTime == null) return null;
        String phone10 = last10(lead.getPhone());
        String email = lead.getEmail() == null ? null : lead.getEmail().trim().toLowerCase(Locale.ROOT);
        if (phone10 == null && (email == null || email.isEmpty())) return null;
        OurLead best = null;
        long bestGap = Long.MAX_VALUE;
        for (OurLead o : ours) {
            if (used.contains(o.id())) continue;
            boolean same = phone10 != null ? phone10.equals(o.phone10()) : email.equals(o.email());
            if (!same) continue;
            long gap = o.createdAtEpoch() - metaTime;
            if (gap < -BEFORE_SECONDS || gap > AFTER_SECONDS) continue;
            if (Math.abs(gap) < bestGap) {
                bestGap = Math.abs(gap);
                best = o;
            }
        }
        return best;
    }

    static boolean hasAdIds(NormalizedLeadData lead) {
        return lead.getAdCampaignId() != null || lead.getAdSetId() != null || lead.getAdId() != null;
    }

    static Long parseMetaTime(String createdTime) {
        if (createdTime == null || createdTime.isBlank()) return null;
        try {
            return OffsetDateTime.parse(createdTime.trim(), META_TIME).toEpochSecond();
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(createdTime.trim()).toEpochSecond();
            } catch (DateTimeParseException e2) {
                return null;
            }
        }
    }

    static String last10(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        return digits.length() < 10 ? null : digits.substring(digits.length() - 10);
    }

    private static String cut(String s, int max) {
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;
        return t.length() <= max ? t : t.substring(0, max);
    }

    private static String emptyToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }
}
