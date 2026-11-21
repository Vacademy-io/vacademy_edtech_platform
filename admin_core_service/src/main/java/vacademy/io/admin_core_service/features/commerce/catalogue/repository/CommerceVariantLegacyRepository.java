package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;

import java.util.Collection;
import java.util.List;

/**
 * Reads the legacy rows behind a variant: the join row (with its invite and payment option)
 * and the payment plan that carries the price. Kept here so the legacy repositories stay untouched.
 */
public interface CommerceVariantLegacyRepository
        extends Repository<PackageSessionLearnerInvitationToPaymentOption, String> {

    @Query("""
            SELECT l FROM PackageSessionLearnerInvitationToPaymentOption l
            JOIN FETCH l.enrollInvite
            JOIN FETCH l.paymentOption
            WHERE l.packageSession.id IN :packageSessionIds
              AND l.enrollInvite.instituteId = :instituteId
              AND l.enrollInvite.tag = :tag
            ORDER BY l.createdAt ASC, l.id ASC
            """)
    List<PackageSessionLearnerInvitationToPaymentOption> findLinksByPackageSessionIds(
            @Param("packageSessionIds") Collection<String> packageSessionIds,
            @Param("instituteId") String instituteId,
            @Param("tag") String tag);

    @Query("""
            SELECT pl FROM PaymentPlan pl
            WHERE pl.paymentOption.id IN :paymentOptionIds
              AND pl.status = :status
            ORDER BY pl.createdAt ASC, pl.id ASC
            """)
    List<PaymentPlan> findPlansByPaymentOptionIds(@Param("paymentOptionIds") Collection<String> paymentOptionIds,
                                                  @Param("status") String status);
}
