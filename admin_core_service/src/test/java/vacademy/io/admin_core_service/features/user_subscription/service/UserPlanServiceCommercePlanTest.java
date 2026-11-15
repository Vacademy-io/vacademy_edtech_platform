package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.commerce.common.CommercePlans;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerBatchEnrollService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.stock_hold.service.RepeatPurchasePolicyService;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * A plan on a PRODUCT invite is a shop order line: paying it activates the plan and settles its
 * stock hold, and nothing else. No enrolment row, mail, workflow, stacking or fee-ledger row.
 * A course plan (typed or untyped) keeps every existing behaviour.
 */
class UserPlanServiceCommercePlanTest {

    private UserPlanRepository userPlanRepository;
    private CommerceVariantRepository inviteSessions;
    private StockHoldService stockHoldService;
    private LearnerBatchEnrollService learnerBatchEnrollService;
    private PackageSessionEnrollInviteToPaymentOptionService inviteToOptionService;
    private StudentSessionInstituteGroupMappingRepository mappingRepository;
    private AsyncEnrollmentEmailService emailService;
    private DynamicNotificationService notificationService;
    private WorkflowTriggerService workflowTriggerService;
    private UserAccountLedgerService ledger;
    private RepeatPurchasePolicyService repeatPurchasePolicy;
    private UserPlanService service;

    @BeforeEach
    void setUp() {
        userPlanRepository = mock(UserPlanRepository.class);
        inviteSessions = mock(CommerceVariantRepository.class);
        stockHoldService = mock(StockHoldService.class);
        learnerBatchEnrollService = mock(LearnerBatchEnrollService.class);
        inviteToOptionService = mock(PackageSessionEnrollInviteToPaymentOptionService.class);
        mappingRepository = mock(StudentSessionInstituteGroupMappingRepository.class);
        emailService = mock(AsyncEnrollmentEmailService.class);
        notificationService = mock(DynamicNotificationService.class);
        workflowTriggerService = mock(WorkflowTriggerService.class);
        ledger = mock(UserAccountLedgerService.class);
        repeatPurchasePolicy = mock(RepeatPurchasePolicyService.class);

        service = new UserPlanService();
        ReflectionTestUtils.setField(service, "userPlanRepository", userPlanRepository);
        ReflectionTestUtils.setField(service, "commercePlans", new CommercePlans(inviteSessions));
        ReflectionTestUtils.setField(service, "stockHoldService", stockHoldService);
        ReflectionTestUtils.setField(service, "learnerBatchEnrollService", learnerBatchEnrollService);
        ReflectionTestUtils.setField(service, "packageSessionEnrollInviteToPaymentOptionService", inviteToOptionService);
        ReflectionTestUtils.setField(service, "studentSessionInstituteGroupMappingRepository", mappingRepository);
        ReflectionTestUtils.setField(service, "studentSessionRepository", mock(StudentSessionRepository.class));
        ReflectionTestUtils.setField(service, "asyncEnrollmentEmailService", emailService);
        ReflectionTestUtils.setField(service, "dynamicNotificationService", notificationService);
        ReflectionTestUtils.setField(service, "workflowTriggerService", workflowTriggerService);
        ReflectionTestUtils.setField(service, "userAccountLedgerService", ledger);
        ReflectionTestUtils.setField(service, "repeatPurchasePolicyService", repeatPurchasePolicy);
        ReflectionTestUtils.setField(service, "paymentSettingService", mock(PaymentSettingService.class));

        when(inviteSessions.countVariantsOnInvite("inv-product")).thenReturn(1L);
        when(userPlanRepository.save(any(UserPlan.class))).thenAnswer(call -> {
            UserPlan saved = call.getArgument(0);
            if (saved.getId() == null) {
                saved.setId("plan-new");
            }
            return saved;
        });
    }

