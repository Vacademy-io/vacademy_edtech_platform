package vacademy.io.admin_core_service.features.ai_usage.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.repository.Repository;
import vacademy.io.admin_core_service.features.ai_usage.entity.AiTokenUsage;

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;

/**
 * Native-query reader over the credit ledger (credit_transactions lives in THIS
 * admin_core DB). Aggregates per user WITHOUT joining the user directory — the
 * users/user_role/roles tables live in the auth-service DB, so they can't be
 * SQL-joined here. Names + roles are resolved separately via AuthService.
 *
 * Credits are net of refunds; attribution uses COALESCE(subject_user_id, user_id)
 * so work done ON a learner (actor = teacher) is credited to the learner.
 */
public interface CreditUsageRepository extends Repository<AiTokenUsage, UUID> {

    // All per-user usage for the window (one row per user who used AI — bounded).
    // Object[]{uid, ledger_role, net_credits, req_count}. Enriched + paginated in Java.
    @Query(value = "SELECT COALESCE(ct.subject_user_id, ct.user_id) AS uid, " +
            "       MAX(ct.user_role) AS ledger_role, " +
            "       SUM(CASE WHEN ct.transaction_type = 'USAGE_DEDUCTION' THEN ABS(ct.amount) " +
            "                WHEN ct.transaction_type = 'REFUND' THEN -ABS(ct.amount) " +
            "                ELSE 0 END) AS net_credits, " +
            "       COUNT(*) FILTER (WHERE ct.transaction_type = 'USAGE_DEDUCTION') AS req_count " +
            "FROM credit_transactions ct " +
            "WHERE ct.institute_id = :instituteId " +
            "  AND COALESCE(ct.subject_user_id, ct.user_id) IS NOT NULL " +
            "  AND ct.created_at >= :fromTs AND ct.created_at < :toTs " +
            "GROUP BY COALESCE(ct.subject_user_id, ct.user_id) " +
            "ORDER BY net_credits DESC",
            nativeQuery = true)
    List<Object[]> findAllUserUsage(@Param("instituteId") String instituteId,
                                    @Param("fromTs") Timestamp fromTs,
                                    @Param("toTs") Timestamp toTs);

    // Paginated per-user deduction log. Object[]{id, created_at, request_type, model_name, amount, description}.
    @Query(value = "SELECT ct.id, ct.created_at, ct.request_type, ct.model_name, ABS(ct.amount), ct.description " +
            "FROM credit_transactions ct " +
            "WHERE ct.institute_id = :instituteId " +
            "  AND COALESCE(ct.subject_user_id, ct.user_id) = :userId " +
            "  AND ct.transaction_type = 'USAGE_DEDUCTION' " +
            "  AND ct.created_at >= :fromTs AND ct.created_at < :toTs " +
            "ORDER BY ct.created_at DESC",
            countQuery = "SELECT COUNT(*) FROM credit_transactions ct " +
                    "WHERE ct.institute_id = :instituteId " +
                    "  AND COALESCE(ct.subject_user_id, ct.user_id) = :userId " +
                    "  AND ct.transaction_type = 'USAGE_DEDUCTION' " +
                    "  AND ct.created_at >= :fromTs AND ct.created_at < :toTs",
            nativeQuery = true)
    Page<Object[]> findUserLogs(@Param("instituteId") String instituteId,
                                @Param("userId") String userId,
                                @Param("fromTs") Timestamp fromTs,
                                @Param("toTs") Timestamp toTs,
                                Pageable pageable);

    // All deduction rows for the institute in the window (newest first), for the
    // admin export. Object[]{ created_at, uid, request_type, model_name, amount, description }.
    // Bounded by the caller via a large Pageable (export cap).
    @Query(value = "SELECT ct.created_at, COALESCE(ct.subject_user_id, ct.user_id) AS uid, " +
            "       ct.request_type, ct.model_name, ABS(ct.amount), ct.description " +
            "FROM credit_transactions ct " +
            "WHERE ct.institute_id = :instituteId " +
            "  AND ct.transaction_type = 'USAGE_DEDUCTION' " +
            "  AND COALESCE(ct.subject_user_id, ct.user_id) IS NOT NULL " +
            "  AND ct.created_at >= :fromTs AND ct.created_at < :toTs " +
            "ORDER BY ct.created_at DESC",
            nativeQuery = true)
    Page<Object[]> findAllLogs(@Param("instituteId") String instituteId,
                               @Param("fromTs") Timestamp fromTs,
                               @Param("toTs") Timestamp toTs,
                               Pageable pageable);

