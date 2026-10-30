package vacademy.io.admin_core_service.features.usage_metering.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.CategoryUsage;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.CostRates;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.DailyPoint;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.InstituteUsageResponse;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.InstituteUsageRow;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.MonthlyPoint;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.PlatformUsageResponse;

import java.sql.Date;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the daily usage tables for the dashboards. Read-only transactions, so the
 * queries go to the replica; each touches one small, date-bounded slice.
 */
@Service
public class UsageReportService {

    private static final double GB = 1024d * 1024 * 1024;

    private final JdbcTemplate jdbcTemplate;
    private final CostRates rates;

    public UsageReportService(JdbcTemplate jdbcTemplate,
                              @Value("${usage.cost.storage-usd-per-gb-month:0.015}") double storageUsdPerGbMonth,
                              @Value("${usage.cost.bandwidth-usd-per-gb:0.109}") double bandwidthUsdPerGb,
                              @Value("${usage.cost.usd-to-inr:88}") double usdToInr) {
        this.jdbcTemplate = jdbcTemplate;
        this.rates = new CostRates(storageUsdPerGbMonth, bandwidthUsdPerGb, usdToInr);
    }

    @Transactional(readOnly = true)
    public InstituteUsageResponse instituteUsage(String instituteId) {
        InstituteUsageResponse r = new InstituteUsageResponse();
        r.setInstituteId(instituteId);

        LocalDate asOf = jdbcTemplate.queryForObject(
                "SELECT max(usage_date) FROM institute_storage_usage_daily", LocalDate.class);
        r.setStorageAsOf(asOf);
        List<CategoryUsage> storage = asOf == null ? List.of() : jdbcTemplate.query("""
                SELECT category, sum(bytes), sum(object_count)
                FROM institute_storage_usage_daily
                WHERE institute_id = ? AND usage_date = ?
                GROUP BY category ORDER BY sum(bytes) DESC
                """, (rs, i) -> new CategoryUsage(rs.getString(1), rs.getLong(2), rs.getLong(3)),
                instituteId, Date.valueOf(asOf));
        r.setStorageByCategory(storage);
        r.setStorageBytes(storage.stream().mapToLong(CategoryUsage::getBytes).sum());
        r.setStorageObjects(storage.stream().mapToLong(CategoryUsage::getCount).sum());
        r.setStorageTrend(jdbcTemplate.query("""
                SELECT usage_date, sum(bytes) FROM institute_storage_usage_daily
                WHERE institute_id = ? AND usage_date >= ?
                GROUP BY usage_date ORDER BY usage_date
                """, (rs, i) -> new DailyPoint(rs.getDate(1).toLocalDate(), rs.getLong(2)),
                instituteId, Date.valueOf(today().minusDays(90))));

        r.setBandwidthTrackingSince(jdbcTemplate.queryForObject(
                "SELECT min(usage_date) FROM institute_bandwidth_usage_daily", LocalDate.class));
        YearMonth month = YearMonth.from(today());
        r.setBandwidthMonth(month.toString());
        List<CategoryUsage> bandwidth = jdbcTemplate.query("""
                SELECT category, sum(bytes), sum(requests)
                FROM institute_bandwidth_usage_daily
                WHERE institute_id = ? AND usage_date BETWEEN ? AND ?
                GROUP BY category ORDER BY sum(bytes) DESC
                """, (rs, i) -> new CategoryUsage(rs.getString(1), rs.getLong(2), rs.getLong(3)),
                instituteId, Date.valueOf(month.atDay(1)), Date.valueOf(month.atEndOfMonth()));
        r.setBandwidthMonthByCategory(bandwidth);
        r.setBandwidthMonthBytes(bandwidth.stream().mapToLong(CategoryUsage::getBytes).sum());
        r.setBandwidthMonthRequests(bandwidth.stream().mapToLong(CategoryUsage::getCount).sum());
        r.setBandwidthDaily(jdbcTemplate.query("""
                SELECT usage_date, sum(bytes) FROM institute_bandwidth_usage_daily
                WHERE institute_id = ? AND usage_date >= ?
                GROUP BY usage_date ORDER BY usage_date
                """, (rs, i) -> new DailyPoint(rs.getDate(1).toLocalDate(), rs.getLong(2)),
                instituteId, Date.valueOf(today().minusDays(30))));
        r.setBandwidthMonthly(jdbcTemplate.query("""
                SELECT to_char(usage_date, 'YYYY-MM'), sum(bytes) FROM institute_bandwidth_usage_daily
                WHERE institute_id = ? AND usage_date >= ?
                GROUP BY 1 ORDER BY 1
                """, (rs, i) -> new MonthlyPoint(rs.getString(1), rs.getLong(2)),
                instituteId, Date.valueOf(month.minusMonths(5).atDay(1))));
        return r;
    }

