package vacademy.io.admin_core_service.features.usage_metering.service;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.AllowanceStatus;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageAllowance;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageAllowanceRequest;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.YearMonth;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * An institute's storage and bandwidth allowance: what its plan includes and what each
 * extra GB costs. Only institutes with a row in {@code institute_usage_allowance} are on
 * one; everyone else sees plain usage, as before. Nothing here blocks an upload or raises
 * an invoice: the charge is a figure to show the institute and to bill by hand.
 *
 * <p>How a month is charged:
 * <ul>
 *   <li>Storage: the average of the month's nightly snapshots, minus the included GB,
 *       times the storage rate. A night with no files counts as zero.</li>
 *   <li>Bandwidth: the month's total, minus the included GB, times the bandwidth rate.</li>
 * </ul>
 * 1 GB is 1024^3 bytes, the same as the screens show.
 */
@Service
@RequiredArgsConstructor
public class UsageAllowanceService {

    private static final double GB = 1024d * 1024 * 1024;
    private static final double MAX_GB = 10_000_000d;
    private static final double MAX_RATE = 1_000_000d;

    private static final RowMapper<UsageAllowance> ROW = (rs, i) -> {
        UsageAllowance a = new UsageAllowance();
        a.setInstituteId(rs.getString("institute_id"));
        a.setIncludedStorageGb(rs.getDouble("included_storage_gb"));
        a.setIncludedBandwidthGb(rs.getDouble("included_bandwidth_gb"));
        a.setStorageRatePerGb(rs.getDouble("storage_rate_per_gb"));
        a.setBandwidthRatePerGb(rs.getDouble("bandwidth_rate_per_gb"));
        a.setCurrency(rs.getString("currency"));
        a.setNote(rs.getString("note"));
        a.setUpdatedBy(rs.getString("updated_by"));
        Timestamp updatedAt = rs.getTimestamp("updated_at");
        a.setUpdatedAt(updatedAt == null ? null : updatedAt.toInstant());
        return a;
    };

    private final JdbcTemplate jdbcTemplate;

