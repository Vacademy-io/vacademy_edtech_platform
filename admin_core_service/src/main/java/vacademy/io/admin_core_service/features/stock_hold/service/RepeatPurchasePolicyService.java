package vacademy.io.admin_core_service.features.stock_hold.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.course_settings.service.PackageSettingService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.StockInfoProjection;

import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * May a learner buy the same item again, and is an item a pure charge (shipping / deposit)?
 *
 * <p>CONTRACT — other code calls exactly these signatures; bodies are implemented by the
 * stock work package.
 *
 * <p><b>Read as {@code COURSE_SETTING.data.commerce.allowRepeatPurchase}</b>, per course first and
 * institute-wide as a fallback, exactly like {@code LeadConversionPolicyService}: a course that
 * has never seen the setting falls through to the institute, while a course that explicitly set
 * {@code false} is never overridden by an institute-wide {@code true}.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RepeatPurchasePolicyService {

    private static final String COURSE_SETTING_KEY = "COURSE_SETTING";
    /** Group under COURSE_SETTING.data that holds checkout / storefront behaviour flags. */
    private static final String COMMERCE_GROUP = "commerce";
    private static final String ALLOW_REPEAT_PURCHASE = "allowRepeatPurchase";

    /** Package types that are a charge on an order, never a thing the learner owns. */
    private static final Set<String> CHARGE_PACKAGE_TYPES = Set.of("DELIVERY_CHARGE", "SECURITY_DEPOSIT");

    private final PackageSessionLearnerInvitationToPaymentOptionRepository inviteSessionRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final PackageSettingService packageSettingService;
    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;

    /**
     * {@code COURSE_SETTING.data.commerce.allowRepeatPurchase}, read per course first and then
     * institute-wide (same two-level resolution as LeadConversionPolicyService). Default false,
     * and every failure path returns false (today's behaviour).
     *
     * <p>An invite over several courses allows a repeat purchase only when no course on it says
     * {@code false} and at least one says {@code true}; when no course answers, the institute does.
     */
    public boolean allowsRepeatPurchase(EnrollInvite enrollInvite) {
        if (enrollInvite == null) {
            return false;
        }
        try {
            Set<String> packageIds = sessionsOf(enrollInvite).stream()
                    .map(StockInfoProjection::getPackageId)
                    .filter(StringUtils::hasText)
                    .collect(Collectors.toSet());
            boolean sawCourseAnswer = false;
            for (String packageId : packageIds) {
                Boolean perCourse = readPackageFlag(packageId);
                if (perCourse == null) {
                    continue;
                }
                if (!perCourse) {
                    return false;
                }
                sawCourseAnswer = true;
            }
            if (sawCourseAnswer) {
                return true;
            }
            return Boolean.TRUE.equals(readInstituteFlag(enrollInvite.getInstituteId()));
        } catch (Exception e) {
            log.warn("Could not resolve {}.{} for invite {}: {}", COMMERCE_GROUP, ALLOW_REPEAT_PURCHASE,
                    enrollInvite.getId(), e.getMessage());
            return false;
        }
    }

    /** True when every package session on the invite is a DELIVERY_CHARGE or SECURITY_DEPOSIT package. */
    public boolean isChargeItem(EnrollInvite enrollInvite) {
        if (enrollInvite == null) {
            return false;
        }
        try {
            List<StockInfoProjection> sessions = sessionsOf(enrollInvite);
            return !sessions.isEmpty() && sessions.stream().allMatch(this::isCharge);
        } catch (Exception e) {
            log.warn("Could not tell whether invite {} is a charge item: {}", enrollInvite.getId(), e.getMessage());
            return false;
        }
    }

    /** True when the package session's package type is DELIVERY_CHARGE or SECURITY_DEPOSIT. */
    public boolean isChargePackageSession(String packageSessionId) {
        if (!StringUtils.hasText(packageSessionId)) {
            return false;
        }
        try {
            return packageSessionRepository.findStockInfoByIds(List.of(packageSessionId)).stream()
                    .anyMatch(this::isCharge);
        } catch (Exception e) {
            log.warn("Could not read the package type of session {}: {}", packageSessionId, e.getMessage());
            return false;
        }
    }

    private boolean isCharge(StockInfoProjection session) {
        return session.getPackageType() != null && CHARGE_PACKAGE_TYPES.contains(session.getPackageType());
    }

    /** The invite's ACTIVE package sessions, with their package id and type. */
    private List<StockInfoProjection> sessionsOf(EnrollInvite enrollInvite) {
        List<String> packageSessionIds = inviteSessionRepository.findPackageSessionIdsByEnrollInviteAndStatusIn(
                enrollInvite, List.of(StatusEnum.ACTIVE.name()));
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return List.of();
        }
        Set<String> ids = packageSessionIds.stream().filter(Objects::nonNull).collect(Collectors.toCollection(HashSet::new));
        return ids.isEmpty() ? List.of() : packageSessionRepository.findStockInfoByIds(ids);
    }

    /** @return the course-level flag, or null when the course has not set it either way. */
    private Boolean readPackageFlag(String packageId) {
        try {
            return readFlag(packageSettingService.getSettingData(packageId, COURSE_SETTING_KEY));
        } catch (Exception e) {
            log.warn("Could not read course-level {}.{} for package {}: {}",
                    COMMERCE_GROUP, ALLOW_REPEAT_PURCHASE, packageId, e.getMessage());
            return null;
        }
    }

    /** @return the institute-level flag, or null when the institute has not set it either way. */
    private Boolean readInstituteFlag(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return null;
        }
        try {
            return readFlag(instituteSettingService.getSettingByInstituteIdAndKey(instituteId, COURSE_SETTING_KEY));
        } catch (Exception e) {
            log.warn("Could not read institute-level {}.{} for institute {}: {}",
                    COMMERCE_GROUP, ALLOW_REPEAT_PURCHASE, instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * Pull {@code commerce.allowRepeatPurchase} out of a COURSE_SETTING {@code data} blob.
     * Returns null for "not set", which is what makes the course → institute fallback work.
     */
    private Boolean readFlag(Object data) {
        if (data == null) {
            return null;
        }
        JsonNode node = objectMapper.valueToTree(data).path(COMMERCE_GROUP).path(ALLOW_REPEAT_PURCHASE);
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        // Tolerate a string "true"/"false" — settings blobs are hand-edited JSON in places.
        return node.isBoolean() ? node.asBoolean() : Boolean.parseBoolean(node.asText());
    }
}
