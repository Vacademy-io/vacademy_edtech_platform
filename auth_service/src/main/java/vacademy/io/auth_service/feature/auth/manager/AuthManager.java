package vacademy.io.auth_service.feature.auth.manager;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.web.client.RestTemplate;
import vacademy.io.auth_service.feature.auth.constants.AuthConstants;
import vacademy.io.auth_service.feature.auth.dto.AuthRequestDto;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.dto.NotificationTemplateConfigDTO;
import vacademy.io.auth_service.feature.auth.dto.RegisterRequest;
import vacademy.io.auth_service.feature.auth.dto.WhatsAppOTPRequest;
import vacademy.io.auth_service.feature.auth.dto.WhatsAppOTPVerifyRequest;
import vacademy.io.auth_service.feature.auth.enums.ClientNameEnum;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.auth_service.feature.notification.service.NotificationEmailBody;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.common.auth.dto.RefreshTokenRequestDTO;
import vacademy.io.common.auth.entity.*;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.OAuth2VendorToUserDetailService;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.ExpiredTokenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.dto.InstituteIdAndNameDTO;
import vacademy.io.common.institute.dto.InstituteInfoDTO;
import vacademy.io.common.notification.dto.EmailOTPRequest;
import vacademy.io.common.notification.dto.GenericEmailRequest;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.auth_service.feature.institute.service.InstituteSettingsService;
import org.springframework.util.StringUtils;

import java.util.*;

import static vacademy.io.auth_service.feature.auth.constants.AuthConstants.ADMIN_ROLE;

@Component
public class AuthManager {

    /**
     * Every WhatsApp OTP template on the platform stores the same settings: one
     * body parameter carrying the code, and the copy-code button carrying it
     * again. That is not a coincidence — it is the fixed shape of a Meta
     * AUTHENTICATION template, so a caller naming its own template needs no
     * per-institute copy of it.
     */
    private static final String AUTHENTICATION_TEMPLATE_SETTING_JSON = "{\"language_code\":\"en\","
            + "\"parameters\":{\"body\":[{\"source\":\"otp\",\"type\":\"text\"}],"
            + "\"button\":[{\"source\":\"otp\",\"type\":\"text\"}]}}";

    private static final String DEFAULT_OTP_LANGUAGE_CODE = "en";

    @Autowired
    UserRepository userRepository;

    @Autowired
    vacademy.io.auth_service.feature.demo.service.TrialAccessGuard trialAccessGuard;

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
    InternalClientUtils internalClientUtils;

    @Autowired
    RoleRepository roleRepository;

    @Value("${admin.core.service.base_url}")
    private String adminCoreServiceBaseUrl;
    @Value("${spring.application.name}")
    private String applicationName;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private UserPermissionRepository userPermissionRepository;

    @Autowired
    private OAuth2VendorToUserDetailService oAuth2VendorToUserDetailService;

    @Autowired
    private InstituteSettingsService instituteSettingsService;

