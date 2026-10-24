package vacademy.io.auth_service.feature.auth.manager;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.auth.constants.AuthConstants;
import vacademy.io.auth_service.feature.auth.dto.ActiveSessionDTO;
import vacademy.io.auth_service.feature.auth.dto.AuthRequestDto;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.enums.ClientNameEnum;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.auth_service.feature.user.service.UserSessionService;

import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.institute.service.InstituteSettingsService;
import vacademy.io.auth_service.feature.notification.service.NotificationEmailBody;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.auth_service.feature.util.UsernameGenerator;
import vacademy.io.auth_service.feature.admin_core_service.dto.InstituteSignupPolicy;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.auth_service.feature.login_link.service.LoginCodeService;
import vacademy.io.common.auth.dto.RefreshTokenRequestDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.InstituteChoice;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.UserWithJwtDTO;
import vacademy.io.common.auth.entity.*;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.auth.service.OAuth2VendorToUserDetailService;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.notification.dto.GenericEmailRequest;
import vacademy.io.common.notification.dto.EmailOTPRequest;
import vacademy.io.common.exceptions.ExpiredTokenException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.common.dto.CustomFieldValueDTO;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@Component
public class LearnerAuthManager {

        private static final Logger log = LoggerFactory.getLogger(LearnerAuthManager.class);

        @Autowired
        UserRepository userRepository;

        @Autowired
        JwtService jwtService;

        @Autowired
        UserRoleRepository userRoleRepository;

        @Autowired
        RefreshTokenService refreshTokenService;

        @Autowired
        AuthenticationManager authenticationManager;

        @Autowired
        RestTemplate restTemplate;

        @Autowired
        OriginInstituteResolver originInstituteResolver;

        @Autowired
        AuthService authService;

        @Autowired
        private InternalClientUtils internalClientUtils;

        @Autowired
        private OAuth2VendorToUserDetailService oAuth2VendorToUserDetailService;

        @Autowired
        private InstitutePolicyService institutePolicyService;

        @Autowired
        private LoginCodeService loginCodeService;

        @Value("${admin.core.service.base_url}")
        private String adminCoreServiceBaseUrl;

        @Value("${spring.application.name}")
        private String applicationName;

        @Autowired
        private NotificationService notificationService;

        @Autowired
        private UserSessionService userSessionService;

        @Autowired
        private RoleRepository roleRepository;

        @Autowired
        private UserPermissionRepository userPermissionRepository;

        @Autowired
        private InstituteInternalService instituteInternalService;

        @Autowired
        private InstituteSettingsService instituteSettingsService;

