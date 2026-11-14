package vacademy.io.auth_service.feature.auth.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import vacademy.io.auth_service.feature.auth.dto.RegisterRequest;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.common.auth.entity.RefreshToken;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.service.OAuth2VendorToUserDetailService;
import vacademy.io.common.auth.service.RefreshTokenService;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.dto.InstituteInfoDTO;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * POST /auth-service/v1/signup-root: ADMIN, and only ADMIN, on the institute this very request
 * creates. These pin what main already does; this commit changes no signup-root code.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SignupRootRoleScopeTest {

    @Mock UserRepository userRepository;
    @Mock RoleRepository roleRepository;
    @Mock InternalClientUtils internalClientUtils;
    @Mock AuthService authService;
    @Mock RefreshTokenService refreshTokenService;
    @Mock OAuth2VendorToUserDetailService oAuth2VendorToUserDetailService;

    @InjectMocks AuthManager authManager;

    @BeforeEach
    void setUp() {
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(roleRepository.findByNameIn(anyList())).thenAnswer(inv -> {
            List<Role> found = new ArrayList<>();
            for (String name : inv.<List<String>>getArgument(0)) {
                Role role = new Role();
                role.setName(name);
                found.add(role);
            }
            return found;
        });
        when(internalClientUtils.makeHmacRequest(any(), any(), any(), any(), any()))
                .thenReturn(ResponseEntity.ok("{\"instituteId\":\"created-now\",\"instituteName\":\"New\"}"));
        User created = new User();
        created.setId("u-new");
        created.setUsername("owner");
        when(authService.createUser(any(RegisterRequest.class), any(), any())).thenReturn(created);
        when(refreshTokenService.createRefreshToken(any(), any())).thenReturn(new RefreshToken());
    }

    private static RegisterRequest request(String email, List<String> roles, String instituteIdInBody) {
        InstituteInfoDTO institute = new InstituteInfoDTO();
        institute.setId(instituteIdInBody);
        RegisterRequest request = new RegisterRequest();
        request.setEmail(email);
        request.setFullName("Owner");
        request.setUserName("owner");
        request.setUserRoles(roles);
        request.setInstitute(institute);
        return request;
    }

    @SuppressWarnings("unchecked")
    private Set<UserRole> rolesWritten() {
        ArgumentCaptor<Set<UserRole>> captor = ArgumentCaptor.forClass(Set.class);
        verify(authService).createUser(any(RegisterRequest.class), captor.capture(), any());
        return captor.getValue();
    }

    @Test
    void adminIsGrantedOnlyOnTheInstituteCreatedByThisRequest() {
        authManager.registerRootUser(request("owner@example.com", List.of("ADMIN"), "someone-elses-institute"));

        Set<UserRole> roles = rolesWritten();
        assertEquals(1, roles.size());
        UserRole only = roles.iterator().next();
        assertEquals("ADMIN", only.getRole().getName());
        assertEquals("created-now", only.getInstituteId());
    }

    @Test
    void rolesNamedInTheBodyAreIgnored() {
        for (List<String> sent : List.of(List.of("SUPER_ADMIN", "TEACHER", "STUDENT"), List.<String>of())) {
            org.mockito.Mockito.clearInvocations(authService);
            authManager.registerRootUser(request("owner@example.com", sent, null));
            Set<UserRole> roles = rolesWritten();
            assertEquals(1, roles.size());
            assertEquals("ADMIN", roles.iterator().next().getRole().getName());
        }
        org.mockito.Mockito.clearInvocations(authService);
        authManager.registerRootUser(request("owner@example.com", null, null));
        assertEquals("ADMIN", rolesWritten().iterator().next().getRole().getName());
    }

    @Test
    void existingEmailIsRefusedBeforeAnInstituteIsCreated() {
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("admin@example.com"))
                .thenReturn(Optional.of(new User()));

        // plain, upper case and padded: the spellings main refuses today
        for (String spelled : List.of("admin@example.com", "Admin@Example.com", "  admin@example.com ")) {
            VacademyException refused = assertThrows(VacademyException.class,
                    () -> authManager.registerRootUser(request(spelled, List.of("ADMIN"), null)), spelled);
            assertEquals(HttpStatus.CONFLICT, refused.getStatus());
        }
        verify(internalClientUtils, never()).makeHmacRequest(any(), any(), any(), any(), any());
        verify(authService, never()).createUser(any(RegisterRequest.class), any(), any());
        verify(refreshTokenService, never()).createRefreshToken(any(), any());
    }
}
