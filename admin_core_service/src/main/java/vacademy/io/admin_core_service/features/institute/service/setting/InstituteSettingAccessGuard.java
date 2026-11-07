package vacademy.io.admin_core_service.features.institute.service.setting;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Locale;
import java.util.Set;
import java.util.function.Predicate;

/**
 * Who may WRITE an institute setting through the generic setting endpoints
 * ({@code /institute/setting/v1/save-setting}, {@code create-name-setting},
 * {@code update-name-setting}) and the custom-field setting endpoint. These take the institute
 * and the setting key from the request, and had no caller check at all: any signed-in user
 * could rewrite any key of any institute.
 *
 * <p>The rule, after a platform super-admin ({@link SuperAdminAuthUtil} allowlist), who may
 * write anything:
 * <ol>
 *   <li>{@link #SUPER_ADMIN_ONLY_KEYS}: nobody else. VOICE_CALLING_SETTING carries the
 *       OPS-ONLY {@code billing} block (per-minute credit rates, CallBillingService); tenants
 *       save it through {@code PUT /v1/telephony/voice-config}, which keeps the stored billing
 *       block. A generic save replaces the whole blob, so an institute could zero its own rates.
 *       AI_VIDEO_POLICY holds the platform's per-institute AI video limits; an institute must not
 *       raise its own.</li>
 *   <li>{@link #ADMIN_ONLY_KEYS} and the {@code CUSTOM_ROLE_DISPLAY_SETTINGS*} family: institute
 *       ADMIN ({@link InstituteAccessValidator#requireInstituteAdmin}). These decide what each
 *       role can see or do: ROLE_DISPLAY_SETTINGS (custom roles' display blobs live inside it,
 *       keyed by role id) is read server-side as an authorization input (sub-org permissions,
 *       call-number visibility, live activity, audience access), as are the legacy
 *       AUDIENCE_ROLE_ACCESS key and LIVE_SESSION_SETTING.roleVisibility (which live sessions each
 *       role sees); the display blobs gate each role's dashboard; ASSISTANT_TOOLS / MCP_SERVER_SETTING pick which
 *       roles get AI tools that write data, NAMING_SETTING renames the whole product, and
 *       USER_IDENTIFIER changes how every member logs in.</li>
 *   <li>every other key: institute STAFF ({@link InstituteAccessValidator#requireInstituteStaff}).
 *       Not ADMIN-only on purpose: an admin can open the Settings page to a teacher or custom
 *       role (role display {@code ui.showSettings}), several settings are saved from
 *       non-settings screens that teachers and custom roles use, and the AI assistant saves
 *       COURSE_SETTING (drip rules) as the staff member using it. Learners are refused.</li>
 * </ol>
 *
 * <p>No root-user bypass: {@code is_root_user} is set for learners and invited staff (see
 * {@link InstituteAccessValidator#requireInstituteAdmin}), so membership comes from the caller's
 * authorities, which auth_service mints for the {@code clientId}-header institute only, with
 * {@code clientId == instituteId} required.
 */
@Component
public class InstituteSettingAccessGuard {

    public static final String NAMING_SETTING_KEY = "NAMING_SETTING";
    public static final String CUSTOM_FIELD_SETTING_KEY = "CUSTOM_FIELD_SETTING";

    /** Keys only a platform super-admin may write through the generic endpoint. */
    static final Set<String> SUPER_ADMIN_ONLY_KEYS = Set.of(
            "VOICE_CALLING_SETTING",
            // LMS AI video limits (enabled, qualities, minutes, monthly credit cap, concurrency),
            // written by ai_service PUT /super-admin/v1/institutes/{id}/ai-video-policy.
            "AI_VIDEO_POLICY");

    /** Keys only an institute ADMIN may write. Compared upper-cased. */
    static final Set<String> ADMIN_ONLY_KEYS = Set.of(
            "ROLE_DISPLAY_SETTINGS",
            "ROLE_DISPLAY_SETTING",
            "ADMIN_DISPLAY_SETTINGS",
            "TEACHER_DISPLAY_SETTINGS",
            "AUDIENCE_ROLE_ACCESS",
            "LIVE_SESSION_SETTING",
            NAMING_SETTING_KEY,
            "ASSISTANT_TOOLS_SETTING",
            "MCP_SERVER_SETTING",
            "USER_IDENTIFIER");

    /** Per-custom-role display blobs ({@code CUSTOM_ROLE_DISPLAY_SETTINGS_<roleId>} and the like). */
    static final String CUSTOM_ROLE_DISPLAY_PREFIX = "CUSTOM_ROLE_DISPLAY_SETTINGS";

