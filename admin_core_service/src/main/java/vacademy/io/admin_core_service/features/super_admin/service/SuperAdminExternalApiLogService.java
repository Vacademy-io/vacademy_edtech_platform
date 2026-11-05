package vacademy.io.admin_core_service.features.super_admin.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.super_admin.dto.ExternalApiLogDTOs.LogDetail;
import vacademy.io.admin_core_service.features.super_admin.dto.ExternalApiLogDTOs.LogRow;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminPageResponse;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.logging.PayloadRedactor;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Vendor call records that already live in admin_core's tables, in one row shape, for the
 * health-check portal's External APIs page. Read-only.
 *
 * <p>List rows carry no bodies and no phone numbers. Bodies come one row at a time, masked:
 * anything that is not JSON has no keys to mask, so it is withheld rather than returned raw.
 */
@Service
public class SuperAdminExternalApiLogService {

    /** What one table contributes. Every value is a constant here; request input is only ever bound. */
    private record Source(String from, String id, String time, String vendor, String operation, String status,
            String error, String instituteId, String instituteName, String amount, String currency,
            String durationMs, String creditsBilled, String payload, String response) {
    }

    private static final Map<String, Source> SOURCES = Map.of(
            "telephony", new Source(
                    "telephony_call_log t LEFT JOIN institutes i ON i.id = t.institute_id",
                    "t.id", "t.created_at", "t.provider_type", "t.direction", "t.status", "t.termination_reason",
                    "t.institute_id", "i.name", "t.price", "NULL", "t.duration_seconds * 1000",
                    "t.credits_billed_at IS NOT NULL", "t.raw_payload_json", "NULL"),
            "payments", new Source(
                    "payment_log p",
                    "p.id", "p.created_at", "p.vendor", "p.order_status", "p.payment_status", "NULL",
                    "NULL", "NULL", "p.payment_amount", "p.currency", "NULL",
                    "NULL", "p.payment_specific_data", "NULL"),
            "webhooks", new Source(
                    "web_hook w",
                    "w.id", "w.created_at", "w.vendor", "w.event_type", "w.status", "w.error_message",
                    "NULL", "NULL", "NULL", "NULL", "NULL",
                    "NULL", "w.payload", "NULL"),
            "calls", new Source(
                    "external_api_call_log e LEFT JOIN institutes i ON i.id = e.institute_id",
                    "CAST(e.id AS text)", "e.occurred_at", "e.vendor", "e.operation", "e.status", "e.error_message",
                    "e.institute_id", "i.name", "e.cost_amount", "e.cost_currency", "e.duration_ms",
                    "NULL", "CAST(e.request_summary AS text)", "CAST(e.response_summary AS text)"));

    /** Recipients and payer details in vendor payloads, on top of the default credential names. */
    private static final PayloadRedactor REDACTOR = new PayloadRedactor(List.of(
            "phone", "phoneNumber", "mobile", "mobileNumber", "contact", "email", "customerEmail",
            "from", "to", "fromNumber", "toNumber", "caller", "callerId", "callerNumber", "vpa", "upiId"));

    @PersistenceContext
    private EntityManager em;

    @Autowired
    private ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public SuperAdminPageResponse<LogRow> list(String sourceKey, String vendor, String status, int hours, int page,
            int size) {
        Source source = source(sourceKey);
        StringBuilder where = new StringBuilder(" WHERE ").append(source.time()).append(" >= :from");
        Map<String, Object> params = new HashMap<>();
        params.put("from", Timestamp.from(Instant.now().minusSeconds(hours * 3600L)));
        if (vendor != null && !vendor.isBlank()) {
            where.append(" AND ").append(source.vendor()).append(" = :vendor");
            params.put("vendor", vendor);
        }
        if (status != null && !status.isBlank()) {
            where.append(" AND ").append(source.status()).append(" = :status");
            params.put("status", status);
        }

        Query countQuery = em.createNativeQuery("SELECT count(*) FROM " + source.from() + where);
        params.forEach(countQuery::setParameter);
        long total = ((Number) countQuery.getSingleResult()).longValue();

        Query query = em.createNativeQuery(rowSelect(source) + where + " ORDER BY " + source.time() + " DESC");
        params.forEach(query::setParameter);
        query.setFirstResult(page * size);
        query.setMaxResults(size);

        List<LogRow> rows = new ArrayList<>();
        for (Object row : query.getResultList()) {
            rows.add(toRow((Object[]) row));
        }
        return SuperAdminPageResponse.<LogRow>builder()
                .content(rows).page(page).size(size).totalElements(total)
                .totalPages((int) Math.ceil((double) total / size))
                .build();
    }

    @Transactional(readOnly = true)
    public LogDetail detail(String sourceKey, String id) {
        Source source = source(sourceKey);
        List<?> found = em.createNativeQuery("SELECT " + source.payload() + ", " + source.response()
                + " FROM " + source.from() + " WHERE " + source.id() + " = :id")
                .setParameter("id", id).getResultList();
        if (found.isEmpty()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Log not found");
        }
        Object[] row = (Object[]) found.get(0);
        return new LogDetail(redact((String) row[0]), redact((String) row[1]));
    }

    private static Source source(String key) {
        Source source = SOURCES.get(key);
        if (source == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Unknown log source");
        }
        return source;
    }

    private static String rowSelect(Source s) {
        return "SELECT " + s.id() + ", " + s.time() + ", " + s.vendor() + ", " + s.operation() + ", " + s.status()
                + ", " + s.error() + ", " + s.instituteId() + ", " + s.instituteName() + ", " + s.amount()
                + ", " + s.currency() + ", " + s.durationMs() + ", " + s.creditsBilled() + " FROM " + s.from();
    }

    private static LogRow toRow(Object[] r) {
        return new LogRow((String) r[0], instant(r[1]), (String) r[2], (String) r[3], (String) r[4], (String) r[5],
                (String) r[6], (String) r[7], number(r[8]), (String) r[9], number(r[10]), (Boolean) r[11]);
    }

    private static BigDecimal number(Object value) {
        return value == null ? null : new BigDecimal(value.toString());
    }

    /**
     * Native query date types vary with the Hibernate version and column type, and a wrong
     * cast here fails the whole list (see SuperAdminCallService). Naive values are UTC.
     */
    private static Instant instant(Object value) {
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof java.util.Date date) {
            return date.toInstant();
        }
        if (value instanceof OffsetDateTime offset) {
            return offset.toInstant();
        }
        if (value instanceof LocalDateTime local) {
            return local.toInstant(ZoneOffset.UTC);
        }
        return null;
    }

    private String redact(String body) {
        if (body == null) {
            return null;
        }
        try {
            Object tree = objectMapper.readValue(body, Object.class);
            return objectMapper.writeValueAsString(REDACTOR.redact(tree));
        } catch (JsonProcessingException e) {
            return "[withheld: body is not JSON, " + body.length() + " chars]";
        }
    }
}
