package vacademy.io.admin_core_service.features.usage_metering.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.AllowanceStatus;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageAllowance;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageAllowanceRequest;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageCharge;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * An institute's storage and bandwidth plan: what it includes and what each extra GB costs.
 * Only institutes with a row in {@code institute_usage_allowance} are on one; everyone else
 * sees plain usage, as before. Nothing here blocks an upload or a video.
 *
 * <p>How a month is priced (1 GB = 1024^3 bytes, as the screens show):
 * <ul>
 *   <li>Storage: the average of the month's nightly snapshots, minus the included GB
 *       (plus any add-on pack), times the storage rate. A night with no files counts as zero.</li>
 *   <li>Bandwidth: the month's total, minus the included GB, times the bandwidth rate.</li>
 *   <li>Add-on: its fixed monthly price on top.</li>
 * </ul>
 *
 * <p>A plan in {@value #CREDITS} is charged to the institute's credit wallet once a month by
 * {@link #chargeMonth}, from its {@code charge_from_month} on, never retroactively. A plan in a
 * real currency is shown only and billed by hand.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UsageAllowanceService {

    public static final String CREDITS = "CREDITS";
    static final String REQUEST_TYPE = "storage_bandwidth";
    private static final double GB = 1024d * 1024 * 1024;
    private static final double MAX_GB = 10_000_000d;
    private static final double MAX_RATE = 1_000_000d;
    /** A month's charge above this is refused and logged rather than deducted. */
    private static final BigDecimal MAX_MONTHLY_CREDITS = new BigDecimal("1000000");

    private static final RowMapper<UsageAllowance> ROW = (rs, i) -> {
        UsageAllowance a = new UsageAllowance();
        a.setInstituteId(rs.getString("institute_id"));
        a.setIncludedStorageGb(rs.getDouble("included_storage_gb"));
        a.setIncludedBandwidthGb(rs.getDouble("included_bandwidth_gb"));
        a.setStorageRatePerGb(rs.getDouble("storage_rate_per_gb"));
        a.setBandwidthRatePerGb(rs.getDouble("bandwidth_rate_per_gb"));
        a.setCurrency(rs.getString("currency"));
        a.setAddonStorageGb(rs.getDouble("addon_storage_gb"));
        a.setAddonPricePerMonth(rs.getDouble("addon_price_per_month"));
        a.setChargeFromMonth(rs.getString("charge_from_month"));
        a.setNote(rs.getString("note"));
        a.setUpdatedBy(rs.getString("updated_by"));
        Timestamp updatedAt = rs.getTimestamp("updated_at");
        a.setUpdatedAt(updatedAt == null ? null : updatedAt.toInstant());
        return a;
    };

    private static final RowMapper<UsageCharge> CHARGE_ROW = (rs, i) -> {
        UsageCharge c = new UsageCharge();
        c.setInstituteId(rs.getString("institute_id"));
        c.setMonth(rs.getString("month"));
        c.setStatus(rs.getString("status"));
        c.setCredits(rs.getDouble("credits"));
        c.setStorageAverageBytes(rs.getLong("storage_average_bytes"));
        c.setStorageExtraBytes(rs.getLong("storage_extra_bytes"));
        c.setBandwidthBytes(rs.getLong("bandwidth_bytes"));
        c.setBandwidthExtraBytes(rs.getLong("bandwidth_extra_bytes"));
        c.setAddonCredits(rs.getDouble("addon_credits"));
        c.setError(rs.getString("error"));
        Timestamp updatedAt = rs.getTimestamp("updated_at");
        c.setUpdatedAt(updatedAt == null ? null : updatedAt.toInstant());
        return c;
    };

    private final JdbcTemplate jdbcTemplate;
    private final CreditClient creditClient;

    /** The institute's plan, or null when it is not on one. */
    @Transactional(readOnly = true)
    public UsageAllowance find(String instituteId) {
        List<UsageAllowance> rows = jdbcTemplate.query(
                "SELECT * FROM institute_usage_allowance WHERE institute_id = ?", ROW, instituteId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Every plan, keyed by institute id. */
    @Transactional(readOnly = true)
    public Map<String, UsageAllowance> findAll() {
        Map<String, UsageAllowance> all = new LinkedHashMap<>();
        jdbcTemplate.query("SELECT * FROM institute_usage_allowance", ROW)
                .forEach(a -> all.put(a.getInstituteId(), a));
        return all;
    }

    /** Creates or replaces the institute's plan. */
    @Transactional
    public UsageAllowance save(String instituteId, UsageAllowanceRequest req, String updatedBy) {
        if (req == null) {
            throw bad("Plan details are required");
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
        double addonGb = req.getAddonStorageGb() == null ? 0 : amount(req.getAddonStorageGb(), "Add-on storage", MAX_GB);
        double addonPrice = req.getAddonPricePerMonth() == null ? 0
                : amount(req.getAddonPricePerMonth(), "Add-on price", MAX_RATE);
        String currency = req.getCurrency() == null || req.getCurrency().isBlank()
                ? CREDITS : req.getCurrency().trim().toUpperCase();
        if (!CREDITS.equals(currency) && !currency.matches("[A-Z]{3}")) {
            throw bad("Currency must be CREDITS or a three-letter code such as INR");
        }
        String note = req.getNote() == null || req.getNote().isBlank() ? null : req.getNote().trim();
        if (note != null && note.length() > 1000) {
            throw bad("Note is too long (1,000 characters at most)");
        }

        // Wallet plans start charging no earlier than this month; next month by default,
        // so a plan set mid-month never charges for days before it existed.
        String chargeFrom = null;
        if (CREDITS.equals(currency)) {
            YearMonth thisMonth = YearMonth.now(ZoneOffset.UTC);
            UsageAllowance existing = find(instituteId);
            YearMonth from;
            if (req.getChargeFromMonth() != null && !req.getChargeFromMonth().isBlank()) {
                from = parseMonth(req.getChargeFromMonth());
                boolean unchanged = existing != null && req.getChargeFromMonth().equals(existing.getChargeFromMonth());
                if (from.isBefore(thisMonth) && !unchanged) {
                    throw bad("Charging can't start before this month");
                }
            } else if (existing != null && existing.getChargeFromMonth() != null) {
                from = parseMonth(existing.getChargeFromMonth());
            } else {
                from = thisMonth.plusMonths(1);
            }
            chargeFrom = from.toString();
        }

        jdbcTemplate.update("""
                INSERT INTO institute_usage_allowance
                    (institute_id, included_storage_gb, included_bandwidth_gb,
                     storage_rate_per_gb, bandwidth_rate_per_gb, currency,
                     addon_storage_gb, addon_price_per_month, charge_from_month, note, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (institute_id) DO UPDATE SET
                    included_storage_gb = EXCLUDED.included_storage_gb,
                    included_bandwidth_gb = EXCLUDED.included_bandwidth_gb,
                    storage_rate_per_gb = EXCLUDED.storage_rate_per_gb,
                    bandwidth_rate_per_gb = EXCLUDED.bandwidth_rate_per_gb,
                    currency = EXCLUDED.currency,
                    addon_storage_gb = EXCLUDED.addon_storage_gb,
                    addon_price_per_month = EXCLUDED.addon_price_per_month,
                    charge_from_month = EXCLUDED.charge_from_month,
                    note = EXCLUDED.note,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = CURRENT_TIMESTAMP
                """, instituteId, storageGb, bandwidthGb, storageRate, bandwidthRate, currency,
                addonGb, addonPrice, chargeFrom, note, updatedBy);
        return find(instituteId);
    }

    /** Takes the institute off its plan; past charges stay in the ledger. */
    @Transactional
    public boolean remove(String instituteId) {
        return jdbcTemplate.update("DELETE FROM institute_usage_allowance WHERE institute_id = ?", instituteId) > 0;
    }

    /** One institute's month against its plan. */
    @Transactional(readOnly = true)
    public AllowanceStatus status(UsageAllowance allowance, YearMonth month) {
        String id = allowance.getInstituteId();
        return statuses(Map.of(id, allowance), month).get(id);
    }

    /** The month against the plan, for each institute given. */
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
        s.setAddonStorageGb(a.getAddonStorageGb());
        s.setChargeFromMonth(a.getChargeFromMonth());
        s.setChargedToWallet(chargeable(a, month));
        s.setStorageSnapshotDays(snapshotDays);
        s.setStorageAverageBytes(storageAverageBytes);
        s.setBandwidthBytes(bandwidthBytes);
        double storageIncludedGb = a.getIncludedStorageGb() + a.getAddonStorageGb();
        long storageExtra = Math.max(0, storageAverageBytes - Math.round(storageIncludedGb * GB));
        long bandwidthExtra = Math.max(0, bandwidthBytes - Math.round(a.getIncludedBandwidthGb() * GB));
        s.setStorageExtraBytes(storageExtra);
        s.setBandwidthExtraBytes(bandwidthExtra);
        double storageCharge = money(storageExtra / GB * a.getStorageRatePerGb());
        double bandwidthCharge = money(bandwidthExtra / GB * a.getBandwidthRatePerGb());
        double addon = money(a.getAddonPricePerMonth());
        s.setStorageCharge(storageCharge);
        s.setBandwidthCharge(bandwidthCharge);
        s.setAddonPrice(addon);
        s.setTotalCharge(money(storageCharge + bandwidthCharge + addon));
        return s;
    }

    /** True when the month is charged to the wallet: a CREDITS plan, from its first month on. */
    static boolean chargeable(UsageAllowance a, YearMonth month) {
        if (!CREDITS.equals(a.getCurrency()) || a.getChargeFromMonth() == null) {
            return false;
        }
        try {
            return !month.isBefore(YearMonth.parse(a.getChargeFromMonth()));
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ wallet charges

    /** The institute's monthly charges, newest first. */
    @Transactional(readOnly = true)
    public List<UsageCharge> charges(String instituteId) {
        return jdbcTemplate.query(
                "SELECT * FROM institute_usage_charge WHERE institute_id = ? ORDER BY month DESC LIMIT 24",
                CHARGE_ROW, instituteId);
    }

    /** The charge recorded for one month, or null. */
    @Transactional(readOnly = true)
    public UsageCharge charge(String instituteId, YearMonth month) {
        List<UsageCharge> rows = jdbcTemplate.query(
                "SELECT * FROM institute_usage_charge WHERE institute_id = ? AND month = ?",
                CHARGE_ROW, instituteId, month.toString());
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * Charges every CREDITS plan for {@code month} that has not been charged yet; FAILED months
     * are tried again. The deduction carries the key {@code storage:{institute}:{month}}, which
     * the wallet applies at most once, so a re-run never charges twice.
     *
     * @return how many institutes were charged (including months with nothing due)
     */
    public int chargeMonth(YearMonth month) {
        Map<String, UsageAllowance> due = new LinkedHashMap<>();
        findAll().forEach((id, a) -> {
            if (chargeable(a, month)) {
                UsageCharge done = charge(id, month);
                if (done == null || !"CHARGED".equals(done.getStatus())) {
                    due.put(id, a);
                }
            }
        });
        if (due.isEmpty()) {
            return 0;
        }
        Map<String, AllowanceStatus> statuses = statuses(due, month);
        int charged = 0;
        for (UsageAllowance a : due.values()) {
            AllowanceStatus s = statuses.get(a.getInstituteId());
            if (chargeOne(a.getInstituteId(), month, s)) {
                charged++;
            }
        }
        log.info("[usage-charge] {}: {} of {} institutes charged", month, charged, due.size());
        return charged;
    }

    private boolean chargeOne(String instituteId, YearMonth month, AllowanceStatus s) {
        String key = "storage:" + instituteId + ":" + month;
        BigDecimal credits = BigDecimal.valueOf(s.getTotalCharge()).setScale(2, RoundingMode.HALF_UP);
        String status;
        String error = null;
        if (credits.signum() <= 0) {
            status = "CHARGED";
        } else if (credits.compareTo(MAX_MONTHLY_CREDITS) > 0) {
            status = "FAILED";
            error = "Charge of " + credits + " credits is above the safety limit; not deducted";
            log.error("[usage-charge] {} {}: {}", instituteId, month, error);
        } else {
            boolean ok = creditClient.deductPrecomputed(instituteId, REQUEST_TYPE, description(month, s), credits, key);
            status = ok ? "CHARGED" : "FAILED";
            if (!ok) {
                error = "The credit wallet did not accept the charge; tried again on the next run";
                log.warn("[usage-charge] {} {}: deduction of {} credits not applied", instituteId, month, credits);
            }
        }
        jdbcTemplate.update("""
                INSERT INTO institute_usage_charge
                    (id, institute_id, month, status, credits, storage_average_bytes, storage_extra_bytes,
                     bandwidth_bytes, bandwidth_extra_bytes, addon_credits, idempotency_key, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (institute_id, month) DO UPDATE SET
                    status = EXCLUDED.status, credits = EXCLUDED.credits,
                    storage_average_bytes = EXCLUDED.storage_average_bytes,
                    storage_extra_bytes = EXCLUDED.storage_extra_bytes,
                    bandwidth_bytes = EXCLUDED.bandwidth_bytes,
                    bandwidth_extra_bytes = EXCLUDED.bandwidth_extra_bytes,
                    addon_credits = EXCLUDED.addon_credits,
                    error = EXCLUDED.error, updated_at = CURRENT_TIMESTAMP
                """, UUID.randomUUID().toString(), instituteId, month.toString(), status, credits,
                s.getStorageAverageBytes(), s.getStorageExtraBytes(), s.getBandwidthBytes(),
                s.getBandwidthExtraBytes(), s.getAddonPrice(), key, error);
        return "CHARGED".equals(status);
    }

    static String description(YearMonth month, AllowanceStatus s) {
        StringBuilder d = new StringBuilder("Storage & bandwidth, ")
                .append(month.getMonth().getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.ENGLISH))
                .append(' ').append(month.getYear()).append(':');
        if (s.getStorageExtraBytes() > 0) {
            d.append(String.format(java.util.Locale.ENGLISH, " %.2f GB storage over plan", s.getStorageExtraBytes() / GB));
        }
        if (s.getBandwidthExtraBytes() > 0) {
            d.append(String.format(java.util.Locale.ENGLISH, " %.2f GB bandwidth over plan", s.getBandwidthExtraBytes() / GB));
        }
        if (s.getAddonPrice() > 0) {
            d.append(String.format(java.util.Locale.ENGLISH, " +%.0f GB storage pack", s.getAddonStorageGb()));
        }
        return d.toString();
    }

    /** The month the monthly job charges on {@code today}: last month, from the 3rd on. */
    public static YearMonth monthToCharge(LocalDate today) {
        // Bandwidth for a day is final two nights later (late CDN logs), so wait until the 3rd.
        return today.getDayOfMonth() >= 3 ? YearMonth.from(today).minusMonths(1) : null;
    }

    private static double money(double value) {
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    private static YearMonth parseMonth(String value) {
        try {
            return YearMonth.parse(value.trim());
        } catch (DateTimeParseException e) {
            throw bad("Month must look like 2026-12");
        }
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
