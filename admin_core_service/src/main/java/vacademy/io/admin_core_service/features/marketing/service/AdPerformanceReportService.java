package vacademy.io.admin_core_service.features.marketing.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.dto.AdAccountDTO;
import vacademy.io.admin_core_service.features.marketing.dto.AdPerformanceDTO;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.repository.AdAccountRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Types;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Ad performance report: synced ad spend next to the enquiries and admissions the CRM attributes
 * to Meta, Google and YouTube (see {@link AdPerformanceSql} for the attribution rules).
 *
 * <p>Load rules: both queries run in one read-only transaction (routed to the replica) with an 8s
 * statement timeout; aggregation is SQL + a small in-memory fold; results are cached 2 minutes per
 * (institute, from, to). The connected-account list is read fresh on every call so a sync or a
 * disconnect shows at once.
 */
@Service
@Slf4j
public class AdPerformanceReportService {

    static final int DEFAULT_RANGE_DAYS = 30;
    static final int MAX_RANGE_DAYS = 400;
    static final Duration CACHE_TTL = Duration.ofMinutes(2);
    static final List<String> PLATFORM_ORDER = List.of(
            MarketingConstants.PLATFORM_META, MarketingConstants.PLATFORM_GOOGLE, MarketingConstants.PLATFORM_YOUTUBE);
    private static final String DEFAULT_CURRENCY = "INR";
    private static final String STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '8s'";

    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate readOnlyTx;
    private final LeadReportSettingService leadReportSettingService;
    private final AdAccountRepository adAccountRepository;
    private final MarketingConnectionService connectionService;

    private final Cache<String, AdPerformanceDTO> cache = Caffeine.newBuilder()
            .expireAfterWrite(CACHE_TTL)
            .maximumSize(1_000)
            .build();

    public AdPerformanceReportService(NamedParameterJdbcTemplate jdbc,
                                      PlatformTransactionManager transactionManager,
                                      LeadReportSettingService leadReportSettingService,
                                      AdAccountRepository adAccountRepository,
                                      MarketingConnectionService connectionService) {
        this.jdbc = jdbc;
        this.readOnlyTx = new TransactionTemplate(transactionManager);
        this.readOnlyTx.setReadOnly(true);
        this.leadReportSettingService = leadReportSettingService;
        this.adAccountRepository = adAccountRepository;
        this.connectionService = connectionService;
    }

    /** One synced spend row (ad_spend_daily), with its report platform already resolved. */
    record SpendFact(String adAccountId, String platform, String channel, String campaignId, String campaignName,
                     LocalDate day, String currency, BigDecimal spend, long clicks, long impressions,
                     BigDecimal platformLeads) {
    }

