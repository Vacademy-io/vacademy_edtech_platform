package vacademy.io.admin_core_service.features.engagement.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * All in-process reads the engagement feature makes against OTHER features' tables, in one
 * reviewed file. Native SQL on purpose: the engagement brain reads cross-feature data by
 * table contract (the recon-verified schema), not by borrowing other features' repository
 * methods whose semantics may shift under them.
 *
 * Every method is cohort-batched (IN-lists), never per-subject.
 */
@Repository
@Slf4j
public class EngagementReadDao {

    @PersistenceContext
    private EntityManager em;

    // ==================== Contacts ====================

    /** userId → [fullName, mobile, email] from the student table (latest row per user wins). */
    public Map<String, String[]> studentContactsByUserIds(List<String> userIds) {
        Map<String, String[]> out = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT DISTINCT ON (user_id) user_id, full_name, mobile_number, email
                FROM student WHERE user_id IN (:userIds)
                ORDER BY user_id, created_at DESC NULLS LAST
                """)
                .setParameter("userIds", userIds)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.put((String) c[0], new String[]{(String) c[1], (String) c[2], (String) c[3]});
        }
        return out;
    }

    /** audienceResponseId → [name(null), mobile, email] from the lead row's parent_* contact fields. */
    public Map<String, String[]> leadContactsByResponseIds(List<String> responseIds) {
        Map<String, String[]> out = new HashMap<>();
        if (responseIds == null || responseIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT id, parent_name, parent_mobile, parent_email
                FROM audience_response WHERE id IN (:ids)
                """)
                .setParameter("ids", responseIds)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.put((String) c[0], new String[]{(String) c[1], (String) c[2], (String) c[3]});
        }
        return out;
    }

    /**
     * audienceResponseId → source_type (LEAD_AGENT, WEBSITE, WALK_IN, ...). Every CRM lead gets a
     * user_id at submit time, so this — not user_id — is what tells a cold, researched
     * organisation from a person who filled a form.
     */
    public Map<String, String> leadSourceTypesByResponseIds(List<String> responseIds) {
        Map<String, String> out = new HashMap<>();
        if (responseIds == null || responseIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT id, source_type FROM audience_response WHERE id IN (:ids)
                """)
                .setParameter("ids", responseIds)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            if (c[1] != null) out.put((String) c[0], (String) c[1]);
        }
        return out;
    }

    /**
     * audienceResponseId → the Lead Agent's research on that organisation (lead_candidate.lead_json,
     * as text), for leads the agent delivered into this institute.
     */
    public Map<String, String> leadAgentResearchByResponseIds(List<String> responseIds, String instituteId) {
        Map<String, String> out = new HashMap<>();
        if (responseIds == null || responseIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT i.response_id, CAST(c.lead_json AS text)
                FROM lead_agent_intake i
                JOIN lead_candidate c ON c.id = i.external_id AND c.institute_id = i.institute_id
                WHERE i.response_id IN (:ids) AND i.institute_id = :instituteId
                """)
                .setParameter("ids", responseIds)
                .setParameter("instituteId", instituteId)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            if (c[1] != null) out.put((String) c[0], (String) c[1]);
        }
        return out;
    }

    // ==================== Enrollment + course activity ====================

    /** userId → list of [package_session_id, status, enrolled_date, expiry_date]. */
    public Map<String, List<Object[]>> enrollmentsByUserIds(List<String> userIds, String instituteId) {
        Map<String, List<Object[]>> out = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT user_id, package_session_id, status, enrolled_date, expiry_date
                FROM student_session_institute_group_mapping
                WHERE user_id IN (:userIds) AND institute_id = :instituteId
                  AND status IN ('ACTIVE', 'INVITED')
                """)
                .setParameter("userIds", userIds)
                .setParameter("instituteId", instituteId)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.computeIfAbsent((String) c[0], k -> new java.util.ArrayList<>()).add(c);
        }
        return out;
    }

    /**
     * userId → [package_session_id, completion%(String)] from the learner_operation rollup —
     * PERCENTAGE_PACKAGE_SESSION_COMPLETED is precomputed, no calculation here.
     */
    public Map<String, List<Object[]>> completionByUserIds(List<String> userIds) {
        Map<String, List<Object[]>> out = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT user_id, source_id, value
                FROM learner_operation
                WHERE user_id IN (:userIds)
                  AND source = 'PACKAGE_SESSION'
                  AND operation = 'PERCENTAGE_PACKAGE_SESSION_COMPLETED'
                """)
                .setParameter("userIds", userIds)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.computeIfAbsent((String) c[0], k -> new java.util.ArrayList<>()).add(c);
        }
        return out;
    }

    // ==================== CRM lead context ====================

    /**
     * audienceResponseId → [status_label, submitted_at, lead_tier, best_score, assigned_counselor_name,
     * last_activity_at]. Joins the lead row to its per-institute status + the per-user rollup.
     */
    public Map<String, Object[]> leadContextByResponseIds(List<String> responseIds, String instituteId) {
        Map<String, Object[]> out = new HashMap<>();
        if (responseIds == null || responseIds.isEmpty()) return out;
        // ulp is joined on user_id AND institute_id: user_lead_profile.user_id is globally UNIQUE
        // (V195) but carries institute_id, so a user_id-only join could surface another institute's
        // tier/score for a cross-institute user. Scope it.
        List<?> rows = em.createNativeQuery("""
                SELECT ar.id, ls.label, ar.submitted_at, ulp.lead_tier, ulp.best_score,
                       ulp.assigned_counselor_name, ulp.last_activity_at
                FROM audience_response ar
                LEFT JOIN lead_status ls ON ls.id = ar.lead_status_id
                LEFT JOIN user_lead_profile ulp ON ulp.user_id = ar.user_id AND ulp.institute_id = :instituteId
                WHERE ar.id IN (:ids)
                """)
                .setParameter("ids", responseIds)
                .setParameter("instituteId", instituteId)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.put((String) c[0], c);
        }
        return out;
    }

    /** userId → latest 3 timeline JOURNEY events [action_type, title, created_at]. */
    public Map<String, List<Object[]>> recentJourneyByUserIds(List<String> userIds, Instant since) {
        Map<String, List<Object[]>> out = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT student_user_id, action_type, title, created_at FROM (
                    SELECT student_user_id, action_type, title, created_at,
                           ROW_NUMBER() OVER (PARTITION BY student_user_id ORDER BY created_at DESC) rn
                    FROM timeline_event
                    WHERE student_user_id IN (:userIds) AND created_at >= :since
                ) t WHERE rn <= 3
                """)
                .setParameter("userIds", userIds)
                .setParameter("since", Timestamp.from(since))
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.computeIfAbsent((String) c[0], k -> new java.util.ArrayList<>()).add(c);
        }
        return out;
    }

    // ==================== Calls ====================

    /**
     * last-10-digits → latest call [direction, status, duration_seconds, created_at]. The subject's
     * number is from_number on INBOUND calls, to_number otherwise (an inbound-only lead would be
     * missed by a to_number-only match). Comparison is on the last 10 digits so E.164-stored
     * numbers (+91...) match the digits-only keys the callers pass.
     */
    public Map<String, Object[]> latestCallByPhones(List<String> last10Digits, String instituteId, Instant since) {
        Map<String, Object[]> out = new HashMap<>();
        if (last10Digits == null || last10Digits.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT DISTINCT ON (subj) subj, direction, status, duration_seconds, created_at
                FROM (
                    SELECT RIGHT(regexp_replace(
                               COALESCE(CASE WHEN direction = 'INBOUND' THEN from_number ELSE to_number END, ''),
                               '[^0-9]', '', 'g'), 10) AS subj,
                           direction, status, duration_seconds, created_at
                    FROM telephony_call_log
                    WHERE institute_id = :instituteId AND created_at >= :since
                ) c
                WHERE subj IN (:phones)
                ORDER BY subj, created_at DESC
                """)
                .setParameter("phones", last10Digits)
                .setParameter("instituteId", instituteId)
                .setParameter("since", Timestamp.from(since))
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.put((String) c[0], c);
        }
        return out;
    }

    /**
     * audienceResponseId → (field_name → value) for lead-attached custom fields.
     * custom_field_values is an append-log (no uniqueness) — latest row per field wins.
     */
    public Map<String, Map<String, String>> leadCustomFieldsByResponseIds(List<String> responseIds) {
        Map<String, Map<String, String>> out = new HashMap<>();
        if (responseIds == null || responseIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT DISTINCT ON (cfv.source_id, cfv.custom_field_id)
                       cfv.source_id, cf.field_name, cfv.value
                FROM custom_field_values cfv
                JOIN custom_fields cf ON cf.id = cfv.custom_field_id
                WHERE cfv.source_type = 'AUDIENCE_RESPONSE' AND cfv.source_id IN (:ids)
                ORDER BY cfv.source_id, cfv.custom_field_id, cfv.created_at DESC NULLS LAST
                """)
                .setParameter("ids", responseIds)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.computeIfAbsent((String) c[0], k -> new HashMap<>()).put((String) c[1], (String) c[2]);
        }
        return out;
    }

    // ==================== Audience resolution (enrollment) ====================

    /** Distinct ACTIVE/INVITED learner user ids in a batch. */
    public List<String> userIdsByPackageSession(String packageSessionId, String instituteId) {
        @SuppressWarnings("unchecked")
        List<String> rows = em.createNativeQuery("""
                SELECT DISTINCT user_id FROM student_session_institute_group_mapping
                WHERE package_session_id = :psId AND institute_id = :instituteId
                  AND status IN ('ACTIVE', 'INVITED') AND user_id IS NOT NULL
                """)
                .setParameter("psId", packageSessionId)
                .setParameter("instituteId", instituteId)
                .getResultList();
        return rows;
    }

    /**
     * ACTIVE, non-opted-out lead rows of an audience:
     * [audience_response_id, user_id?, phone10?, 'CONVERTED' or null].
     * Unconverted leads (user_id NULL) are INCLUDED — the engine reaches raw leads, unlike the
     * announcements path (RecipientType.AUDIENCE filters to converted only). overall_status
     * OPTED_OUT is excluded here because unconverted leads have no user_id and therefore no
     * user-keyed opt-out path — this is their only consent gate at enrollment.
     * phone10 is the last 10 digits of the lead's phone (null when it has fewer digits or is one
     * digit repeated, a placeholder), so the reconcile can collapse two rows of the same person.
     * The 4th column says the CRM marked the lead Converted (pipeline status or profile), or Lost /
     * Not interested ('LOST').
     * Oldest rows first, so the row kept for a phone stays the same across reconciles.
     */
    /**
     * Live lead rows submitted to these lists since {@code since}: {id, audience_id, institute_id,
     * user_id}. Uses idx_audience_response_audience_submitted (audience_id, submitted_at).
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> leadsSubmittedSince(java.util.Collection<String> audienceIds, java.time.Instant since) {
        if (audienceIds == null || audienceIds.isEmpty()) return List.of();
        return em.createNativeQuery("""
                SELECT ar.id, ar.audience_id, a.institute_id, ar.user_id
                  FROM audience_response ar
                  JOIN audience a ON a.id = ar.audience_id
                 WHERE ar.audience_id IN (:audienceIds)
                   AND ar.submitted_at >= :since
                   AND COALESCE(ar.audience_status, 'ACTIVE') = 'ACTIVE'
                 ORDER BY ar.submitted_at
                """)
                .setParameter("audienceIds", audienceIds)
                .setParameter("since", java.sql.Timestamp.from(since))
                .getResultList();
    }

    public List<Object[]> leadsByAudience(String audienceId, String instituteId) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery("""
                SELECT ar.id, ar.user_id,
                       CASE WHEN length(d.digits) >= 10 AND d.digits !~ '^(.)\\1*$'
                            THEN RIGHT(d.digits, 10) END AS phone10,
                       CASE WHEN ls.status_key = 'CONVERTED' OR ulp.conversion_status = 'CONVERTED'
                            THEN 'CONVERTED'
                            WHEN ls.status_key IN ('LOST', 'NOT_INTERESTED')
                            THEN 'LOST' END AS lead_stage
                FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id
                CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(ar.parent_mobile, ''), '[^0-9]', '', 'g') AS digits) d
                LEFT JOIN lead_status ls ON ls.id = ar.lead_status_id
                LEFT JOIN user_lead_profile ulp ON ulp.user_id = ar.user_id AND ulp.institute_id = :instituteId
                WHERE ar.audience_id = :audienceId AND a.institute_id = :instituteId
                  AND ar.audience_status = 'ACTIVE'
                  AND (ar.overall_status IS NULL OR ar.overall_status <> 'OPTED_OUT')
                ORDER BY ar.created_at, ar.id
                """)
                .setParameter("audienceId", audienceId)
                .setParameter("instituteId", instituteId)
                .getResultList();
        return rows;
    }

    /** Validate USER selectors: which of these ids have an ACTIVE/INVITED mapping in the institute. */
    public java.util.Set<String> validInstituteUserIds(java.util.Collection<String> userIds, String instituteId) {
        java.util.Set<String> out = new java.util.HashSet<>();
        if (userIds == null || userIds.isEmpty()) return out;
        @SuppressWarnings("unchecked")
        List<String> rows = em.createNativeQuery("""
                SELECT DISTINCT user_id FROM student_session_institute_group_mapping
                WHERE institute_id = :instituteId AND user_id IN (:userIds)
                  AND status IN ('ACTIVE', 'INVITED')
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("userIds", userIds)
                .getResultList();
        out.addAll(rows);
        return out;
    }

    // ==================== Consent ====================

    /** Subjects present in the institute's OPT_OUT audience (by user_id). */
    public java.util.Set<String> optedOutUserIds(String instituteId, List<String> userIds) {
        java.util.Set<String> out = new java.util.HashSet<>();
        if (userIds == null || userIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT DISTINCT ar.user_id
                FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id
                WHERE a.institute_id = :instituteId
                  AND a.campaign_type LIKE '%OPT_OUT%'
                  AND ar.audience_status = 'ACTIVE'
                  AND ar.user_id IN (:userIds)
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("userIds", userIds)
                .getResultList();
        for (Object r : rows) out.add((String) r);
        return out;
    }

    /**
     * The lead rows behind these members, as [id, overall_status, audience_status, lead_stage].
     * The opt-out list above is keyed by user_id, so an unconverted lead (no user_id) is invisible
     * to it; the lead row itself carries its consent (overall_status) and whether the admin
     * removed it (audience_status). lead_stage is 'CONVERTED' when the CRM marked the lead
     * Converted (pipeline status or profile), 'LOST' when its pipeline status is Lost or Not
     * interested (L2), else null. A row missing from the result no longer
     * exists in this institute.
     */
    public List<Object[]> leadConsentRows(String instituteId, java.util.Collection<String> audienceResponseIds) {
        if (audienceResponseIds == null || audienceResponseIds.isEmpty()) return List.of();
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery("""
                SELECT ar.id, ar.overall_status, ar.audience_status,
                       CASE WHEN ls.status_key = 'CONVERTED' OR ulp.conversion_status = 'CONVERTED'
                            THEN 'CONVERTED'
                            WHEN ls.status_key IN ('LOST', 'NOT_INTERESTED')
                            THEN 'LOST' END AS lead_stage
                FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id
                LEFT JOIN lead_status ls ON ls.id = ar.lead_status_id
                LEFT JOIN user_lead_profile ulp ON ulp.user_id = ar.user_id AND ulp.institute_id = :instituteId
                WHERE a.institute_id = :instituteId
                  AND ar.id IN (:ids)
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", audienceResponseIds)
                .getResultList();
        return rows;
    }

    /**
     * Everyone this institute's engines hold as opted out, as [user_id?, audience_response_id?,
     * phone10?]. An opt-out lives on the member rows it flipped, so an engine created later would
     * otherwise enrol the same person again; enrolment checks this list. phone10 is the lead's
     * phone, else the learner's, as in leadsByAudience. Read at enrolment only, never per sweep.
     */
    public List<Object[]> optedOutSubjects(String instituteId) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery("""
                SELECT om.user_id, om.audience_response_id,
                       CASE WHEN length(d.digits) >= 10 AND d.digits !~ '^(.)\\1*$'
                            THEN RIGHT(d.digits, 10) END AS phone10
                FROM engagement_member om
                LEFT JOIN audience_response oar ON oar.id = om.audience_response_id
                CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(oar.parent_mobile,
                        (SELECT s.mobile_number FROM student s WHERE s.user_id = om.user_id LIMIT 1), ''),
                        '[^0-9]', '', 'g') AS digits) d
                WHERE om.institute_id = :instituteId AND om.status = 'OPTED_OUT'
                """)
                .setParameter("instituteId", instituteId)
                .getResultList();
        return rows;
    }

    /** The last 10 digits of one lead row's phone, null when it has none (same rule as above). */
    public String leadPhone10(String audienceResponseId) {
        if (audienceResponseId == null) return null;
        List<?> rows = em.createNativeQuery("""
                SELECT CASE WHEN length(d.digits) >= 10 AND d.digits !~ '^(.)\\1*$'
                            THEN RIGHT(d.digits, 10) END
                FROM audience_response ar
                CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(ar.parent_mobile, ''), '[^0-9]', '', 'g') AS digits) d
                WHERE ar.id = :id
                """)
                .setParameter("id", audienceResponseId)
                .getResultList();
        return rows.isEmpty() ? null : (String) rows.get(0);
    }

    /**
     * Live members of this engine that are the same person as a new lead row: the same user, or a
     * lead row with the same phone. A second lead row for someone already in the engine must not
     * become a second member (two members = two messages).
     */
    public long liveMembersForSamePerson(String engineId, String audienceResponseId, String userId, String phone10) {
        if (userId == null && phone10 == null) return 0;
        Object n = em.createNativeQuery("""
                SELECT count(*) FROM engagement_member m
                LEFT JOIN audience_response ar ON ar.id = m.audience_response_id
                WHERE m.engine_id = :engineId AND m.status IN ('ACTIVE', 'PAUSED')
                  AND COALESCE(m.audience_response_id, '') <> :responseId
                  AND ((:userId <> '' AND m.user_id = :userId)
                       OR (:phone10 <> ''
                           AND RIGHT(regexp_replace(COALESCE(ar.parent_mobile, ''), '[^0-9]', '', 'g'), 10) = :phone10))
                """)
                .setParameter("engineId", engineId)
                .setParameter("responseId", audienceResponseId != null ? audienceResponseId : "")
                .setParameter("userId", userId != null ? userId : "")
                .setParameter("phone10", phone10 != null ? phone10 : "")
                .getSingleResult();
        return n instanceof Number num ? num.longValue() : 0;
    }
}
