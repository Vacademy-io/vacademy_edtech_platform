package vacademy.io.auth_service.feature.institute_oauth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InstituteOAuthClientAccessGuardTest {

    UserRoleRepository roles;
    InstituteOAuthClientAccessGuard guard;

    @BeforeEach
    void setUp() {
        roles = mock(UserRoleRepository.class);
        when(roles.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(anyString(), anyString(), anyList(), anyList()))
                .thenReturn(Optional.empty());
        when(roles.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses("admin-1", "stemx", List.of("ADMIN"), List.of("ACTIVE")))
                .thenReturn(Optional.of(new UserRole()));
        guard = new InstituteOAuthClientAccessGuard(roles);
    }

    static CustomUserDetails user(String userId, boolean root) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(userId);
        when(user.isRootUser()).thenReturn(root);
        return user;
    }

    @Test
    void activeAdminOfTheInstituteIsAllowed() {
        assertThatCode(() -> guard.requireInstituteAdmin(user("admin-1", false), "stemx")).doesNotThrowAnyException();
    }

    @Test
    void rootFlagIsNotABypass() {
        assertThatThrownBy(() -> guard.requireInstituteAdmin(user("someone", true), "stemx"))
                .isInstanceOf(VacademyException.class);
    }

    @Test
    void adminOfAnotherInstituteIsRefused() {
        assertThatThrownBy(() -> guard.requireInstituteAdmin(user("admin-1", false), "other-institute"))
                .isInstanceOf(VacademyException.class);
    }

    @Test
    void missingUserOrInstituteIsRefused() {
        assertThatThrownBy(() -> guard.requireInstituteAdmin(null, "stemx")).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> guard.requireInstituteAdmin(user(null, true), "stemx")).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> guard.requireInstituteAdmin(user("admin-1", false), " ")).isInstanceOf(VacademyException.class);
    }
}
