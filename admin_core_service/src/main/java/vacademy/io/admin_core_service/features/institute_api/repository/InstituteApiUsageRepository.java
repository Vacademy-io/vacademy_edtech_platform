package vacademy.io.admin_core_service.features.institute_api.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;

import java.math.BigDecimal;
import java.sql.Timestamp;

/**
 * Native reader over the credit ledger (credit_transactions lives in this admin_core DB)
 * for partner-API spend. API traffic is billed with {@code user_id = 'apikey:<key_id>'}
 * (spec 10.5 / 10.8). Net of refunds, same rule as CreditUsageRepository.
 * Uses idx_credit_transactions_inst_user_created (V323).
 */
public interface InstituteApiUsageRepository extends Repository<InstituteApiKey, String> {

    @Query(value = "SELECT COALESCE(SUM(CASE WHEN ct.transaction_type = 'USAGE_DEDUCTION' THEN ABS(ct.amount) " +
            "                             WHEN ct.transaction_type = 'REFUND' THEN -ABS(ct.amount) " +
            "                             ELSE 0 END), 0) " +
            "FROM credit_transactions ct " +
            "WHERE ct.institute_id = :instituteId " +
            "  AND ct.user_id LIKE :userIdPattern " +
            "  AND ct.created_at >= :fromTs",
            nativeQuery = true)
    BigDecimal sumCreditsByUserPatternSince(@Param("instituteId") String instituteId,
                                            @Param("userIdPattern") String userIdPattern,
                                            @Param("fromTs") Timestamp fromTs);

    /** Pattern passed as a bind parameter: no quote or colon inside the native SQL. */
    String API_KEY_ACTOR_PATTERN = "apikey:%";

    default BigDecimal sumApiKeyCreditsSince(String instituteId, Timestamp fromTs) {
        BigDecimal sum = sumCreditsByUserPatternSince(instituteId, API_KEY_ACTOR_PATTERN, fromTs);
        return sum == null ? BigDecimal.ZERO : sum;
    }
}
