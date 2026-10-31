package vacademy.io.admin_core_service.features.user_subscription.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.util.TimezoneNormalizer;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardAgeingProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardBatchBalanceProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardBreakdownProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardNewPayersProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardPackageSessionProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardSeriesProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentDashboardRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentDashboardResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.UpcomingMonthProjection;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentDashboardRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * The Payment Dashboard: one read-only response with every figure the page draws. See
 * {@link PaymentDashboardResponseDTO} for what each figure means and
 * {@link PaymentDashboardRepository} for how the money is counted (the same rules as the
 * Collected / Due / Upcoming cards on Manage Payments).
 */
@Service
public class PaymentDashboardService {

    private static final Logger log = LoggerFactory.getLogger(PaymentDashboardService.class);
    private static final LocalDateTime EPOCH = LocalDateTime.of(1970, 1, 1, 0, 0);
    /** Postgres rejects an empty IN list, so an unfiltered call binds a value that never matches. */
    private static final List<String> NO_SESSIONS = List.of("__none__");
    private static final int MONTHS = 24;
    private static final int YEARS = 4;
    private static final int DAYS = 182;

    @Autowired
    private PaymentDashboardRepository dashboardRepository;

    @Autowired
    private UserPlanRepository userPlanRepository;

    @Autowired
    private PaymentLogService paymentLogService;

    @Value("${payments.due.upcoming-days:30}")
    private int upcomingDays;

    public PaymentDashboardResponseDTO getDashboard(PaymentDashboardRequestDTO request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }
        String instituteId = request.getInstituteId();
        ZoneId zone = resolveZone(request.getTimeZone());
        String zoneId = zone.getId();
        // Stored timestamps and the request window are UTC, whatever zone the JVM runs in.
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        boolean allTime = request.getStartDateInUtc() == null;
        LocalDateTime start = allTime ? EPOCH : request.getStartDateInUtc();
        LocalDateTime end = request.getEndDateInUtc() != null ? request.getEndDateInUtc() : now;
        if (end.isBefore(start)) {
            throw new VacademyException("end_date_in_utc must not be before start_date_in_utc");
        }
        LocalDateTime previousStart = allTime ? null : start.minusYears(1);
        LocalDateTime previousEnd = allTime ? null : end.minusYears(1);
        boolean noSessions = CollectionUtils.isEmpty(request.getPackageSessionIds());
        List<String> sessionIds = noSessions ? NO_SESSIONS : request.getPackageSessionIds();

        // ---- Flows: money that came in during the period ----
        List<DashboardBreakdownProjection> periodSlices =
                dashboardRepository.collectedBreakdown(instituteId, start, end, noSessions, sessionIds);
        List<DashboardBreakdownProjection> previousSlices = allTime
                ? List.of()
                : dashboardRepository.collectedBreakdown(instituteId, previousStart, previousEnd, noSessions, sessionIds);
        List<DashboardBreakdownProjection> allTimeSlices = allTime
                ? periodSlices
                : dashboardRepository.collectedBreakdown(instituteId, EPOCH, now, noSessions, sessionIds);
        DashboardNewPayersProjection newPayers = dashboardRepository.countNewPayers(
                instituteId, EPOCH, now, noSessions, sessionIds,
                start, end, allTime ? start : previousStart, allTime ? end : previousEnd);

        // ---- Series: months (24 + four financial years) and days, cut in the admin's zone ----
        YearMonth endMonth = YearMonth.from(toZone(end, zone));
        YearMonth firstChartMonth = endMonth.minusMonths(MONTHS - 1L);
        YearMonth firstFyMonth = financialYearStart(endMonth).minusYears(YEARS - 1L);
        YearMonth firstSeriesMonth = firstChartMonth.isBefore(firstFyMonth) ? firstChartMonth : firstFyMonth;
        LocalDateTime seriesFrom = toUtc(firstSeriesMonth.atDay(1), zone);
        Map<String, DashboardSeriesProjection> byMonth = index(
                dashboardRepository.collectedByMonth(instituteId, seriesFrom, end, noSessions, sessionIds, zoneId));
        Map<String, DashboardSeriesProjection> newByMonth = index(
                dashboardRepository.newPayersByMonth(instituteId, EPOCH, end, noSessions, sessionIds, zoneId, seriesFrom));
        LocalDate endDay = toZone(end, zone).toLocalDate();
        LocalDate firstDay = endDay.minusDays(DAYS - 1L);
        Map<String, DashboardSeriesProjection> byDay = index(dashboardRepository.collectedByDay(
                instituteId, toUtc(firstDay, zone), end, noSessions, sessionIds, zoneId));