    /** Every institute's latest storage and the month's bandwidth, with our approximate cost. */
    @Transactional(readOnly = true)
    public PlatformUsageResponse platformUsage(YearMonth month) {
        PlatformUsageResponse r = new PlatformUsageResponse();
        r.setMonth(month.toString());
        r.setRates(rates);
        LocalDate asOf = jdbcTemplate.queryForObject(
                "SELECT max(usage_date) FROM institute_storage_usage_daily", LocalDate.class);
        r.setStorageAsOf(asOf);
        r.setBandwidthTrackingSince(jdbcTemplate.queryForObject(
                "SELECT min(usage_date) FROM institute_bandwidth_usage_daily", LocalDate.class));

        Map<String, InstituteUsageRow> rows = new LinkedHashMap<>();
        if (asOf != null) {
            jdbcTemplate.query("""
                    SELECT institute_id, sum(bytes),
                           sum(CASE WHEN category = 'RECORDING' THEN bytes ELSE 0 END)
                    FROM institute_storage_usage_daily WHERE usage_date = ?
                    GROUP BY institute_id
                    """, rs -> {
                InstituteUsageRow row = rows.computeIfAbsent(rs.getString(1), this::newRow);
                row.setStorageBytes(rs.getLong(2));
                row.setRecordingBytes(rs.getLong(3));
            }, Date.valueOf(asOf));
        }
        jdbcTemplate.query("""
                SELECT institute_id, sum(bytes), sum(requests)
                FROM institute_bandwidth_usage_daily WHERE usage_date BETWEEN ? AND ?
                GROUP BY institute_id
                """, rs -> {
            InstituteUsageRow row = rows.computeIfAbsent(rs.getString(1), this::newRow);
            row.setBandwidthBytes(rs.getLong(2));
            row.setBandwidthRequests(rs.getLong(3));
        }, Date.valueOf(month.atDay(1)), Date.valueOf(month.atEndOfMonth()));

        Map<String, String> names = new HashMap<>();
        List<String> ids = rows.keySet().stream().filter(id -> !UsageKeyClassifier.UNASSIGNED.equals(id)).toList();
        if (!ids.isEmpty()) {
            String placeholders = String.join(",", ids.stream().map(id -> "?").toList());
            jdbcTemplate.query("SELECT id, name FROM institutes WHERE id IN (" + placeholders + ")",
                    rs -> {
                        names.put(rs.getString(1), rs.getString(2));
                    }, ids.toArray());
        }

        InstituteUsageRow totals = newRow("_TOTAL");
        List<InstituteUsageRow> institutes = new ArrayList<>();
        for (InstituteUsageRow row : rows.values()) {
            row.setInstituteName(names.getOrDefault(row.getInstituteId(), null));
            price(row);
            totals.setStorageBytes(totals.getStorageBytes() + row.getStorageBytes());
            totals.setRecordingBytes(totals.getRecordingBytes() + row.getRecordingBytes());
            totals.setBandwidthBytes(totals.getBandwidthBytes() + row.getBandwidthBytes());
            totals.setBandwidthRequests(totals.getBandwidthRequests() + row.getBandwidthRequests());
            if (UsageKeyClassifier.UNASSIGNED.equals(row.getInstituteId())) {
                r.setUnassigned(row);
            } else {
                institutes.add(row);
            }
        }
        price(totals);
        institutes.sort(Comparator.comparingDouble(InstituteUsageRow::getTotalCostInr).reversed());
        r.setInstitutes(institutes);
        r.setTotals(totals);
        return r;
    }

    private InstituteUsageRow newRow(String instituteId) {
        InstituteUsageRow row = new InstituteUsageRow();
        row.setInstituteId(instituteId);
        return row;
    }

    private void price(InstituteUsageRow row) {
        double storage = row.getStorageBytes() / GB * rates.getStorageUsdPerGbMonth() * rates.getUsdToInr();
        double bandwidth = row.getBandwidthBytes() / GB * rates.getBandwidthUsdPerGb() * rates.getUsdToInr();
        row.setStorageCostInr(Math.round(storage));
        row.setBandwidthCostInr(Math.round(bandwidth));
        row.setTotalCostInr(Math.round(storage + bandwidth));
    }

    private static LocalDate today() {
        return LocalDate.now(ZoneOffset.UTC);
    }
}
