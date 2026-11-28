package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.learner.service.LearnerPortalAccessService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.util.TrialStartResolver;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The membership merge tags ({{practice_name}}, {{expiry_date_long}}, {{subscription_link}}, ...)
 * in one place, so a renewal email renders the same whether the enrolment-policy reminder sends
 * it, an admin sends it from the student side view, or it goes out in a campaign.
 */
@Slf4j
@Service
public class MembershipPlaceholderService {

    /** Every key this service fills; the notification service asks for these by name. */
    public static final List<String> KEYS = List.of(
            "learner_name", "first_name", "last_name", "practice_name",
            "expiry_date", "expiry_date_long", "subscription_link");

    /** Plans a member can still see on the subscriptions page; ACTIVE wins when there are several. */
    private static final List<String> CANDIDATE_STATUSES = List.of(
            UserPlanStatusEnum.ACTIVE.name(),
            UserPlanStatusEnum.CANCELED.name(),
            UserPlanStatusEnum.PAYMENT_FAILED.name(),
            UserPlanStatusEnum.EXPIRED.name());

    @Autowired
    private UserPlanRepository userPlanRepository;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private AuthService authService;

    @Lazy
    @Autowired
    private LearnerPortalAccessService learnerPortalAccessService;

    /**
     * Values for one known plan. {@code zone} formats the end date (null = server default);
     * the enrolment-policy reminder passes its context billing zone.
     */
    public Map<String, String> forPlan(UserPlan plan, UserDTO user, String instituteId, ZoneId zone) {
        String learnerName = user != null && StringUtils.hasText(user.getFullName())
                ? user.getFullName().trim()
                : "Learner";
        String[] nameParts = learnerName.split("\\s+", 2);
        Date endDate = plan != null ? plan.getEndDate() : null;

        Map<String, String> values = new HashMap<>();
        values.put("learner_name", learnerName);
        values.put("first_name", nameParts[0]);
        values.put("last_name", nameParts.length > 1 ? nameParts[1] : "");
        values.put("expiry_date", formatEndDate(endDate, "yyyy-MM-dd", zone));
        // Human-readable form for learner-facing copy, e.g. "14 November 2026".
        values.put("expiry_date_long", formatEndDate(endDate, "d MMMM yyyy", zone));
        values.put("practice_name", resolveSubOrgName(plan != null ? plan.getSubOrgId() : null));
        values.put("subscription_link", buildSubscriptionLink(user, instituteId));
        return values;
    }

    /**
     * Values per user for a batch of recipients at one institute, keyed by user id. Each user's
     * plan is their ACTIVE plan ending last, else the most recently ending visible one. Users
     * with no plan still get their name and subscription link; the date and practice are blank.
     */
    public Map<String, Map<String, String>> forUsers(String instituteId, List<String> userIds) {
        if (!StringUtils.hasText(instituteId) || userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        List<String> ids = userIds.stream().filter(StringUtils::hasText).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }

        Map<String, UserDTO> users = authService.getUsersFromAuthServiceByUserIds(ids).stream()
                .filter(u -> u != null && u.getId() != null)
                .collect(Collectors.toMap(UserDTO::getId, Function.identity(), (a, b) -> a));

        Map<String, UserPlan> planByUser = userPlanRepository
                .findAllByUserIdInAndInstituteIdAndStatusIn(ids, instituteId, CANDIDATE_STATUSES)
                .stream()
                .collect(Collectors.toMap(UserPlan::getUserId, Function.identity(),
                        (a, b) -> PLAN_PREFERENCE.compare(a, b) >= 0 ? a : b));

        Map<String, Map<String, String>> result = new HashMap<>();
        for (String userId : ids) {
            UserDTO user = users.get(userId);
            if (user == null) {
                continue;
            }
            UserPlan plan = planByUser.get(userId);
            ZoneId zone = plan != null && plan.getEnrollInvite() != null
                    ? TrialStartResolver.zoneFromInvite(plan.getEnrollInvite().getSettingJson())
                    : null;
            result.put(userId, forPlan(plan, user, instituteId, zone));
        }
        return result;
    }

    /** Greater = preferred: ACTIVE over anything else, then the later end date. */
    private static final Comparator<UserPlan> PLAN_PREFERENCE = Comparator
            .comparing((UserPlan p) -> UserPlanStatusEnum.ACTIVE.name().equals(p.getStatus()))
            .thenComparing(UserPlan::getEndDate, Comparator.nullsFirst(Comparator.naturalOrder()));

    private static String formatEndDate(Date endDate, String pattern, ZoneId zone) {
        if (endDate == null) {
            return "";
        }
        SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.ENGLISH);
        if (zone != null) {
            format.setTimeZone(TimeZone.getTimeZone(zone));
        }
        return format.format(endDate);
    }

    /** Name of the sub-org (practice) a SUB_ORG plan was bought for; blank for individual plans. */
    private String resolveSubOrgName(String subOrgId) {
        if (!StringUtils.hasText(subOrgId)) {
            return "";
        }
        try {
            return instituteRepository.findById(subOrgId)
                    .map(Institute::getInstituteName)
                    .orElse("");
        } catch (Exception e) {
            log.warn("Could not resolve sub-org name for {}: {}", subOrgId, e.getMessage());
            return "";
        }
    }

    /**
     * The learner portal page where a member manages (and can cancel) their subscription:
     * {@code <portal>/subscriptions/<username>}, on the same host the learner's other portal
     * links use.
     */
    private String buildSubscriptionLink(UserDTO user, String instituteId) {
        if (user == null || !StringUtils.hasText(user.getUsername())) {
            return "";
        }
        try {
            return learnerPortalAccessService.resolvePortalBaseUrl(instituteId, user.getId())
                    + "/subscriptions/"
                    + URLEncoder.encode(user.getUsername(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("Could not build subscription link for user {}: {}", user.getId(), e.getMessage());
            return "";
        }
    }
}
