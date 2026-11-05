package vacademy.io.admin_core_service.features.product_config.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.product_config.dto.ProductInstituteDTO;
import vacademy.io.admin_core_service.features.product_config.dto.TrialChangeDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** A product's institutes for the health dashboard: who signed up, and their trial. */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductSignupService {

    private static final int MAX_EXTEND_DAYS = 365;
    private static final int MAX_PAGE_SIZE = 100;
    private static final String TRIAL_TAG = "FREE_TRIAL";
    private static final String PURCHASED = "EXISTS (SELECT 1 FROM credit_transactions t WHERE t.institute_id = i.id "
            + "AND t.transaction_type IN ('PURCHASE', 'ADMIN_GRANT'))";
    private static final String STATUS = "CASE WHEN COALESCE(i.lead_tag, '') <> '" + TRIAL_TAG
            + "' OR i.demo_expires_at IS NULL THEN 'NOT_ON_TRIAL' WHEN " + PURCHASED
            + " THEN 'PAID' WHEN i.demo_expires_at < (now() AT TIME ZONE 'UTC') THEN 'EXPIRED' ELSE 'ON_TRIAL' END";
    private static final String FROM = " FROM institutes i LEFT JOIN institute_credits c ON c.institute_id = i.id "
            + "WHERE i.product = ?";

    private final JdbcTemplate jdbc;

    public Map<String, Object> list(String productKey, int page, int size, String search, String status) {
        int limit = Math.max(1, Math.min(size, MAX_PAGE_SIZE));
        int offset = Math.max(0, page) * limit;
        StringBuilder where = new StringBuilder(FROM);
        List<Object> args = new ArrayList<>(List.of(productKey));
        if (StringUtils.hasText(search)) {
            String like = "%" + search.trim().toLowerCase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
            where.append(" AND (LOWER(i.name) LIKE ? OR LOWER(i.email) LIKE ? OR i.mobile_number LIKE ?)");
            args.addAll(List.of(like, like, like));
        }
        if (StringUtils.hasText(status)) {
            where.append(" AND ").append(STATUS).append(" = ?");
            args.add(status.trim().toUpperCase());
        }
        Long total = jdbc.queryForObject("SELECT COUNT(*)" + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(limit);
        pageArgs.add(offset);
        List<ProductInstituteDTO> rows = jdbc.query(select() + where + " ORDER BY i.created_at DESC LIMIT ? OFFSET ?",
                (rs, n) -> toDto(rs), pageArgs.toArray());
        return Map.of("content", rows, "total", total == null ? 0 : total, "page", Math.max(0, page), "size", limit);
    }

    /** Add days, counted from today if it already ended, or set the end date. It can only move forward. */
    @Transactional
    public ProductInstituteDTO changeTrial(String productKey, String instituteId, TrialChangeDTO change, String actor) {
        ProductInstituteDTO current = one(productKey, instituteId);
        if (!TRIAL_TAG.equals(current.getLeadTag()) || "NOT_ON_TRIAL".equals(current.getTrialStatus())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "This institute is not on a free trial");
        }
        if ("PAID".equals(current.getTrialStatus())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "This institute has bought or been given credits, so its trial is over");
        }
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        LocalDateTime ends = newEnd(change, current, now);
        if (!ends.isAfter(now)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "The new end date must be in the future");
        }
        if (ends.isAfter(now.plusDays(MAX_EXTEND_DAYS))) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "A trial can end at most " + MAX_EXTEND_DAYS + " days from today");
        }
        int updated = jdbc.update("UPDATE institutes SET demo_expires_at = ?, updated_at = now() "
                + "WHERE id = ? AND product = ? AND lead_tag = ?", Timestamp.valueOf(ends), instituteId, productKey, TRIAL_TAG);
        if (updated == 0) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "No such institute on this product");
        }
        log.info("[product-trial] {} moved trial of institute {} from {} to {}", actor, instituteId, current.getTrialEndsAt(), ends);
        return one(productKey, instituteId);
    }

    private static LocalDateTime newEnd(TrialChangeDTO change, ProductInstituteDTO current, LocalDateTime now) {
        if (change == null || (change.getExtendDays() == null) == !StringUtils.hasText(change.getEndsOn())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Give either the days to add or an end date");
        }
        if (change.getExtendDays() != null) {
            if (change.getExtendDays() < 1 || change.getExtendDays() > MAX_EXTEND_DAYS) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "Days to add must be between 1 and " + MAX_EXTEND_DAYS);
            }
            LocalDateTime from = LocalDateTime.parse(current.getTrialEndsAt());
            return (from.isAfter(now) ? from : now).plusDays(change.getExtendDays());
        }
        try {
            return LocalDate.parse(change.getEndsOn().trim()).atTime(LocalTime.of(23, 59, 59));
        } catch (DateTimeParseException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "The end date is not valid");
        }
    }

    private ProductInstituteDTO one(String productKey, String instituteId) {
        return jdbc.query(select() + FROM + " AND i.id = ?", (rs, n) -> toDto(rs), productKey, instituteId)
                .stream().findFirst()
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "No such institute on this product"));
    }

    private static String select() {
        return "SELECT i.id, i.name, i.email, i.mobile_number, i.city, i.state, i.lead_tag, i.demo_expires_at, "
                + "i.created_at, c.current_balance, c.used_credits, " + STATUS + " AS trial_status";
    }

    private static ProductInstituteDTO toDto(ResultSet rs) throws SQLException {
        Timestamp ends = rs.getTimestamp("demo_expires_at");
        Timestamp created = rs.getTimestamp("created_at");
        return ProductInstituteDTO.builder()
                .id(rs.getString("id"))
                .name(rs.getString("name"))
                .email(rs.getString("email"))
                .phone(rs.getString("mobile_number"))
                .city(rs.getString("city"))
                .state(rs.getString("state"))
                .leadTag(rs.getString("lead_tag"))
                .trialStatus(rs.getString("trial_status"))
                .trialEndsAt(ends == null ? null : ends.toLocalDateTime().toString())
                .creditBalance(rs.getBigDecimal("current_balance"))
                .creditsUsed(rs.getBigDecimal("used_credits"))
                .createdAt(created == null ? null : created.toLocalDateTime().toString())
                .build();
    }
}
