package vacademy.io.admin_core_service.features.institute.service.setting;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * /institute/setting/v1 save-setting, create-name-setting and update-name-setting (and the
 * custom-field save) took the institute and the key from the request with no caller check:
 * any signed-in user could rewrite any institute's role display settings (an authorization
 * input server-side), naming, or the VOICE_CALLING_SETTING billing block. These pin who may
 * write what. The real {@link InstituteAccessValidator} runs, with the clientId header set.
 */
class InstituteSettingAccessGuardTest {

    private static final String INSTITUTE = "inst-1";
    private static final String SUPER_ADMIN_ID = "platform-ops";

    private final InstituteSettingAccessGuard guard = new InstituteSettingAccessGuard(
            new InstituteAccessValidator(), user -> SUPER_ADMIN_ID.equals(user.getUserId()));

    @BeforeEach
    void clientIdHeaderMatchesInstitute() {
        clientIdHeader(INSTITUTE);
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientIdHeader(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (clientId != null) {
            request.addHeader("clientId", clientId);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    /** Root flag set on every principal: learners and invited staff are root users too. */
    private static CustomUserDetails principal(String userId, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName("Test User");
        dto.setRootUser(true);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static CustomUserDetails admin() {
        return principal("admin", "ADMIN");
    }

    private static CustomUserDetails teacher() {
        return principal("teacher", "TEACHER");
    }

    private static CustomUserDetails customRole() {
        return principal("counsellor", "COUNSELLOR", "SOME_PERMISSION");
    }

    private static CustomUserDetails learner() {
        return principal("learner", "STUDENT");
    }

    // ---- key classification ------------------------------------------------------------

    @Test
    @DisplayName("role display keys, naming and role-scoped AI access keys are ADMIN-only; billing blob is super-admin only")
    void keyLevels() {
        for (String key : List.of("ROLE_DISPLAY_SETTINGS", "ROLE_DISPLAY_SETTING", "ADMIN_DISPLAY_SETTINGS",
                "TEACHER_DISPLAY_SETTINGS", "CUSTOM_ROLE_DISPLAY_SETTINGS_abc123", "NAMING_SETTING",
                "ASSISTANT_TOOLS_SETTING", "MCP_SERVER_SETTING", "USER_IDENTIFIER", "AUDIENCE_ROLE_ACCESS",
                "LIVE_SESSION_SETTING")) {
            assertEquals(InstituteSettingAccessGuard.Level.ADMIN, InstituteSettingAccessGuard.requiredLevel(key), key);
        }
        // Case / whitespace variants must not slip a protected key through.
        assertEquals(InstituteSettingAccessGuard.Level.ADMIN,
                InstituteSettingAccessGuard.requiredLevel(" role_display_settings "));
        assertEquals(InstituteSettingAccessGuard.Level.SUPER_ADMIN,
                InstituteSettingAccessGuard.requiredLevel("VOICE_CALLING_SETTING"));
        // Keys teachers / custom roles save from non-settings screens (course drip rules, Student AI
        // page) or through notification_service (EMAIL_SETTING) must stay staff-level.
        for (String key : List.of("COURSE_SETTING", "CHATBOT_SETTING", "LEAD_SETTING", "EMAIL_SETTING",
                "STUDENT_DISPLAY_SETTINGS", "DOUBT_MANAGEMENT_SETTING", "CUSTOM_FIELD_SETTING")) {
            assertEquals(InstituteSettingAccessGuard.Level.STAFF, InstituteSettingAccessGuard.requiredLevel(key), key);
        }
    }

    // ---- staff-level keys ----------------------------------------------------------------

    @Test
    @DisplayName("admin, teacher and custom-role staff may write an ordinary key")
    void staffMayWriteOrdinaryKeys() {
        assertDoesNotThrow(() -> guard.requireCanWrite(admin(), INSTITUTE, "COURSE_SETTING"));
        assertDoesNotThrow(() -> guard.requireCanWrite(teacher(), INSTITUTE, "COURSE_SETTING"));
        assertDoesNotThrow(() -> guard.requireCanWrite(customRole(), INSTITUTE, "EMAIL_SETTING"));
    }

    @Test
    @DisplayName("a learner (root flag set) cannot write any key")
    void learnerDenied() {
        assertThrows(ForbiddenException.class, () -> guard.requireCanWrite(learner(), INSTITUTE, "COURSE_SETTING"));
        // Self-signup learners carry TEACHER too (allowLearnersToCreateCourses).
        assertThrows(ForbiddenException.class,
                () -> guard.requireCanWrite(principal("selfsignup", "STUDENT", "TEACHER"), INSTITUTE, "COURSE_SETTING"));
    }

    @Test
    @DisplayName("staff of another institute cannot write here (clientId must equal instituteId)")
    void otherInstituteDenied() {
        clientIdHeader("inst-2");
        assertThrows(ForbiddenException.class, () -> guard.requireCanWrite(admin(), INSTITUTE, "COURSE_SETTING"));
    }

    @Test
    @DisplayName("no clientId header (roles resolved for no institute) is denied")
    void missingClientIdDenied() {
        clientIdHeader(null);
        assertThrows(ForbiddenException.class,
                () -> guard.requireCanWrite(principal("someone"), INSTITUTE, "EMAIL_SETTING"));
    }

    // ---- admin-only keys -----------------------------------------------------------------

    @Test
    @DisplayName("only an institute ADMIN may write role display settings and naming")
    void adminOnlyKeys() {
        for (String key : List.of("ROLE_DISPLAY_SETTINGS", "TEACHER_DISPLAY_SETTINGS", "ADMIN_DISPLAY_SETTINGS",
                "CUSTOM_ROLE_DISPLAY_SETTINGS_r1", "NAMING_SETTING", "ASSISTANT_TOOLS_SETTING")) {
            assertDoesNotThrow(() -> guard.requireCanWrite(admin(), INSTITUTE, key), key);
            assertThrows(ForbiddenException.class, () -> guard.requireCanWrite(teacher(), INSTITUTE, key), key);
            assertThrows(ForbiddenException.class, () -> guard.requireCanWrite(customRole(), INSTITUTE, key), key);
            assertThrows(ForbiddenException.class, () -> guard.requireCanWrite(learner(), INSTITUTE, key), key);
        }
    }

    @Test
    @DisplayName("an admin who is also enrolled as a learner keeps admin writes")
    void adminWhoIsAlsoLearner() {
        assertDoesNotThrow(() -> guard.requireCanWrite(principal("both", "ADMIN", "STUDENT"), INSTITUTE,
                "ROLE_DISPLAY_SETTINGS"));
    }

    // ---- super-admin ---------------------------------------------------------------------

    @Test
    @DisplayName("VOICE_CALLING_SETTING (ops-only billing block) is refused even to an institute admin")
    void voiceCallingBillingIsOpsOnly() {
        assertThrows(ForbiddenException.class, () -> guard.requireCanWrite(admin(), INSTITUTE, "VOICE_CALLING_SETTING"));
    }

    @Test
    @DisplayName("AI_VIDEO_POLICY (platform AI video limits) is refused even to an institute admin")
    void aiVideoPolicyIsOpsOnly() {
        assertEquals(InstituteSettingAccessGuard.Level.SUPER_ADMIN,
                InstituteSettingAccessGuard.requiredLevel(" ai_video_policy "));
        assertThrows(ForbiddenException.class, () -> guard.requireCanWrite(admin(), INSTITUTE, "AI_VIDEO_POLICY"));
    }

    @Test
    @DisplayName("a platform super-admin may write any key of any institute, with no role there")
    void superAdminBypass() {
        clientIdHeader(null);
        CustomUserDetails ops = principal(SUPER_ADMIN_ID);
        assertDoesNotThrow(() -> guard.requireCanWrite(ops, INSTITUTE, "VOICE_CALLING_SETTING"));
        assertDoesNotThrow(() -> guard.requireCanWrite(ops, INSTITUTE, "ROLE_DISPLAY_SETTINGS"));
        assertDoesNotThrow(() -> guard.requireCanReadAll(ops, INSTITUTE));
    }

    // ---- whole-blob reads ------------------------------------------------------------------

    @Test
    @DisplayName("/all and /raw need staff of the institute")
    void readAll() {
        assertDoesNotThrow(() -> guard.requireCanReadAll(teacher(), INSTITUTE));
        assertThrows(ForbiddenException.class, () -> guard.requireCanReadAll(learner(), INSTITUTE));
        clientIdHeader("inst-2");
        assertThrows(ForbiddenException.class, () -> guard.requireCanReadAll(admin(), INSTITUTE));
    }

    // ---- per-key reads ---------------------------------------------------------------------

    @Test
    @DisplayName("keys holding provider credentials need staff to read; learners and other institutes refused")
    void secretKeyReads() {
        for (String key : List.of("WHATSAPP_SETTING", "EMAIL_SETTING", "LMS_SETTING", "MOODLE_SETTING", " whatsapp_setting ")) {
            assertDoesNotThrow(() -> guard.requireCanReadKey(admin(), INSTITUTE, key), key);
            assertDoesNotThrow(() -> guard.requireCanReadKey(teacher(), INSTITUTE, key), key);
            assertDoesNotThrow(() -> guard.requireCanReadKey(customRole(), INSTITUTE, key), key);
            assertThrows(ForbiddenException.class, () -> guard.requireCanReadKey(learner(), INSTITUTE, key), key);
            assertThrows(ForbiddenException.class,
                    () -> guard.requireCanReadKey(principal("parent", "PARENT"), INSTITUTE, key), key);
        }
        clientIdHeader("inst-2");
        assertThrows(ForbiddenException.class, () -> guard.requireCanReadKey(admin(), INSTITUTE, "WHATSAPP_SETTING"));
        clientIdHeader(null);
        assertDoesNotThrow(() -> guard.requireCanReadKey(principal(SUPER_ADMIN_ID), INSTITUTE, "WHATSAPP_SETTING"));
    }

    @Test
    @DisplayName("the keys the learner app reads stay open to a learner")
    void learnerReadsOfOrdinaryKeysStayOpen() {
        for (String key : List.of("STUDENT_TNC_SETTING", "LEARNER_TRACKING_SETTING", "ASSESSMENT_SETTING",
                "STUDENT_DISPLAY_SETTINGS", "CHATBOT_SETTING", "CUSTOM_FIELD_SETTING", "ONBOARDING_SETTING",
                "BADGES_REWARDS_SETTING", "DOUBT_MANAGEMENT_SETTING")) {
            assertDoesNotThrow(() -> guard.requireCanReadKey(learner(), INSTITUTE, key), key);
        }
        assertDoesNotThrow(() -> guard.requireCanReadKey(learner(), INSTITUTE, null));
    }
}
