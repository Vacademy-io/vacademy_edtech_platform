package vacademy.io.admin_core_service.features.enrollment_policy;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.enrollment_policy.scheduler.PackageSessionScheduler;
import vacademy.io.admin_core_service.features.enrollment_policy.service.RenewalChargeService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Manual triggers for the enrolment-policy and autopay jobs, for verifying them without
 * waiting for their cron.
 *
 * <p>NOT under {@code /open/**} — deliberately. These are not read-only test hooks: the
 * expiry sweep flips plan statuses and deactivates access, and renewal-charge takes a REAL
 * payment (it arms next_charge_at itself and runs the scheduler's own charge path, so it
 * bypasses the due-date filter, the autopay flag and the institute gate). While this sat on
 * the open path, one unauthenticated GET with a user_plan id could charge any learner who
 * had a card on file. Both endpoints now require a valid token.
 */
@RestController
@RequestMapping("/admin-core-service/v1/enrollment-policy/test")
public class TestEnrollMentController {
    @Autowired
    private PackageSessionScheduler packageSessionScheduler;

    @Autowired
    private RenewalChargeService renewalChargeService;

    /** Runs the enrolment-policy expiry sweep now. Flips plan statuses — not read-only. */
    @GetMapping
    public void testEnrollmentPolicy(@RequestAttribute("user") CustomUserDetails user) {
        packageSessionScheduler.processPackageSessionExpiries();
    }

    /**
     * Forces an autopay renewal charge for one plan NOW, bypassing next_charge_at, so autopay
     * can be verified without waiting for the cycle. Runs the exact scheduler path.
     *
     * <p>This MOVES REAL MONEY. The authenticated caller is the authorisation.
     */
    @GetMapping("/renewal-charge/{userPlanId}")
    public String testRenewalCharge(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String userPlanId) {
        return renewalChargeService.chargeNow(userPlanId);
    }
}
