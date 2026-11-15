package vacademy.io.admin_core_service.features.commerce.common;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.SpelQueryContext;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentDashboardRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.Method;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CommercePlansTest {

    private CommerceVariantRepository inviteSessions;
    private CommercePlans commercePlans;

    @BeforeEach
    void setUp() {
        inviteSessions = mock(CommerceVariantRepository.class);
        commercePlans = new CommercePlans(inviteSessions);
    }

    private static UserPlan planOn(String inviteId) {
        UserPlan plan = new UserPlan();
        plan.setId("plan-1");
        plan.setEnrollInviteId(inviteId);
        return plan;
    }

    @Test
    void aPlanOnAVariantInviteIsACommercePlan() {
        when(inviteSessions.countVariantsOnInvite("inv-product")).thenReturn(1L);
        assertTrue(commercePlans.isCommercePlan(planOn("inv-product")));
        assertTrue(commercePlans.isCommerceInviteId("inv-product"));

        EnrollInvite invite = new EnrollInvite();
        invite.setId("inv-product");
        assertTrue(commercePlans.isCommerceInvite(invite));
    }

    @Test
    void aPlanOnAnInviteWithNoVariantIsNot() {
        // Includes a bulk-created course typed PRODUCT: no commerce_variant row, so it is a
        // course, is enrolled on payment and stays in every membership job and report.
        when(inviteSessions.countVariantsOnInvite("inv-course-typed-product")).thenReturn(0L);

        assertFalse(commercePlans.isCommercePlan(planOn("inv-course-typed-product")));
        assertFalse(commercePlans.isCommercePlan(planOn("inv-course")));
        assertDoesNotThrow(() -> commercePlans.refuseCommercePlan(planOn("inv-course-typed-product"), "cancel the plan"));
    }

    @Test
    void noPlanOrNoInviteIsNotCommerceAndReadsNothing() {
        assertFalse(commercePlans.isCommercePlan(null));
        assertFalse(commercePlans.isCommercePlan(planOn(null)));
        assertFalse(commercePlans.isCommerceInvite(null));
        assertFalse(commercePlans.isCommerceInviteId(" "));
        verifyNoInteractions(inviteSessions);
    }

    @Test
    void refusalIsA400ForACommercePlanOnly() {
        when(inviteSessions.countVariantsOnInvite("inv-product")).thenReturn(1L);

        VacademyException refused = assertThrows(VacademyException.class,
                () -> commercePlans.refuseCommercePlan(planOn("inv-product"), "cancel the plan"));
        assertEquals(400, refused.getStatus().value());
        assertDoesNotThrow(() -> commercePlans.refuseCommercePlan(planOn("inv-course"), "cancel the plan"));
    }

    // ── SQL fragments ────────────────────────────────────────────────────────

    @Test
    void fragmentsAreSafeToEmbed() {
        for (String sql : List.of(CommercePlans.NOT_COMMERCE_PLAN, CommercePlans.NOT_COMMERCE_LOG_PL,
                CommercePlans.NOT_COMMERCE_PLAN_JPQL)) {
            assertThat(sql).startsWith(" ").endsWith(" ");
            // No statement end, comment or bind marker that could shift a page clause or a parameter.
            assertThat(sql).doesNotContain(";").doesNotContain("--").doesNotContain("?").doesNotContain(":");
            assertThat(sql.chars().filter(c -> c == '\'').count() % 2).isZero();
            assertThat(sql.chars().filter(c -> c == '(').count()).isEqualTo(sql.chars().filter(c -> c == ')').count());
            // Same quote scan Spring Data runs over every @Query at start-up.
            assertDoesNotThrow(() -> SpelQueryContext
                    .of((index, expression) -> "?" + index, (prefix, name) -> prefix + name).parse(sql));
        }
        // The test is the commerce_variant row, never the package type: PRODUCT is also a course type.
        assertThat(CommercePlans.NOT_COMMERCE_PLAN).contains("up.enroll_invite_id").contains("commerce_variant")
                .doesNotContain("package_type");
        assertThat(CommercePlans.NOT_COMMERCE_LOG_PL).contains("pl.user_plan_id").contains("commerce_variant")
                .doesNotContain("package_type");
        assertThat(CommercePlans.NOT_COMMERCE_PLAN_JPQL).contains("up.enrollInviteId").contains("CommerceVariant")
                .doesNotContain("packageType");
    }

    @Test
    void planReadersExcludeCommercePlans() throws Exception {
        assertThat(query(UserPlanRepository.class, "findPaidActivePlansWithoutEnrollment").value())
                .contains(CommercePlans.NOT_COMMERCE_PLAN);
        assertThat(query(UserPlanRepository.class, "findAllByStatusInAndInstituteIdIn").value())
                .contains(CommercePlans.NOT_COMMERCE_PLAN_JPQL);
        assertThat(query(UserPlanRepository.class, "findAllByUserIdInAndInstituteIdAndStatusIn").value())
                .contains(CommercePlans.NOT_COMMERCE_PLAN_JPQL);
        Query membership = query(UserPlanRepository.class, "findMembershipDetailsWithDynamicStatus");
        assertThat(membership.value()).contains(CommercePlans.NOT_COMMERCE_PLAN);
        assertThat(membership.countQuery()).contains(CommercePlans.NOT_COMMERCE_PLAN);
        assertThat(query(StudentSessionInstituteGroupMappingRepository.class, "findAbandonedCartPlans").value())
                .contains(CommercePlans.NOT_COMMERCE_PLAN);
        assertThat(query(EnrollInviteRepository.class, "findLatestActiveInviteForLearner").value())
                .contains(CommercePlans.NOT_COMMERCE_PLAN);
        // Both payment-log arms of the admin Payments list: direct logs and logs reached through an invoice.
        assertThat(PaymentLogRepository.COMBINED_PAYMENT_ROWS).contains(CommercePlans.NOT_COMMERCE_PLAN)
                .contains(CommercePlans.NOT_COMMERCE_LOG_PL);
        assertThat(PaymentDashboardRepository.PAID_ROWS_CTE).contains(CommercePlans.NOT_COMMERCE_LOG_PL);
    }

    @Test
    void batchListsLeaveProductsOut() throws Exception {
        String notProduct = "NOT EXISTS (SELECT 1 FROM commerce_product cm_cp WHERE cm_cp.package_id = p.id)";
        assertThat(query(PackageSessionRepository.class, "findPackageSessionsByInstituteId").value())
                .contains(notProduct);
        Query paged = query(PackageSessionRepository.class, "findPackageSessionsByInstituteIdPaginated");
        assertThat(paged.value()).contains(notProduct);
        assertThat(paged.countQuery()).contains(notProduct);
        // The legacy stops-at-zero decrement never touches a product row.
        assertThat(query(PackageSessionRepository.class, "decrementAvailableSlotsClamped").value())
                .contains("commerce_variant");
    }

    @Test
    void instituteCourseAndBatchListsLeaveProductsOut() throws Exception {
        String notProduct = "FROM commerce_product cm_cp WHERE cm_cp.package_id = ";
        for (String method : List.of("findDistinctSessionsByInstituteIdAndStatusIn",
                "findDistinctLevelsByInstituteIdAndStatusIn", "findDistinctPackagesByInstituteIdAndStatuses",
                "countDistinctPackagesByInstituteId")) {
            assertThat(query(PackageRepository.class, method).value()).as(method).contains(notProduct);
        }
        Query criteria = query(PackageRepository.class, "findPackagesByCriteria");
        assertThat(criteria.value()).contains(notProduct);
        assertThat(criteria.countQuery()).contains(notProduct);
        for (String method : List.of("findCountPackageSessionsByInstituteIdAndStatusIn",
                "findPackageSessionsByInstituteIdAndSessionId")) {
            assertThat(query(PackageSessionRepository.class, method).value()).as(method).contains(notProduct);
        }
    }

    @Test
    void noQueryDecidesCommerceByPackageTypeAlone() throws Exception {
        // A bulk-created course can be typed PRODUCT; hiding it by type made it vanish from the LMS.
        for (Class<?> repository : List.of(PackageRepository.class, PackageSessionRepository.class)) {
            for (Method method : repository.getDeclaredMethods()) {
                Query query = method.getAnnotation(Query.class);
                if (query != null) {
                    assertThat(query.value() + query.countQuery()).as(method.getName())
                            .doesNotContain("IS DISTINCT FROM 'PRODUCT'").doesNotContain("= 'PRODUCT'");
                }
            }
        }
    }

    private static Query query(Class<?> repository, String methodName) {
        for (Method method : repository.getDeclaredMethods()) {
            if (method.getName().equals(methodName) && method.getAnnotation(Query.class) != null) {
                return method.getAnnotation(Query.class);
            }
        }
        throw new AssertionError(repository.getSimpleName() + "#" + methodName + " has no @Query");
    }
}
