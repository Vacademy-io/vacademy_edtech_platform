package vacademy.io.admin_core_service.features.auth_service.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.client.HttpClientErrorException;
import vacademy.io.admin_core_service.features.auth_service.constants.AuthServiceRoutes;
import vacademy.io.admin_core_service.features.institute_learner.constants.StudentConstants;
import vacademy.io.admin_core_service.features.learner.dto.JwtResponseDto;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.UserWithJwtDTO;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@Slf4j
public class AuthService {

    private static final org.slf4j.Logger logger = org.slf4j.LoggerFactory.getLogger(AuthService.class);

    @Autowired
    InternalClientUtils hmacClientUtils;

    @Value(value = "${auth.server.baseurl}")
    String authServerBaseUrl;
    @Value(value = "${spring.application.name}")
    String clientName;

    public UserDTO inviteUser(UserDTO userDTO, String instituteId) {

        ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                clientName,
                HttpMethod.POST.name(),
                authServerBaseUrl,
                AuthServiceRoutes.INVITE_USER_ROUTE + "?instituteId=" + instituteId,
                userDTO);

        ObjectMapper objectMapper = new ObjectMapper();

        try {
            UserDTO userD = objectMapper.readValue(response.getBody(), UserDTO.class);
            return userD;
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    public List<UserDTO> getUsersFromAuthServiceByUserIds(List<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return List.of();
        }
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    AuthServiceRoutes.GET_USERS_FROM_AUTH_SERVICE,
                    userIds);

            return objectMapper.readValue(response.getBody(), new TypeReference<List<UserDTO>>() {
            });
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    /**
     * Expand a recipient rule like "all ADMINs" into real users for one institute.
     *
     * Used by scheduled reporting. Returns an empty list rather than throwing when
     * auth_service is unreachable: a report with no resolvable recipients is
     * skipped and recorded, which is a better failure than a scheduled job that
     * dies partway and leaves a half-charged run behind.
     */
    public List<UserDTO> getUsersByInstituteAndRoles(String instituteId, List<String> roles) {
        try {
            return requireUsersByInstituteAndRoles(instituteId, roles);
        } catch (Exception e) {
            log.warn("[reporting] could not expand roles {} for institute {} — no recipients resolved",
                    roles, instituteId, e);
            return List.of();
        }
    }

