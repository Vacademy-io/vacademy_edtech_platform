package vacademy.io.auth_service.feature.admin_core_service.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.admin_core_service.dto.InstituteSignupPolicy;
import vacademy.io.auth_service.feature.admin_core_service.dto.UsernameChangedRequest;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

@Service
public class InstitutePolicyService {

    private static final Logger log = LoggerFactory.getLogger(InstitutePolicyService.class);

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name}")
    private String applicationName;

    @Value("${admin.core.service.base_url}")
    private String adminCoreServiceBaseUrl;

    private static final long POLICY_CACHE_TTL_MS = 5 * 60 * 1000L;

    private record CachedPolicy(InstituteSignupPolicy policy, long fetchedAt) {
    }

    private final Map<String, CachedPolicy> policyCache = new ConcurrentHashMap<>();

    /**
     * Same as {@link #fetchSignupPolicy} but reuses the answer for five minutes. User
     * creation calls this once per new learner, and a CSV of hundreds of rows must not
     * turn into hundreds of calls to admin-core. A failed fetch (null) is cached too.
     */
    public InstituteSignupPolicy fetchSignupPolicyCached(String instituteId) {
        if (!StringUtils.hasText(instituteId))
            return null;
        long now = System.currentTimeMillis();
        CachedPolicy cached = policyCache.get(instituteId);
        if (cached != null && now - cached.fetchedAt() < POLICY_CACHE_TTL_MS) {
            return cached.policy();
        }
        InstituteSignupPolicy policy = fetchSignupPolicy(instituteId);
        policyCache.put(instituteId, new CachedPolicy(policy, now));
        return policy;
    }

    public InstituteSignupPolicy fetchSignupPolicy(String instituteId) {
        if (!StringUtils.hasText(instituteId))
            return null;
        try {
            ResponseEntity<String> resp = internalClientUtils.makeHmacRequest(
                    applicationName,
                    HttpMethod.GET.name(),
                    adminCoreServiceBaseUrl,
                    "/admin-core-service/public/institute/v1/details/" + instituteId,
                    null);
            if (resp == null || resp.getBody() == null)
                return null;

            ObjectMapper mapper = new ObjectMapper();
            JsonNode institute = mapper.readTree(resp.getBody());
            String settingJson = institute.has("setting") && !institute.get("setting").isNull()
                    ? institute.get("setting").asText()
                    : null;
            if (!StringUtils.hasText(settingJson))
                return null;

            JsonNode settingNode = mapper.readTree(settingJson).get("setting");
            if (settingNode == null)
                return null;

            String passwordStrategy = null;
            String passwordDelivery = null;
            String usernameStrategy = null;
            String usernameCustomFieldId = null;
            String usernamePrefix = null;
            boolean usernameApplyToAll = false;
            boolean usernameOverrideTyped = false;
            boolean allowCreateCourses = false;

            JsonNode studentDisplay = settingNode.get("STUDENT_DISPLAY_SETTINGS");
            if (studentDisplay != null && studentDisplay.has("data")) {
                JsonNode data = studentDisplay.get("data");
                JsonNode signup = data.get("signup");
                if (signup != null) {
                    if (signup.has("passwordStrategy"))
                        passwordStrategy = signup.get("passwordStrategy").asText();
                    if (signup.has("passwordDelivery"))
                        passwordDelivery = signup.get("passwordDelivery").asText();
                    if (signup.has("usernameStrategy"))
                        usernameStrategy = signup.get("usernameStrategy").asText();
                    if (signup.hasNonNull("usernameCustomFieldId"))
                        usernameCustomFieldId = signup.get("usernameCustomFieldId").asText();
                    if (signup.hasNonNull("usernamePrefix"))
                        usernamePrefix = signup.get("usernamePrefix").asText();
                    usernameApplyToAll = signup.path("usernameApplyToAll").asBoolean(false);
                    usernameOverrideTyped = signup.path("usernameOverrideTyped").asBoolean(false);
                }
            }

            JsonNode courseSetting = settingNode.get("COURSE_SETTING");
            if (courseSetting != null && courseSetting.has("data")) {
                JsonNode perm = courseSetting.get("data").get("permissions");
                if (perm != null && perm.has("allowLearnersToCreateCourses")) {
                    allowCreateCourses = perm.get("allowLearnersToCreateCourses").asBoolean(false);
                }
            }

            return InstituteSignupPolicy.builder()
                    .passwordStrategy(passwordStrategy)
                    .passwordDelivery(passwordDelivery)
                    .allowLearnersToCreateCourses(allowCreateCourses)
                    .userNameStrategy(usernameStrategy)
                    .usernameCustomFieldId(usernameCustomFieldId)
                    .usernamePrefix(usernamePrefix)
                    .usernameApplyToAll(usernameApplyToAll)
                    .usernameOverrideTyped(usernameOverrideTyped)
                    .build();
        } catch (Exception e) {
            return null;
        }
    }

    public void updateLearnerDetails(UserDTO userDTO){
        try {
            ResponseEntity<String> resp = internalClientUtils.makeHmacRequest(
                applicationName,
                HttpMethod.PUT.name(),
                adminCoreServiceBaseUrl,
                "/admin-core-service/internal/learner/v1/update",
                userDTO);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    /**
     * Fan out a committed username change to every service holding a denormalized
     * copy. admin_core updates its own {@code student.username} rows and forwards
     * the rename to assessment_service (four more copies) — auth_service does not
     * call assessment_service directly because it has no
     * {@code assessment.server.baseurl} configured in any profile.
     *
     * <p>{@code @Async} + best-effort: a rename must never fail the credential
     * change that triggered it. The final failure is logged with everything
     * needed to replay it by hand, because nothing else in the system detects a
     * stale copy.
     *
     * @param oldUsername the value BEFORE the change — must be captured before
     *                    {@code users.username} is overwritten, since the
     *                    downstream tables are keyed by username
     */
    @Async
    public void notifyUsernameChanged(String userId, String oldUsername, String newUsername) {
        if (!StringUtils.hasText(userId) || !StringUtils.hasText(newUsername)
                || newUsername.equals(oldUsername)) {
            return;
        }
        try {
            UsernameChangedRequest body = new UsernameChangedRequest(userId, oldUsername, newUsername);
            ResponseEntity<String> resp = internalClientUtils.makeHmacRequest(
                    applicationName,
                    HttpMethod.POST.name(),
                    adminCoreServiceBaseUrl,
                    "/admin-core-service/internal/learner/v1/username-changed",
                    body);
            log.info("Username change fan-out dispatched for userId={} '{}' -> '{}': HTTP {}",
                    userId, oldUsername, newUsername,
                    resp != null ? resp.getStatusCodeValue() : "no-response");
        } catch (Exception e) {
            log.error("Username change fan-out FAILED for userId={} '{}' -> '{}': {}. "
                            + "student.username and the assessment-service copies still hold the OLD username; "
                            + "replay with POST /admin-core-service/internal/learner/v1/username-changed",
                    userId, oldUsername, newUsername, e.getMessage());
        }
    }

    /**
     * userId -> the LMS site each learner signs in to (admin_core owns LMS_SETTING and the
     * enrolments), for the login link in credential emails. Learners with no connected LMS
     * are absent from the map. Never throws: a failed lookup returns an empty map so the
     * email still goes out with the learner-portal link.
     */
    public Map<String, String> fetchLmsLoginUrls(java.util.List<String> userIds, String instituteId) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        try {
            Map<String, Object> body = new java.util.HashMap<>();
            body.put("user_ids", userIds);
            body.put("institute_id", instituteId);
            ResponseEntity<String> resp = internalClientUtils.makeHmacRequest(
                    applicationName,
                    HttpMethod.POST.name(),
                    adminCoreServiceBaseUrl,
                    "/admin-core-service/internal/learner/v1/lms-login-urls",
                    body);
            if (resp == null || !StringUtils.hasText(resp.getBody())) {
                return Map.of();
            }
            JsonNode node = new ObjectMapper().readTree(resp.getBody());
            Map<String, String> urls = new java.util.HashMap<>();
            node.fields().forEachRemaining(e -> {
                if (StringUtils.hasText(e.getValue().asText(""))) {
                    urls.put(e.getKey(), e.getValue().asText());
                }
            });
            return urls;
        } catch (Exception e) {
            log.warn("LMS login-URL lookup failed for {} user(s), institute {}: {}",
                    userIds.size(), instituteId, e.getMessage());
            return Map.of();
        }
    }

    /**
     * After a learner changes their portal password, mirror it to any WordPress LMS
     * their courses are connected to (admin_core owns the LMS_SETTING + enrolment data,
     * so it does the actual crm/v1/edit-user push). Async + best-effort: a failure or
     * an admin_core outage must never block or fail the password change itself.
     */
    @Async
    public void syncLmsPassword(String userId, String email, String password) {
        if (!StringUtils.hasText(userId) || !StringUtils.hasText(email) || !StringUtils.hasText(password)) {
            return;
        }
        try {
            UserDTO userDTO = new UserDTO();
            userDTO.setId(userId);
            userDTO.setEmail(email);
            userDTO.setPassword(password);
            ResponseEntity<String> resp = internalClientUtils.makeHmacRequest(
                applicationName,
                HttpMethod.POST.name(),
                adminCoreServiceBaseUrl,
                "/admin-core-service/internal/learner/v1/sync-lms-password",
                userDTO);
            log.info("LMS password sync dispatched to admin-core for userId={}: HTTP {}",
                userId, resp != null ? resp.getStatusCodeValue() : "no-response");
        } catch (Exception e) {
            // best-effort: never surface an LMS-sync failure to the password change,
            // but log it — otherwise a rejected/undeployed internal call is invisible
            // and the password silently fails to reach the LMS.
            log.warn("LMS password sync to admin-core failed for userId={}: {}", userId, e.getMessage());
        }
    }
}