    private final InstituteAccessValidator instituteAccessValidator;
    private final Predicate<CustomUserDetails> platformSuperAdmin;

    @Autowired
    public InstituteSettingAccessGuard(InstituteAccessValidator instituteAccessValidator) {
        this(instituteAccessValidator, InstituteSettingAccessGuard::isPlatformSuperAdmin);
    }

    /** For tests: the super-admin allowlist is an env var. */
    InstituteSettingAccessGuard(InstituteAccessValidator instituteAccessValidator,
                               Predicate<CustomUserDetails> platformSuperAdmin) {
        this.instituteAccessValidator = instituteAccessValidator;
        this.platformSuperAdmin = platformSuperAdmin;
    }

    /** Throws (403) unless {@code user} may write {@code settingKey} of {@code instituteId}. */
    public void requireCanWrite(CustomUserDetails user, String instituteId, String settingKey) {
        if (user != null && platformSuperAdmin.test(user)) {
            return;
        }
        if (settingKey == null || settingKey.isBlank()) {
            throw new VacademyException("settingKey is required");
        }
        switch (requiredLevel(settingKey)) {
            case SUPER_ADMIN -> throw new ForbiddenException(
                    "Access denied: " + settingKey + " can only be changed by Vacademy support");
            case ADMIN -> instituteAccessValidator.requireInstituteAdmin(user, instituteId);
            default -> instituteAccessValidator.requireInstituteStaff(user, instituteId);
        }
    }

    /**
     * Whole-blob reads ({@code /all}, {@code /raw}): institute STAFF (or super-admin). The blob
     * holds every key at once, provider credentials included (WHATSAPP_SETTING), and neither
     * dashboard nor any service calls these two routes (none in either frontend's git history),
     * so nothing legitimate reads them as a learner. The per-key reads stay open.
     */
    public void requireCanReadAll(CustomUserDetails user, String instituteId) {
        if (user != null && platformSuperAdmin.test(user)) {
            return;
        }
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
    }

    /**
     * Keys whose stored blob holds third-party provider credentials:
     * WHATSAPP_SETTING (Meta access_token / app_secret, WATI and Combot apiKey), EMAIL_SETTING
     * (SMTP username / password), LMS_SETTING (LearnDash apiKey / apiSecret / credential-sync
     * secret, Moodle token) and MOODLE_SETTING (Moodle token). Compared upper-cased.
     */
    static final Set<String> SECRET_KEYS = Set.of(
            "WHATSAPP_SETTING",
            "EMAIL_SETTING",
            "LMS_SETTING",
            "MOODLE_SETTING");

    /**
     * Per-key reads ({@code /get}, {@code /data}): open to any caller for ordinary keys — the
     * learner app reads its own keys (STUDENT_DISPLAY_SETTINGS, CHATBOT_SETTING, ...) with a
     * learner token — but a {@link #SECRET_KEYS secret-bearing key} needs institute STAFF (or a
     * super-admin). No frontend, ai_service or other service reads a secret key through these
     * routes: the admin WhatsApp screen uses {@code /institute/whatsapp-config/v1}, LMS uses its
     * own controller, and notification_service reads credentials over the HMAC internal route.
     */
    public void requireCanReadKey(CustomUserDetails user, String instituteId, String settingKey) {
        if (!isSecretKey(settingKey)) {
            return;
        }
        if (user != null && platformSuperAdmin.test(user)) {
            return;
        }
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
    }

    static boolean isSecretKey(String settingKey) {
        return settingKey != null && SECRET_KEYS.contains(settingKey.trim().toUpperCase(Locale.ROOT));
    }

    enum Level { STAFF, ADMIN, SUPER_ADMIN }

    static Level requiredLevel(String settingKey) {
        String key = settingKey.trim().toUpperCase(Locale.ROOT);
        if (SUPER_ADMIN_ONLY_KEYS.contains(key)) {
            return Level.SUPER_ADMIN;
        }
        if (ADMIN_ONLY_KEYS.contains(key) || key.startsWith(CUSTOM_ROLE_DISPLAY_PREFIX)) {
            return Level.ADMIN;
        }
        return Level.STAFF;
    }

    private static boolean isPlatformSuperAdmin(CustomUserDetails user) {
        try {
            SuperAdminAuthUtil.requireSuperAdmin(user);
            return true;
        } catch (VacademyException e) {
            return false;
        }
    }
}