        // ---- Balances: owed as of today on every live enrolment ----
        BillingSummaryRequestDTO balanceRequest = new BillingSummaryRequestDTO();
        balanceRequest.setInstituteId(instituteId);
        balanceRequest.setPackageSessionIds(noSessions ? null : request.getPackageSessionIds());
        BillingSummaryResponseDTO balances = paymentLogService.getBillingSummary(balanceRequest);
        List<DashboardBatchBalanceProjection> batchBalances = dashboardRepository.balancesByBatch(
                instituteId, EPOCH, now, noSessions, sessionIds, upcomingDays);
        List<DashboardAgeingProjection> ageing = dashboardRepository.overdueAgeing(
                instituteId, EPOCH, now, noSessions, sessionIds, upcomingDays);
        List<UpcomingMonthProjection> forecast = userPlanRepository.getUpcomingByMonth(
                instituteId, EPOCH, now, noSessions, sessionIds, upcomingDays);

        DashboardBreakdownProjection total = firstOf(periodSlices, "TOTAL");
        DashboardBreakdownProjection previousTotal = allTime ? null : firstOf(previousSlices, "TOTAL");

        PaymentDashboardResponseDTO.Kpis kpis = PaymentDashboardResponseDTO.Kpis.builder()
                .collected(amount(total))
                .previousCollected(allTime ? null : amount(previousTotal))
                .payments(count(total == null ? null : total.getPayments()))
                .previousPayments(allTime ? null : count(previousTotal == null ? null : previousTotal.getPayments()))
                .payingLearners(count(total == null ? null : total.getPayers()))
                .previousPayingLearners(allTime ? null : count(previousTotal == null ? null : previousTotal.getPayers()))
                .newPayingLearners(count(newPayers == null ? null : newPayers.getCurrentCount()))
                .previousNewPayingLearners(allTime ? null : count(newPayers == null ? null : newPayers.getPreviousCount()))
                .overdue(orZero(balances.getDue()))
                .learnersOverdue(count(balances.getLearnersOwing()))
                .dueSoon(orZero(balances.getUpcoming()))
                .learnersDueSoon(count(balances.getLearnersUpcoming()))
                .upcomingDays(balances.getUpcomingDays())
                .stillToCome(orZero(balances.getUpcomingAll()))
                .learnersStillToCome(count(balances.getLearnersUpcomingAll()))
                .collectedAllTime(orZero(balances.getCollected()))
                .outstanding(orZero(balances.getOutstanding()))
                .build();