        public JwtResponseDto registerLearner(LearnerEnrollRequestDTO learnerEnrollRequestDTO) {
                if (learnerEnrollRequestDTO == null) {
                        throw new VacademyException("Invalid Request");
                }

                UserDTO userDTO = learnerEnrollRequestDTO.getUser();
                if (userDTO == null) {
                        throw new VacademyException("User details are missing");
                }

                String instituteId = learnerEnrollRequestDTO.getInstituteId();
                log.debug("registerLearner invoked: instituteId={}, subjectId={}, vendorId={}, hasPackageEnroll={}, userEmailPresent={}",
                                instituteId,
                                learnerEnrollRequestDTO.getSubjectId(),
                                learnerEnrollRequestDTO.getVendorId(),
                                learnerEnrollRequestDTO.getLearnerPackageSessionEnroll() != null,
                                userDTO.getEmail() != null);
                User user;
                // Custom field values sent with the enrollment, for the username strategy.
                if (learnerEnrollRequestDTO.getLearnerPackageSessionEnroll() != null) {
                        userDTO.setUsernameFieldValues(CustomFieldValueDTO.toValueMap(
                                        learnerEnrollRequestDTO.getLearnerPackageSessionEnroll().getCustomFieldValues()));
                }

                // Check institute policy if instituteId is provided
                if (instituteId != null && !instituteId.isBlank()) {
                        InstituteSignupPolicy signupPolicy = institutePolicyService.fetchSignupPolicy(instituteId);
                        log.debug("Fetched signup policy for instituteId={}: passwordStrategy={}, passwordDelivery={}, usernameStrategy={}, allowLearnersToCreateCourses={}",
                                        instituteId,
                                        signupPolicy != null ? signupPolicy.getPasswordStrategy() : null,
                                        signupPolicy != null ? signupPolicy.getPasswordDelivery() : null,
                                        signupPolicy != null ? signupPolicy.getUserNameStrategy() : null,
                                        signupPolicy != null && signupPolicy.isAllowLearnersToCreateCourses());
                        if (signupPolicy != null && signupPolicy.getUserNameStrategy() != null
                                        && signupPolicy.getUserNameStrategy().equalsIgnoreCase("email")) {
                                if (userDTO.getEmail() != null) {
                                        log.debug("usernameStrategy=email and email present. Setting username to email");
                                        userDTO.setUsername(userDTO.getEmail());
                                }
                        }
                        boolean deliverPassword = signupPolicy != null
                                        && signupPolicy.getPasswordDelivery() != null
                                        && !signupPolicy.getPasswordDelivery().equalsIgnoreCase("none");
                        boolean isOauth2Signup = learnerEnrollRequestDTO.getSubjectId() != null
                                        && learnerEnrollRequestDTO.getVendorId() != null;
                        log.debug("Resolved deliverPassword={} (policy), isOauth2Signup={}", deliverPassword,
                                        isOauth2Signup);

                        // user = authService.createUser(userDTO, instituteId, deliverPassword);
                        user = authService.createUserForLearnerSelfSignup(userDTO, instituteId, deliverPassword);
                        log.debug("User createUser completed: userId={}, username={} (may be null if creation failed)",
                                        user != null ? user.getId() : null,
                                        user != null ? user.getUsername() : null);
                } else {
                        log.debug("No instituteId provided. Creating user with notifications enabled by default");
                        // user = authService.createUser(userDTO, null, true);
                        user = authService.createUserForLearnerSelfSignup(userDTO, instituteId, true);
                        log.debug("User createUser (no institute) completed: userId={}, username={}",
                                        user != null ? user.getId() : null,
                                        user != null ? user.getUsername() : null);
                }

                if (user != null) {
                        userDTO.setId(user.getId());
                        userDTO.setUsername(user.getUsername());
                }

                if (learnerEnrollRequestDTO.getLearnerPackageSessionEnroll() != null) {
                        log.debug("Proceeding with learner package session enroll via internal API: {}",
                                        AuthConstants.LEARNER_ENROLL_PATH);
                        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                                        applicationName, HttpMethod.POST.name(),
                                        adminCoreServiceBaseUrl, AuthConstants.LEARNER_ENROLL_PATH,
                                        learnerEnrollRequestDTO);

                        try {
                                new ObjectMapper().readValue(response.getBody(),
                                                new TypeReference<LearnerEnrollResponseDTO>() {
                                                });
                        } catch (JsonProcessingException e) {
                                throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                                                "Failed to register learner: " + e.getMessage());
                        }
                } else {
                        log.debug("Proceeding with open add-learner via internal API: {}",
                                        AuthConstants.ADD_LEARNER);
                        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                                        applicationName, HttpMethod.POST.name(),
                                        adminCoreServiceBaseUrl, AuthConstants.ADD_LEARNER,
                                        userDTO);

                        // Response might be null, handle gracefully
                        String responseInstituteId = (response != null) ? response.getBody() : null;
                        log.debug("add-learner response body instituteId={}", responseInstituteId);

                        // No package-session enrollment means this signup would otherwise be
                        // invisible to the institute admin (the learner list requires an
                        // enrollment row). Surface it as a lead instead. Best-effort: a
                        // failure here must never break signup.
                        if (StringUtils.hasText(instituteId) && user != null) {
                                try {
                                        Map<String, String> leadBody = Map.of(
                                                        "userId", user.getId(),
                                                        "instituteId", instituteId,
                                                        "name", user.getFullName() != null ? user.getFullName() : "",
                                                        "email", user.getEmail() != null ? user.getEmail() : "",
                                                        "mobile", user.getMobileNumber() != null
                                                                        ? user.getMobileNumber()
                                                                        : "");
                                        internalClientUtils.makeHmacRequest(applicationName, HttpMethod.POST.name(),
                                                        adminCoreServiceBaseUrl, AuthConstants.SELF_SIGNUP_LEAD_PATH,
                                                        leadBody);
                                } catch (Exception e) {
                                        log.warn("Self-signup lead capture failed (non-blocking) for userId={}: {}",
                                                        user.getId(), e.getMessage());
                                }
                        }
                }

                // Verify email if data is available
                if (learnerEnrollRequestDTO.getSubjectId() != null &&
                                learnerEnrollRequestDTO.getVendorId() != null &&
                                user != null && user.getEmail() != null) {
                        log.debug("Verifying vendor email mapping for subjectId={}, vendorId={}, emailPresent=true",
                                        learnerEnrollRequestDTO.getSubjectId(),
                                        learnerEnrollRequestDTO.getVendorId());
                        oAuth2VendorToUserDetailService.verifyEmail(
                                        learnerEnrollRequestDTO.getSubjectId(),
                                        learnerEnrollRequestDTO.getVendorId(),
                                        user.getEmail());
                }

                RefreshToken refreshToken = refreshTokenService.createRefreshToken(
                                (user != null) ? user.getUsername() : null,
                                "VACADEMY-WEB");

                JwtResponseDto jwt = authService.generateJwtTokenForUser(
                                user,
                                refreshToken,
                                (user != null && user.getRoles() != null) ? user.getRoles().stream().toList()
                                                : List.of());
                log.debug("Generated JWT for userId={} (access token omitted)", user != null ? user.getId() : null);
                return jwt;
        }

        private User createUser(UserDTO userDTO) {
                User user = new User();

                user.setUsername(
                                StringUtils.hasText(userDTO.getUsername())
                                                ? userDTO.getUsername()
                                                : UsernameGenerator.generateUsername(userDTO.getFullName()));

                user.setPassword(
                                StringUtils.hasText(userDTO.getPassword())
                                                ? userDTO.getPassword()
                                                : UsernameGenerator.generatePassword(8));

                user.setEmail(userDTO.getEmail());
                user.setFullName(userDTO.getFullName());
                user.setAddressLine(userDTO.getAddressLine());
                user.setCity(userDTO.getCity());
                user.setPinCode(userDTO.getPinCode());
                user.setMobileNumber(userDTO.getMobileNumber());
                user.setDateOfBirth(userDTO.getDateOfBirth());
                user.setGender(userDTO.getGender());
                user.setRootUser(userDTO.isRootUser());

                return userRepository.save(user);
        }

        public void sendWelcomeMailToUser(User user) {
                // Drives both the sender address and the branding below, so an arbitrary role
                // would welcome a learner in the wrong institute's name.
                String instituteId = InstituteChoice.forUser(originInstituteResolver, user);
                InstituteInfoDTO instituteInfoDTO = null;
                String instituteName = "Vacademy"; // Default fallback
                String theme = "#E67E22";
                String learnerLoginUrl = "https://dash.vacademy.io";
                if (StringUtils.hasText(instituteId)) {
                        instituteInfoDTO = instituteInternalService.getInstituteByInstituteId(instituteId);
                        if (instituteInfoDTO.getInstituteName() != null)
                                instituteName = instituteInfoDTO.getInstituteName();
                        if (instituteInfoDTO.getInstituteThemeCode() != null)
                                theme = instituteInfoDTO.getInstituteThemeCode();
                        if (instituteInfoDTO.getLearnerPortalUrl() != null)
                                learnerLoginUrl = instituteInfoDTO.getLearnerPortalUrl();
                }

                GenericEmailRequest emailRequest = new GenericEmailRequest();
                emailRequest.setTo(user.getEmail());
                emailRequest.setSubject("Welcome to " + instituteName);
                emailRequest.setBody(NotificationEmailBody.createWelcomeEmailBody(instituteName, user.getFullName(),
                                user.getUsername(), user.getPassword(), learnerLoginUrl, theme));
                notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteId);
        }

        /**
         * Resolves the identifier a learner typed into the username field to a canonical
         * username. Username is unique, so a direct match wins. Otherwise, if the input
         * looks like an email, the matching account is found by email — and because email
         * is NOT unique, candidates are disambiguated by the supplied password (preferring
         * an account in the requested institute, then the most recent). If nothing matches,
         * the original input is returned unchanged so authentication fails as before.
         */
        private String resolveLoginUsername(String identifier, String password, String instituteId) {
                if (!StringUtils.hasText(identifier) || !identifier.contains("@")) {
                        return identifier;
                }
                if (userRepository.findByUsername(identifier).isPresent()) {
                        return identifier;
                }
                List<User> passwordMatches = userRepository.findUserDetailsByEmail(identifier).stream()
                                .filter(u -> password != null && password.equals(u.getPassword()))
                                .toList();
                if (passwordMatches.isEmpty()) {
                        return identifier;
                }
                if (StringUtils.hasText(instituteId)) {
                        for (User candidate : passwordMatches) {
                                boolean inInstitute = userRoleRepository
                                                .findUserRolesByUserIdAndStatusesAndRoleNames(candidate.getId(),
                                                                List.of(UserRoleStatus.ACTIVE.name(),
                                                                                UserRoleStatus.INVITED.name()),
                                                                AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL)
                                                .stream()
                                                .anyMatch(role -> instituteId.equals(role.getInstituteId()));
                                if (inInstitute) {
                                        return candidate.getUsername();
                                }
                        }
                }
                // findUserDetailsByEmail is ordered by created_at desc → first is most recent
                return passwordMatches.get(0).getUsername();
        }

        public JwtResponseDto loginUser(AuthRequestDto authRequestDTO) {
                // Learners frequently type their email into the username field. Username is
                // unique, so it is tried first; if the input is an email that maps to an
                // account, resolve it to that account's real username before authenticating.
                String userName = resolveLoginUsername(authRequestDTO.getUserName(),
                                authRequestDTO.getPassword(), authRequestDTO.getInstituteId());
                String password = authRequestDTO.getPassword();

                Authentication authentication = authRequestDTO.getInstituteId() == null
                                ? authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(
                                                null + "@" + userName, password))
                                : authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(
                                                authRequestDTO.getInstituteId() + "@" + userName, password));

                if (!authentication.isAuthenticated())
                        throw new UsernameNotFoundException("Invalid user request!");

                User user = userRepository.findByUsername(userName)
                                .orElseThrow(() -> new UsernameNotFoundException("Invalid user request!"));

                refreshTokenService.deleteAllRefreshToken(user);

                List<UserRole> roles = userRoleRepository.findUserRolesByUserIdAndStatusesAndRoleNames(user.getId(),
                                List.of(UserRoleStatus.ACTIVE.name()), AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
                if (roles.isEmpty())
                        throw new UsernameNotFoundException("Invalid user request!");

                // Resolve instituteId: use request value, or single-institute fallback
                String instituteId = authRequestDTO.getInstituteId();
                if (instituteId == null || instituteId.isBlank()) {
                        // Count distinct institutes from user roles
                        java.util.Set<String> instituteIds = roles.stream()
                                        .map(UserRole::getInstituteId)
                                        .filter(id -> id != null && !id.isBlank())
                                        .collect(java.util.stream.Collectors.toSet());
                        if (instituteIds.size() == 1) {
                                instituteId = instituteIds.iterator().next();
                        }
                        // If multiple institutes → instituteId stays null → skip session check
                        // Session will be checked when user selects an institute
                }

                // ── SESSION LIMIT CHECK (skip for multi-institute — checked at institute selection) ──
                if (instituteId != null) {
                        Optional<List<ActiveSessionDTO>> sessionCheck = userSessionService.checkSessionLimit(
                                        user.getId(), instituteId);
                        if (sessionCheck.isPresent()) {
                                return JwtResponseDto.builder()
                                                .sessionLimitExceeded(true)
                                                .activeSessions(sessionCheck.get())
                                                .build();
                        }
                }
                // ── END SESSION LIMIT CHECK ──

                List<String> permissions = userPermissionRepository.findByUserId(user.getId()).stream()
                                .map(UserPermission::getPermissionId).toList();

                RefreshToken refreshToken = refreshTokenService.createRefreshToken(userName,
                                authRequestDTO.getClientName());

                String accessToken = jwtService.generateToken(user, user.getRoles().stream().toList(), permissions);

                // Register the new session (only for single-institute; multi-institute done at selection)
                if (instituteId != null) {
                        userSessionService.createSession(
                                        user.getId(), instituteId,
                                        accessToken, authRequestDTO.getDeviceType());
                }

                return JwtResponseDto.builder()
                                .accessToken(accessToken)
                                .refreshToken(refreshToken.getToken())
                                .build();
        }

        public String requestOtp(AuthRequestDto authRequestDTO) {
                Optional<User> user = null;

                // Determine the user identifier strategy for the institute.
                // Deliberately the CALLER-SUPPLIED institute, never the host-resolved fallback used
                // for the mail below: this selects the lookup query, and an institute configured as
                // PHONE resolves to findUserByEmailWithPhoneNotNull. Letting the fallback reach here
                // would move portals that currently answer as EMAIL (because the caller sent no
                // institute) onto the PHONE path and lock out users with no mobile number on file.
                String userIdentifier = resolveUserIdentifier(authRequestDTO.getInstituteId());

                if (authRequestDTO.getClientName() != null
                                && authRequestDTO.getClientName().equals(ClientNameEnum.ADMIN.name())) {
                        if ("PHONE".equalsIgnoreCase(userIdentifier)) {
                                user = userRepository.findUserByEmailWithPhoneNotNull(
                                                authRequestDTO.getEmail(),
                                                List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                                                AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
                        } else {
                                user = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(
                                                authRequestDTO.getEmail(),
                                                List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                                                AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
                        }
                } else {
                        if ("PHONE".equalsIgnoreCase(userIdentifier)) {
                                user = userRepository.findUserByEmailWithPhoneNotNull(
                                                authRequestDTO.getEmail(),
                                                List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                                                AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
                        } else {
                                user = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(
                                                authRequestDTO.getEmail(),
                                                List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                                                AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
                        }
                }

                if (user.isEmpty())
                        throw new UsernameNotFoundException("User not found!");

                notificationService.sendOtp(makeOtp(authRequestDTO.getEmail()),
                                resolveInstituteIdForMail(authRequestDTO));
                return "OTP sent to " + authRequestDTO.getEmail();
        }

        public JwtResponseDto loginViaOtp(AuthRequestDto authRequestDTO) {
                if (authRequestDTO.getOtp() == null)
                        throw new UsernameNotFoundException("Invalid OTP!");

                boolean isValid = notificationService.verifyOTP(
                                EmailOTPRequest.builder().otp(authRequestDTO.getOtp()).to(authRequestDTO.getEmail())
                                                .build());
                if (!isValid)
                        throw new UsernameNotFoundException("Invalid OTP!");

                // Determine the user identifier strategy for the institute
                String userIdentifier = resolveUserIdentifier(authRequestDTO.getInstituteId());

                User user;
                if ("PHONE".equalsIgnoreCase(userIdentifier)) {
                        user = userRepository
                                        .findUserByEmailWithPhoneNotNull(authRequestDTO.getEmail(),
                                                        List.of(UserRoleStatus.ACTIVE.name(),
                                                                        UserRoleStatus.INVITED.name()),
                                                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL)
                                        .orElseThrow(() -> new VacademyException("User not found!!!"));
                } else {
                        user = userRepository
                                        .findMostRecentUserByEmailAndRoleStatusAndRoleNames(authRequestDTO.getEmail(),
                                                        List.of(UserRoleStatus.ACTIVE.name(),
                                                                        UserRoleStatus.INVITED.name()),
                                                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL)
                                        .orElseThrow(() -> new VacademyException("User not found!!!"));
                }

                refreshTokenService.deleteAllRefreshToken(user);

                // Resolve instituteId from request or user's roles
                String otpInstituteId = authRequestDTO.getInstituteId();
                if (otpInstituteId == null || otpInstituteId.isBlank()) {
                        List<UserRole> userRoles = user.getRoles().stream().toList();
                        if (!userRoles.isEmpty()) otpInstituteId = userRoles.get(0).getInstituteId();
                }

                // ── SESSION LIMIT CHECK (transparent when no limit configured) ──
                Optional<List<ActiveSessionDTO>> sessionCheck = userSessionService.checkSessionLimit(user.getId(),
                                otpInstituteId);
                if (sessionCheck.isPresent()) {
                        return JwtResponseDto.builder()
                                        .sessionLimitExceeded(true)
                                        .activeSessions(sessionCheck.get())
                                        .build();
                }
                // ── END SESSION LIMIT CHECK ──

                List<String> permissions = userPermissionRepository.findByUserId(user.getId()).stream()
                                .map(UserPermission::getPermissionId).toList();
                RefreshToken refreshToken = refreshTokenService.createRefreshToken(user.getUsername(),
                                authRequestDTO.getClientName());

                String accessToken = jwtService.generateToken(user, user.getRoles().stream().toList(), permissions);

                // Register the new session (noop for institutes without limit configured)
                userSessionService.createSession(
                                user.getId(), otpInstituteId,
                                accessToken, authRequestDTO.getDeviceType());

                return JwtResponseDto.builder()
                                .accessToken(accessToken)
                                .refreshToken(refreshToken.getToken())
                                .build();
        }

        public JwtResponseDto refreshToken(RefreshTokenRequestDTO refreshTokenRequestDTO) {
                return refreshTokenService.findByToken(refreshTokenRequestDTO.getToken())
                                .map(refreshTokenService::verifyExpiration)
                                .map(RefreshToken::getUserInfo)
                                .map(user -> {
                                        List<String> permissions = userPermissionRepository.findByUserId(user.getId())
                                                        .stream()
                                                        .map(UserPermission::getPermissionId).toList();
                                        // Echo the (still valid) refresh token: the learner app stores
                                        // response.refreshToken, and a missing one would wipe its copy.
                                        return JwtResponseDto.builder()
                                                        .accessToken(jwtService.generateToken(user,
                                                                        user.getRoles().stream().toList(), permissions))
                                                        .refreshToken(refreshTokenRequestDTO.getToken())
                                                        .build();
                                })
                                .orElseThrow(() -> new ExpiredTokenException(
                                                "Refresh token is expired. Please log in again."));
        }

        /**
         * The institute whose sender address and branding the OTP mail should carry: the one the
         * caller supplied, or — when they supplied none — whichever institute owns the host the
         * request came from. See {@link OriginInstituteResolver} for why the fallback exists and
         * why it can only ever return null on failure.
         *
         * <p>Scoped to the mail on purpose. The fallback is a good enough guess to brand an email
         * correctly and NOT good enough to change who can log in, so it is resolved here at the
         * point of sending rather than where the authentication path would see it.
         */
        private String resolveInstituteIdForMail(AuthRequestDto authRequestDTO) {
                if (StringUtils.hasText(authRequestDTO.getInstituteId())) {
                        return authRequestDTO.getInstituteId();
                }
                return originInstituteResolver.resolveInstituteId();
        }

        private EmailOTPRequest makeOtp(String email) {
                return EmailOTPRequest.builder()
                                .to(email)
                                .service("auth-service")
                                .subject("OTP Verification")
                                .name("User")
                                .build();
        }

        public JwtResponseDto loginViaOtpForTenDays(AuthRequestDto authRequestDTO) {
                if (authRequestDTO.getOtp() == null)
                        throw new UsernameNotFoundException("Invalid OTP!");

                boolean isValid = notificationService.verifyOTP(
                                EmailOTPRequest.builder().otp(authRequestDTO.getOtp()).to(authRequestDTO.getEmail())
                                                .build());
                if (!isValid)
                        throw new UsernameNotFoundException("Invalid OTP!");

                // Determine the user identifier strategy for the institute
                String userIdentifier = resolveUserIdentifier(authRequestDTO.getInstituteId());

                User user;
                if ("PHONE".equalsIgnoreCase(userIdentifier)) {
                        user = userRepository
                                        .findUserByEmailWithPhoneNotNull(authRequestDTO.getEmail(),
                                                        List.of(UserRoleStatus.ACTIVE.name(),
                                                                        UserRoleStatus.INVITED.name()),
                                                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL)
                                        .orElseThrow(() -> new VacademyException("User not found!!!"));
                } else {
                        user = userRepository
                                        .findMostRecentUserByEmailAndRoleStatusAndRoleNames(authRequestDTO.getEmail(),
                                                        List.of(UserRoleStatus.ACTIVE.name(),
                                                                        UserRoleStatus.INVITED.name()),
                                                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL)
                                        .orElseThrow(() -> new VacademyException("User not found!!!"));
                }

                refreshTokenService.deleteAllRefreshToken(user);

                // Resolve instituteId from request or user's roles
                String tenDayInstituteId = authRequestDTO.getInstituteId();
                if (tenDayInstituteId == null || tenDayInstituteId.isBlank()) {
                        List<UserRole> userRoles = user.getRoles().stream().toList();
                        if (!userRoles.isEmpty()) tenDayInstituteId = userRoles.get(0).getInstituteId();
                }

                // ── SESSION LIMIT CHECK (transparent when no limit configured) ──
                Optional<List<ActiveSessionDTO>> sessionCheck = userSessionService.checkSessionLimit(user.getId(),
                                tenDayInstituteId);
                if (sessionCheck.isPresent()) {
                        return JwtResponseDto.builder()
                                        .sessionLimitExceeded(true)
                                        .activeSessions(sessionCheck.get())
                                        .build();
                }
                // ── END SESSION LIMIT CHECK ──

                List<String> permissions = userPermissionRepository.findByUserId(user.getId()).stream()
                                .map(UserPermission::getPermissionId).toList();
                RefreshToken refreshToken = refreshTokenService.createRefreshToken(user.getUsername(),
                                authRequestDTO.getClientName());

                String accessToken = jwtService.generateToken(user, user.getRoles().stream().toList(), permissions, 10);

                // Register the new session (noop for institutes without limit configured)
                userSessionService.createSession(
                                user.getId(), tenDayInstituteId,
                                accessToken, authRequestDTO.getDeviceType());

                return JwtResponseDto.builder()
                                .accessToken(accessToken)
                                .refreshToken(refreshToken.getToken())
                                .build();
        }

        public UserWithJwtDTO generateTokenForUserByUserId(String userId, String instituteId) {
                User user = userRepository.findById(userId)
                                .orElseThrow(() -> new UsernameNotFoundException("User not found!"));

                // The minted token carries ALL of the user's roles and passes the super-admin
                // allowlist, so a platform staff account enrolled as a learner somewhere must
                // never get one from this path.
                if (SuperAdminAuthUtil.isSuperAdminUserId(user.getId())) {
                        throw new VacademyException(HttpStatus.FORBIDDEN,
                                        "Cannot generate a learner token for a platform staff account");
                }

                Optional<UserRole> userRole = userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                                userId,
                                instituteId,
                                AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL,
                                List.of(UserRoleStatus.ACTIVE.name()));

                if (userRole.isEmpty()) {
                        throw new UsernameNotFoundException(
                                        "User does not have active STUDENT role for this institute!");
                }

                refreshTokenService.deleteAllRefreshToken(user);

                List<String> permissions = userPermissionRepository.findByUserId(user.getId()).stream()
                                .map(UserPermission::getPermissionId).toList();

                RefreshToken refreshToken = refreshTokenService.createRefreshToken(user.getUsername(), "VACADEMY-WEB");

                return new UserWithJwtDTO(new UserDTO(user),
                                jwtService.generateToken(user, user.getRoles().stream().toList(),
                                                permissions),
                                refreshToken.getToken());

        }

        // ============================================================================
        // TRUSTED LOGIN - EMERGENCY ENDPOINT (TEMPORARY)
        // ============================================================================
        // ⚠️ WARNING: This endpoint bypasses OTP verification.
        // TODO: Remove this endpoint once SES email service is restored.
        // ============================================================================

        @Value("${security.trusted-login.enabled:false}")
        private boolean trustedLoginEnabled;

        /**
         * Emergency login by username without OTP verification.
         * 
         * ⚠️ TEMPORARY: This is an emergency endpoint for when email service (SES) is
         * down
         * and users cannot receive OTP codes.
         * 
         * Security measures:
         * - Feature flag controlled (must be explicitly enabled)
         * - All requests are logged for audit purposes
         * - Only works for users with STUDENT role in the specified institute (if
         * provided)
         * 
         * <p>Login codes ({@code ?lc=} on the link, see LoginCodeService) are used only for an
         * institute that has switched on "require login code" (institute_login_link_policy,
         * off by default). There the code alone decides: valid = signed in, anything else =
         * 401, and the emergency flag is not consulted. The username and institute, when sent,
         * must match the code's.
         *
         * <p>Everywhere else (the default) a code is ignored and the original username-only
         * behaviour applies. Without a code, a user who belongs to an institute with the switch
         * on gets 401.
         *
         * @param username    The user's username (required unless a code is sent)
         * @param instituteId The institute ID (optional - if null, looks up by username
         *                    only)
         * @param code        Login code from the link (optional)
         * @param requestIP   The request IP address for logging
         * @return JwtResponseDto with access and refresh tokens
         */
        public JwtResponseDto loginByUsernameTrusted(String username, String instituteId, String code,
                        String requestIP) {
                return loginByUsernameTrusted(username, instituteId, code, null, requestIP);
        }

        /**
         * @param route the landing route the learner app reports (LoginLinkRoute name, optional).
         *              An institute requiring codes may exempt it; see institute_login_link_policy.
         */
        public JwtResponseDto loginByUsernameTrusted(String username, String instituteId, String code,
                        String route, String requestIP) {
                // Log all attempts for security audit
                log.warn("TRUSTED_LOGIN_ATTEMPT: username={}, instituteId={}, withCode={}, route={}, IP={}",
                                username, instituteId, code != null && !code.isBlank(), route, requestIP);

                boolean codeEnforced = code != null && !code.isBlank()
                                && loginCodeService.instituteOf(code).map(loginCodeService::requiresCode).orElse(false);
                if (codeEnforced) {
                        User codeUser = loginCodeService.redeem(code, username, instituteId, requestIP)
                                        .orElseThrow(() -> {
                                                log.warn("TRUSTED_LOGIN_DENIED: invalid login code. username={}, instituteId={}, IP={}",
                                                                username, instituteId, requestIP);
                                                return new VacademyException(HttpStatus.UNAUTHORIZED,
                                                                "This login link is invalid or has expired.");
                                        });
                        log.warn("TRUSTED_LOGIN_SUCCESS: User {} (id={}) logged in via login code from IP {}",
                                        codeUser.getUsername(), codeUser.getId(), requestIP);
                        return issueTrustedLoginTokens(codeUser);
                }

                // Check if feature is enabled
                if (!trustedLoginEnabled) {
                        log.warn("TRUSTED_LOGIN_DENIED: Feature is disabled. username={}, IP={}", username, requestIP);
                        throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                                        "Trusted login is currently disabled");
                }

                // Validate request - only username is required (institute_id is optional)
                if (username == null || username.isBlank()) {
                        throw new VacademyException(HttpStatus.BAD_REQUEST,
                                        "Username is required");
                }

                // Find user - use institute-specific query if provided, otherwise just by
                // username
                User user;
                if (instituteId != null && !instituteId.isBlank()) {
                        // Find by username and institute
                        user = userRepository.findUserByUsernameAndInstituteId(username, instituteId)
                                        .orElseThrow(() -> {
                                                log.warn("TRUSTED_LOGIN_FAILED: User not found. username={}, instituteId={}, IP={}",
                                                                username, instituteId, requestIP);
                                                return new VacademyException(HttpStatus.NOT_FOUND, "User not found");
                                        });
                } else {
                        // Find by username only (username is unique)
                        user = userRepository.findByUsername(username)
                                        .orElseThrow(() -> {
                                                log.warn("TRUSTED_LOGIN_FAILED: User not found. username={}, IP={}",
                                                                username, requestIP);
                                                return new VacademyException(HttpStatus.NOT_FOUND, "User not found");
                                        });
                }

                if (loginCodeService.anyInstituteRequiresCode(user.getId(), instituteId,
                                vacademy.io.auth_service.feature.login_link.enums.LoginLinkRoute.parse(route).orElse(null))) {
                        log.warn("TRUSTED_LOGIN_DENIED: login code required. username={}, instituteId={}, route={}, IP={}",
                                        username, instituteId, route, requestIP);
                        throw new VacademyException(HttpStatus.UNAUTHORIZED,
                                        "This login link is invalid or has expired.");
                }

                // Log successful login for audit
                log.warn("TRUSTED_LOGIN_SUCCESS: User {} (id={}) logged in via trusted endpoint from IP {}",
                                username, user.getId(), requestIP);

                return issueTrustedLoginTokens(user);
        }

        private JwtResponseDto issueTrustedLoginTokens(User user) {
                // Delete existing refresh tokens (same as regular login)
                refreshTokenService.deleteAllRefreshToken(user);

                // Get user permissions
                List<String> permissions = userPermissionRepository.findByUserId(user.getId()).stream()
                                .map(UserPermission::getPermissionId).toList();

                // Create refresh token
                RefreshToken refreshToken = refreshTokenService.createRefreshToken(
                                user.getUsername(),
                                "VACADEMY-WEB-TRUSTED" // Mark the client name for audit purposes
                );

                // Generate JWT with 10-day expiry (same as login-otp-ten-days)
                return JwtResponseDto.builder()
                                .accessToken(jwtService.generateToken(user, user.getRoles().stream().toList(),
                                                permissions, 10))
                                .refreshToken(refreshToken.getToken())
                                .build();
        }

        /**
         * Check if trusted login feature is enabled.
         * 
         * @return true if trusted login is enabled
         */
        public boolean isTrustedLoginEnabled() {
                return trustedLoginEnabled;
        }

        /**
         * Resolves the user identifier strategy for the given institute.
         * Returns "EMAIL" (default) if institute is not found or user_identifier is
         * null.
         */
        private String resolveUserIdentifier(String instituteId) {
                return instituteSettingsService.getUserIdentifier(instituteId);
        }
}
