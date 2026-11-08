package vacademy.io.notification_service.features.email_billing;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Emails not sent because the institute was out of free allowance and credits. Each one is kept
 * so the admin can see it and resend it after topping up; nothing is sent later on its own (an
 * hours-late "your class has started" is worse than none).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class BlockedEmailStore {

    /** Larger attachments are not kept; the row says so and cannot be resent with them. */
    static final long MAX_KEPT_ATTACHMENT_BYTES = 10L * 1024 * 1024;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final ApplicationEventPublisher events;

    /** Published after an email is blocked, for the out-of-credits notice. */
    public record EmailBlockedEvent(String instituteId) {
    }

    public record BlockedEmail(String id, String instituteId, String toEmail, List<String> cc, String ccMode,
            String subject, String body, String emailType, String logSource, String fromEmail, String fromName,
            String userId, Map<String, byte[]> attachments, boolean attachmentsDropped, int units, String status,
            java.time.Instant createdAt) {
    }

    /** Never throws: recording a blocked email must not turn into a send failure. */
    public void save(String instituteId, String to, List<String> cc, String ccMode, String subject, String body,
            String emailType, String logSource, String fromEmail, String fromName, String userId,
            Map<String, byte[]> attachments, int units) {
        try {
            String attachmentJson = null;
            boolean dropped = false;
            long bytes = EmailUnits.attachmentBytes(attachments);
            if (bytes > MAX_KEPT_ATTACHMENT_BYTES) {
                dropped = true;
            } else if (attachments != null && !attachments.isEmpty()) {
                List<Map<String, String>> list = new ArrayList<>();
                attachments.forEach((name, data) -> {
                    if (data != null) {
                        list.add(Map.of("filename", name, "contentBase64", Base64.getEncoder().encodeToString(data)));
                    }
                });
                attachmentJson = objectMapper.writeValueAsString(list);
            }
            jdbc.update("""
                    INSERT INTO email_blocked (id, institute_id, to_email, cc, cc_mode, subject, body, email_type,
                        log_source, from_email, from_name, user_id, attachments, attachments_dropped, units)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, UUID.randomUUID().toString(), instituteId, to,
                    cc == null || cc.isEmpty() ? null : objectMapper.writeValueAsString(cc), ccMode,
                    subject, body, emailType, logSource, fromEmail, fromName, userId, attachmentJson, dropped, units);
            log.info("Email to {} for institute {} not sent: no free allowance or credits left", to, instituteId);
        } catch (Exception e) {
            log.error("Could not record blocked email to {} for institute {}: {}", to, instituteId, e.getMessage());
        }
        try {
            events.publishEvent(new EmailBlockedEvent(instituteId));
        } catch (Exception e) {
            log.warn("Could not publish email-blocked event for {}: {}", instituteId, e.getMessage());
        }
    }

    /** A whole send was refused up front (not enough credits for all of it): only the notice goes out. */
    public void notifyBlocked(String instituteId) {
        try {
            events.publishEvent(new EmailBlockedEvent(instituteId));
        } catch (Exception e) {
            log.warn("Could not publish email-blocked event for {}: {}", instituteId, e.getMessage());
        }
    }

    public List<BlockedEmail> list(String instituteId, String status, int limit, int offset) {
        return jdbc.query("""
                SELECT * FROM email_blocked WHERE institute_id = ? AND status = ?
                ORDER BY created_at DESC LIMIT ? OFFSET ?
                """, (rs, i) -> map(rs), instituteId, status, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
    }

    public long count(String instituteId, String status) {
        Long n = jdbc.queryForObject("SELECT count(*) FROM email_blocked WHERE institute_id = ? AND status = ?",
                Long.class, instituteId, status);
        return n == null ? 0 : n;
    }

    public java.util.Optional<BlockedEmail> find(String instituteId, String id) {
        List<BlockedEmail> rows = jdbc.query("SELECT * FROM email_blocked WHERE institute_id = ? AND id = ?",
                (rs, i) -> map(rs), instituteId, id);
        return rows.stream().findFirst();
    }

    /** Moves a BLOCKED row to RESENT or DISCARDED; false when it was no longer BLOCKED. */
    public boolean resolve(String instituteId, String id, String newStatus) {
        return jdbc.update("""
                UPDATE email_blocked SET status = ?, resolved_at = CURRENT_TIMESTAMP
                WHERE institute_id = ? AND id = ? AND status = 'BLOCKED'
                """, newStatus, instituteId, id) == 1;
    }

    private BlockedEmail map(java.sql.ResultSet rs) throws java.sql.SQLException {
        List<String> cc = List.of();
        Map<String, byte[]> attachments = Map.of();
        try {
            String ccJson = rs.getString("cc");
            if (ccJson != null) {
                cc = objectMapper.readValue(ccJson, new TypeReference<List<String>>() {
                });
            }
            String attJson = rs.getString("attachments");
            if (attJson != null) {
                Map<String, byte[]> m = new LinkedHashMap<>();
                for (Map<String, String> a : objectMapper.readValue(attJson,
                        new TypeReference<List<Map<String, String>>>() {
                        })) {
                    m.put(a.get("filename"), Base64.getDecoder().decode(a.get("contentBase64")));
                }
                attachments = m;
            }
        } catch (Exception e) {
            log.warn("Unreadable blocked email {}: {}", rs.getString("id"), e.getMessage());
        }
        return new BlockedEmail(rs.getString("id"), rs.getString("institute_id"), rs.getString("to_email"), cc,
                rs.getString("cc_mode"), rs.getString("subject"), rs.getString("body"), rs.getString("email_type"),
                rs.getString("log_source"), rs.getString("from_email"), rs.getString("from_name"),
                rs.getString("user_id"), attachments, rs.getBoolean("attachments_dropped"), rs.getInt("units"),
                rs.getString("status"), rs.getTimestamp("created_at").toInstant());
    }
}
