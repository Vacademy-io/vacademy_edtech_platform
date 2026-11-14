package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService;
import vacademy.io.admin_core_service.features.user_subscription.dto.SubscriptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** A user_plan row is written for every checkout; only memberships belong on "My Membership". */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SubscriptionMembershipRuleTest {

    @Mock private UserPlanRepository userPlanRepository;
    @Mock private PackageSessionLearnerInvitationToPaymentOptionRepository inviteSessionRepository;
    @Mock private UserInstitutePaymentGatewayMappingService mandateService;
    @Mock private StudentSessionInstituteGroupMappingRepository mappingRepository;
    @Mock private PlanChangeService planChangeService;
    @Mock private PaymentLogRepository paymentLogRepository;
    @Mock private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;
    @Mock private PaymentSettingService paymentSettingService;
    @Mock private InstituteRepository instituteRepository;
    @InjectMocks private SubscriptionService service;

    private final List<UserPlan> plans = new ArrayList<>();

    @BeforeEach
    void setUp() {
        when(userPlanRepository.findAllByUserIdAndInstituteIdAndStatusIn(anyString(), anyString(), anyList()))
                .thenReturn(plans);
        when(planChangeService.summarise(any(), any(), any()))
                .thenReturn(new PlanChangeService.PlanChangeSummary(false, null));
    }

    private UserPlan plan(String id, String optionType, String... packageTypes) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId("invite-" + id);
        invite.setVendor("RAZORPAY");
        invite.setVendorId("RAZORPAY");
        when(inviteSessionRepository.findPackageTypesByEnrollInviteId("invite-" + id))
                .thenReturn(Arrays.asList(packageTypes));
        PaymentOption option = new PaymentOption();
        option.setType(optionType);
        PaymentPlan paymentPlan = new PaymentPlan();
        paymentPlan.setActualPrice(200.0);
        UserPlan plan = new UserPlan();
        plan.setId(id);
        plan.setUserId("learner");
        plan.setStatus("ACTIVE");
        plan.setEnrollInvite(invite);
        plan.setPaymentOption(option);
        plan.setPaymentPlan(paymentPlan);
        return plan;
    }

    private List<String> listedIds() {
        return service.listSubscriptions("learner", "inst").stream().map(SubscriptionDTO::getUserPlanId).toList();
    }

    @Test
    void readOnRentsOneTimeMembershipIsListed() {
        plans.add(plan("membership", "ONE_TIME", "MEMBERSHIP"));
        assertEquals(List.of("membership"), listedIds());
    }

    @Test
    void aSubscriptionOnAnOrdinaryCourseIsListed() {
        plans.add(plan("typed", "SUBSCRIPTION", "COURSE"));
        plans.add(plan("untyped", "SUBSCRIPTION", (String) null));
        assertEquals(List.of("typed", "untyped"), listedIds());
    }

    @Test
    void aFreeMembershipIsListed() {
        plans.add(plan("free-membership", "FREE", "MEMBERSHIP"));
        assertEquals(List.of("free-membership"), listedIds());
    }

    @Test
    void purchasesAndChargesAreNot() {
        plans.add(plan("book", "ONE_TIME", "COURSE"));
        plans.add(plan("untyped-course", "ONE_TIME", (String) null));
        plans.add(plan("free-course", "FREE", "COURSE"));
        plans.add(plan("instalments", "CPO", "COURSE"));
        plans.add(plan("donation", "donation", "COURSE"));
        plans.add(plan("delivery", "ONE_TIME", "DELIVERY_CHARGE"));
        plans.add(plan("deposit", "ONE_TIME", "SECURITY_DEPOSIT"));
        assertEquals(List.of(), listedIds());
    }

    @Test
    void aChargeIsNeverAMembershipEvenOnASubscriptionOption() {
        plans.add(plan("delivery", "SUBSCRIPTION", "DELIVERY_CHARGE"));
        assertEquals(List.of(), listedIds());
    }

    @Test
    void cancellingAPurchaseReportsNoRenewal() {
        UserPlan book = plan("book", "ONE_TIME", "COURSE");
        when(userPlanRepository.findById("book")).thenReturn(Optional.of(book));

        SubscriptionDTO dto = service.cancelSubscription("learner", "inst", "book");

        assertFalse(dto.isMembership());
        assertFalse(dto.isCanRenewManually());
    }

    @Test
    void aListedMembershipIsFlaggedAsOne() {
        plans.add(plan("membership", "ONE_TIME", "MEMBERSHIP"));
        assertTrue(service.listSubscriptions("learner", "inst").get(0).isMembership());
    }

    @Test
    void payingToRenewABookIsRefusedAsABadRequest() {
        UserPlan book = plan("book", "ONE_TIME", "COURSE");
        when(userPlanRepository.findById("book")).thenReturn(Optional.of(book));
        CustomUserDetails learner = mock(CustomUserDetails.class);
        when(learner.getUserId()).thenReturn("learner");

        assertThrows(InvalidRequestException.class,
                () -> service.initiateRenewalPayment(learner, "inst", "book", false, null, null));
    }
}