    /**
     * The same lookup, but a failure surfaces instead of collapsing to an empty
     * list. Anything that RENDERS this as a roster must use this variant: an
     * unreachable auth_service and an institute with no staff are the same empty
     * list, and showing "no staff" for an outage is a lie the caller acts on.
     *
     * <p>auth_service returns ACTIVE memberships only — INVITED users are not
     * included.
     */
    public List<UserDTO> requireUsersByInstituteAndRoles(String instituteId, List<String> roles) {
        if (instituteId == null || instituteId.isBlank() || roles == null || roles.isEmpty()) {
            return List.of();
        }
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            // Do NOT pre-encode. InternalClientUtils runs the path through
            // UriComponentsBuilder.toUriString(), which encodes internally — a
            // space in a real role name ("CONTENT CREATOR") becomes %20 correctly,
            // whereas pre-encoding yields ADMIN%252CCONTENT+CREATOR and the comma
            // stops being a separator. Verified against spring-web 6.1.
            String path = AuthServiceRoutes.GET_USERS_BY_INSTITUTE_ROLE
                    + "?instituteId=" + instituteId
                    + "&roles=" + String.join(",", roles);
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    path,
                    null);
            return objectMapper.readValue(response.getBody(), new TypeReference<List<UserDTO>>() {
            });
        } catch (Exception e) {
            throw new VacademyException("Could not reach auth_service to resolve users for institute "
                    + instituteId + ": " + e.getMessage());
        }
    }

    /**
     * Substring search against auth_service's users table (full_name / email /
     * mobile_number). Returns user IDs only — caller can then filter its own
     * tables on user_id IN (...).
     *
     * Returns an empty list on error so a transient auth-service blip degrades
     * search to "no matches" rather than blowing up the caller.
     */
    public List<String> searchUserIdsByQuery(String query, String instituteId) {
        if (query == null || query.isBlank()) return List.of();
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            String encodedQuery = java.net.URLEncoder.encode(query.trim(),
                    java.nio.charset.StandardCharsets.UTF_8);
            StringBuilder path = new StringBuilder(AuthServiceRoutes.SEARCH_USER_IDS)
                    .append("?query=").append(encodedQuery);
            if (instituteId != null && !instituteId.isBlank()) {
                path.append("&instituteId=").append(java.net.URLEncoder.encode(instituteId,
                        java.nio.charset.StandardCharsets.UTF_8));
            }
            // The query is already percent-encoded above; the plain makeHmacRequest would encode it
            // again, so an email ("@" -> %40 -> %2540) or "+91" reached auth_service mangled and
            // matched nobody.
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequestWithEncodedRoute(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    path.toString(),
                    null);

            if (response == null || response.getBody() == null) return List.of();
            return objectMapper.readValue(response.getBody(), new TypeReference<List<String>>() {
            });
        } catch (Exception e) {
            logger.warn("searchUserIdsByQuery failed for query='{}', instituteId='{}': {}",
                    query, instituteId, e.getMessage());
            return List.of();
        }
    }

    public UserDTO updateUser(UserDTO userDTO, String userId) {
        if (userDTO == null || userId == null) {
            throw new VacademyException("User details cannot be null");
        }
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.PUT.name(),
                    authServerBaseUrl,
                    AuthServiceRoutes.UPDATE_USER_ROUTE + "?userId=" + userId,
                    userDTO);

            return objectMapper.readValue(response.getBody(), new TypeReference<UserDTO>() {
            });
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    public UserDTO createUserFromAuthService(UserDTO userDTO, String instituteId, boolean sendCred) {
        try {
            String url = StudentConstants.addUserRoute
                    + "?instituteId=" + instituteId
                    + "&isNotify=" + sendCred;

            userDTO.setRootUser(true);
            ObjectMapper objectMapper = new ObjectMapper();

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    url,
                    userDTO);

            return objectMapper.readValue(response.getBody(), UserDTO.class);

        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    public UserDTO createUserFromAuthServiceForLearnerEnrollment(UserDTO userDTO, String instituteId,
            boolean sendCred) {
        return createUserFromAuthServiceForLearnerEnrollment(userDTO, instituteId, sendCred, null);
    }

    public UserDTO createUserFromAuthServiceForLearnerEnrollment(UserDTO userDTO, String instituteId,
            boolean sendCred, String loginUrl) {
        try {
            String url = StudentConstants.addLearnerRoute
                    + "?instituteId=" + instituteId
                    + "&isNotify=" + sendCred;

            if (loginUrl != null && !loginUrl.isBlank()) {
                // Deliberately NOT pre-encoded: makeHmacRequest hands the URL to RestTemplate as a
                // string, which encodes it once itself. Encoding here made that a second pass, so a
                // portal stored with a scheme arrived as "https%3A%2F%2F…" and the emailed button
                // was a dead link (learners of every institute whose URL carries "://").
                url += "&loginUrl=" + loginUrl.trim();
            }

            userDTO.setRootUser(true);
            ObjectMapper objectMapper = new ObjectMapper();

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    url,
                    userDTO);

            return objectMapper.readValue(response.getBody(), UserDTO.class);

        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    public UserDTO getUsersFromAuthServiceWithPasswordByUserId(String userId) {
        if (userId == null) {
            return null;
        }
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    AuthServiceRoutes.GET_USER_BY_ID_WITH_PASSWORD + "?userId=" + userId,
                    null);

            return objectMapper.readValue(response.getBody(), new TypeReference<UserDTO>() {
            });
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    /**
     * Resolve a user by phone number (auth_service matches on last-10 digits, so any
     * format works). Returns empty when no user has that number — used by the
     * telephony lead resolver to attribute a call to the user who owns the dialed
     * number (the phone often lives only on the user record, not the CRM lead's
     * parent_mobile). Never throws — a missing user / lookup hiccup yields empty.
     */
    public Optional<UserDTO> getUserByMobile(String mobileNumber) {
        if (mobileNumber == null || mobileNumber.isBlank()) {
            return Optional.empty();
        }
        try {
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    AuthServiceRoutes.GET_USER_BY_MOBILE + "?mobileNumber=" + mobileNumber,
                    null);
            if (response == null || !response.getStatusCode().is2xxSuccessful()
                    || response.getBody() == null || response.getBody().isBlank()) {
                return Optional.empty();
            }
            return Optional.ofNullable(new ObjectMapper().readValue(response.getBody(), UserDTO.class));
        } catch (HttpClientErrorException.NotFound nf) {
            // No user has this number — the common case for non-lead / cold-call
            // numbers. Expected, not an error: return empty quietly (no log spam,
            // and never log the number itself — it's PII).
            return Optional.empty();
        } catch (Exception e) {
            // Genuine failure (5xx, connection, parse) — log WITHOUT the number.
            logger.warn("auth_service user-by-mobile lookup failed: {}", e.getMessage());
            return Optional.empty();
        }
    }

    public UserWithJwtDTO generateJwtTokensWithUser(String userId, String instituteId) {
        try {
            String endpoint = AuthServiceRoutes.GENERATE_TOKEN_FOR_LEARNER + "?userId=" + userId + "&instituteId="
                    + instituteId;
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    endpoint,
                    null);

            if (response == null || response.getBody() == null) {
                throw new VacademyException("Failed to generate JWT tokens");
            }

            ObjectMapper mapper = new ObjectMapper();
            return mapper.readValue(response.getBody(), UserWithJwtDTO.class);
        } catch (Exception e) {
            throw new VacademyException("Failed to generate JWT tokens: " + e.getMessage());
        }
    }

    /**
     * Re-sends one user's current login details via auth-service, branded for
     * {@code instituteId} and with the sign-in button pointing at {@code loginUrl}.
     * Read-only on the user. Returns auth-service's {@code {sent, failed, message}} reply.
     */
    public Map<String, Object> resendLoginDetails(String userId, String instituteId, String loginUrl) {
        try {
            String endpoint = AuthServiceRoutes.RESEND_LOGIN_DETAILS
                    + "?userId=" + userId
                    + "&instituteId=" + instituteId;
            if (loginUrl != null && !loginUrl.isBlank()) {
                // Not pre-encoded: makeHmacRequest hands the URL to RestTemplate as a string, which
                // encodes it once itself (see createUserFromAuthServiceForLearnerEnrollment).
                endpoint += "&loginUrl=" + loginUrl.trim();
            }
            // Everything travels in the query string; an empty JSON body keeps the POST
            // well-formed for RestTemplate and the ingress alike.
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    endpoint,
                    Map.of());
            return new ObjectMapper().readValue(response.getBody(),
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new VacademyException("Failed to resend login details: " + e.getMessage());
        }
    }

    public String sendCredToUsers(List<String> userIds) {
        try {
            String endpoint = AuthServiceRoutes.SEND_CRED_TO_USERS;
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    endpoint,
                    userIds);

            return response.getBody();
        } catch (Exception e) {
            throw new VacademyException("Failed to generate JWT tokens: " + e.getMessage());
        }
    }

    /**
     * Idempotently adds the supplied roles to a user in auth-service. No-op
     * when the user already has an ACTIVE row for the given (institute, role)
     * tuple — see {@code RoleService.addRolesToUser} dedup. Failures are
     * logged but not thrown: callers should treat this as best-effort so a
     * transient auth-service hiccup doesn't roll back the enrollment that's
     * already been committed in admin_core_service.
     *
     * <p>Specifically used by the bulk-assign flow to make sure existing users
     * (e.g. leads created from an audience-form submission) carry the
     * {@code STUDENT} role on enrollment, since the learner-portal login
     * rejects users without it.
     */
    public void addRolesToUserInternal(String userId, List<String> roles, String instituteId) {
        if (userId == null || userId.isBlank() || roles == null || roles.isEmpty()
                || instituteId == null || instituteId.isBlank()) {
            return;
        }
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("user_id", userId);
            body.put("roles", roles);
            body.put("institute_id", instituteId);

            hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    AuthServiceRoutes.ADD_USER_ROLES_INTERNAL,
                    body);
        } catch (Exception e) {
            // Best-effort: log and swallow so a single auth-service blip
            // doesn't fail an entire bulk-assign batch where the admin_core
            // rows have already been written.
            logger.warn("Failed to add roles {} to user {} in institute {}: {}",
                    roles, userId, instituteId, e.getMessage());
        }
    }

    /**
     * {@link #addRolesToUserInternal} that THROWS on failure: for a caller that must know the
     * role was granted (the public API's counsellor create answers 201 only when it was).
     */
    public void addRolesToUserStrict(String userId, List<String> roles, String instituteId) {
        Map<String, Object> body = new HashMap<>();
        body.put("user_id", userId);
        body.put("roles", roles);
        body.put("institute_id", instituteId);
        try {
            hmacClientUtils.makeHmacRequest(clientName, HttpMethod.POST.name(), authServerBaseUrl,
                    AuthServiceRoutes.ADD_USER_ROLES_INTERNAL, body);
        } catch (Exception e) {
            throw new VacademyException("add-user-roles failed: " + e.getMessage());
        }
    }

    /**
     * The user with this email, or empty when none exists. THROWS when auth_service cannot
     * answer, so "no such user" is never confused with "could not ask". The email is
     * percent-encoded here (a '+' in a raw query string is read back as a space).
     */
    public Optional<UserDTO> findUserByEmailStrict(String email) {
        if (email == null || email.isBlank()) return Optional.empty();
        String encoded = java.net.URLEncoder.encode(email.trim().toLowerCase(java.util.Locale.ROOT),
                java.nio.charset.StandardCharsets.UTF_8);
        try {
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequestWithEncodedRoute(clientName,
                    HttpMethod.GET.name(), authServerBaseUrl,
                    AuthServiceRoutes.GET_USER_BY_EMAIL + "?email=" + encoded, null);
            if (response == null || response.getStatusCode().value() == 404 || response.getBody() == null
                    || response.getBody().isBlank()) {
                return Optional.empty();
            }
            ObjectMapper objectMapper = new ObjectMapper();
            objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            return Optional.ofNullable(objectMapper.readValue(response.getBody(), UserDTO.class));
        } catch (HttpClientErrorException.NotFound nf) {
            return Optional.empty();
        } catch (Exception e) {
            throw new VacademyException("user-by-email lookup failed: " + e.getMessage());
        }
    }

    /**
     * Every role row the user holds, as maps with institute_id, role_name and status. THROWS
     * when auth_service cannot answer.
     */
    public List<Map<String, String>> getRoleMembershipsStrict(String userId) {
        if (userId == null || userId.isBlank()) return List.of();
        try {
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequestWithEncodedRoute(clientName,
                    HttpMethod.GET.name(), authServerBaseUrl,
                    AuthServiceRoutes.USER_ROLE_MEMBERSHIPS + "?userId="
                            + java.net.URLEncoder.encode(userId, java.nio.charset.StandardCharsets.UTF_8), null);
            if (response == null || response.getBody() == null || !response.getStatusCode().is2xxSuccessful()) {
                throw new VacademyException("memberships lookup failed");
            }
            List<Map<String, String>> out = new ObjectMapper().readValue(response.getBody(),
                    new TypeReference<List<Map<String, String>>>() {
                    });
            return out == null ? List.of() : out;
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException("memberships lookup failed: " + e.getMessage());
        }
    }

    /**
     * Pauses (DISABLED) or restores (ACTIVE) only the named roles of a user in one institute.
     * Returns how many role rows changed. THROWS on failure.
     */
    public int updateRoleStatusForRoles(String instituteId, String userId, List<String> roles, String status) {
        try {
            String path = AuthServiceRoutes.USER_ROLE_STATUS_INTERNAL
                    + "?instituteId=" + java.net.URLEncoder.encode(instituteId, java.nio.charset.StandardCharsets.UTF_8)
                    + "&userId=" + java.net.URLEncoder.encode(userId, java.nio.charset.StandardCharsets.UTF_8)
                    + "&status=" + java.net.URLEncoder.encode(status, java.nio.charset.StandardCharsets.UTF_8);
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequestWithEncodedRoute(clientName,
                    HttpMethod.PUT.name(), authServerBaseUrl, path, roles);
            if (response == null || response.getBody() == null || !response.getStatusCode().is2xxSuccessful()) {
                throw new VacademyException("role-status update failed");
            }
            Map<String, Object> out = new ObjectMapper().readValue(response.getBody(),
                    new TypeReference<Map<String, Object>>() {
                    });
            Object n = out == null ? null : out.get("updated");
            return n instanceof Number num ? num.intValue() : 0;
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException("role-status update failed: " + e.getMessage());
        }
    }

    public UserDTO createOrGetExistingUserById(UserDTO userDTO, String instituteId) {
        try {
            String endpoint = AuthServiceRoutes.CREATE_OR_GET_EXISTING_BY_ID + "?instituteId=" + instituteId;
            ObjectMapper objectMapper = new ObjectMapper();

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    endpoint,
                    userDTO);

            return objectMapper.readValue(response.getBody(), UserDTO.class);
        } catch (Exception e) {
            throw new VacademyException("Failed to create or get existing user: " + e.getMessage());
        }
    }

    public vacademy.io.admin_core_service.features.student_analysis.dto.StudentLoginStatsDto getStudentLoginStats(
            String userId, String startDate, String endDate) {
        try {
            String endpoint = AuthServiceRoutes.GET_STUDENT_LOGIN_STATS
                    + "?userId=" + userId
                    + "&startDate=" + startDate
                    + "&endDate=" + endDate;

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    endpoint,
                    null);

            ObjectMapper objectMapper = new ObjectMapper();
            return objectMapper.readValue(response.getBody(),
                    vacademy.io.admin_core_service.features.student_analysis.dto.StudentLoginStatsDto.class);
        } catch (Exception e) {
            throw new VacademyException("Failed to get student login stats: " + e.getMessage());
        }
    }

    public List<UserDTO> createMultipleUsers(List<UserDTO> userDTOs, String instituteId, boolean toNotifiy) {
        if (userDTOs == null || userDTOs.isEmpty()) {
            throw new VacademyException("User DTOs list cannot be null or empty");
        }
        try {
            String endpoint = AuthServiceRoutes.CREATE_MULTIPLE_USERS + "?instituteId=" + instituteId + "&isNotify="
                    + toNotifiy;
            ObjectMapper objectMapper = new ObjectMapper();

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    endpoint,
                    userDTOs);

            return objectMapper.readValue(response.getBody(), new TypeReference<List<UserDTO>>() {
            });
        } catch (Exception e) {
            throw new VacademyException("Failed to create multiple users: " + e.getMessage());
        }
    }

    /**
     * Fetch users with their linked children from auth_service.
     * 
     * @param userIds List of parent user IDs to fetch
     * @return List of ParentWithChildDTO containing parent and child user
     *         information
     */
    public List<vacademy.io.common.auth.dto.ParentWithChildDTO> getUsersWithChildren(List<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return List.of();
        }
        try {
            String endpoint = AuthServiceRoutes.GET_USERS_WITH_CHILDREN;
            ObjectMapper objectMapper = new ObjectMapper();

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    endpoint,
                    userIds);

            return objectMapper.readValue(response.getBody(),
                    new TypeReference<List<vacademy.io.common.auth.dto.ParentWithChildDTO>>() {
                    });
        } catch (Exception e) {
            throw new VacademyException("Failed to get users with children: " + e.getMessage());
        }
    }

    /**
     * Fetch user by mobile number from auth_service.
     * Handles various phone formats: +917999742868, 7999742868, 917999742868
     * 
     * @param mobileNumber User's phone number in any format
     * @return UserDTO if found, null if not found
     */
    /**
     * Search users in auth_service by free-text query (name/email/mobile),
     * scoped to an institute. Backed by the autosuggest-users endpoint.
     * Returns up to 10 matches.
     */
    public List<UserDTO> autosuggestUsers(String instituteId, String query) {
        if (instituteId == null || instituteId.isBlank() || query == null || query.isBlank()) {
            return List.of();
        }
        try {
            String endpoint = AuthServiceRoutes.AUTOSUGGEST_USERS
                    + "?instituteId=" + java.net.URLEncoder.encode(instituteId, java.nio.charset.StandardCharsets.UTF_8)
                    + "&query=" + java.net.URLEncoder.encode(query, java.nio.charset.StandardCharsets.UTF_8);

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    endpoint,
                    null);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                ObjectMapper objectMapper = new ObjectMapper();
                return objectMapper.readValue(response.getBody(), new TypeReference<List<UserDTO>>() {});
            }
            return List.of();
        } catch (Exception e) {
            throw new VacademyException("Failed to autosuggest users: " + e.getMessage());
        }
    }

    public UserDTO getUserByEmail(String email) {
        if (email == null || email.isBlank()) {
            return null;
        }
        String normalized = email.toLowerCase().trim();
        // Primary: dedicated internal endpoint — pass raw value, RestTemplate encodes once
        try {
            String endpoint = AuthServiceRoutes.GET_USER_BY_EMAIL + "?emailId=" + normalized;
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName, HttpMethod.GET.name(), authServerBaseUrl, endpoint, null);
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return objectMapper.readValue(response.getBody(), UserDTO.class);
            }
        } catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("404")) {
                return null;
            }
            logger.warn("getUserByEmail primary failed for '{}': {}", normalized, e.getMessage());
        }
        // Fallback: search-ids with raw value (same no-pre-encode pattern as getUserByMobileNumber)
        try {
            String searchEndpoint = AuthServiceRoutes.SEARCH_USER_IDS + "?query=" + normalized;
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName, HttpMethod.GET.name(), authServerBaseUrl, searchEndpoint, null);
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                List<String> ids = objectMapper.readValue(response.getBody(),
                        new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {});
                if (!ids.isEmpty()) {
                    List<UserDTO> candidates = getUsersFromAuthServiceByUserIds(ids);
                    return candidates.stream()
                            .filter(u -> normalized.equalsIgnoreCase(u.getEmail()))
                            .findFirst()
                            .orElse(null);
                }
            }
        } catch (Exception e) {
            logger.warn("getUserByEmail fallback failed for '{}': {}", normalized, e.getMessage());
        }
        return null;
    }

    public UserDTO getUserByMobileNumber(String mobileNumber) {
        if (mobileNumber == null || mobileNumber.isBlank()) {
            return null;
        }
        try {
            String endpoint = AuthServiceRoutes.GET_USER_BY_MOBILE + "?mobileNumber=" + mobileNumber;
            ObjectMapper objectMapper = new ObjectMapper();

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    endpoint,
                    null);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return objectMapper.readValue(response.getBody(), UserDTO.class);
            }
            return null;
        } catch (Exception e) {
            // A 404 from Auth Service simply means the user doesn't exist yet, which is
            // expected for new admissions.
            if (e.getMessage() != null && e.getMessage().contains("404")) {
                return null;
            }
            throw new VacademyException("Failed to get user by mobile number: " + e.getMessage());
        }
    }

    /**
     * Fetch the user IDs of every user holding a given role within an institute. Returns an
     * empty list (never throws back to caller) when the institute has no such users or when the
     * lookup fails — this is meant for best-effort fallbacks like the doubt-notification cascade,
     * where admin broadcast is a backup, not a hard requirement.
     */
    public List<String> getUserIdsByRole(String instituteId, String roleName) {
        if (instituteId == null || instituteId.isBlank() || roleName == null || roleName.isBlank()) {
            return List.of();
        }
        try {
            String endpoint = AuthServiceRoutes.GET_USERS_BY_ROLE
                    + "?instituteId=" + java.net.URLEncoder.encode(instituteId, java.nio.charset.StandardCharsets.UTF_8)
                    + "&roleName=" + java.net.URLEncoder.encode(roleName, java.nio.charset.StandardCharsets.UTF_8);
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    endpoint,
                    null);
            if (response == null || response.getBody() == null
                    || !response.getStatusCode().is2xxSuccessful()) {
                // Log loudly: callers cannot tell "no such users" from "lookup failed" (both are an
                // empty list), and for the doubt cascade an empty admin list means nobody is notified.
                logger.warn("Role lookup returned no usable response for institute {} role {} (status {})",
                        instituteId, roleName,
                        response == null ? "no-response" : response.getStatusCode());
                return List.of();
            }
            ObjectMapper objectMapper = new ObjectMapper();
            objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            List<UserDTO> users = objectMapper.readValue(response.getBody(),
                    new TypeReference<List<UserDTO>>() {});
            return users.stream()
                    .map(UserDTO::getId)
                    .filter(id -> id != null && !id.isEmpty())
                    .distinct()
                    .toList();
        } catch (Exception e) {
            // Swallow — this method only powers fallbacks; failure should not break doubt creation.
            // Still log: a silent empty here is indistinguishable from "institute has no such role",
            // and it silently costs the doubt cascade every one of its recipients.
            logger.warn("Role lookup failed for institute {} role {}: {}", instituteId, roleName, e.getMessage());
            return List.of();
        }
    }

    /**
     * User ids of everyone holding ANY of the given roles (ACTIVE user_role
     * rows) in the institute, via the HMAC-internal users-of-status endpoint —
     * the same DTO-based RoleService path that powers the staff screen.
     *
     * <p>STRICT: throws on lookup failure instead of returning an empty list,
     * so callers that cache the result (CounsellorScopeService's role cache)
     * can tell "institute has no such users" apart from "auth_service is
     * down" and serve a stale value rather than silently flipping RBAC scope.
     */
    public List<String> getActiveUserIdsByRoles(String instituteId, List<String> roles) {
        return getActiveUsersByRoles(instituteId, roles).stream()
                // Null-element guard: before this method delegated, the mapping ran
                // INSIDE the try below, so a null row would have surfaced as a
                // VacademyException like every other failure here. Out here it would
                // instead escape as a raw NPE and be rendered as a 511 by the generic
                // RuntimeException handler. Unreachable in practice — auth_service
                // builds the list with map(UserWithRolesDTO::new), which cannot emit
                // null — but this path decides RBAC scope, so it does not get to
                // depend on a remote service's serialiser staying well-behaved.
                .filter(java.util.Objects::nonNull)
                .map(vacademy.io.common.auth.dto.UserWithRolesDTO::getId)
                .filter(id -> id != null && !id.isEmpty())
                .distinct()
                .toList();
    }

    /**
     * Full user records (name / email / mobile / roles) of everyone holding ANY
     * of the given roles in the institute — the same users-of-status call
     * {@link #getActiveUserIdsByRoles} makes, without the second round trip
     * through {@code getUsersFromAuthServiceByUserIds} just to recover names.
     *
     * <p>Same STRICT failure contract: throws rather than returning an empty
     * list, so a caller can tell "no such users" apart from "auth_service is
     * down".
     */
    public List<vacademy.io.common.auth.dto.UserWithRolesDTO> getActiveUsersByRoles(
            String instituteId, List<String> roles) {
        if (instituteId == null || instituteId.isBlank() || roles == null || roles.isEmpty()) {
            return List.of();
        }
        try {
            String endpoint = AuthServiceRoutes.USERS_OF_STATUS_INTERNAL
                    + "?instituteId=" + java.net.URLEncoder.encode(instituteId, java.nio.charset.StandardCharsets.UTF_8);
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    endpoint,
                    roles);
            if (response == null || response.getBody() == null
                    || !response.getStatusCode().is2xxSuccessful()) {
                throw new VacademyException("users-of-status lookup failed for roles " + roles);
            }
            ObjectMapper objectMapper = new ObjectMapper();
            objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            return objectMapper.readValue(response.getBody(),
                    new TypeReference<List<vacademy.io.common.auth.dto.UserWithRolesDTO>>() {});
        } catch (VacademyException ve) {
            throw ve;
        } catch (Exception e) {
            throw new VacademyException("users-of-status lookup failed: " + e.getMessage());
        }
    }

    public void updateInstituteSettings(String instituteId, String userIdentifier) {
        try {
            String endpoint = AuthServiceRoutes.UPDATE_INSTITUTE_SETTINGS;

            // Create a payload similar to UpdateInstituteSettingsDTO from auth_service
            java.util.Map<String, Object> payload = new java.util.HashMap<>();
            payload.put("instituteId", instituteId);
            payload.put("userIdentifier", userIdentifier);
            // Intentionally not setting settingsJson here so it remains null in the DTO,
            // preventing accidental overwrites of existing institute settings in
            // auth_service.

            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.PUT.name(),
                    authServerBaseUrl,
                    endpoint,
                    payload);

            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new VacademyException("Failed to update institute settings in auth_service.");
            }
        } catch (Exception e) {
            throw new VacademyException("Failed to update institute settings: " + e.getMessage());
        }
    }

    /**
     * Links two EXISTING users as guardian (parent) and student. Back-fill
     * only on the auth_service side — never overwrites an existing link.
     */
    public void linkParentChild(String parentUserId, String studentUserId) {
        try {
            vacademy.io.common.auth.dto.ParentChildLinkRequestDTO body =
                    vacademy.io.common.auth.dto.ParentChildLinkRequestDTO.builder()
                            .parentUserId(parentUserId)
                            .studentUserId(studentUserId)
                            .build();
            hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    AuthServiceRoutes.LINK_PARENT_CHILD,
                    body);
        } catch (Exception e) {
            throw new VacademyException("Failed to link parent and child: " + e.getMessage());
        }
    }

    /**
     * All children (students) linked to a single guardian (parent) user id.
     */
    public List<UserDTO> getChildrenOfParent(String parentUserId) {
        if (parentUserId == null || parentUserId.isBlank()) {
            return List.of();
        }
        try {
            String endpoint = AuthServiceRoutes.CHILDREN_OF_PARENT + "?parentUserId=" + parentUserId;
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    authServerBaseUrl,
                    endpoint,
                    null);
            if (response == null || response.getBody() == null || !response.getStatusCode().is2xxSuccessful()) {
                return List.of();
            }
            ObjectMapper objectMapper = new ObjectMapper();
            return objectMapper.readValue(response.getBody(), new TypeReference<List<UserDTO>>() {
            });
        } catch (Exception e) {
            throw new VacademyException("Failed to get children of parent: " + e.getMessage());
        }
    }

    /**
     * Bulk username/password lookup. Used when re-sharing an ALREADY-created
     * guardian's credentials (the create-time flows get the password back
     * inline, but a later "share credentials" action has to fetch it).
     */
    public List<vacademy.io.common.auth.dto.UserCredentials> getUsersCredentials(List<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return List.of();
        }
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    AuthServiceRoutes.USERS_CREDENTIALS,
                    userIds);
            return objectMapper.readValue(response.getBody(),
                    new TypeReference<List<vacademy.io.common.auth.dto.UserCredentials>>() {
                    });
        } catch (Exception e) {
            throw new VacademyException("Failed to fetch user credentials: " + e.getMessage());
        }
    }

    /**
     * Institute-wide guardian backfill: creates a synthetic parent for each
     * item whose child does not already have one linked.
     */
    public vacademy.io.common.auth.dto.BackfillParentsResultDTO backfillParents(
            List<vacademy.io.common.auth.dto.BackfillParentItemDTO> items, String instituteId) {
        try {
            String endpoint = AuthServiceRoutes.BACKFILL_PARENTS + "?instituteId=" + instituteId;
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    authServerBaseUrl,
                    endpoint,
                    items);
            return objectMapper.readValue(response.getBody(),
                    vacademy.io.common.auth.dto.BackfillParentsResultDTO.class);
        } catch (Exception e) {
            throw new VacademyException("Failed to backfill parents: " + e.getMessage());
        }
    }

    /**
     * userId -> roles at THIS institute. Authorisation must not be decided from
     * UserDTO.roles, which spans every institute and includes INVITED memberships.
     *
     * Returns an empty map on failure; callers must treat "no roles" as "no
     * privileges", never as "unrestricted".
     */
    public Map<String, List<String>> getInstituteRoles(String instituteId, List<String> userIds) {
        if (instituteId == null || instituteId.isBlank() || userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            // See the note above: UriComponentsBuilder encodes; pre-encoding here
            // turns every comma into literal %2C and the id list into one string.
            String path = AuthServiceRoutes.GET_INSTITUTE_ROLES
                    + "?instituteId=" + instituteId
                    + "&userIds=" + String.join(",", userIds);
            ResponseEntity<String> response = hmacClientUtils.makeHmacRequest(
                    clientName, HttpMethod.GET.name(), authServerBaseUrl, path, null);
            return objectMapper.readValue(response.getBody(),
                    new TypeReference<Map<String, List<String>>>() {
                    });
        } catch (Exception e) {
            log.warn("[reporting] institute-role lookup failed for institute {}", instituteId, e);
            return Map.of();
        }
    }
}