        return PaymentDashboardResponseDTO.builder()
                .periodStart(allTime ? null : start)
                .periodEnd(end)
                .previousStart(previousStart)
                .previousEnd(previousEnd)
                .timeZone(zoneId)
                .currency(balances.getCurrency())
                .kpis(kpis)
                .months(monthSeries(firstChartMonth, endMonth, byMonth, newByMonth))
                .years(yearSeries(firstFyMonth, endMonth, byMonth))
                .days(daySeries(firstDay, endDay, byDay))
                .sources(slices(periodSlices, "SOURCE"))
                .methods(slices(periodSlices, "METHOD"))
                .batches(batchRows(periodSlices, allTimeSlices, batchBalances))
                .ageing(ageing.stream().map(a -> PaymentDashboardResponseDTO.AgeingBucket.builder()
                        .bucket(a.getBucket())
                        .amount(orZero(a.getAmount()))
                        .learners(count(a.getLearners()))
                        .oldestDays(a.getOldestDays())
                        .build()).toList())
                .forecast(forecast.stream().map(f -> PaymentDashboardResponseDTO.ForecastMonth.builder()
                        .month(f.getMonthStart() != null ? YearMonth.from(f.getMonthStart()).toString() : null)
                        .amount(orZero(f.getAmount()))
                        .learners(count(f.getLearners()))
                        .build()).toList())
                .build();
    }

    // ---- assembly ----

    private List<PaymentDashboardResponseDTO.SeriesPoint> monthSeries(
            YearMonth from, YearMonth to, Map<String, DashboardSeriesProjection> collected,
            Map<String, DashboardSeriesProjection> newPayers) {
        List<PaymentDashboardResponseDTO.SeriesPoint> out = new ArrayList<>();
        for (YearMonth m = from; !m.isAfter(to); m = m.plusMonths(1)) {
            DashboardSeriesProjection row = collected.get(m.toString());
            DashboardSeriesProjection first = newPayers.get(m.toString());
            out.add(PaymentDashboardResponseDTO.SeriesPoint.builder()
                    .bucket(m.toString())
                    .collected(row == null ? 0d : orZero(row.getAmount()))
                    .payments(row == null ? 0L : count(row.getPayments()))
                    .payers(row == null ? 0L : count(row.getPayers()))
                    .newPayers(first == null ? 0L : count(first.getPayers()))
                    .build());
        }
        return out;
    }

    private List<PaymentDashboardResponseDTO.YearPoint> yearSeries(
            YearMonth firstFyMonth, YearMonth endMonth, Map<String, DashboardSeriesProjection> collected) {
        List<PaymentDashboardResponseDTO.YearPoint> out = new ArrayList<>();
        for (int i = 0; i < YEARS; i++) {
            YearMonth fyStart = firstFyMonth.plusYears(i);
            YearMonth fyEnd = fyStart.plusMonths(11);
            double sum = 0d;
            for (YearMonth m = fyStart; !m.isAfter(fyEnd) && !m.isAfter(endMonth); m = m.plusMonths(1)) {
                DashboardSeriesProjection row = collected.get(m.toString());
                if (row != null) sum += orZero(row.getAmount());
            }
            out.add(PaymentDashboardResponseDTO.YearPoint.builder()
                    .financialYear(fyStart.getYear() + "-" + String.format("%02d", (fyStart.getYear() + 1) % 100))
                    .collected(sum)
                    .partial(endMonth.isBefore(fyEnd))
                    .build());
        }
        return out;
    }

    private List<PaymentDashboardResponseDTO.SeriesPoint> daySeries(
            LocalDate from, LocalDate to, Map<String, DashboardSeriesProjection> collected) {
        List<PaymentDashboardResponseDTO.SeriesPoint> out = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            DashboardSeriesProjection row = collected.get(d.toString());
            out.add(PaymentDashboardResponseDTO.SeriesPoint.builder()
                    .bucket(d.toString())
                    .collected(row == null ? 0d : orZero(row.getAmount()))
                    .payments(row == null ? 0L : count(row.getPayments()))
                    .payers(row == null ? 0L : count(row.getPayers()))
                    .build());
        }
        return out;
    }

    private List<PaymentDashboardResponseDTO.Slice> slices(List<DashboardBreakdownProjection> rows, String dimension) {
        return rows.stream()
                .filter(r -> dimension.equals(r.getDimension()))
                .map(r -> PaymentDashboardResponseDTO.Slice.builder()
                        .key(r.getBucketKey())
                        .amount(orZero(r.getAmount()))
                        .payments(count(r.getPayments()))
                        .payers(count(r.getPayers()))
                        .build())
                .toList();
    }

    /** One row per batch seen in either the collections or the balances; null key = unassigned. */
    private List<PaymentDashboardResponseDTO.BatchRow> batchRows(
            List<DashboardBreakdownProjection> period, List<DashboardBreakdownProjection> allTime,
            List<DashboardBatchBalanceProjection> balances) {
        Map<String, Double> collected = new HashMap<>();
        Map<String, Double> collectedAllTime = new HashMap<>();
        period.stream().filter(r -> "BATCH".equals(r.getDimension()))
                .forEach(r -> collected.put(r.getBucketKey(), orZero(r.getAmount())));
        allTime.stream().filter(r -> "BATCH".equals(r.getDimension()))
                .forEach(r -> collectedAllTime.put(r.getBucketKey(), orZero(r.getAmount())));
        Map<String, DashboardBatchBalanceProjection> owed = new HashMap<>();
        balances.forEach(b -> owed.put(b.getPackageSessionId(), b));

        Set<String> keys = new LinkedHashSet<>();
        keys.addAll(collected.keySet());
        keys.addAll(collectedAllTime.keySet());
        keys.addAll(owed.keySet());

        List<String> ids = keys.stream().filter(Objects::nonNull).toList();
        Map<String, DashboardPackageSessionProjection> names = new LinkedHashMap<>();
        if (!ids.isEmpty()) {
            dashboardRepository.packageSessionNames(ids).forEach(n -> names.put(n.getPackageSessionId(), n));
        }

        List<PaymentDashboardResponseDTO.BatchRow> out = new ArrayList<>();
        for (String key : keys) {
            DashboardPackageSessionProjection name = key == null ? null : names.get(key);
            DashboardBatchBalanceProjection b = owed.get(key);
            out.add(PaymentDashboardResponseDTO.BatchRow.builder()
                    .packageSessionId(key)
                    .packageId(name == null ? null : name.getPackageId())
                    .packageName(name == null ? null : name.getPackageName())
                    .levelName(name == null ? null : name.getLevelName())
                    .sessionName(name == null ? null : name.getSessionName())
                    .collected(collected.getOrDefault(key, 0d))
                    .collectedAllTime(collectedAllTime.getOrDefault(key, 0d))
                    .overdue(b == null ? 0d : orZero(b.getOverdue()))
                    .stillToCome(b == null ? 0d : orZero(b.getStillToCome()))
                    .learners(b == null ? 0L : count(b.getLearners()))
                    .build());
        }
        return out;
    }

    // ---- helpers ----

    /**
     * Months and days are cut in this zone, which Postgres receives by name. Browsers still send
     * legacy names such as Asia/Calcutta that the JVM accepts and Postgres rejects, failing the
     * whole query, so the name goes through the same normaliser as live-session zones first.
     */
    private ZoneId resolveZone(String requested) {
        if (!StringUtils.hasText(requested)) {
            return ZoneOffset.UTC;
        }
        String normalized = TimezoneNormalizer.normalize(requested, null);
        if (normalized == null) {
            log.warn("Ignoring unrecognised payment-dashboard time zone '{}'; using UTC", requested);
            return ZoneOffset.UTC;
        }
        // Only Area/Location names. Postgres reads a bare offset such as +05:30 or GMT+5 with the
        // POSIX sign, the opposite of Java, so it would cut the months on the wrong side of UTC.
        if (!normalized.contains("/")) {
            log.warn("Ignoring non-regional payment-dashboard time zone '{}'; using UTC", requested);
            return ZoneOffset.UTC;
        }
        try {
            return ZoneId.of(normalized);
        } catch (DateTimeException e) {
            log.warn("Ignoring unrecognised payment-dashboard time zone '{}'; using UTC", requested);
            return ZoneOffset.UTC;
        }
    }

    private static LocalDateTime toZone(LocalDateTime utc, ZoneId zone) {
        return utc.atZone(ZoneOffset.UTC).withZoneSameInstant(zone).toLocalDateTime();
    }

    private static LocalDateTime toUtc(LocalDate localDay, ZoneId zone) {
        return localDay.atStartOfDay(zone).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
    }

    /** April of the financial year a month belongs to. */
    private static YearMonth financialYearStart(YearMonth month) {
        return month.getMonthValue() >= 4 ? YearMonth.of(month.getYear(), 4) : YearMonth.of(month.getYear() - 1, 4);
    }

    private static Map<String, DashboardSeriesProjection> index(List<DashboardSeriesProjection> rows) {
        Map<String, DashboardSeriesProjection> out = new HashMap<>();
        rows.forEach(r -> out.put(r.getBucket(), r));
        return out;
    }

    private static DashboardBreakdownProjection firstOf(List<DashboardBreakdownProjection> rows, String dimension) {
        return rows.stream().filter(r -> dimension.equals(r.getDimension())).findFirst().orElse(null);
    }

    private static double amount(DashboardBreakdownProjection row) {
        return row == null ? 0d : orZero(row.getAmount());
    }

    private static double orZero(Double value) {
        return value == null ? 0d : value;
    }

    private static long count(Long value) {
        return value == null ? 0L : value;
    }
}
