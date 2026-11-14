package vacademy.io.admin_core_service.features.product_page.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageLoginCode;

import java.util.Optional;

@Repository
public interface ProductPageLoginCodeRepository extends JpaRepository<ProductPageLoginCode, String> {

    Optional<ProductPageLoginCode> findByCodeHash(String codeHash);

    boolean existsByPaymentLogId(String paymentLogId);

    /** Claims the code: 1 when this call consumed it, 0 when it was already used or has expired. */
    @Modifying
    @Query(value = "UPDATE product_page_login_code SET consumed_at = CURRENT_TIMESTAMP "
            + "WHERE code_hash = :codeHash AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
            nativeQuery = true)
    int consume(@Param("codeHash") String codeHash);

    /**
     * True when the user's account was first set up by this checkout: their earliest
     * student row is no older than {@code windowMinutes} before the payment log was opened.
     * Accounts that existed before (other institutes, imports, earlier sign-ups) are false.
     */
    @Query(value = "SELECT COALESCE((SELECT MIN(s.created_at) FROM student s WHERE s.user_id = :userId) "
            + ">= (SELECT pl.created_at FROM payment_log pl WHERE pl.id = :paymentLogId) "
            + "- make_interval(mins => :windowMinutes), false)",
            nativeQuery = true)
    boolean accountCreatedByCheckout(@Param("userId") String userId,
                                     @Param("paymentLogId") String paymentLogId,
                                     @Param("windowMinutes") int windowMinutes);
}
