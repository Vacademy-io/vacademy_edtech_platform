package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import vacademy.io.admin_core_service.features.audience.dto.CounselorPerformanceDTO;
import vacademy.io.admin_core_service.features.audience.dto.LeadReportProjections;
import vacademy.io.admin_core_service.features.audience.dto.LeadReportSummaryDTO;
import vacademy.io.admin_core_service.features.audience.dto.LeadSlaConfigDTO;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Builds the two read-only Lead Reports endpoints: a summary (KPIs + breakdowns + daily trend)
 * and per-counsellor performance. Pure aggregation over existing tables — never writes anything,
 * so it can never break any business rule. Date range defaults to the last 30 days when omitted.
 *
 * Every report is RBAC-scoped to the caller via {@link ReportScopeResolver} (same rules as
 * the sales dashboard), and optionally narrowed by team, counsellor, audience/campaign and
 * source-type dimensions.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadReportService {

    private final AudienceResponseRepository audienceResponseRepository;
    private final LeadStatusRepository leadStatusRepository;
    private final LeadSlaConfigService leadSlaConfigService;
    private final AuthService authService;
    private final ReportScopeResolver reportScopeResolver;
    private final vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService counsellorScopeService;
    private final LeadReportSettingService settingService;

    private static final int DEFAULT_RANGE_DAYS = 30;

    // ─────────────────────────────────────────────────────────────────────
    // Lead Reports — summary
    // ─────────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public LeadReportSummaryDTO getLeadSummary(String instituteId, String fromDate, String toDate,
                                               String teamId, String counsellorUserId,
                                               String audienceId, String sourceType,
                                               String callerUserId) {
        DateRange range = resolveRange(fromDate, toDate, instituteId);
        LeadSlaConfigDTO.TatReminder tat = resolveTat(instituteId); // null when TAT disabled
        Integer tatMinutes = tat != null ? tat.getTatMinutes() : null;
        Integer tatMinutesParam = tatMinutes != null ? tatMinutes : 0;
        String tatRule = tat != null ? tat.getWorkingHoursRule() : null;

        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));
        String audienceFilter = trimToNull(audienceId);
        String sourceFilter = trimToNull(sourceType);

        LeadReportProjections.TotalsProjection totals =
                audienceResponseRepository.findReportTotals(instituteId, range.from, range.to,
                        scopeCsv, audienceFilter, sourceFilter);
        LeadReportProjections.ResponseStatsProjection response =
                audienceResponseRepository.findReportResponseStats(instituteId, range.from, range.to, tatMinutesParam, tatRule,
                        scopeCsv, audienceFilter, sourceFilter);
        List<LeadReportProjections.StatusCountProjection> statusRows =
                audienceResponseRepository.findReportStatusBreakdown(instituteId, range.from, range.to,
                        scopeCsv, audienceFilter, sourceFilter);
        List<LeadReportProjections.SourceCountProjection> sourceRows =
                audienceResponseRepository.findReportSourceBreakdown(instituteId, range.from, range.to,
                        scopeCsv, audienceFilter, sourceFilter);
        List<LeadReportProjections.TierCountProjection> tierRows =
                audienceResponseRepository.findReportTierBreakdown(instituteId, range.from, range.to,
                        scopeCsv, audienceFilter, sourceFilter);
        List<LeadReportProjections.DailyTrendProjection> trendRows =
                audienceResponseRepository.findReportDailyTrend(instituteId, range.from, range.to,
                        range.zone, scopeCsv, audienceFilter, sourceFilter);

        long total = nz(totals != null ? totals.getTotalLeads() : null);
        long converted = nz(totals != null ? totals.getConvertedLeads() : null);
        long lost = nz(totals != null ? totals.getLostLeads() : null);
        long active = nz(totals != null ? totals.getActiveLeads() : null);
        long overdue = nz(totals != null ? totals.getOverdueLeads() : null);
        long responded = nz(response != null ? response.getRespondedLeads() : null);
        Double avgResponseMin = response != null ? response.getAvgResponseMinutes() : null;
        Long tatMet = (tatMinutes == null || response == null) ? null : response.getTatMetCount();

        LeadReportSummaryDTO.Totals totalsDto = LeadReportSummaryDTO.Totals.builder()
                .totalLeads(total)
                .convertedLeads(converted)
                .lostLeads(lost)
                .activeLeads(active)
                .conversionRate(percentage(converted, total))
                .respondedLeads(responded)
                .avgResponseMinutes(avgResponseMin)
                .tatMetCount(tatMet)
                .tatMetRate(tatMet == null ? null : percentage(tatMet, responded))
                .overdueLeads(overdue)
                .build();

        // Resolve status_key → (label, color) from the catalog so the FE doesn't need a second call.
        Map<String, LeadStatus> catalog = leadStatusRepository
                .findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(instituteId).stream()
                .collect(Collectors.toMap(LeadStatus::getStatusKey, s -> s, (a, b) -> a));

        List<LeadReportSummaryDTO.StatusBreakdown> statusBreakdown = statusRows.stream()
                .map(r -> {
                    LeadStatus s = catalog.get(r.getStatusKey());
                    return LeadReportSummaryDTO.StatusBreakdown.builder()
                            .statusKey(r.getStatusKey())
                            .label(s != null ? s.getLabel() : r.getStatusKey())
                            .color(s != null ? s.getColor() : null)
                            .count(nz(r.getLeadCount()))
                            .build();
                })
                .collect(Collectors.toList());

        List<LeadReportSummaryDTO.SourceBreakdown> sourceBreakdown = sourceRows.stream()
                .map(r -> LeadReportSummaryDTO.SourceBreakdown.builder()
                        .sourceType(r.getSourceType())
                        .total(nz(r.getTotalCount()))
                        .converted(nz(r.getConvertedCount()))
                        .build())
                .collect(Collectors.toList());

        List<LeadReportSummaryDTO.TierBreakdown> tierBreakdown = tierRows.stream()
                .map(r -> LeadReportSummaryDTO.TierBreakdown.builder()
                        .tier(r.getTier())
                        .count(nz(r.getLeadCount()))
                        .build())
                .collect(Collectors.toList());

        List<LeadReportSummaryDTO.DailyTrendPoint> trend = trendRows.stream()
                .map(r -> LeadReportSummaryDTO.DailyTrendPoint.builder()
                        .date(r.getDay() != null ? r.getDay().toString() : null)
                        .submitted(nz(r.getSubmittedCount()))
                        .converted(nz(r.getConvertedCount()))
                        .build())
                .collect(Collectors.toList());

        return LeadReportSummaryDTO.builder()
                .fromDate(range.fromLocal)
                .toDate(range.toLocal)
                .totals(totalsDto)
                .byStatus(statusBreakdown)
                .bySource(sourceBreakdown)
                .byTier(tierBreakdown)
                .trendByDay(trend)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Counsellor performance
    // ─────────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public CounselorPerformanceDTO getCounselorPerformance(String instituteId, String fromDate, String toDate,
                                                           String teamId, String counsellorUserId,
                                                           String audienceId, String sourceType,
                                                           String callerUserId) {
        DateRange range = resolveRange(fromDate, toDate, instituteId);
        LeadSlaConfigDTO.TatReminder tat = resolveTat(instituteId);
        Integer tatMinutes = tat != null ? tat.getTatMinutes() : null;
        Integer tatMinutesParam = tatMinutes != null ? tatMinutes : 0;
        String tatRule = tat != null ? tat.getWorkingHoursRule() : null;

        String scopeCsv = reportScopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(teamId), trimToNull(counsellorUserId));

        List<LeadReportProjections.CounselorRowProjection> raw = audienceResponseRepository
                .findReportCounselorPerformance(instituteId, range.from, range.to, tatMinutesParam, tatRule,
                        scopeCsv, trimToNull(audienceId), trimToNull(sourceType));

        // Every ACTIVE counsellor in the caller's scope must get a row — the
        // SQL groups the lead DATA, so a counsellor with zero leads in the
        // window produced no row at all and read as "missing" in the report.
        // Zero rows are appended after the data-driven ones (below).
        List<String> scopedCounsellors = scopedActiveCounsellors(instituteId, scopeCsv);

        // Batch-resolve counsellor names (one call to auth-service for all ids
        // in the result AND the zero-padded roster).
        Map<String, String> nameById = Collections.emptyMap();
        List<String> ids = java.util.stream.Stream.concat(
                        raw.stream().map(LeadReportProjections.CounselorRowProjection::getCounselorId),
                        scopedCounsellors.stream())
                .filter(s -> s != null && !s.isBlank()).distinct().collect(Collectors.toList());
        if (!ids.isEmpty()) {
            try {
                List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(ids);
                if (!CollectionUtils.isEmpty(users)) {
                    nameById = users.stream().filter(u -> u != null && u.getId() != null)
                            .collect(Collectors.toMap(UserDTO::getId, UserDTO::getFullName, (a, b) -> a));
                }
            } catch (Exception ex) {
                log.warn("[LeadReport] Failed to resolve counsellor names: {}", ex.getMessage());
            }
        }

        final Map<String, String> nameByIdFinal = nameById;
        List<CounselorPerformanceDTO.Row> rows = raw.stream().map(r -> {
            long assigned = nz(r.getLeadsAssigned());
            long responded = nz(r.getLeadsResponded());
            long conversions = nz(r.getConversions());
            Long tatMet = tatMinutes == null ? null : r.getTatMetCount();
            return CounselorPerformanceDTO.Row.builder()
                    .counselorId(r.getCounselorId())
                    .counselorName(Optional.ofNullable(nameByIdFinal.get(r.getCounselorId()))
                            .filter(s -> !s.isBlank())
                            .orElse(r.getCounselorId()))
                    .leadsAssigned(assigned)
                    .leadsResponded(responded)
                    .conversions(conversions)
                    .conversionRate(percentage(conversions, assigned))
                    .avgResponseMinutes(r.getAvgResponseMinutes())
                    .tatMetCount(tatMet)
                    .tatMetRate(tatMet == null ? null : percentage(tatMet, responded))
                    .openLeads(nz(r.getOpenLeads()))
                    .overdueLeads(nz(r.getOverdueLeads()))
                    .build();
        }).collect(Collectors.toList());

        // Zero rows for scoped active counsellors with no lead data in the
        // window, name-sorted after the data-driven rows.
        Set<String> presentIds = rows.stream()
                .map(CounselorPerformanceDTO.Row::getCounselorId)
                .collect(Collectors.toSet());
        scopedCounsellors.stream()
                .filter(id -> !presentIds.contains(id))
                .map(id -> CounselorPerformanceDTO.Row.builder()
                        .counselorId(id)
                        .counselorName(Optional.ofNullable(nameByIdFinal.get(id))
                                .filter(s -> !s.isBlank())
                                .orElse(id))
                        .leadsAssigned(0)
                        .leadsResponded(0)
                        .conversions(0)
                        .conversionRate(null)
                        .avgResponseMinutes(null)
                        .tatMetCount(tatMinutes == null ? null : 0L)
                        .tatMetRate(null)
                        .openLeads(0)
                        .overdueLeads(0)
                        .build())
                .sorted(Comparator.comparing(CounselorPerformanceDTO.Row::getCounselorName,
                        String.CASE_INSENSITIVE_ORDER))
                .forEach(rows::add);

        // Summary: weighted averages so a few heavy counsellors don't get equal weight to outliers.
        long totalAssigned = rows.stream().mapToLong(CounselorPerformanceDTO.Row::getLeadsAssigned).sum();
        long totalConversions = rows.stream().mapToLong(CounselorPerformanceDTO.Row::getConversions).sum();
        double avgResponseWeighted = weightedAvg(
                rows.stream().filter(r -> r.getAvgResponseMinutes() != null && r.getLeadsResponded() > 0)
                        .collect(Collectors.toList()),
                r -> r.getAvgResponseMinutes(),
                r -> (double) r.getLeadsResponded());

        CounselorPerformanceDTO.Summary summary = CounselorPerformanceDTO.Summary.builder()
                .totalCounselors(rows.size())
                .avgResponseMinutes(Double.isNaN(avgResponseWeighted) ? null : avgResponseWeighted)
                .avgConversionRate(totalAssigned == 0 ? null : (totalConversions * 100.0) / totalAssigned)
                .build();

        return CounselorPerformanceDTO.builder()
                .fromDate(range.fromLocal)
                .toDate(range.toLocal)
                .tatMinutes(tatMinutes)
                .tatHours(tatMinutes == null ? null : (tatMinutes + 59) / 60)
                .rows(rows)
                .summary(summary)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private static String trimToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    /**
     * The ACTIVE counsellor-role users inside the resolved report scope — the
     * roster that per-counsellor reports must render even with zero activity.
     * The scope CSV may also carry non-counsellor ids (explicit teamId filters
     * list whole teams), so it's intersected with the role roster. Empty when
     * the scope is unfiltered (setup mode — nothing sensible to pad with).
     */
    private List<String> scopedActiveCounsellors(String instituteId, String scopeCsv) {
        if (scopeCsv == null || scopeCsv.isBlank()) return List.of();
        Set<String> counsellors = new java.util.HashSet<>(
                counsellorScopeService.allCounsellorUserIds(instituteId));
        return java.util.Arrays.stream(scopeCsv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty() && counsellors.contains(s))
                .distinct()
                .collect(Collectors.toList());
    }

    /** The TAT config when TAT is enabled; null otherwise (drives "is TAT shown?" downstream). */
    private LeadSlaConfigDTO.TatReminder resolveTat(String instituteId) {
        try {
            LeadSlaConfigDTO sla = leadSlaConfigService.getSchedulerConfig(instituteId);
            if (sla != null && sla.getTatReminder() != null && sla.getTatReminder().isEnabled()) {
                return sla.getTatReminder();
            }
        } catch (Exception ex) {
            log.debug("[LeadReport] No SLA config for institute {}: {}", instituteId, ex.getMessage());
        }
        return null;
    }

    /**
     * Parse [from, to] as ISO yyyy-MM-dd days in the INSTITUTE timezone (report settings); default to
     * the last 30 days. Columns store UTC wall clock, so the query bounds are each day's local midnight
     * converted to UTC; fromLocal/toLocal keep the local midnights for the response.
     */
    private DateRange resolveRange(String fromDate, String toDate, String instituteId) {
        ZoneId zone;
        try {
            zone = ZoneId.of(settingService.get(instituteId).timezone());
        } catch (Exception e) {
            zone = ZoneId.of("Asia/Kolkata");
        }
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        // Inclusive-of-day on both ends; query uses '<' on the upper bound so add a day.
        return new DateRange(
                utcWallClock(from, zone),
                utcWallClock(to.plusDays(1), zone),
                from.atStartOfDay().toString(),
                to.plusDays(1).atStartOfDay().toString(),
                zone.getId());
    }

    private static String utcWallClock(LocalDate day, ZoneId zone) {
        return day.atStartOfDay(zone).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime().toString();
    }

    private static LocalDate parseOr(String iso, LocalDate fallback) {
        if (iso == null || iso.isBlank()) return fallback;
        try { return LocalDate.parse(iso); } catch (Exception e) { return fallback; }
    }

    private static long nz(Long v) { return v == null ? 0L : v; }

    /** numerator/denominator * 100, rounded to one decimal; null when denominator is 0. */
    private static Double percentage(long num, long denom) {
        if (denom == 0) return null;
        return Math.round((num * 1000.0) / denom) / 10.0;
    }

    /** Sum(value * weight) / Sum(weight). Returns NaN when total weight is 0. */
    private static <T> double weightedAvg(List<T> rows,
                                          java.util.function.Function<T, Double> value,
                                          java.util.function.Function<T, Double> weight) {
        double num = 0, den = 0;
        for (T r : rows) {
            Double v = value.apply(r); Double w = weight.apply(r);
            if (v == null || w == null) continue;
            num += v * w; den += w;
        }
        return den == 0 ? Double.NaN : (num / den);
    }

    private record DateRange(String from, String to, String fromLocal, String toLocal, String zone) {
        // from/to: ISO LocalDateTime strings (UTC wall clock) the native query CASTs to timestamp.
    }
}
