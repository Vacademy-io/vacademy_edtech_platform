package vacademy.io.admin_core_service.features.engagement.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Batched CRM reads for the lead data points (crm_timeline, crm_followups, ai_calls, ownership).
 * One query per cohort and data point, keyed by lead id (audience_response.id), always scoped to
 * the institute: a lead id belongs to exactly one institute through its audience, and every query
 * joins back to it, so a row of another institute can never surface (M1).
 */
@Repository
public class EngagementCrmReadDao {

    /** AI voice providers (CallIntelligenceEnqueueService.sourceBucket); every other provider is a human call. */
    static final List<String> AI_CALL_PROVIDERS = List.of("AAVTAAR", "VACADEMY_AI", "MOCK");

    public static boolean isAiProvider(String providerType) {
        return AI_CALL_PROVIDERS.contains(providerType);
    }

    @PersistenceContext
    private EntityManager em;

    /**
     * Lead id → newest timeline events first, at most {@code perLead}:
     * [type_id, category, action_type, actor_type, actor_name, title, description, created_at].
     * Lead events are filed under AUDIENCE_RESPONSE (notes, status, follow-ups, engine reach-outs) and
     * LEAD (calls), both keyed by the lead id. Rows written before V614 have no institute_id; they are
     * read only through the lead id, which the join pins to this institute (N5).
     */
    public Map<String, List<Object[]>> timelineByLeadIds(String instituteId, Collection<String> leadIds, int perLead) {
        Map<String, List<Object[]>> out = new HashMap<>();
        if (leadIds == null || leadIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT type_id, category, action_type, actor_type, actor_name, title, description, created_at
                FROM (
                    SELECT te.type_id, te.category, te.action_type, te.actor_type, te.actor_name,
                           te.title, te.description, te.created_at,
                           ROW_NUMBER() OVER (PARTITION BY te.type_id ORDER BY te.created_at DESC) AS rn
                    FROM timeline_event te
                    JOIN audience_response ar ON ar.id = te.type_id
                    JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId
                    WHERE te.type IN ('AUDIENCE_RESPONSE', 'LEAD')
                      AND te.type_id IN (:ids)
                      AND (te.institute_id IS NULL OR te.institute_id = :instituteId)
                ) t
                WHERE t.rn <= :perLead
                ORDER BY type_id, created_at DESC
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", leadIds)
                .setParameter("perLead", perLead)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.computeIfAbsent((String) c[0], k -> new ArrayList<>()).add(c);
        }
        return out;
    }

    /**
     * Lead id → follow-ups: every open one (soonest first, at most {@code maxOpen}) and the last closed one:
     * [audience_response_id, closed, status, schedule_time, content, is_priority, closer_reason,
     *  interest_level, student_response, next_action, closed_at, created_at].
     * A COMPLETED status counts as closed even where is_closed was not flipped.
     */
    public Map<String, List<Object[]>> followupsByLeadIds(String instituteId, Collection<String> leadIds, int maxOpen) {
        Map<String, List<Object[]>> out = new HashMap<>();
        if (leadIds == null || leadIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT audience_response_id, closed, status, schedule_time, content, is_priority, closer_reason,
                       interest_level, student_response, next_action, closed_at, created_at
                FROM (
                    SELECT f.audience_response_id,
                           (f.is_closed OR f.status = 'COMPLETED') AS closed,
                           f.status, f.schedule_time, f.content, f.is_priority, f.closer_reason,
                           f.interest_level, f.student_response, f.next_action, f.closed_at, f.created_at,
                           ROW_NUMBER() OVER (
                               PARTITION BY f.audience_response_id, (f.is_closed OR f.status = 'COMPLETED')
                               ORDER BY CASE WHEN (f.is_closed OR f.status = 'COMPLETED')
                                             THEN COALESCE(f.closed_at, f.updated_at) END DESC NULLS LAST,
                                        f.schedule_time ASC NULLS LAST) AS rn
                    FROM lead_followup f
                    WHERE f.institute_id = :instituteId
                      AND f.audience_response_id IN (:ids)
                ) x
                WHERE (x.closed = FALSE AND x.rn <= :maxOpen) OR (x.closed = TRUE AND x.rn = 1)
                ORDER BY audience_response_id, closed, schedule_time
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", leadIds)
                .setParameter("maxOpen", maxOpen)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.computeIfAbsent((String) c[0], k -> new ArrayList<>()).add(c);
        }
        return out;
    }

    /**
     * Lead id → its last {@code perLead} calls, newest first, with the call analysis when there is one:
     * [response_id, call_log_id, provider_type, direction, status, duration_seconds, at, disposition_key,
     *  disposition_notes, ci_status, general_summary, lead_sentiment, conversion_likelihood,
     *  generic_status, inferred_goal]. ci_status is returned whatever it is, so a caller can tell
     * "analysis still running" from "no analysis" (C-8); the analysis fields mean something only
     * when it is COMPLETED (C-9).
     */
    public Map<String, List<Object[]>> callsByLeadIds(String instituteId, Collection<String> leadIds, int perLead) {
        Map<String, List<Object[]>> out = new HashMap<>();
        if (leadIds == null || leadIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT c.response_id, c.id, c.provider_type, c.direction, c.status, c.duration_seconds, c.at,
                       c.disposition_key, c.disposition_notes,
                       ci.status, ci.general_summary, ci.lead_sentiment, ci.conversion_likelihood,
                       ci.generic_status, ci.inferred_goal
                FROM (
                    SELECT l.response_id, l.id, l.provider_type, l.direction, l.status, l.duration_seconds,
                           COALESCE(l.start_time, l.created_at) AS at, l.disposition_key, l.disposition_notes,
                           ROW_NUMBER() OVER (PARTITION BY l.response_id
                                              ORDER BY COALESCE(l.start_time, l.created_at) DESC) AS rn
                    FROM telephony_call_log l
                    WHERE l.institute_id = :instituteId
                      AND l.response_id IN (:ids)
                ) c
                LEFT JOIN call_intelligence ci ON ci.call_log_id = c.id AND ci.institute_id = :instituteId
                WHERE c.rn <= :perLead
                ORDER BY c.response_id, c.at DESC
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", leadIds)
                .setParameter("perLead", perLead)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.computeIfAbsent((String) c[0], k -> new ArrayList<>()).add(c);
        }
        return out;
    }