    /** The institute's allowance, or null when it is not on one. */
    @Transactional(readOnly = true)
    public UsageAllowance find(String instituteId) {
        List<UsageAllowance> rows = jdbcTemplate.query(
                "SELECT * FROM institute_usage_allowance WHERE institute_id = ?", ROW, instituteId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Every allowance, keyed by institute id. */
    @Transactional(readOnly = true)
    public Map<String, UsageAllowance> findAll() {
        Map<String, UsageAllowance> all = new LinkedHashMap<>();
        jdbcTemplate.query("SELECT * FROM institute_usage_allowance", ROW)
                .forEach(a -> all.put(a.getInstituteId(), a));
        return all;
    }

    /** Creates or replaces the institute's allowance. */
    @Transactional
    public UsageAllowance save(String instituteId, UsageAllowanceRequest req, String updatedBy) {
        if (req == null) {
            throw bad("Allowance details are required");
        }
        Integer exists = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM institutes WHERE id = ?", Integer.class, instituteId);
        if (exists == null || exists == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Institute not found");
        }
        double storageGb = amount(req.getIncludedStorageGb(), "Included storage", MAX_GB);
        double bandwidthGb = amount(req.getIncludedBandwidthGb(), "Included bandwidth", MAX_GB);
        double storageRate = amount(req.getStorageRatePerGb(), "Storage rate", MAX_RATE);
        double bandwidthRate = amount(req.getBandwidthRatePerGb(), "Bandwidth rate", MAX_RATE);
        String currency = req.getCurrency() == null || req.getCurrency().isBlank()
                ? "INR" : req.getCurrency().trim().toUpperCase();
        if (!currency.matches("[A-Z]{3}")) {
            throw bad("Currency must be a three-letter code such as INR");
        }
        String note = req.getNote() == null || req.getNote().isBlank() ? null : req.getNote().trim();
        if (note != null && note.length() > 1000) {
            throw bad("Note is too long (1,000 characters at most)");
        }
        jdbcTemplate.update("""
                INSERT INTO institute_usage_allowance
                    (institute_id, included_storage_gb, included_bandwidth_gb,
                     storage_rate_per_gb, bandwidth_rate_per_gb, currency, note, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (institute_id) DO UPDATE SET
                    included_storage_gb = EXCLUDED.included_storage_gb,
                    included_bandwidth_gb = EXCLUDED.included_bandwidth_gb,
                    storage_rate_per_gb = EXCLUDED.storage_rate_per_gb,
                    bandwidth_rate_per_gb = EXCLUDED.bandwidth_rate_per_gb,
                    currency = EXCLUDED.currency,
                    note = EXCLUDED.note,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = CURRENT_TIMESTAMP
                """, instituteId, storageGb, bandwidthGb, storageRate, bandwidthRate, currency, note, updatedBy);
        List<UsageAllowance> saved = jdbcTemplate.query(
                "SELECT * FROM institute_usage_allowance WHERE institute_id = ?", ROW, instituteId);
        return saved.get(0);
    }

    /** Takes the institute off its allowance; its screen goes back to plain usage. */
    @Transactional
    public boolean remove(String instituteId) {
        return jdbcTemplate.update("DELETE FROM institute_usage_allowance WHERE institute_id = ?", instituteId) > 0;
    }

    /** One institute's month against its allowance. */
    @Transactional(readOnly = true)
    public AllowanceStatus status(UsageAllowance allowance, YearMonth month) {
        String id = allowance.getInstituteId();
        return statuses(Map.of(id, allowance), month).get(id);
    }

    /** The month against the allowance, for each institute given. */
    @Transactional(readOnly = true)
    public Map<String, AllowanceStatus> statuses(Map<String, UsageAllowance> allowances, YearMonth month) {
        Map<String, AllowanceStatus> out = new HashMap<>();
        if (allowances.isEmpty()) {
            return out;
        }
        Date from = Date.valueOf(month.atDay(1));
        Date to = Date.valueOf(month.atEndOfMonth());
        Collection<String> ids = allowances.keySet();
        String in = String.join(",", ids.stream().map(id -> "?").toList());

        // Nights with a snapshot, for any institute: the divisor of the storage average.
        Integer snapshotDays = jdbcTemplate.queryForObject(
                "SELECT count(DISTINCT usage_date) FROM institute_storage_usage_daily WHERE usage_date BETWEEN ? AND ?",
                Integer.class, from, to);
        int days = snapshotDays == null ? 0 : snapshotDays;

        Map<String, Long> storageByteDays = new HashMap<>();
        Map<String, Long> bandwidthBytes = new HashMap<>();
        Object[] args = new Object[ids.size() + 2];
        args[0] = from;
        args[1] = to;
        int n = 2;
        for (String id : ids) {
            args[n++] = id;
        }
        jdbcTemplate.query("SELECT institute_id, sum(bytes) FROM institute_storage_usage_daily "
                + "WHERE usage_date BETWEEN ? AND ? AND institute_id IN (" + in + ") GROUP BY institute_id",
                rs -> {
                    storageByteDays.put(rs.getString(1), rs.getLong(2));
                }, args);
        jdbcTemplate.query("SELECT institute_id, sum(bytes) FROM institute_bandwidth_usage_daily "
                + "WHERE usage_date BETWEEN ? AND ? AND institute_id IN (" + in + ") GROUP BY institute_id",
                rs -> {
                    bandwidthBytes.put(rs.getString(1), rs.getLong(2));
                }, args);

        for (UsageAllowance a : allowances.values()) {
            long averageStored = days == 0 ? 0 : storageByteDays.getOrDefault(a.getInstituteId(), 0L) / days;
            out.put(a.getInstituteId(),
                    price(a, month, days, averageStored, bandwidthBytes.getOrDefault(a.getInstituteId(), 0L)));
        }
        return out;
    }

    /** The arithmetic on its own, so it can be checked without a database. */
    static AllowanceStatus price(UsageAllowance a, YearMonth month, int snapshotDays,
                                 long storageAverageBytes, long bandwidthBytes) {
        AllowanceStatus s = new AllowanceStatus();
        s.setMonth(month.toString());
        s.setIncludedStorageGb(a.getIncludedStorageGb());
        s.setIncludedBandwidthGb(a.getIncludedBandwidthGb());
        s.setStorageRatePerGb(a.getStorageRatePerGb());
        s.setBandwidthRatePerGb(a.getBandwidthRatePerGb());
        s.setCurrency(a.getCurrency());
        s.setStorageSnapshotDays(snapshotDays);
        s.setStorageAverageBytes(storageAverageBytes);
        s.setBandwidthBytes(bandwidthBytes);
        long storageExtra = Math.max(0, storageAverageBytes - Math.round(a.getIncludedStorageGb() * GB));
        long bandwidthExtra = Math.max(0, bandwidthBytes - Math.round(a.getIncludedBandwidthGb() * GB));
        s.setStorageExtraBytes(storageExtra);
        s.setBandwidthExtraBytes(bandwidthExtra);
        double storageCharge = money(storageExtra / GB * a.getStorageRatePerGb());
        double bandwidthCharge = money(bandwidthExtra / GB * a.getBandwidthRatePerGb());
        s.setStorageCharge(storageCharge);
        s.setBandwidthCharge(bandwidthCharge);
        s.setTotalCharge(money(storageCharge + bandwidthCharge));
        return s;
    }

    private static double money(double value) {
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    private static double amount(Double value, String label, double max) {
        if (value == null || value.isNaN() || value < 0 || value > max) {
            throw bad(label + " must be a number from 0 to " + (long) max);
        }
        return value;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
