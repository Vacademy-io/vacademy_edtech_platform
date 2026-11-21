package vacademy.io.admin_core_service.features.commerce.common;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Is a user plan (or the invite it was bought on) a shop order line rather than a course
 * enrolment? A commerce plan has no enrolment row and must not be treated as a membership by
 * jobs, mails, workflows, the fee ledger or reports.
 *
 * <p>The test is "the plan's invite sells a package session that has a {@code commerce_variant}
 * row". It is not the package type: {@code PRODUCT} is also a course type that bulk course
 * creation has always been able to write, and such a course must keep behaving as a course.
 * Every variant has its own invite and legacy invite writers refuse a variant's session, so one
 * invite is either all commerce or not commerce at all.
 *
 * <p>The SQL constants are the same test for queries. They are constants so repository
 * {@code @Query} annotations can use them, they start and end with a space, and they carry only
 * balanced quotes (Spring Data scans {@code @Query} text for quotes and fails the boot on an
 * unbalanced one). A plan with no invite passes them.
 */
@Component
public class CommercePlans {

    private static final String PRODUCT_INVITE_NATIVE =
            " FROM package_session_learner_invitation_to_payment_option cm_link"
            + " JOIN commerce_variant cm_cv ON cm_cv.package_session_id = cm_link.package_session_id"
            + " WHERE cm_link.enroll_invite_id = ";

    /** Native SQL. Reads the user_plan alias {@code up}. */
    public static final String NOT_COMMERCE_PLAN =
            " NOT EXISTS (SELECT 1" + PRODUCT_INVITE_NATIVE + "up.enroll_invite_id) ";

    /** Native SQL. Reads the payment_log alias {@code pl}; a log with no plan passes. */
    public static final String NOT_COMMERCE_LOG_PL =
            " NOT EXISTS (SELECT 1 FROM user_plan cm_up WHERE cm_up.id = pl.user_plan_id"
            + " AND EXISTS (SELECT 1" + PRODUCT_INVITE_NATIVE + "cm_up.enroll_invite_id)) ";

    /** JPQL. Reads the UserPlan alias {@code up}. */
    public static final String NOT_COMMERCE_PLAN_JPQL =
            " NOT EXISTS (SELECT 1 FROM PackageSessionLearnerInvitationToPaymentOption cmLink, CommerceVariant cmVar"
            + " WHERE cmLink.enrollInvite.id = up.enrollInviteId"
            + " AND cmVar.packageSessionId = cmLink.packageSession.id) ";

    private final CommerceVariantRepository variantRepository;

    public CommercePlans(CommerceVariantRepository variantRepository) {
        this.variantRepository = variantRepository;
    }

    public boolean isCommercePlan(UserPlan userPlan) {
        return userPlan != null && isCommerceInviteId(userPlan.getEnrollInviteId());
    }

    public boolean isCommerceInvite(EnrollInvite enrollInvite) {
        return enrollInvite != null && isCommerceInviteId(enrollInvite.getId());
    }

    /** Throws 400 when the plan is a shop order line. {@code action} completes "Cannot ...". */
    public void refuseCommercePlan(UserPlan userPlan, String action) {
        if (isCommercePlan(userPlan)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Cannot " + action + ": this plan is a shop order line and is managed in Commerce.");
        }
    }

    public boolean isCommerceInviteId(String enrollInviteId) {
        if (!StringUtils.hasText(enrollInviteId)) {
            return false;
        }
        return variantRepository.countVariantsOnInvite(enrollInviteId) > 0;
    }
}
