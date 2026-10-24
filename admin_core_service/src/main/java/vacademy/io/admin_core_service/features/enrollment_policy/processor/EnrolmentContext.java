package vacademy.io.admin_core_service.features.enrollment_policy.processor;

import lombok.Builder;
import lombok.Getter;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.EnrollmentPolicySettingsDTO;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.common.auth.dto.UserDTO;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * UserPlan-centric enrollment context.
 * Carries ALL data for a UserPlan and its associated mappings in a single pass.
 */
@Getter
@Builder
public class EnrolmentContext {
    // UserPlan-level data
    private final UserPlan userPlan;  // The UserPlan being processed
    private final List<StudentSessionInstituteGroupMapping> mappings;  // ALL mappings for this UserPlan (was allMappings)
    private final Map<String, EnrollmentPolicySettingsDTO> policiesByPackageSessionId;  // Package session ID → Policy
    
    // User context
    private final UserDTO user;  // ROOT_ADMIN for SUB_ORG, individual user for Individual

    /**
     * AUTOPAY_SETTING.GRACE_PERIOD_DAYS off the invite, when it sets one. It then WINS over
     * the policy's waitingPeriodInDays, so an institute has a single answer to "how long
     * after the term does access survive?" -- the autopay sweep reads the invite value, and
     * having this sweep read a different number from the package-session policy meant the
     * two could revoke access on different days for the same learner.
     */
    private final Integer graceDaysOverride;

    /**
     * The invite's billing timezone. Without it the day arithmetic ran on
     * {@link ZoneId#systemDefault()} -- the pod's zone, UTC in prod -- so an end_date stored
     * at IST midnight read as the previous day and every deadline landed a day out.
     */
    private final ZoneId billingZone;

    private ZoneId zone() {
        return billingZone != null ? billingZone : ZoneId.systemDefault();
    }

    public Date getStartDate() {
      return   userPlan.getStartDate();
    }

    public Date getEndDate() {
        return userPlan.getEndDate();
    }

    public UserDTO getUser() {
        return user;
    }

    public long getDaysUntilExpiry() {
        Date endDate = getEndDate();
        if (endDate == null) {
            return Long.MAX_VALUE;
        }
        LocalDate today = LocalDate.now(zone());
        LocalDate expiry = lastAccessDay(endDate);
        return ChronoUnit.DAYS.between(today, expiry);
    }

    public long getDaysPastExpiry() {
        Date endDate = getEndDate();
        if (endDate == null) {
            return Long.MIN_VALUE;
        }
        LocalDate today = LocalDate.now(zone());
        LocalDate expiry = lastAccessDay(endDate);
        return ChronoUnit.DAYS.between(expiry, today);
    }

    /**
     * The last day the term covers. {@code end_date} is the instant access ENDS, so it is
     * exclusive: an end of 27 Sep 18:30 UTC is 28 Sep 00:00 in Asia/Kolkata, and reading the
     * date of the instant itself made day 0 fall the day AFTER access ran out. Matches
     * RenewalGracePolicy.lastAccessDay, so the waiting period and the autopay grace cannot
     * disagree about which day is which.
     */
    private LocalDate lastAccessDay(Date endDate) {
        return Instant.ofEpochMilli(endDate.getTime()).minusSeconds(1).atZone(zone()).toLocalDate();
    }

    public Integer getWaitingPeriod() {
        // The invite's grace wins when it is configured: it is what the autopay sweep and
        // the learner-facing copy already use, so the two sweeps cannot disagree.
        if (graceDaysOverride != null) {
            return graceDaysOverride;
        }
        // Otherwise the MAXIMUM waiting period among all policies
        // This gives users the longest grace period if different package sessions have different settings
        return policiesByPackageSessionId.values().stream()
            .filter(p -> p.getOnExpiry() != null && p.getOnExpiry().getWaitingPeriodInDays() != null)
            .map(p -> p.getOnExpiry().getWaitingPeriodInDays())
            .max(Integer::compareTo)
            .orElse(0);
    }
    
    /**
     * Get policy for a specific package session
     */
    public EnrollmentPolicySettingsDTO getPolicyForPackageSession(String packageSessionId) {
        return policiesByPackageSessionId != null ? policiesByPackageSessionId.get(packageSessionId) : null;
    }
    
    /**
     * Check if this is a SUB_ORG UserPlan
     */
    public boolean isSubOrg() {
        return userPlan != null 
            && "SUB_ORG".equals(userPlan.getSource()) 
            && userPlan.getSubOrgId() != null;
    }
    
    /**
     * Get SubOrg ID if this is a SUB_ORG UserPlan
     */
    public String getSubOrgId() {
        return isSubOrg() ? userPlan.getSubOrgId() : null;
    }

    /**
     * Get all mappings (replaces getAllMappings())
     */
    public List<StudentSessionInstituteGroupMapping> getAllMappings() {
        return mappings;
    }
}
