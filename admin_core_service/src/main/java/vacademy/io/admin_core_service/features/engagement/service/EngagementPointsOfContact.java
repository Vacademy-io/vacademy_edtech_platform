package vacademy.io.admin_core_service.features.engagement.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The people an institute wants told when its engagement engine needs a human: the admins and the
 * counsellor assigned to the lead. One place, so every engine alert (a callback that could not be
 * placed, a meeting booked, a rejected WhatsApp template) reaches the same people the same way: an
 * email and a bell alert. The per-engine contacts another team is building plug in at
 * {@link #recipients}.
 */
@Service
@Slf4j
public class EngagementPointsOfContact {

    private static final String EMAIL_TYPE = "UTILITY_EMAIL";

    @Autowired @Lazy private AuthService authService;
    @Autowired @Lazy private NotificationService notificationService;
    @PersistenceContext private EntityManager em;

    /** Admins of the institute, plus the counsellor assigned to {@code leadUserId} when given. */
    public List<UserDTO> recipients(String instituteId, String leadUserId) {
        Map<String, UserDTO> byId = new LinkedHashMap<>();
        try {
            for (UserDTO u : authService.requireUsersByInstituteAndRoles(instituteId, List.of("ADMIN"))) {
                if (u != null && u.getId() != null) byId.put(u.getId(), u);
            }
        } catch (Exception e) {
            log.warn("Alert: could not resolve admins of {}: {}", instituteId, e.getMessage());
        }
        String counsellor = assignedCounsellor(instituteId, leadUserId);
        if (counsellor != null && !byId.containsKey(counsellor)) {
            try {
                for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(List.of(counsellor))) {
                    if (u != null && u.getId() != null) byId.put(u.getId(), u);
                }
            } catch (Exception e) {
                log.warn("Alert: could not resolve counsellor {}: {}", counsellor, e.getMessage());
            }
        }
        return new ArrayList<>(byId.values());
    }

    /**
     * Emails and bell-alerts the points of contact. Best effort per recipient: a failure to reach one
     * person never stops the others, and never fails the caller.
     *
     * @param sourceKind / sourceId  tag on the bell alert, so it can be found later
     */
    public int alert(String instituteId, String leadUserId, String title, String htmlBody,
                     String sourceKind, String sourceId) {
        List<UserDTO> people = recipients(instituteId, leadUserId);
        if (people.isEmpty()) {
            log.warn("Alert '{}' for institute {}: nobody to tell (no admin or counsellor found)", title, instituteId);
            return 0;
        }
        int emailed = 0;
        for (UserDTO u : people) {
            if (u.getEmail() == null || u.getEmail().isBlank()) continue;
            try {
                notificationService.sendHtmlEmailViaUnified(u.getEmail(), title, htmlBody, instituteId, null, null, EMAIL_TYPE);
                emailed++;
            } catch (Exception e) {
                log.warn("Alert '{}': email to {} failed: {}", title, u.getEmail(), e.getMessage());
            }
        }
        try {
            Map<String, Object> settings = new HashMap<>();
            settings.put("priority", 2);
            settings.put("isDismissible", true);
            settings.put("showBadge", true);
            settings.put("isActive", true);
            notificationService.createSystemAlertAnnouncement(instituteId,
                    people.stream().map(UserDTO::getId).toList(), title, stripTags(htmlBody), "system",
                    "Engagement engine", "ADMIN", settings, sourceKind, sourceId);
        } catch (Exception e) {
            log.warn("Alert '{}': bell alert failed: {}", title, e.getMessage());
        }
        return emailed;
    }

    private String assignedCounsellor(String instituteId, String leadUserId) {
        if (leadUserId == null || leadUserId.isBlank()) return null;
        try {
            @SuppressWarnings("unchecked")
            List<Object> rows = em.createNativeQuery("""
                    SELECT assigned_counselor_id FROM user_lead_profile
                     WHERE user_id = :u AND institute_id = :i AND assigned_counselor_id IS NOT NULL LIMIT 1
                    """).setParameter("u", leadUserId).setParameter("i", instituteId).getResultList();
            return rows.isEmpty() ? null : String.valueOf(rows.get(0));
        } catch (Exception e) {
            log.warn("Alert: counsellor lookup failed for {}: {}", leadUserId, e.getMessage());
            return null;
        }
    }

    static String stripTags(String html) {
        return html == null ? "" : html.replaceAll("(?i)<br\\s*/?>|</p>", " ").replaceAll("<[^>]+>", "").replaceAll("\\s+", " ").trim();
    }

    /** Escapes text that comes from a lead (names, their words) before it goes into an email. */
    public static String esc(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