    // ── Automations chatbot (request_type='chatbot') ────────────────────────
    // ChatbotAiService stamps batch_id with the chatbot_flow id and puts the
    // flow name in the description, so a per-flow rollup needs no cross-service
    // join (chatbot_flow lives in the notification-service database).

    // Per-flow rollup for the window.
    // Object[]{ flow_id, net_credits, turn_count, user_count, last_used_at, sample_description }.
    @Query(value = "SELECT ct.batch_id AS flow_id, " +
            "       SUM(ABS(ct.amount)) AS net_credits, " +
            "       COUNT(*) AS turn_count, " +
            "       COUNT(DISTINCT COALESCE(ct.subject_user_id, ct.user_id)) AS user_count, " +
            "       MAX(ct.created_at) AS last_used_at, " +
            "       (array_agg(ct.description ORDER BY ct.created_at DESC))[1] AS sample_description " +
            "FROM credit_transactions ct " +
            "WHERE ct.institute_id = :instituteId " +
            "  AND ct.request_type = 'chatbot' " +
            "  AND ct.transaction_type = 'USAGE_DEDUCTION' " +
            "  AND ct.created_at >= :fromTs AND ct.created_at < :toTs " +
            "GROUP BY ct.batch_id " +
            "ORDER BY net_credits DESC",
            nativeQuery = true)
    List<Object[]> findChatbotUsageByFlow(@Param("instituteId") String instituteId,
                                          @Param("fromTs") Timestamp fromTs,
                                          @Param("toTs") Timestamp toTs);

    // Institute-wide totals for the window. Object[]{ net_credits, turn_count, user_count }.
    @Query(value = "SELECT COALESCE(SUM(ABS(ct.amount)), 0) AS net_credits, " +
            "       COUNT(*) AS turn_count, " +
            "       COUNT(DISTINCT COALESCE(ct.subject_user_id, ct.user_id)) AS user_count " +
            "FROM credit_transactions ct " +
            "WHERE ct.institute_id = :instituteId " +
            "  AND ct.request_type = 'chatbot' " +
            "  AND ct.transaction_type = 'USAGE_DEDUCTION' " +
            "  AND ct.created_at >= :fromTs AND ct.created_at < :toTs",
            nativeQuery = true)
    List<Object[]> findChatbotTotals(@Param("instituteId") String instituteId,
                                     @Param("fromTs") Timestamp fromTs,
                                     @Param("toTs") Timestamp toTs);

    // Paginated per-turn log, optionally narrowed to one flow.
    // Object[]{ id, created_at, batch_id, uid, model_name, amount, description }.
    // :flowId is nullable — CAST keeps Postgres from erroring on an untyped NULL parameter.
    @Query(value = "SELECT ct.id, ct.created_at, ct.batch_id, " +
            "       COALESCE(ct.subject_user_id, ct.user_id) AS uid, " +
            "       ct.model_name, ABS(ct.amount), ct.description " +
            "FROM credit_transactions ct " +
            "WHERE ct.institute_id = :instituteId " +
            "  AND ct.request_type = 'chatbot' " +
            "  AND ct.transaction_type = 'USAGE_DEDUCTION' " +
            "  AND (CAST(:flowId AS TEXT) IS NULL OR ct.batch_id = CAST(:flowId AS TEXT)) " +
            "  AND ct.created_at >= :fromTs AND ct.created_at < :toTs " +
            "ORDER BY ct.created_at DESC",
            countQuery = "SELECT COUNT(*) FROM credit_transactions ct " +
                    "WHERE ct.institute_id = :instituteId " +
                    "  AND ct.request_type = 'chatbot' " +
                    "  AND ct.transaction_type = 'USAGE_DEDUCTION' " +
                    "  AND (CAST(:flowId AS TEXT) IS NULL OR ct.batch_id = CAST(:flowId AS TEXT)) " +
                    "  AND ct.created_at >= :fromTs AND ct.created_at < :toTs",
            nativeQuery = true)
    Page<Object[]> findChatbotLogs(@Param("instituteId") String instituteId,
                                   @Param("flowId") String flowId,
                                   @Param("fromTs") Timestamp fromTs,
                                   @Param("toTs") Timestamp toTs,
                                   Pageable pageable);
}
