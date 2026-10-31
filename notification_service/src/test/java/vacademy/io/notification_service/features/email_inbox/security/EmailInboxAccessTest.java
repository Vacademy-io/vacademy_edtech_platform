package vacademy.io.notification_service.features.email_inbox.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;

class EmailInboxAccessTest {

    private static CustomUserDetails user(String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        doReturn("u-1").when(user).getUserId();
        List<SimpleGrantedAuthority> list = Arrays.stream(authorities).map(SimpleGrantedAuthority::new).toList();
        doReturn(list).when(user).getAuthorities();
        return user;
    }

    @Test
    void adminTeacherAndCustomRolesPass() {
        assertThatCode(() -> EmailInboxAccess.requireStaff(user("ADMIN"), "inst-1", "inst-1")).doesNotThrowAnyException();
        assertThatCode(() -> EmailInboxAccess.requireStaff(user("TEACHER"), "inst-1", "inst-1")).doesNotThrowAnyException();
        assertThatCode(() -> EmailInboxAccess.requireStaff(user("ACADEMIC COORDINATOR"), "inst-1", "inst-1")).doesNotThrowAnyException();
        assertThatCode(() -> EmailInboxAccess.requireStaff(user("STUDENT", "ADMIN"), "inst-1", "inst-1")).doesNotThrowAnyException();
    }

    @Test
    void learnersAndRolelessCallersAreRefused() {
        assertThatThrownBy(() -> EmailInboxAccess.requireStaff(user("STUDENT"), "inst-1", "inst-1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("STAFF_REQUIRED");
        assertThatThrownBy(() -> EmailInboxAccess.requireStaff(user("STUDENT", "TEACHER"), "inst-1", "inst-1"))
                .hasMessageContaining("STAFF_REQUIRED");
        assertThatThrownBy(() -> EmailInboxAccess.requireStaff(user(), "inst-1", "inst-1"))
                .hasMessageContaining("STAFF_REQUIRED");
    }

    @Test
    void theInstituteMustBeTheTokensInstitute() {
        assertThatThrownBy(() -> EmailInboxAccess.requireStaff(user("ADMIN"), "inst-1", "inst-2"))
                .hasMessageContaining("INSTITUTE_MISMATCH");
        assertThatThrownBy(() -> EmailInboxAccess.requireStaff(user("ADMIN"), null, "inst-1"))
                .hasMessageContaining("INSTITUTE_MISMATCH");
        assertThatThrownBy(() -> EmailInboxAccess.requireStaff(null, "inst-1", "inst-1"))
                .hasMessageContaining("UNAUTHENTICATED");
    }
}
