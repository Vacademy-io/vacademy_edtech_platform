package vacademy.io.admin_core_service.features.engagement.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * While a lead is inside an engagement engine, the engine owns its outreach (design: "existing
 * workflow automations are paused for any lead while it is inside the engine"). Workflow WhatsApp
 * and email nodes ask this before sending, so a lead does not get the engine's message and a
 * workflow drip on the same day.
 *
 * <p>Only lead nurture is held back: scheduled workflows (drips over lead lists) and the lead
 * events in {@link #LEAD_NURTURE_EVENTS}. Everything else a workflow sends is about something the
 * person did or owns (enrolment, payment, a class, a test, a form they just filled) and always
 * goes, as do sends to learners. A lead is "inside" when it is an ACTIVE member, as a lead row, of an ACTIVE engine:
 * a dry-run engine sends nothing, so workflows keep going for it, and the AI-call engine only
 * carries call promises.
 */
@Component
@Slf4j
public class EngagementWorkflowSuppression {

    /**
     * Lead events whose workflow sends are nurture the engine replaces. Not here on purpose: the
     * answer to something the person just did (a form, a call to our line, a checkout) and every
     * learner, payment or class event.
     */
    static final Set<String> LEAD_NURTURE_EVENTS = Set.of(
            "LEAD_STATUS_CHANGED",
            "LEAD_ASSIGNED_TO_COUNSELOR",
            "LEAD_TAT_REMINDER_BEFORE",
            "LEAD_TAT_OVERDUE",
            "FOLLOW_UP_DUE",
            "FOLLOW_UP_OVERDUE");

    /** A move to one of these statuses ends the engine's work; its workflow message always goes. */
    static final Set<String> TERMINAL_STATUSES = Set.of("CONVERTED", "LOST", "NOT_INTERESTED");

    @PersistenceContext
    private EntityManager em;

    /**
     * True when this workflow run is lead nurture: a scheduled run, or one fired by a lead event.
     * A run fired by any other event, or started by hand or by another service, is never held.
     */
    public static boolean appliesTo(Map<String, Object> context) {
        if (context == null) return false;
        Object event = context.get("triggerEvents");
        if (event != null && !String.valueOf(event).isBlank()) {
            String name = String.valueOf(event).trim();
            if ("LEAD_STATUS_CHANGED".equals(name) && context.get("newStatus") != null
                    && TERMINAL_STATUSES.contains(String.valueOf(context.get("newStatus")))) {
                return false; // the welcome on Converted, the goodbye on Lost
            }
            return LEAD_NURTURE_EVENTS.contains(name);
        }
        return context.get("scheduleId") != null;
    }

    /** Phones (last 10 digits) of the leads an active engine of this institute is working now. */
    public Set<String> engagedLeadPhones(String instituteId) {
        Set<String> out = new HashSet<>();
        if (instituteId == null || instituteId.isBlank()) return out;
        try {
            @SuppressWarnings("unchecked")
            List<String> rows = em.createNativeQuery("""
                    SELECT DISTINCT RIGHT(d.digits, 10)
                      FROM engagement_member m
                      JOIN engagement_engine e ON e.id = m.engine_id
                      LEFT JOIN audience_response ar ON ar.id = m.audience_response_id
                     CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(ar.parent_mobile,
                            (SELECT s.mobile_number FROM student s WHERE s.user_id = m.user_id LIMIT 1), ''),
                            '[^0-9]', '', 'g') AS digits) d
                     WHERE m.institute_id = :instituteId AND m.status = 'ACTIVE'
                       AND m.audience_response_id IS NOT NULL
                       AND e.status = 'ACTIVE'
                       AND (e.created_by IS NULL OR e.created_by <> 'SYSTEM_AI_CALL')
                       AND length(d.digits) >= 10
                    """)
                    .setParameter("instituteId", instituteId)
                    .getResultList();
            out.addAll(rows);
        } catch (Exception e) {
            // Never block a workflow on this lookup: on failure nothing is held back.
            log.warn("Engaged-lead phone lookup failed for institute {}: {}", instituteId, e.getMessage());
        }
        return out;
    }

    /** Emails (lowercased) of the leads an active engine of this institute is working now. */
    public Set<String> engagedLeadEmails(String instituteId) {
        Set<String> out = new HashSet<>();
        if (instituteId == null || instituteId.isBlank()) return out;
        try {
            @SuppressWarnings("unchecked")
            List<String> rows = em.createNativeQuery("""
                    SELECT DISTINCT LOWER(TRIM(COALESCE(NULLIF(ar.parent_email, ''),
                            (SELECT s.email FROM student s WHERE s.user_id = m.user_id LIMIT 1))))
                      FROM engagement_member m
                      JOIN engagement_engine e ON e.id = m.engine_id
                      LEFT JOIN audience_response ar ON ar.id = m.audience_response_id
                     WHERE m.institute_id = :instituteId AND m.status = 'ACTIVE'
                       AND m.audience_response_id IS NOT NULL
                       AND e.status = 'ACTIVE'
                       AND (e.created_by IS NULL OR e.created_by <> 'SYSTEM_AI_CALL')
                    """)
                    .setParameter("instituteId", instituteId)
                    .getResultList();
            for (String r : rows) if (r != null && !r.isBlank()) out.add(r);
        } catch (Exception e) {
            log.warn("Engaged-lead email lookup failed for institute {}: {}", instituteId, e.getMessage());
        }
        return out;
    }

    /** The last 10 digits of a phone, as {@link #engagedLeadPhones} keys them. */
    public static String phoneKey(String phone) {
        if (phone == null) return null;
        String d = phone.replaceAll("[^0-9]", "");
        return d.length() < 10 ? null : d.substring(d.length() - 10);
    }

    public static String emailKey(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }
}
