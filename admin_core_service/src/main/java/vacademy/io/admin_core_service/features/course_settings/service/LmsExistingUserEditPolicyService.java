package vacademy.io.admin_core_service.features.course_settings.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

/**
 * Single answer to "when an enrolment workflow finds the learner ALREADY exists on the external
 * LMS, may it overwrite that account's details with ours?".
 *
 * <p>Today the Vet enrolment workflow looks the learner up by email
 * ({@code GET /crm/v1/user}); if it finds them it keeps the returned id and skips creation
 * ({@code create-user} is gated on the existing-user id being null). The existing account is
 * left exactly as it was, so a returning learner keeps whatever password they already have on the
 * LMS. This flag is what lets a workflow reset that password to ours ({@code edit-user} with the
 * enrolment password) instead — a returning learner logs in with the credentials we issued, while
 * a migration keeps this off so pre-existing accounts are never disturbed.</p>
 *
 * <p><b>Read as {@code COURSE_SETTING.data.lms.editExistingUser}</b>, per course first and
 * institute-wide as a fallback:</p>
 * <ol>
 *   <li>{@code package.course_setting.setting.COURSE_SETTING.data.lms.editExistingUser}</li>
 *   <li>{@code INSTITUTE.setting.COURSE_SETTING.data.lms.editExistingUser}</li>
 *   <li>{@code false}</li>
 * </ol>
 *
 * <p>The two-level resolution mirrors how {@code LearnerLmsUserSyncService} already resolves LMS
 * connections — course-level config wins, institute config is the default — because the LMS
 * connection itself is attached per course.</p>
 *
 * <p><b>Defaults to false, and every failure path returns false.</b> This is the opposite of
 * {@code EnrollmentCredentialPolicyService}, which defaults true, and deliberately so: not
 * sending an email is recoverable, but overwriting a live account on a customer's LMS is not.
 * An institute that never touched this setting must not start rewriting LMS profiles because of
 * an unreadable settings blob.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LmsExistingUserEditPolicyService {

    private static final String COURSE_SETTING_KEY = "COURSE_SETTING";
    /** Group under COURSE_SETTING.data that holds LMS behaviour flags. */
    private static final String LMS_GROUP = "lms";
    private static final String EDIT_EXISTING_USER = "editExistingUser";

    /**
     * Context key the workflow graph reads. The edit-user HTTP_REQUEST node gates itself with
     * {@code "condition": "#ctx['lmsEditExistingUser'] == true && <existing-user-id> != null"},
     * where {@code <existing-user-id>} is whichever key that graph stored the looked-up LMS user id
     * under — {@code #ctx['newMemberId']} in the add-member (staff) workflow, and the onboarding
     * (admin) workflow's own equivalent. The handler's SpEL evaluation already defaults to false on
     * error, so a run whose context never received this key simply skips the edit.
     */
    public static final String CONTEXT_KEY = "lmsEditExistingUser";

    private final PackageSettingService packageSettingService;
    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;

    /**
     * @param instituteId institute the learner is being enrolled into
     * @param packageId   course being enrolled into; null falls straight through to the
     *                    institute-level setting (e.g. a flow with no single course)
     * @return whether a workflow may edit an existing LMS account for this enrolment
     */
    public boolean mayEditExistingUser(String instituteId, String packageId) {
        Boolean perCourse = readPackageFlag(packageId);
        if (perCourse != null) {
            return perCourse;
        }
        Boolean perInstitute = readInstituteFlag(instituteId);
        return perInstitute != null && perInstitute;
    }

    /** @return the course-level flag, or null when the course has not set it either way. */
    private Boolean readPackageFlag(String packageId) {
        if (!StringUtils.hasText(packageId)) {
            return null;
        }
        try {
            Object data = packageSettingService.getSettingData(packageId, COURSE_SETTING_KEY);
            return readFlag(data);
        } catch (Exception e) {
            log.warn("Could not read course-level {}.{} for package {}: {}",
                    LMS_GROUP, EDIT_EXISTING_USER, packageId, e.getMessage());
            return null;
        }
    }

    /** @return the institute-level flag, or null when the institute has not set it either way. */
    private Boolean readInstituteFlag(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return null;
        }
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, COURSE_SETTING_KEY);
            return readFlag(data);
        } catch (Exception e) {
            log.warn("Could not read institute-level {}.{} for institute {}: {}",
                    LMS_GROUP, EDIT_EXISTING_USER, instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * Pull {@code lms.editExistingUser} out of a COURSE_SETTING {@code data} blob.
     *
     * <p>Returns null for "not set", which is what makes the course → institute fallback work:
     * a course that has never seen this setting must fall through, while a course that has
     * explicitly set it to false must NOT be overridden by an institute-wide true.</p>
     */
    private Boolean readFlag(Object data) {
        if (data == null) {
            return null;
        }
        JsonNode node = objectMapper.valueToTree(data).path(LMS_GROUP).path(EDIT_EXISTING_USER);
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        // Tolerate a string "true"/"false" — settings blobs are hand-edited JSON in places.
        return node.isBoolean() ? node.asBoolean() : Boolean.parseBoolean(node.asText());
    }
}
