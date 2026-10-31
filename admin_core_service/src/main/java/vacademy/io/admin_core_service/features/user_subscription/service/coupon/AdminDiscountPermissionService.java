package vacademy.io.admin_core_service.features.user_subscription.service.coupon;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Who may apply an admin discount (manual enroll, bulk assign, admin invoice, the
 * discount preview). Driven by the per-role Display Settings flag
 * {@code learnerManagement.canApplyDiscounts}, resolved the way the admin app picks a
 * user's Display Settings card — the same resolution {@code PaymentDeletionService}
 * uses for {@code allowDeletePayments}: an ADMIN reads the admin card; anyone whose
 * roles have a custom-role card reads those cards (any of them granting is enough);
 * everyone else reads the teacher card.
 *
 * <p>Defaults: the ADMIN card counts as ON when the flag is absent (admins could always
 * give discounts); every other card counts as OFF until an admin turns it on. A role
 * lookup error fails CLOSED.
 *
 * <p>The caller must be institute STAFF ({@link InstituteAccessValidator#requireInstituteStaff}):
 * no root-user bypass, because {@code is_root_user} is also set for learners and invited
 * staff, and a learner (even one carrying TEACHER from self-signup) is refused.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminDiscountPermissionService {

    /** The Display Settings flag, under {@code learnerManagement}. */
    public static final String CAN_APPLY_DISCOUNTS_FLAG = "canApplyDiscounts";

    private static final String ADMIN_SETTINGS_KEY = "ADMIN_DISPLAY_SETTINGS";
    private static final String TEACHER_SETTINGS_KEY = "TEACHER_DISPLAY_SETTINGS";
    private static final String ROLE_SETTINGS_KEY = "ROLE_DISPLAY_SETTINGS";
    private static final String LEARNER_MANAGEMENT = "learnerManagement";

    private static final String TURNED_OFF_MESSAGE = "Applying discounts is turned off for your role. "
            + "An admin can turn it on under Settings → Display Settings → Learner Management.";

    /** Roles live in auth_service's database — admin_core has no user_role table to query. */
    private final InstituteRoleUserClient instituteRoleUserClient;
    private final InstituteSettingService instituteSettingService;
    private final InstituteAccessValidator instituteAccessValidator;

    /** Throws unless the caller belongs to the institute AND their role may apply discounts. */
    public void requireCanApplyDiscounts(CustomUserDetails user, String instituteId) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        if (!canApplyDiscounts(user.getUserId(), instituteId)) {
            throw new ForbiddenException(TURNED_OFF_MESSAGE);
        }
    }

    /** Non-throwing form, for the dashboard's "can I?" check. */
    public boolean canApplyDiscounts(CustomUserDetails user, String instituteId) {
        if (user == null) {
            return false;
        }
        try {
            instituteAccessValidator.requireInstituteStaff(user, instituteId);
        } catch (Exception e) {
            return false;
        }
        return canApplyDiscounts(user.getUserId(), instituteId);
    }

    public boolean canApplyDiscounts(String userId, String instituteId) {
        if (!StringUtils.hasText(userId) || !StringUtils.hasText(instituteId)) return false;
        try {
            Optional<Set<String>> roleNames = instituteRoleUserClient.findRolesOfUser(instituteId, userId);
            if (roleNames.isEmpty()) return false; // lookup failed: fail closed
            if (roleNames.get().contains("ADMIN")) {
                return flagOn(instituteSettingService.getSettingByInstituteIdAndKey(instituteId, ADMIN_SETTINGS_KEY),
                        true);
            }
            Optional<Set<String>> roleIdLookup = instituteRoleUserClient.findRoleIdsOfUser(instituteId, userId);
            if (roleIdLookup.isEmpty()) return false;
            List<String> roleIds = List.copyOf(roleIdLookup.get());
            Object byRole = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, ROLE_SETTINGS_KEY);
            if (byRole instanceof Map<?, ?> roles) {
                List<Object> cards = roleIds.stream().filter(id -> id != null && roles.containsKey(id))
                        .map(roles::get).map(Object.class::cast).toList();
                if (!cards.isEmpty()) {
                    return cards.stream().anyMatch(card -> flagOn(card, false));
                }
            }
            return flagOn(instituteSettingService.getSettingByInstituteIdAndKey(instituteId, TEACHER_SETTINGS_KEY),
                    false);
        } catch (Exception e) {
            log.warn("canApplyDiscounts({}, {}) failed, treating as not allowed: {}",
                    userId, instituteId, e.getMessage());
            return false;
        }
    }

    /**
     * @param whenAbsent value to use when the card exists but has no flag yet (or the card
     *                   itself is missing) — true only for the admin card.
     */
    private static boolean flagOn(Object settings, boolean whenAbsent) {
        if (!(settings instanceof Map<?, ?> map)) return whenAbsent;
        Object section = map.get(LEARNER_MANAGEMENT);
        if (!(section instanceof Map<?, ?> lm) || !lm.containsKey(CAN_APPLY_DISCOUNTS_FLAG)) return whenAbsent;
        return Boolean.TRUE.equals(lm.get(CAN_APPLY_DISCOUNTS_FLAG));
    }
}