    @Autowired
    private vacademy.io.auth_service.feature.user.service.UserSessionService userSessionService;

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AuthManager.class);

    public JwtResponseDto registerRootUser(RegisterRequest registerRequest) {
        if (Objects.isNull(registerRequest))
            throw new VacademyException("Invalid Request");

        // Signup is unauthenticated, so an existing email must never get this far: createUser would
        // reuse that account and we would hand working tokens for it to whoever asked. Rejecting
        // here (rather than after) also avoids leaving an orphaned institute behind.
        String email = registerRequest.getEmail() == null ? null : registerRequest.getEmail().toLowerCase().trim();
        if (email != null && !email.isBlank()
                && userRepository.findFirstByEmailOrderByCreatedAtDesc(email).isPresent()) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "An account already exists for " + email + ". Please log in instead.");
        }

        // Only ever mint an admin here. The role list arrives in the request body, so without this
        // a caller could name any role that happens to exist in the roles table.
        registerRequest.setUserRoles(List.of(ADMIN_ROLE));

        InstituteInfoDTO instituteInfoDTO = registerRequest.getInstitute();

        // Debug logging for institute fields - to trace production issues
        log.info("[AUTH-SERVICE] registerRootUser - Institute fields before sending to admin service:");
        log.info("[AUTH-SERVICE] board: {}",
                instituteInfoDTO != null ? instituteInfoDTO.getBoard() : "null (DTO is null)");
        log.info("[AUTH-SERVICE] gstDetails: {}",
                instituteInfoDTO != null ? instituteInfoDTO.getGstDetails() : "null (DTO is null)");
        log.info("[AUTH-SERVICE] affiliationNumber: {}",
                instituteInfoDTO != null ? instituteInfoDTO.getAffiliationNumber() : "null (DTO is null)");
        log.info("[AUTH-SERVICE] staffStrength: {}",
                instituteInfoDTO != null ? instituteInfoDTO.getStaffStrength() : "null (DTO is null)");
        log.info("[AUTH-SERVICE] schoolStrength: {}",
                instituteInfoDTO != null ? instituteInfoDTO.getSchoolStrength() : "null (DTO is null)");
        log.info("[AUTH-SERVICE] Full InstituteInfoDTO: {}", instituteInfoDTO);

        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(applicationName, HttpMethod.POST.name(),
                adminCoreServiceBaseUrl, AuthConstants.CREATE_INSTITUTES_PATH, instituteInfoDTO);

        ObjectMapper objectMapper = new ObjectMapper();
        InstituteIdAndNameDTO customUserDetails;

        try {
            customUserDetails = objectMapper.readValue(response.getBody(), new TypeReference<InstituteIdAndNameDTO>() {
            });

        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to register user institutes due to service unavailability: " + e.getMessage());
        }

        // Set the newly created institute ID back on the request so downstream
        // methods (e.g. welcome email) use the real ID instead of the empty placeholder
        if (instituteInfoDTO != null) {
            instituteInfoDTO.setId(customUserDetails.getInstituteId());
        }

        List<Role> allRoles = getAllUserRoles(registerRequest.getUserRoles());
        Set<UserRole> userRoleSet = new HashSet<>();

        allRoles.forEach(role -> {
            UserRole userRole = new UserRole();
            userRole.setRole(role);
            userRole.setInstituteId(customUserDetails.getInstituteId());

            userRoleSet.add(userRole);
        });
        User newUser = authService.createUser(registerRequest, userRoleSet);
        oAuth2VendorToUserDetailService.verifyEmail(registerRequest.getSubjectId(), registerRequest.getVendorId(),
                registerRequest.getEmail());
        // Generate a refresh token
        RefreshToken refreshToken = refreshTokenService.createRefreshToken(newUser.getUsername(), "VACADEMY-WEB");

        return authService.generateJwtTokenForUser(newUser, refreshToken, userRoleSet.stream().toList());
    }

    private Role getAdminRole() {
        return roleRepository.findByName(ADMIN_ROLE)
                .orElseThrow(() -> new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR, "Role 'ADMIN' not found"));
    }

    private List<Role> getAllUserRoles(List<String> userRoles) {
        return roleRepository.findByNameIn(userRoles);
    }

    public JwtResponseDto loginUser(AuthRequestDto authRequestDTO) {

        Authentication authentication = authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(
                authRequestDTO.getInstituteId() + "@" + authRequestDTO.getUserName(), authRequestDTO.getPassword()));
        if (authentication.isAuthenticated()) {

            String username = authRequestDTO.getUserName();

            Optional<User> userOptional = userRepository.findByUsername(username);
            if (userOptional.isEmpty()) {
                throw new UsernameNotFoundException("invalid user request..!!");
            }

            // A demo workspace stops letting anyone in once its trial lapses. Checked here rather
            // than by a scheduler so it can never drift, and so extending the date restores access
            // immediately. Nothing is deleted.
            trialAccessGuard.assertNotExpired(authRequestDTO.getInstituteId());

            refreshTokenService.deleteAllRefreshToken(userOptional.get());

            User user = userOptional.get();

            List<UserRole> allUserRoles = userRoleRepository.findByUser(user);
            List<UserRole> eligibleStaffRoles = allUserRoles.stream()
                    .filter(UserRoleService::grantsAccess)
                    .filter(ur -> ur.getRole() != null && ur.getRole().getName() != null
                            && !AuthConstants.STUDENT_ROLE.equals(ur.getRole().getName()))
                    .toList();
            // Prefer the institute being signed into, so its invite is the one accepted.
            String requestedInstituteId = authRequestDTO.getInstituteId();
            Optional<UserRole> nonStudentRole = eligibleStaffRoles.stream()
                    .filter(ur -> requestedInstituteId != null
                            && requestedInstituteId.equals(ur.getInstituteId()))
                    .findFirst()
                    .or(() -> eligibleStaffRoles.stream().findFirst());

            // Accept the pending invitation in that institute. Only INVITED rows move: the
            // old blanket update also re-activated roles an admin had disabled or deleted,
            // so "Disable access" was undone by the member's next sign-in.
            if (nonStudentRole.isPresent()) {
                userRoleRepository.activateInvitedRolesByInstituteIdAndUserId(
                        nonStudentRole.get().getInstituteId(),
                        List.of(user.getId()));
            } else {
                throw new UsernameNotFoundException("invalid user request..!!");
            }

            RefreshToken refreshToken = refreshTokenService.createRefreshToken(authRequestDTO.getUserName(),
                    authRequestDTO.getClientName());
            List<String> userPermissions = userPermissionRepository.findByUserId(user.getId()).stream()
                    .map(UserPermission::getPermissionId).toList();

            String accessToken = jwtService.generateToken(user, user.getRoles().stream().toList(), userPermissions);

            return JwtResponseDto.builder()
                    .accessToken(accessToken)
                    .refreshToken(refreshToken.getToken()).build();

        } else {
            throw new UsernameNotFoundException("invalid user request..!!");
        }
    }

    public JwtResponseDto refreshToken(RefreshTokenRequestDTO refreshTokenRequestDTO) {
        return refreshTokenService.findByToken(refreshTokenRequestDTO.getToken())
                .map(refreshTokenService::verifyExpiration).map(RefreshToken::getUserInfo).map(userInfo -> {

                    List<UserRole> userRoles = userRoleRepository.findByUser(userInfo);
                    // Access revoked everywhere (disabled / removed from every team and
                    // enrolment): stop renewing, so an already signed-in session ends too.
                    // Users with no role rows at all keep the old behaviour — that is not a
                    // revocation, and some live sessions (e.g. role-less accounts) depend on it.
                    if (!userRoles.isEmpty() && userRoles.stream().noneMatch(UserRoleService::grantsAccess)) {
                        throw new ExpiredTokenException(
                                "Your access has been removed. Please contact your institute.");
                    }
                    List<String> userPermissions = userPermissionRepository.findByUserId(userInfo.getId()).stream()
                            .map(UserPermission::getPermissionId).toList();
                    // Generate new access token
                    String accessToken = jwtService.generateToken(userInfo, userRoles, userPermissions);
                    // Return the new JWT token
                    return JwtResponseDto.builder().accessToken(accessToken).build();
                }).orElseThrow(() -> new ExpiredTokenException(
                        refreshTokenRequestDTO.getToken() + " Refresh token is. Please make a new login..!"));

    }

    public String requestOtp(AuthRequestDto authRequestDTO) {
        Optional<User> user = null;

        // Determine the user identifier strategy for the institute.
        // Deliberately the CALLER-SUPPLIED institute, never the host-resolved fallback used for
        // the mail below: this selects the lookup query, and an institute configured as PHONE
        // resolves to findUserByEmailWithPhoneNotNull. Letting the fallback reach here would move
        // portals that currently answer as EMAIL (because the caller sent no institute) onto the
        // PHONE path and lock out every user with no mobile number on file.
        String userIdentifier = resolveUserIdentifier(authRequestDTO.getInstituteId());

        if (authRequestDTO.getClientName() != null
                && authRequestDTO.getClientName().equals(ClientNameEnum.ADMIN.name())) {
            if ("PHONE".equalsIgnoreCase(userIdentifier)) {
                user = userRepository.findUserByEmailWithPhoneNotNull(authRequestDTO.getEmail(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            } else {
                user = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(authRequestDTO.getEmail(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            }
        } else {
            if ("PHONE".equalsIgnoreCase(userIdentifier)) {
                user = userRepository.findUserByEmailWithPhoneNotNull(authRequestDTO.getEmail(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            } else {
                user = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(authRequestDTO.getEmail(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            }
        }
        if (user.isEmpty()) {
            throw new UsernameNotFoundException("invalid user request..!!");
        } else {
            notificationService.sendOtp(makeOtp(authRequestDTO.getEmail()),
                    resolveInstituteIdForMail(authRequestDTO));
            return "OTP sent to " + authRequestDTO.getEmail();
        }
    }

    /**
     * The institute whose sender address and branding the OTP mail should carry: the one the
     * caller supplied, or — when they supplied none — whichever institute owns the host the
     * request came from. See {@link OriginInstituteResolver} for why the fallback exists and why
     * it can only ever return null on failure.
     *
     * <p>Scoped to the mail on purpose. The fallback is a good enough guess to brand an email
     * correctly and NOT good enough to change who can log in, so it is resolved here at the point
     * of sending rather than at the top of the method where the authentication path would see it.
     */
    private String resolveInstituteIdForMail(AuthRequestDto authRequestDTO) {
        if (StringUtils.hasText(authRequestDTO.getInstituteId())) {
            return authRequestDTO.getInstituteId();
        }
        return originInstituteResolver.resolveInstituteId();
    }

    /**
     * Subject and display name stay institute-neutral — they were "Vacademy | Otp verification."
     * and "Vacademy User", which put the platform's name on white-labelled mail whose body and
     * sender are correctly the institute's. Matches what the learner portal already sends.
     *
     * <p>Deliberately NOT left blank: notification_service reads a blank subject as "build me a
     * branded one" and that template appends the OTP itself to the subject line. Institute-branded
     * subjects are worth having, but not at the price of putting the code in every notification
     * preview as a side effect of this fix.
     */
    private EmailOTPRequest makeOtp(String email) {
        return EmailOTPRequest.builder().to(email).service("auth-service").subject("OTP Verification")
                .name("User").build();
    }

    public JwtResponseDto loginViaOtp(AuthRequestDto authRequestDTO) {
        validateOtp(authRequestDTO);
        User user = null;

        // Determine the user identifier strategy for the institute
        String userIdentifier = resolveUserIdentifier(authRequestDTO.getInstituteId());

        if (authRequestDTO.getClientName() != null
                && authRequestDTO.getClientName().equals(ClientNameEnum.ADMIN.name())) {
            Optional<User> userOptional;
            if ("PHONE".equalsIgnoreCase(userIdentifier)) {
                userOptional = userRepository.findUserByEmailWithPhoneNotNull(
                        authRequestDTO.getEmail(), List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            } else {
                userOptional = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(
                        authRequestDTO.getEmail(), List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            }
            if (userOptional.isEmpty()) {
                throw new VacademyException("invalid user request..!!");
            }
            user = userOptional.get();
        } else {
            Optional<User> userOptional;
            if ("PHONE".equalsIgnoreCase(userIdentifier)) {
                userOptional = userRepository.findUserByEmailWithPhoneNotNull(
                        authRequestDTO.getEmail(), List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            } else {
                userOptional = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(
                        authRequestDTO.getEmail(), List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            }
            if (userOptional.isEmpty()) {
                throw new VacademyException("invalid user request..!!");
            }
            user = userOptional.get();
        }
        return generateJwtResponse(authRequestDTO, user);
    }

    private void validateOtp(AuthRequestDto authRequestDTO) {
        if (authRequestDTO.getOtp() == null) {
            throw new UsernameNotFoundException("invalid user request..!!");
        }

        boolean isValidOtp = notificationService.verifyOTP(
                EmailOTPRequest.builder()
                        .otp(authRequestDTO.getOtp())
                        .to(authRequestDTO.getEmail())
                        .build());
        if (!isValidOtp) {
            throw new UsernameNotFoundException("invalid user request..!!");
        }
    }

    private JwtResponseDto generateJwtResponse(AuthRequestDto authRequestDTO, User user) {
        String username = user.getUsername();

        refreshTokenService.deleteAllRefreshToken(user);

        // Resolve instituteId from request or user's roles
        String jwtInstituteId = authRequestDTO.getInstituteId();
        if (jwtInstituteId == null || jwtInstituteId.isBlank()) {
            List<vacademy.io.common.auth.entity.UserRole> userRoles = user.getRoles().stream().toList();
            if (!userRoles.isEmpty()) jwtInstituteId = userRoles.get(0).getInstituteId();
        }

        // ── SESSION LIMIT CHECK (transparent when no limit configured) ──
        Optional<List<vacademy.io.auth_service.feature.auth.dto.ActiveSessionDTO>> sessionCheck = userSessionService
                .checkSessionLimit(user.getId(), jwtInstituteId);
        if (sessionCheck.isPresent()) {
            return JwtResponseDto.builder()
                    .sessionLimitExceeded(true)
                    .activeSessions(sessionCheck.get())
                    .build();
        }
        // ── END SESSION LIMIT CHECK ──

        RefreshToken refreshToken = refreshTokenService.createRefreshToken(username, authRequestDTO.getClientName());
        List<String> userPermissions = userPermissionRepository.findByUserId(user.getId()).stream()
                .map(UserPermission::getPermissionId).toList();

        String accessToken = jwtService.generateToken(user, user.getRoles().stream().toList(), userPermissions);

        // Register the new session (noop for institutes without limit configured)
        userSessionService.createSession(
                user.getId(), jwtInstituteId,
                accessToken, authRequestDTO.getDeviceType());

        return JwtResponseDto.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken.getToken())
                .build();
    }

    public String requestWhatsAppOtp(AuthRequestDto authRequestDTO) {
        // Validate user exists with phone number
        Optional<User> user = null;

        // Determine the user identifier strategy for the institute
        String userIdentifier = resolveUserIdentifier(authRequestDTO.getInstituteId());

        if (authRequestDTO.getClientName() != null
                && authRequestDTO.getClientName().equals(ClientNameEnum.ADMIN.name())) {
            if ("EMAIL".equalsIgnoreCase(userIdentifier)) {
                user = userRepository.findUserByPhoneWithEmailNotNull(
                        authRequestDTO.getPhoneNumber(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            } else {
                user = userRepository.findUserByMobileNumberAndRoleStatusAndRoleNames(
                        authRequestDTO.getPhoneNumber(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            }
        } else {
            if ("EMAIL".equalsIgnoreCase(userIdentifier)) {
                user = userRepository.findUserByPhoneWithEmailNotNull(
                        authRequestDTO.getPhoneNumber(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            } else {
                user = userRepository.findUserByMobileNumberAndRoleStatusAndRoleNames(
                        authRequestDTO.getPhoneNumber(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            }
        }

        if (user.isEmpty()) {
            throw new UsernameNotFoundException("No user found with phone number: " + authRequestDTO.getPhoneNumber());
        }

        // Fetch template config from admin service
        NotificationTemplateConfigDTO templateConfig = notificationService
                .getTemplateConfig("OTP_REQUEST", authRequestDTO.getInstituteId(), "WHATSAPP");

        // Send WhatsApp OTP via notification service
        WhatsAppOTPRequest whatsAppOTPRequest = WhatsAppOTPRequest.builder()
                .phoneNumber(authRequestDTO.getPhoneNumber())
                .instituteId(authRequestDTO.getInstituteId())
                .templateName(templateConfig.getTemplateName())
                .languageCode(templateConfig.getLanguageCode())
                .settingJson(templateConfig.getSettingJson())
                .build();

        assertWhatsAppOtpSent(notificationService.sendWhatsAppOtp(whatsAppOTPRequest),
                authRequestDTO.getPhoneNumber());
        return "WhatsApp OTP sent to " + authRequestDTO.getPhoneNumber();
    }

    public JwtResponseDto loginViaWhatsAppOtp(AuthRequestDto authRequestDTO) {
        // Verify WhatsApp OTP
        validateWhatsAppOtp(authRequestDTO);

        // Find user by phone number
        User user = null;

        // Determine the user identifier strategy for the institute
        String userIdentifier = resolveUserIdentifier(authRequestDTO.getInstituteId());

        if (authRequestDTO.getClientName() != null
                && authRequestDTO.getClientName().equals(ClientNameEnum.ADMIN.name())) {
            Optional<User> userOptional;
            if ("EMAIL".equalsIgnoreCase(userIdentifier)) {
                userOptional = userRepository.findUserByPhoneWithEmailNotNull(
                        authRequestDTO.getPhoneNumber(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            } else {
                userOptional = userRepository.findUserByMobileNumberAndRoleStatusAndRoleNames(
                        authRequestDTO.getPhoneNumber(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
            }
            if (userOptional.isEmpty()) {
                throw new VacademyException("User not found with phone number: " + authRequestDTO.getPhoneNumber());
            }
            user = userOptional.get();
        } else {
            Optional<User> userOptional;
            if ("EMAIL".equalsIgnoreCase(userIdentifier)) {
                userOptional = userRepository.findUserByPhoneWithEmailNotNull(
                        authRequestDTO.getPhoneNumber(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            } else {
                userOptional = userRepository.findUserByMobileNumberAndRoleStatusAndRoleNames(
                        authRequestDTO.getPhoneNumber(),
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                        AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL);
            }
            if (userOptional.isEmpty()) {
                throw new VacademyException("User not found with phone number: " + authRequestDTO.getPhoneNumber());
            }
            user = userOptional.get();
        }

        return generateJwtResponse(authRequestDTO, user);
    }

    private void validateWhatsAppOtp(AuthRequestDto authRequestDTO) {
        if (authRequestDTO.getOtp() == null || authRequestDTO.getPhoneNumber() == null) {
            throw new UsernameNotFoundException("OTP or phone number is missing");
        }

        WhatsAppOTPVerifyRequest verifyRequest = WhatsAppOTPVerifyRequest.builder()
                .phoneNumber(authRequestDTO.getPhoneNumber())
                .otp(authRequestDTO.getOtp())
                .build();

        boolean isValidOtp = notificationService.verifyWhatsAppOTP(verifyRequest);
        if (!isValidOtp) {
            throw new UsernameNotFoundException("Invalid or expired OTP");
        }
    }

    /**
     * Request WhatsApp OTP without user validation.
     * Use this for generic verification scenarios (guest checkout, lead
     * verification, etc.)
     * Reuses existing notification service flow.
     */

    /**
     * Reports a WhatsApp OTP send that the provider refused.
     *
     * The notification service answers a Meta rejection with
     * {@code {"success": false, "message": ...}} and HTTP 200 — it does not
     * throw. Both callers used to discard that and tell the caller "OTP sent",
     * so a bad template, an unregistered sender or a blocked number all looked
     * identical to success and the only symptom was a code that never arrived.
     */
    private void assertWhatsAppOtpSent(String responseBody, String phoneNumber) {
        if (responseBody == null || responseBody.isBlank()) {
            return; // Nothing to read — leave the old optimistic behaviour.
        }
        try {
            com.fasterxml.jackson.databind.JsonNode node =
                    new com.fasterxml.jackson.databind.ObjectMapper().readTree(responseBody);
            if (node.has("success") && !node.path("success").asBoolean(true)) {
                String reason = node.path("message").asText("WhatsApp provider refused the message");
                log.error("WhatsApp OTP not sent to {}: {}", phoneNumber, reason);
                throw new VacademyException("Could not send the WhatsApp code: " + reason);
            }
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            // Unreadable body is not proof of failure; don't block a send over it.
            log.warn("Could not read the WhatsApp OTP response: {}", e.getMessage());
        }
    }

    public String requestGenericWhatsAppOtp(AuthRequestDto authRequestDTO) {
        if (authRequestDTO.getPhoneNumber() == null || authRequestDTO.getInstituteId() == null) {
            throw new VacademyException("Phone number and Institute ID are required");
        }

        String requestedTemplate = authRequestDTO.getTemplateName() != null
                && !authRequestDTO.getTemplateName().isBlank()
                        ? authRequestDTO.getTemplateName().trim()
                        : null;

        String templateName;
        String languageCode;
        String settingJson;

        // Try the institute's OTP config first, exactly as before. A caller that
        // names its own template (a live session's, say) still takes its
        // languageCode and settingJson from here — those describe the template's
        // PARAMETERS, and substituting a generic set would send a body-only
        // template a copy-code button it does not have, which Meta rejects.
        NotificationTemplateConfigDTO templateConfig = null;
        try {
            templateConfig = notificationService
                    .getTemplateConfig("OTP_REQUEST", authRequestDTO.getInstituteId(), "WHATSAPP");
        } catch (Exception e) {
            // Only a caller that brought its own template can proceed without one.
            if (requestedTemplate == null) {
                throw e;
            }
            log.warn("No OTP_REQUEST config for institute {}; using the named template '{}' with "
                    + "standard authentication-template settings", authRequestDTO.getInstituteId(),
                    requestedTemplate);
        }

        if (templateConfig != null) {
            templateName = requestedTemplate != null ? requestedTemplate : templateConfig.getTemplateName();
            languageCode = templateConfig.getLanguageCode();
            settingJson = templateConfig.getSettingJson();
        } else {
            // No institute config at all — fall back to the fixed shape of a Meta
            // AUTHENTICATION template, which is what an OTP template always is.
            templateName = requestedTemplate;
            languageCode = authRequestDTO.getLanguageCode() != null
                    && !authRequestDTO.getLanguageCode().isBlank()
                            ? authRequestDTO.getLanguageCode().trim()
                            : DEFAULT_OTP_LANGUAGE_CODE;
            settingJson = AUTHENTICATION_TEMPLATE_SETTING_JSON;
        }

        // Send WhatsApp OTP via notification service (same as login flow)
        WhatsAppOTPRequest whatsAppOTPRequest = WhatsAppOTPRequest.builder()
                .phoneNumber(authRequestDTO.getPhoneNumber())
                .instituteId(authRequestDTO.getInstituteId())
                .templateName(templateName)
                .languageCode(languageCode)
                .settingJson(settingJson)
                .build();

        assertWhatsAppOtpSent(notificationService.sendWhatsAppOtp(whatsAppOTPRequest),
                authRequestDTO.getPhoneNumber());
        return "WhatsApp OTP sent to " + authRequestDTO.getPhoneNumber();
    }

    /**
     * Verify WhatsApp OTP without user validation or JWT generation.
     * Returns true if OTP is valid, false otherwise.
     * Reuses existing notification service verification.
     */
    public boolean verifyGenericWhatsAppOtp(AuthRequestDto authRequestDTO) {
        if (authRequestDTO.getOtp() == null || authRequestDTO.getPhoneNumber() == null) {
            throw new VacademyException("OTP and phone number are required");
        }

        WhatsAppOTPVerifyRequest verifyRequest = WhatsAppOTPVerifyRequest.builder()
                .phoneNumber(authRequestDTO.getPhoneNumber())
                .otp(authRequestDTO.getOtp())
                .build();

        return notificationService.verifyWhatsAppOTP(verifyRequest);
    }

    /**
     * Verify generic WhatsApp OTP and login the user.
     * Looks up the user by phone number after OTP verification
     * and returns access + refresh tokens.
     */
    public JwtResponseDto verifyGenericWhatsAppOtpAndLogin(AuthRequestDto authRequestDTO) {
        if (authRequestDTO.getOtp() == null || authRequestDTO.getPhoneNumber() == null) {
            throw new VacademyException("OTP and phone number are required");
        }

        // Verify the OTP first
        WhatsAppOTPVerifyRequest verifyRequest = WhatsAppOTPVerifyRequest.builder()
                .phoneNumber(authRequestDTO.getPhoneNumber())
                .otp(authRequestDTO.getOtp())
                .build();

        boolean isValidOtp = notificationService.verifyWhatsAppOTP(verifyRequest);
        if (!isValidOtp) {
            throw new VacademyException("Invalid or expired OTP");
        }

        // Find the user behind this phone number. Prefer one who holds a role in
        // the institute being logged into: a number can front several accounts,
        // and the newest of them may have no role here at all — that mints a token
        // with empty authorities, so the login "succeeds" while the portal has
        // nowhere to send the learner. Falls back to the previous behaviour when
        // no institute was supplied or none of the accounts match it.
        String phoneDigits = authRequestDTO.getPhoneNumber().replaceAll("[^0-9]", "");
        Optional<User> userOptional = Optional.empty();
        if (authRequestDTO.getInstituteId() != null && !authRequestDTO.getInstituteId().isBlank()) {
            userOptional = userRepository.findLatestUserByMobileNumberAndInstitute(
                    phoneDigits, authRequestDTO.getInstituteId());
        }
        if (userOptional.isEmpty()) {
            userOptional = userRepository.findLatestUserByMobileNumber(phoneDigits);
        }

        if (userOptional.isEmpty()) {
            throw new VacademyException("No user found with phone number: " + authRequestDTO.getPhoneNumber());
        }

        return generateJwtResponse(authRequestDTO, userOptional.get());
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
