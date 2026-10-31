package vacademy.io.auth_service.feature.auth.manager;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.auth.constants.AuthConstants;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.dto.RegisterRequest;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.notification.service.NotificationEmailBody;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.auth_service.feature.user.util.RandomCredentialGenerator;
import vacademy.io.common.auth.entity.*;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.InstituteChoice;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.common.institute.dto.InstituteIdAndNameDTO;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.util.*;

@Component
public class AdminOAuth2Manager {

    @Autowired
    OriginInstituteResolver originInstituteResolver;

    @Autowired
    UserRepository userRepository;

    @Autowired
    JwtService jwtService;

    @Autowired
    RefreshTokenService refreshTokenService;

    @Autowired
    UserRoleRepository userRoleRepository;

    @Autowired
    NotificationService notificationService;

    @Autowired
    private UserPermissionRepository userPermissionRepository;

    @Autowired
    private InstituteInternalService instituteInternalService;

    public JwtResponseDto loginUserByEmail(String email) {
        Optional<User> userOptional = userRepository.findMostRecentUserByEmailAndRoleStatusAndRoleNames(email,
                List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name()),
                AuthConstants.VALID_ROLES_FOR_ADMIN_PORTAL);
        if (userOptional.isEmpty()) {
            throw new UsernameNotFoundException("invalid user request..!!");
        }

        refreshTokenService.deleteAllRefreshToken(userOptional.get());

        User user = userOptional.get();

        List<UserRole> userRoles = userRoleRepository.findByUser(user);

        // Accept a pending invite on first Google sign-in — only INVITED rows, and only in an
        // institute where the user still has access. The old blanket update re-activated every
        // role in whichever institute came first, which let a disabled member re-enable
        // themselves just by signing in with Google.
        userRoles.stream()
                .filter(UserRoleService::grantsAccess)
                .findFirst()
                .ifPresent(role -> userRoleRepository.activateInvitedRolesByInstituteIdAndUserId(
                        role.getInstituteId(), List.of(user.getId())));
        List<String> userPermissions = userPermissionRepository.findByUserId(user.getId()).stream()
                .map(UserPermission::getPermissionId).toList();
        RefreshToken refreshToken = refreshTokenService.createRefreshToken(user.getUsername(), "oauth2-client");
        return JwtResponseDto.builder().accessToken(jwtService.generateToken(user, userRoles, userPermissions))
                .refreshToken(refreshToken.getToken()).build();
    }

    public JwtResponseDto registerRootUser(String fullName, String email) {
        String userName = RandomCredentialGenerator.generateRandomUsername(fullName);
        String password = RandomCredentialGenerator.generateRandomPassword();
        RegisterRequest registerRequest = new RegisterRequest();
        registerRequest.setEmail(email);
        registerRequest.setFullName(fullName);
        registerRequest.setPassword(password);
        registerRequest.setUserName(userName);
        Set<UserRole> userRoleSet = new HashSet<>();

        User newUser = createUser(registerRequest, userRoleSet);

        // Generate a refresh token
        RefreshToken refreshToken = refreshTokenService.createRefreshToken(userName, "VACADEMY-WEB");

        sendWelcomeMailToUser(newUser);

        return generateJwtTokenForUser(newUser, refreshToken, userRoleSet.stream().toList());
    }

    @Transactional
    public User createUser(RegisterRequest registerRequest, Set<UserRole> roles) {

        String normalizedEmail = registerRequest.getEmail() != null ? registerRequest.getEmail().toLowerCase() : null;
        User user = User.builder()
                .fullName(registerRequest.getFullName())
                .username(registerRequest.getUserName())
                .email(normalizedEmail)
                .password(registerRequest.getPassword())
                .roles(roles)
                .isRootUser(true)
                .build();

        for (UserRole role : roles) {
            role.setUser(user);
        }

        userRepository.save(user);

        return user;
    }

    public JwtResponseDto generateJwtTokenForUser(User user, RefreshToken refreshToken, List<UserRole> userRoles) {

        List<String> userPermissions = userPermissionRepository.findByUserId(user.getId()).stream()
                .map(UserPermission::getPermissionId).toList();
        String accessToken = jwtService.generateToken(user, userRoles, userPermissions);

        return JwtResponseDto.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken.getToken())
                .build();
    }

    public void sendWelcomeMailToUser(User user) {
        // Drives both the sender address and the branding below, so an arbitrary role
        // would welcome a user in the wrong institute's name.
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

        GenericEmailRequest genericEmailRequest = new GenericEmailRequest();
        genericEmailRequest.setTo(user.getEmail());
        genericEmailRequest.setBody(NotificationEmailBody.createWelcomeEmailBody(instituteName, user.getFullName(),
                user.getUsername(), user.getPassword(), learnerLoginUrl, theme));
        genericEmailRequest.setSubject("Welcome to " + instituteName);
        notificationService.sendGenericHtmlMailViaUnified(genericEmailRequest, instituteId);
    }

    /**
     * Creates a new admin user and logs them in during OAuth2 flow
     * 
     * @param fullName User's full name
     * @param email    User's email
     * @return JWT response with tokens
     * @throws Exception if user creation or login fails
     */
    public JwtResponseDto createUserAndLogin(String fullName, String email) throws Exception {
        // For admin users, always create with auto-generated credentials
        String userName = RandomCredentialGenerator.generateRandomUsername(fullName);
        String password = RandomCredentialGenerator.generateRandomPassword();

        RegisterRequest registerRequest = new RegisterRequest();
        registerRequest.setEmail(email);
        registerRequest.setFullName(fullName);
        registerRequest.setPassword(password);
        registerRequest.setUserName(userName);

        Set<UserRole> userRoleSet = new HashSet<>();
        User newUser = createUser(registerRequest, userRoleSet);

        // Generate a refresh token
        RefreshToken refreshToken = refreshTokenService.createRefreshToken(userName, "oauth2-client");

        // Send welcome email with credentials
        sendWelcomeMailToUser(newUser);

        return generateJwtTokenForUser(newUser, refreshToken, userRoleSet.stream().toList());
    }
}