    private static EnrollInvite invite(String id) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId(id);
        invite.setInstituteId("inst-1");
        return invite;
    }

    private static UserPlan plan(String inviteId, String status) {
        UserPlan plan = new UserPlan();
        plan.setId("plan-1");
        plan.setUserId("buyer-1");
        plan.setStatus(status);
        plan.setEnrollInviteId(inviteId);
        plan.setEnrollInvite(invite(inviteId));
        return plan;
    }

    private void verifyNoLearnerSideEffects() {
        verifyNoInteractions(learnerBatchEnrollService, inviteToOptionService, mappingRepository, emailService,
                notificationService, workflowTriggerService, ledger, repeatPurchasePolicy);
    }

    // ── PAID path ────────────────────────────────────────────────────────────

    @Test
    void firstPaymentOnAProductPlanActivatesItAndDoesNothingElse() {
        UserPlan product = plan("inv-product", "PENDING_FOR_PAYMENT");

        service.applyOperationsOnFirstPayment(product);

        assertEquals("ACTIVE", product.getStatus());
        verify(userPlanRepository).save(product);
        // null: only the plan's own checkout hold settles, no session takes stock again.
        verify(stockHoldService).onPlanActivated(product, null);
        verify(userPlanRepository, never())
                .findTopByUserIdAndEnrollInviteIdAndStatusInAndIdNotInOrderByEndDateDesc(any(), any(), anyList(), anyList());
        verifyNoLearnerSideEffects();
    }

    @Test
    void aSecondPaidEventOnAnActiveProductPlanIsANoOp() {
        UserPlan product = plan("inv-product", "ACTIVE");

        service.applyOperationsOnFirstPayment(product);

        verify(userPlanRepository, never()).save(any());
        verifyNoInteractions(stockHoldService);
        // In particular the enrolment repair for an ACTIVE plan does not run.
        verifyNoLearnerSideEffects();
    }

    @Test
    void activationAlsoRecoversAFailedOrCancelledLine() {
        for (String status : List.of("PAYMENT_FAILED", "CANCELED")) {
            UserPlan product = plan("inv-product", status);
            service.activateCommercePlan(product);
            assertEquals("ACTIVE", product.getStatus(), status);
        }
    }

    @Test
    void activationLeavesOtherStatusesAlone() {
        for (String status : List.of("TERMINATED", "EXPIRED", "PENDING")) {
            UserPlan product = plan("inv-product", status);
            service.activateCommercePlan(product);
            assertEquals(status, product.getStatus());
        }
        verify(userPlanRepository, never()).save(any());
        verifyNoInteractions(stockHoldService);
    }

    @Test
    void enrolmentRepairReturnsAtOnceForAProductPlan() {
        service.ensureEnrollmentExists(plan("inv-product", "ACTIVE"));
        verifyNoLearnerSideEffects();
    }

    @Test
    void enrolmentRepairStillRunsForACoursePlan() {
        UserPlan course = plan("inv-course", "ACTIVE");
        when(inviteToOptionService.findPackageSessionsOfEnrollInvite(course.getEnrollInvite()))
                .thenReturn(List.of("ps-1"));
        when(mappingRepository.existsActiveMembership("buyer-1", List.of("ps-1"))).thenReturn(true);

        service.ensureEnrollmentExists(course);

        verify(mappingRepository).existsActiveMembership("buyer-1", List.of("ps-1"));
    }

    // ── stacking and the fee ledger ──────────────────────────────────────────

    @Test
    void aProductNeverStacksAndACourseStillAsksThePolicy() {
        UserPlan existing = plan("inv-product", "ACTIVE");
        assertFalse((Boolean) ReflectionTestUtils.invokeMethod(service, "stacksOnExistingPlan",
                invite("inv-product"), true, existing));
        verifyNoInteractions(repeatPurchasePolicy);

        EnrollInvite course = invite("inv-course");
        assertTrue((Boolean) ReflectionTestUtils.invokeMethod(service, "stacksOnExistingPlan",
                course, true, existing));
        verify(repeatPurchasePolicy).isChargeItem(course);
    }

    private UserPlan createPendingPlan(String inviteId) {
        PaymentPlan paymentPlan = new PaymentPlan();
        paymentPlan.setId("pp-1");
        paymentPlan.setActualPrice(100);
        when(userPlanRepository.findTopByUserIdAndEnrollInviteIdAndStatusInOrderByEndDateDesc(any(), any(), anyList()))
                .thenReturn(Optional.empty());
        return service.createUserPlan("buyer-1", paymentPlan, null, invite(inviteId), null, null,
                "PENDING_FOR_PAYMENT", "USER", null, null, null, 2);
    }

    @Test
    void aPendingProductPlanAccruesNothingOnTheFeeLedger() {
        UserPlan created = createPendingPlan("inv-product");
        assertEquals("PENDING_FOR_PAYMENT", created.getStatus());
        assertEquals(Integer.valueOf(2), created.getQuantity());
        verifyNoInteractions(ledger);
    }

    @Test
    void aPendingCoursePlanStillAccrues() {
        for (String inviteId : List.of("inv-course", "inv-untyped")) {
            createPendingPlan(inviteId);
        }
        verify(ledger, org.mockito.Mockito.times(2)).recordDebitAccrual(eq("buyer-1"), eq("inst-1"), any(), any(),
                any(), eq("USER_PLAN"), eq("plan-new"), any(), any(), any(), any());
    }

    // ── legacy writers ───────────────────────────────────────────────────────

    @Test
    void legacyCancelRefusesAProductPlan() {
        UserPlan product = plan("inv-product", "ACTIVE");
        when(userPlanRepository.findById("plan-1")).thenReturn(Optional.of(product));

        for (boolean force : new boolean[] { true, false }) {
            VacademyException refused = assertThrows(VacademyException.class,
                    () -> service.cancelUserPlan("plan-1", force));
            assertEquals(400, refused.getStatus().value());
        }
        assertEquals("ACTIVE", product.getStatus());
        verify(userPlanRepository, never()).save(any());
        verifyNoInteractions(stockHoldService);
    }

    @Test
    void bulkStatusChangeRefusesWhenAnyPlanIsAProduct() {
        UserPlan course = plan("inv-course", "ACTIVE");
        course.setId("plan-course");
        UserPlan product = plan("inv-product", "ACTIVE");
        when(userPlanRepository.findAllById(List.of("plan-course", "plan-1"))).thenReturn(List.of(course, product));

        assertThrows(VacademyException.class,
                () -> service.updateUserPlanStatuses(List.of("plan-course", "plan-1"), "EXPIRED"));

        assertEquals("ACTIVE", course.getStatus());
        assertEquals("ACTIVE", product.getStatus());
        verify(userPlanRepository, never()).saveAll(anyList());
    }

    @Test
    void adminPlanChangeRefusesAProductPlan() {
        when(userPlanRepository.findById("plan-1")).thenReturn(Optional.of(plan("inv-product", "ACTIVE")));
        assertThrows(VacademyException.class,
                () -> service.adminChangePlan("plan-1", "inst-1", null, null));
    }
}