    /** kind E = enquiries, A = admissions; platform null = not from ads. */
    record AttributionFact(String kind, String platform, LocalDate day, String campaignId, long n) {
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * @param fromDate yyyy-MM-dd, inclusive (default: 29 days before {@code toDate})
     * @param toDate   yyyy-MM-dd, inclusive (default: today in the institute time zone)
     */
    public AdPerformanceDTO getPerformance(String instituteId, String fromDate, String toDate) {
        ZoneId zone = leadReportSettingService.zoneOf(instituteId);
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseDate(toDate, today, "to");
        LocalDate from = parseDate(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L), "from");
        if (from.isAfter(to)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "'from' must be on or before 'to'");
        }
        if (ChronoUnit.DAYS.between(from, to) + 1 > MAX_RANGE_DAYS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "The date range can be at most " + MAX_RANGE_DAYS + " days");
        }

        String key = instituteId + "|" + from + "|" + to + "|" + zone.getId();
        AdPerformanceDTO core = cache.get(key, k -> compute(instituteId, zone, from, to));

        List<AdAccount> accounts = adAccountRepository.findByInstituteIdAndStatusNot(
                instituteId, MarketingConstants.STATUS_DISCONNECTED);
        Map<String, MarketingConnection> connections = connectionService.findByIds(
                accounts.stream().map(AdAccount::getConnectionId).toList());
        List<AdAccountDTO> accountDtos = accounts.stream()
                .sorted(Comparator.comparing(AdAccount::getPlatform, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(AdAccount::getName, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(a -> AdAccountDTO.from(a, connections.get(a.getConnectionId())))
                .toList();
        Instant lastSynced = accounts.stream()
                .map(AdAccount::getLastSyncedAt)
                .filter(Objects::nonNull)
                .max(Comparator.naturalOrder())
                .orElse(null);
        String currency = core.getCurrency();
        if (currency == null) {
            currency = accounts.stream().map(AdAccount::getCurrency).filter(Objects::nonNull)
                    .findFirst().orElse(DEFAULT_CURRENCY);
        }
        return core.toBuilder()
                .currency(currency)
                .accounts(accountDtos)
                .lastSyncedAt(lastSynced)
                .build();
    }

    /** Drops cached reports of an institute (after a manual sync). */
    public void evictInstitute(String instituteId) {
        if (instituteId == null) return;
        String prefix = instituteId + "|";
        cache.asMap().keySet().removeIf(k -> k.startsWith(prefix));
    }

    // ── Compute ──────────────────────────────────────────────────────────────

    private AdPerformanceDTO compute(String instituteId, ZoneId zone, LocalDate from, LocalDate to) {
        long started = System.currentTimeMillis();
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("tz", zone.getId())
                .addValue("fromTs", utc(from, zone), Types.TIMESTAMP)
                .addValue("toTs", utc(to.plusDays(1), zone), Types.TIMESTAMP)
                .addValue("fromDay", java.sql.Date.valueOf(from), Types.DATE)
                .addValue("toDay", java.sql.Date.valueOf(to), Types.DATE);

        Facts facts = inTx(() -> new Facts(querySpend(params), queryAttribution(params)));
        log.debug("Ad performance computed: institute={} window={}..{} spendRows={} attributionRows={} in {} ms",
                instituteId, from, to, facts.spend().size(), facts.attribution().size(),
                System.currentTimeMillis() - started);
        return assemble(from, to, facts.spend(), facts.attribution());
    }

    private record Facts(List<SpendFact> spend, List<AttributionFact> attribution) {
    }

    private List<SpendFact> querySpend(MapSqlParameterSource params) {
        return jdbc.query(AdPerformanceSql.SPEND, params, (rs, i) -> {
            String platform = rs.getString("platform");
            String channel = rs.getString("channel");
            java.sql.Date day = rs.getDate("day");
            return new SpendFact(
                    rs.getString("ad_account_id"),
                    reportPlatform(platform, channel),
                    channel,
                    rs.getString("campaign_id"),
                    rs.getString("campaign_name"),
                    day == null ? null : day.toLocalDate(),
                    rs.getString("currency"),
                    nz(rs.getBigDecimal("spend")),
                    rs.getLong("clicks"),
                    rs.getLong("impressions"),
                    nz(rs.getBigDecimal("platform_leads")));
        });
    }

    private List<AttributionFact> queryAttribution(MapSqlParameterSource params) {
        return jdbc.query(AdPerformanceSql.ATTRIBUTION, params, (rs, i) -> {
            java.sql.Date day = rs.getDate("day");
            return new AttributionFact(
                    rs.getString("kind"),
                    rs.getString("platform"),
                    day == null ? null : day.toLocalDate(),
                    rs.getString("campaign_id"),
                    rs.getLong("n"));
        });
    }

    /** Folds the query rows into the report (no accounts / last_synced_at: added per request). */
    static AdPerformanceDTO assemble(LocalDate from, LocalDate to, List<SpendFact> spendFacts,
                                     List<AttributionFact> attributionFacts) {
        Map<String, PlatformAgg> platforms = new LinkedHashMap<>();
        for (String p : PLATFORM_ORDER) platforms.put(p, new PlatformAgg());
        Map<String, Metrics> daily = new HashMap<>();
        Map<String, CampaignAgg> campaigns = new LinkedHashMap<>();
        Map<String, BigDecimal> last7 = new HashMap<>();
        Map<String, BigDecimal> spendByCurrency = new HashMap<>();
        LocalDate last7From = to.minusDays(6).isBefore(from) ? from : to.minusDays(6);
        long unattributedEnquiries = 0;
        long unattributedAdmissions = 0;

        for (SpendFact s : spendFacts) {
            if (s.platform() == null || s.day() == null) continue;
            PlatformAgg p = platforms.computeIfAbsent(s.platform(), k -> new PlatformAgg());
            p.spend = p.spend.add(s.spend());
            p.clicks += s.clicks();
            p.impressions += s.impressions();
            p.platformLeads = p.platformLeads.add(s.platformLeads());
            if (s.spend().signum() > 0 || s.clicks() > 0 || s.impressions() > 0) p.accounts.add(s.adAccountId());

            Metrics d = daily.computeIfAbsent(dayKey(s.day(), s.platform()), k -> new Metrics());
            d.spend = d.spend.add(s.spend());

            CampaignAgg c = campaigns.computeIfAbsent(campaignKey(s.platform(), s.campaignId()),
                    k -> new CampaignAgg(s.platform(), s.campaignId()));
            c.spend = c.spend.add(s.spend());
            c.clicks += s.clicks();
            c.impressions += s.impressions();
            if (s.campaignName() != null) c.name = s.campaignName();
            if (s.channel() != null) c.channel = s.channel();

            if (!s.day().isBefore(last7From)) last7.merge(s.platform(), s.spend(), BigDecimal::add);
            if (s.currency() != null) spendByCurrency.merge(s.currency(), s.spend(), BigDecimal::add);
        }

        for (AttributionFact a : attributionFacts) {
            boolean enquiry = "E".equals(a.kind());
            if (a.platform() == null) {
                if (enquiry) unattributedEnquiries += a.n();
                else unattributedAdmissions += a.n();
                continue;
            }
            PlatformAgg p = platforms.computeIfAbsent(a.platform(), k -> new PlatformAgg());
            CampaignAgg c = campaigns.computeIfAbsent(campaignKey(a.platform(), a.campaignId()),
                    k -> new CampaignAgg(a.platform(), a.campaignId()));
            if (enquiry) {
                p.enquiries += a.n();
                c.enquiries += a.n();
            } else {
                p.admissions += a.n();
                c.admissions += a.n();
            }
            if (a.day() != null && !a.day().isBefore(from) && !a.day().isAfter(to)) {
                Metrics d = daily.computeIfAbsent(dayKey(a.day(), a.platform()), k -> new Metrics());
                if (enquiry) d.enquiries += a.n();
                else d.admissions += a.n();
            }
        }

        // Platform rows: only platforms with something to show.
        List<AdPerformanceDTO.PlatformRow> platformRows = new ArrayList<>();
        List<AdSuggestionCalculator.PlatformStat> stats = new ArrayList<>();
        BigDecimal totalSpend = BigDecimal.ZERO;
        long totalClicks = 0;
        long totalImpressions = 0;
        long totalEnquiries = 0;
        long totalAdmissions = 0;
        for (Map.Entry<String, PlatformAgg> e : platforms.entrySet()) {
            PlatformAgg p = e.getValue();
            totalSpend = totalSpend.add(p.spend);
            totalClicks += p.clicks;
            totalImpressions += p.impressions;
            totalEnquiries += p.enquiries;
            totalAdmissions += p.admissions;
            if (p.spend.signum() <= 0 && p.enquiries == 0 && p.admissions == 0) continue;
            platformRows.add(AdPerformanceDTO.PlatformRow.builder()
                    .platform(e.getKey())
                    .spend(money(p.spend))
                    .clicks(p.clicks)
                    .impressions(p.impressions)
                    .enquiries(p.enquiries)
                    .admissions(p.admissions)
                    .costPerEnquiry(cost(p.spend, p.enquiries))
                    .costPerAdmission(cost(p.spend, p.admissions))
                    .platformLeads(money(p.platformLeads))
                    .accounts(p.accounts.size())
                    .build());
            stats.add(new AdSuggestionCalculator.PlatformStat(e.getKey(), p.spend, p.admissions));
        }
        Set<String> shown = new HashSet<>();
        platformRows.forEach(r -> shown.add(r.getPlatform()));

        // Daily rows: every day of the window for every shown platform (zero-filled).
        List<AdPerformanceDTO.DailyRow> dailyRows = new ArrayList<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            for (AdPerformanceDTO.PlatformRow row : platformRows) {
                Metrics d = daily.getOrDefault(dayKey(day, row.getPlatform()), Metrics.EMPTY);
                dailyRows.add(AdPerformanceDTO.DailyRow.builder()
                        .day(day)
                        .platform(row.getPlatform())
                        .spend(money(d.spend))
                        .enquiries(d.enquiries)
                        .admissions(d.admissions)
                        .build());
            }
        }

        // Campaign rows: platform order, then spend, enquiries; the "not matched" row last.
        List<AdPerformanceDTO.CampaignRow> campaignRows = campaigns.values().stream()
                .filter(c -> shown.contains(c.platform))
                .filter(c -> c.spend.signum() > 0 || c.enquiries > 0 || c.admissions > 0 || c.clicks > 0)
                .sorted(Comparator.<CampaignAgg>comparingInt(c -> platformRank(c.platform))
                        .thenComparing(c -> c.campaignId == null)
                        .thenComparing(c -> c.spend, Comparator.reverseOrder())
                        .thenComparing(c -> c.enquiries, Comparator.reverseOrder())
                        .thenComparing(c -> c.campaignId, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(c -> AdPerformanceDTO.CampaignRow.builder()
                        .platform(c.platform)
                        .campaignId(c.campaignId)
                        .campaignName(c.name)
                        .channel(c.channel != null ? c.channel
                                : MarketingConstants.PLATFORM_META.equals(c.platform) ? MarketingConstants.CHANNEL_META
                                : null)
                        .spend(money(c.spend))
                        .clicks(c.clicks)
                        .impressions(c.impressions)
                        .enquiries(c.enquiries)
                        .admissions(c.admissions)
                        .costPerEnquiry(cost(c.spend, c.enquiries))
                        .costPerAdmission(cost(c.spend, c.admissions))
                        .build())
                .toList();

        String currency = spendByCurrency.entrySet().stream()
                .max(Map.Entry.<String, BigDecimal>comparingByValue()
                        .thenComparing(Map.Entry.<String, BigDecimal>comparingByKey()))
                .map(Map.Entry::getKey)
                .orElse(null);

        return AdPerformanceDTO.builder()
                .from(from)
                .to(to)
                .currency(currency)
                .mixedCurrency(spendByCurrency.size() > 1)
                .totals(AdPerformanceDTO.Totals.builder()
                        .spend(money(totalSpend))
                        .clicks(totalClicks)
                        .impressions(totalImpressions)
                        .enquiries(totalEnquiries)
                        .admissions(totalAdmissions)
                        .costPerEnquiry(cost(totalSpend, totalEnquiries))
                        .costPerAdmission(cost(totalSpend, totalAdmissions))
                        .build())
                .platforms(platformRows)
                .daily(dailyRows)
                .campaigns(campaignRows)
                .unattributed(AdPerformanceDTO.Unattributed.builder()
                        .enquiries(unattributedEnquiries)
                        .admissions(unattributedAdmissions)
                        .build())
                .suggestion(AdSuggestionCalculator.suggest(stats, last7))
                .build();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** META stays META; a Google VIDEO campaign is YOUTUBE; other Google channels are GOOGLE. */
    static String reportPlatform(String platform, String channel) {
        if (MarketingConstants.PLATFORM_GOOGLE.equals(platform)) {
            return MarketingConstants.CHANNEL_GOOGLE_VIDEO.equals(channel)
                    ? MarketingConstants.PLATFORM_YOUTUBE : MarketingConstants.PLATFORM_GOOGLE;
        }
        return MarketingConstants.PLATFORM_META.equals(platform) ? MarketingConstants.PLATFORM_META : null;
    }

    /** spend / n rounded to 2 decimals; null when n is 0 or there is no spend to divide. */
    static BigDecimal cost(BigDecimal spend, long n) {
        if (n <= 0 || spend == null || spend.signum() <= 0) return null;
        return spend.divide(BigDecimal.valueOf(n), 2, RoundingMode.HALF_UP);
    }

    private static BigDecimal money(BigDecimal value) {
        return (value == null ? BigDecimal.ZERO : value).setScale(2, RoundingMode.HALF_UP);
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static int platformRank(String platform) {
        int i = PLATFORM_ORDER.indexOf(platform);
        return i < 0 ? PLATFORM_ORDER.size() : i;
    }

    private static String dayKey(LocalDate day, String platform) {
        return day + "|" + platform;
    }

    private static String campaignKey(String platform, String campaignId) {
        return platform + "|" + (campaignId == null ? "" : campaignId);
    }

    private static LocalDateTime utc(LocalDate day, ZoneId zone) {
        return day.atStartOfDay(zone).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
    }

    private static LocalDate parseDate(String raw, LocalDate fallback, String name) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            return LocalDate.parse(raw.trim());
        } catch (DateTimeParseException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Invalid '" + name + "' date (expected yyyy-MM-dd): " + raw);
        }
    }

    private <T> T inTx(Supplier<T> body) {
        return readOnlyTx.execute(status -> {
            jdbc.getJdbcTemplate().execute(STATEMENT_TIMEOUT);
            return body.get();
        });
    }

    private static final class PlatformAgg {
        BigDecimal spend = BigDecimal.ZERO;
        long clicks;
        long impressions;
        long enquiries;
        long admissions;
        BigDecimal platformLeads = BigDecimal.ZERO;
        final Set<String> accounts = new HashSet<>();
    }

    private static final class Metrics {
        static final Metrics EMPTY = new Metrics();
        BigDecimal spend = BigDecimal.ZERO;
        long enquiries;
        long admissions;
    }

    private static final class CampaignAgg {
        final String platform;
        final String campaignId;
        String name;
        String channel;
        BigDecimal spend = BigDecimal.ZERO;
        long clicks;
        long impressions;
        long enquiries;
        long admissions;

        CampaignAgg(String platform, String campaignId) {
            this.platform = platform;
            this.campaignId = campaignId;
        }
    }
}
