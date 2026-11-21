package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralRewardCredit;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.ReferralRewardCreditRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ReferralRewardServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String REFERRER = "referrer-1";

    @Mock private AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    @Mock private ReferralRewardCreditRepository creditRepository;
    @Mock private UserPlanRepository userPlanRepository;

    @InjectMocks private ReferralRewardService service;

    @BeforeEach
    void setUp() {
        when(appliedCouponDiscountRepository.save(any(AppliedCouponDiscount.class))).thenAnswer(inv -> {
            AppliedCouponDiscount d = inv.getArgument(0);
            d.setId("rule-1");
            return d;
        });
    }

    private static ReferralMapping mappingFor(UserPlan plan) {
        return ReferralMapping.builder().id("map-1").referrerUserId(REFERRER).userPlan(plan).build();
    }

    private static UserPlan plan(boolean trial) {
        UserPlan p = new UserPlan();
        p.setId("plan-1");
        p.setUserId("referee-1");
        p.setIsTrial(trial);
        return p;
    }

    @Test
    @DisplayName("Referee on a trial: discount attached to the plan for one cycle, not taken at checkout")
    void refereeTrialGetsDeferredDiscount() {
        UserPlan trial = plan(true);

        boolean atCheckout = service.routeDiscountBenefit(mappingFor(trial), REFERRER, INSTITUTE,
                "REFEREE", "PENDING", AdminDiscountService.MODE_PERCENTAGE, 10.0, null);

        assertFalse(atCheckout);
        assertEquals("rule-1", trial.getAppliedCouponDiscountId());
        assertEquals(0, trial.getDiscountCyclesApplied());
        ArgumentCaptor<AppliedCouponDiscount> rule = ArgumentCaptor.forClass(AppliedCouponDiscount.class);
        verify(appliedCouponDiscountRepository).save(rule.capture());
        assertEquals(AdminDiscountService.SOURCE_REFERRAL, rule.getValue().getDiscountSource());
        assertEquals(1, rule.getValue().getApplyForCycles());
        assertEquals(10.0, rule.getValue().getDiscountPoint());
        assertNull(rule.getValue().getMaxDiscountPoint(), "no cap unless a real amount is configured");
        verify(userPlanRepository).save(trial);
    }

    @Test
    @DisplayName("Referee on a trial that already has an admin discount keeps the admin discount")
    void adminDiscountWinsOverReferral() {
        UserPlan trial = plan(true);
        trial.setAppliedCouponDiscountId("admin-1");
        AppliedCouponDiscount admin = new AppliedCouponDiscount();
        admin.setId("admin-1");
        admin.setDiscountSource(AdminDiscountService.SOURCE_ADMIN);
        when(appliedCouponDiscountRepository.findById("admin-1")).thenReturn(Optional.of(admin));

        service.routeDiscountBenefit(mappingFor(trial), REFERRER, INSTITUTE,
                "REFEREE", "PENDING", AdminDiscountService.MODE_PERCENTAGE, 10.0, null);

        assertEquals("admin-1", trial.getAppliedCouponDiscountId());
        verify(userPlanRepository, never()).save(any());
    }

    @Test
    @DisplayName("Referee on a non-trial plan with no other discount is discounted at checkout")
    void refereeNonTrialAtCheckout() {
        assertTrue(service.routeDiscountBenefit(mappingFor(plan(false)), REFERRER, INSTITUTE,
                "REFEREE", "PENDING", AdminDiscountService.MODE_PERCENTAGE, 10.0, null));
    }

    @Test
    @DisplayName("Referee on a non-trial plan with a coupon: no stacking")
    void refereeNonTrialWithCouponNotStacked() {
        UserPlan p = plan(false);
        p.setAppliedCouponDiscountId("coupon-rule");
        assertFalse(service.routeDiscountBenefit(mappingFor(p), REFERRER, INSTITUTE,
                "REFEREE", "PENDING", AdminDiscountService.MODE_PERCENTAGE, 10.0, null));
    }

    @Test
    @DisplayName("Referrer: a PENDING credit, never a cut in the referee's checkout")
    void referrerGetsPendingCredit() {
        boolean atCheckout = service.routeDiscountBenefit(mappingFor(plan(true)), REFERRER, INSTITUTE,
                "REFERRER", "PENDING", AdminDiscountService.MODE_PERCENTAGE, 5.0, 0.0);

        assertFalse(atCheckout);
        ArgumentCaptor<ReferralRewardCredit> credit = ArgumentCaptor.forClass(ReferralRewardCredit.class);
        verify(creditRepository).save(credit.capture());
        assertEquals(REFERRER, credit.getValue().getUserId());
        assertEquals(ReferralRewardCredit.STATUS_PENDING, credit.getValue().getStatus());
        assertEquals("rule-1", credit.getValue().getAppliedCouponDiscountId());
    }

    @Test
    @DisplayName("Referrer credit is AVAILABLE at once when the referral is already ACTIVE")
    void referrerCreditAvailableWhenActive() {
        service.routeDiscountBenefit(mappingFor(plan(false)), REFERRER, INSTITUTE,
                "REFERRER", "ACTIVE", AdminDiscountService.MODE_FLAT, 100.0, null);

        ArgumentCaptor<ReferralRewardCredit> credit = ArgumentCaptor.forClass(ReferralRewardCredit.class);
        verify(creditRepository).save(credit.capture());
        assertEquals(ReferralRewardCredit.STATUS_AVAILABLE, credit.getValue().getStatus());
    }

    @Test
    @DisplayName("Renewal reserves an AVAILABLE credit and returns its rule")
    void reserveAvailableCredit() {
        UserPlan p = plan(false);
        ReferralRewardCredit credit = ReferralRewardCredit.builder().id("c-1")
                .status(ReferralRewardCredit.STATUS_AVAILABLE).appliedCouponDiscountId("rule-9").build();
        AppliedCouponDiscount rule = new AppliedCouponDiscount();
        rule.setId("rule-9");
        when(creditRepository.findUsableForPlan("referee-1", INSTITUTE, "plan-1")).thenReturn(Optional.of(credit));
        when(creditRepository.reserve("c-1", "plan-1")).thenReturn(1);
        when(appliedCouponDiscountRepository.findById("rule-9")).thenReturn(Optional.of(rule));

        assertSame(rule, service.reserveCreditForRenewal(p, INSTITUTE));
    }

    @Test
    @DisplayName("A credit taken by someone else between read and reserve is not used")
    void lostReservationRace() {
        ReferralRewardCredit credit = ReferralRewardCredit.builder().id("c-1")
                .status(ReferralRewardCredit.STATUS_AVAILABLE).appliedCouponDiscountId("rule-9").build();
        when(creditRepository.findUsableForPlan(any(), any(), any())).thenReturn(Optional.of(credit));
        when(creditRepository.reserve("c-1", "plan-1")).thenReturn(0);

        assertNull(service.reserveCreditForRenewal(plan(false), INSTITUTE));
    }

    @Test
    @DisplayName("A dunning retry reuses the credit this plan already reserved")
    void retryReusesReservedCredit() {
        ReferralRewardCredit credit = ReferralRewardCredit.builder().id("c-1")
                .status(ReferralRewardCredit.STATUS_RESERVED).userPlanId("plan-1")
                .appliedCouponDiscountId("rule-9").build();
        AppliedCouponDiscount rule = new AppliedCouponDiscount();
        when(creditRepository.findUsableForPlan(any(), any(), any())).thenReturn(Optional.of(credit));
        when(appliedCouponDiscountRepository.findById("rule-9")).thenReturn(Optional.of(rule));

        assertSame(rule, service.reserveCreditForRenewal(plan(false), INSTITUTE));
        verify(creditRepository, never()).reserve(any(), any());
    }

    @Test
    @DisplayName("A cap equal to the percentage is the old admin-app bug and means no cap")
    void legacyCapIgnored() {
        assertNull(ReferralRewardService.effectiveCap(10.0, 10.0));
        assertNull(ReferralRewardService.effectiveCap(10.0, null));
        assertNull(ReferralRewardService.effectiveCap(10.0, 0.0));
        assertEquals(500.0, ReferralRewardService.effectiveCap(10.0, 500.0));
    }

    @Test
    @DisplayName("REFERRAL rules reach renewals once; coupons still never do")
    void discountForNextChargeHonoursReferral() {
        UserPlan p = plan(false);
        AppliedCouponDiscount referral = new AppliedCouponDiscount();
        referral.setDiscountSource(AdminDiscountService.SOURCE_REFERRAL);
        referral.setApplyForCycles(1);
        p.setDiscountCyclesApplied(0);
        assertSame(referral, AdminDiscountService.discountForNextCharge(p, referral));
        p.setDiscountCyclesApplied(1);
        assertNull(AdminDiscountService.discountForNextCharge(p, referral));

        AppliedCouponDiscount coupon = new AppliedCouponDiscount();
        coupon.setDiscountSource("COUPON");
        p.setDiscountCyclesApplied(0);
        assertNull(AdminDiscountService.discountForNextCharge(p, coupon));
    }
}