    /**
     * Call log id → the latest AI voice-bot result: [call_log_id, ai_summary, follow_up, follow_up_gist,
     * callback_at, callback_time_text, interest_level, disposition]. ai_call_result has no call_log_id
     * index, so the read rides idx_acr_institute (institute_id, received_at) from {@code since}, a time
     * no later than the oldest of these calls.
     */
    public Map<String, Object[]> aiCallResultsByCallLogIds(String instituteId, Collection<String> callLogIds,
                                                           Instant since) {
        Map<String, Object[]> out = new HashMap<>();
        if (callLogIds == null || callLogIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT DISTINCT ON (r.call_log_id) r.call_log_id, r.ai_summary, r.follow_up, r.follow_up_gist,
                       r.callback_at, r.callback_time_text, r.interest_level, r.disposition
                FROM ai_call_result r
                WHERE r.institute_id = :instituteId
                  AND r.received_at >= :since
                  AND r.call_log_id IN (:ids)
                ORDER BY r.call_log_id, r.received_at DESC
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("since", Timestamp.from(since))
                .setParameter("ids", callLogIds)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.put((String) c[0], c);
        }
        return out;
    }

    /**
     * Call log id → what the call promised (rows the AI Call Actions engine wrote, source_ref =
     * callLogId:ruleId): [call_log_id, channel, status, draft_body, created_at]. Read through the
     * lead members (idx_ea_member), never by a LIKE on source_ref.
     */
    public Map<String, List<Object[]>> callPromisesByLeadIds(String instituteId, Collection<String> leadIds) {
        Map<String, List<Object[]>> out = new HashMap<>();
        if (leadIds == null || leadIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT split_part(a.source_ref, ':', 1), a.channel, a.status, a.draft_body, a.created_at
                FROM engagement_action a
                WHERE a.institute_id = :instituteId
                  AND a.source = 'AI_CALL'
                  AND a.member_id IN (
                      SELECT m.id FROM engagement_member m
                      WHERE m.institute_id = :instituteId AND m.audience_response_id IN (:ids))
                ORDER BY a.created_at
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", leadIds)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.computeIfAbsent((String) c[0], k -> new ArrayList<>()).add(c);
        }
        return out;
    }

    /**
     * Lead id → [id, has_owner, owner_name, first_response_at, last_activity_at, last_human_note_at,
     * last_human_call_at]. The owner follows the CRM dashboard (CrmDashboardSql): the counsellor on the
     * lead profile, else the counsellor linked to the lead enquiry, so an unconverted lead (no user_id,
     * no profile) still has one. A human note is an ACTIVITY timeline row written by a person (not the
     * system, not the engine, not a call record); a human call is a call by a non-AI provider.
     */
    public Map<String, Object[]> ownershipByLeadIds(String instituteId, Collection<String> leadIds) {
        Map<String, Object[]> out = new HashMap<>();
        if (leadIds == null || leadIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT ar.id,
                       (ulp.assigned_counselor_id IS NOT NULL OR lu.user_id IS NOT NULL) AS has_owner,
                       ulp.assigned_counselor_name,
                       ulp.first_response_at,
                       ulp.last_activity_at,
                       (SELECT max(te.created_at) FROM timeline_event te
                         WHERE te.type IN ('AUDIENCE_RESPONSE', 'LEAD') AND te.type_id = ar.id
                           AND (te.institute_id IS NULL OR te.institute_id = :instituteId)
                           AND te.category = 'ACTIVITY'
                           AND te.action_type <> 'CALL_MADE'
                           AND te.actor_type NOT IN ('SYSTEM', 'ENGAGEMENT_ENGINE')) AS last_human_note_at,
                       (SELECT max(COALESCE(l.start_time, l.created_at)) FROM telephony_call_log l
                         WHERE l.institute_id = :instituteId AND l.response_id = ar.id
                           AND l.provider_type NOT IN (:aiProviders)) AS last_human_call_at
                FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId
                LEFT JOIN user_lead_profile ulp ON ulp.user_id = ar.user_id AND ulp.institute_id = :instituteId
                LEFT JOIN LATERAL (
                    SELECT lu.user_id FROM linked_users lu
                    WHERE lu.source = 'ENQUIRY' AND lu.source_id = ar.enquiry_id
                    ORDER BY lu.created_at DESC
                    LIMIT 1
                ) lu ON true
                WHERE ar.id IN (:ids)
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", leadIds)
                .setParameter("aiProviders", AI_CALL_PROVIDERS)
                .getResultList();
        for (Object r : rows) {
            Object[] c = (Object[]) r;
            out.put((String) c[0], c);
        }
        return out;
    }
}
