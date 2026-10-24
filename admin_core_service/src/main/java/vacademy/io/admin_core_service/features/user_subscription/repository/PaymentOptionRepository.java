package vacademy.io.admin_core_service.features.user_subscription.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;

import java.util.List;
import java.util.Optional;

@Repository
public interface PaymentOptionRepository extends JpaRepository<PaymentOption, String> {

    // Paid live sessions: at most one ACTIVE option per session (source=LIVE_SESSION,
    // source_id=<live_session.id>); latest wins defensively if duplicates ever appear.
    Optional<PaymentOption> findFirstBySourceAndSourceIdAndStatusOrderByCreatedAtDesc(
            String source, String sourceId, String status);

    // Regional pricing (V585): options with the switch on. Derived queries, no SQL strings.
    long countByRegionalPricingEnabledTrue();

    List<PaymentOption> findByRegionalPricingEnabledTrue();

    /**
     * NOTE on parameter shape:
     * Postgres JDBC cannot infer the SQL type for a List parameter bound to NULL inside
     * `:list IS NULL` checks (manifests as `ERROR: could not determine data type of parameter $1`).
     * The fix is to always bind non-null lists and gate inclusion via boolean flags
     * (`:hasTypes`, `:hasExcludeTypes`, etc.). When a flag is false the OR short-circuits
     * and the IN clause never executes, so the sentinel list contents don't matter.
     *
     * The hidden_cpo clause leaves out system-built installment plans behind one-time
     * prices (V575): they only carry a learner's chosen schedule and are never offered as
     * a plan of their own. (No comments inside the SQL: an apostrophe there breaks
     * Spring Data's query parsing at startup.)
     */
    @Query(value = """
    SELECT po.*
    FROM payment_option po
    LEFT JOIN payment_plan pp ON po.id = pp.payment_option_id
    WHERE (:hasTypes = false OR po.type IN (:types))
      AND (:hasExcludeTypes = false OR po.type NOT IN (:excludeTypes))
      AND (:source IS NULL OR po.source = :source)
      AND (:sourceId IS NULL OR po.source_id = :sourceId)
      AND (:hasPaymentOptionStatuses = false OR po.status IN (:paymentOptionStatuses))
      AND (
          :hasPaymentPlanStatuses = false
          OR NOT EXISTS (SELECT 1 FROM payment_plan pp_sub WHERE pp_sub.payment_option_id = po.id)
          OR EXISTS (
              SELECT 1
              FROM payment_plan pp2
              WHERE pp2.payment_option_id = po.id AND pp2.status IN (:paymentPlanStatuses)
          )
      )
      AND (
          (:requireApproval = true AND po.require_approval = true) OR
          (:notRequireApproval = true AND po.require_approval = false) OR
          (:requireApproval = false AND :notRequireApproval = false)
      )
      AND (CAST(:search AS text) IS NULL OR po.name ILIKE CONCAT('%', CAST(:search AS text), '%'))
      AND (
          po.complex_payment_option_id IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM complex_payment_option hidden_cpo
              WHERE hidden_cpo.id = po.complex_payment_option_id
                AND hidden_cpo.source_payment_plan_id IS NOT NULL
          )
      )
    GROUP BY po.id, po.name, po.status, po.source, po.source_id, po.tag, po.type, po.require_approval, po.unit, po.complex_payment_option_id, po.created_at, po.updated_at
    ORDER BY po.created_at DESC, MAX(pp.created_at) DESC NULLS LAST
    LIMIT CAST(:maxResults AS integer)
""", nativeQuery = true)
    List<PaymentOption> findPaymentOptionsWithPaymentPlansNative(
            @Param("hasTypes") boolean hasTypes,
            @Param("types") List<String> types,
            @Param("hasExcludeTypes") boolean hasExcludeTypes,
            @Param("excludeTypes") List<String> excludeTypes,
            @Param("source") String source,
            @Param("sourceId") String sourceId,
            @Param("hasPaymentOptionStatuses") boolean hasPaymentOptionStatuses,
            @Param("paymentOptionStatuses") List<String> paymentOptionStatuses,
            @Param("hasPaymentPlanStatuses") boolean hasPaymentPlanStatuses,
            @Param("paymentPlanStatuses") List<String> paymentPlanStatuses,
            @Param("requireApproval") boolean requireApproval,
            @Param("notRequireApproval") boolean notRequireApproval,
            @Param("search") String search,
            // Postgres reads LIMIT NULL as "no limit", which is what every caller
            // that leaves this unset had before.
            @Param("maxResults") Integer maxResults
    );

    @Query("""
    SELECT DISTINCT po
    FROM PaymentOption po
    LEFT JOIN FETCH po.paymentPlans pp
    WHERE (:source IS NULL OR po.source = :source)
      AND (:sourceId IS NULL OR po.sourceId = :sourceId)
      AND (:tag IS NULL OR po.tag = :tag)
      AND (:hasExcludeTypes = false OR po.type NOT IN :excludeTypes)
      AND (:hasPaymentOptionStatus = false OR po.status IN :paymentOptionStatus)
      AND (
            :hasPlanStatuses = false
            OR pp IS NULL
            OR pp.status IN :planStatuses
          )
    ORDER BY po.createdAt DESC
""")
    Optional<PaymentOption> findTopByFiltersWithPlans(
            @Param("source") String source,
            @Param("sourceId") String sourceId,
            @Param("tag") String tag,
            @Param("hasExcludeTypes") boolean hasExcludeTypes,
            @Param("excludeTypes") List<String> excludeTypes,
            @Param("hasPaymentOptionStatus") boolean hasPaymentOptionStatus,
            @Param("paymentOptionStatus") List<String> paymentOptionStatus,
            @Param("hasPlanStatuses") boolean hasPlanStatuses,
            @Param("planStatuses") List<String> planStatuses
    );

    /**
     * Finds the mirror PaymentOption for a given ComplexPaymentOption, if any.
     * Used by ComplexPaymentOptionOperation, SchoolEnrollService, and the mirror sync helper.
     */
    Optional<PaymentOption> findByComplexPaymentOptionId(String complexPaymentOptionId);

}
