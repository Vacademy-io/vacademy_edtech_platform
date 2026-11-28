package vacademy.io.admin_core_service.features.learner_study_library.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Collection;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class LearnerContentAccessGuardTest {

    private final StudentSessionInstituteGroupMappingRepository repo = mock(StudentSessionInstituteGroupMappingRepository.class);

    private static CustomUserDetails user(String... authorities) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn("u1");
        when(u.isRootUser()).thenReturn(false);
        Collection<GrantedAuthority> auths = List.of(authorities).stream()
                .map(a -> (GrantedAuthority) new SimpleGrantedAuthority(a)).toList();
        doReturn(auths).when(u).getAuthorities();
        return u;
    }

    @Test
    @DisplayName("Off by default: nothing is checked")
    void disabledChecksNothing() {
        new LearnerContentAccessGuard(repo, false).requireEnrolled(user("STUDENT"), "ps-1");
        verifyNoInteractions(repo);
    }

    @Test
    @DisplayName("On: a learner without a live membership is blocked")
    void blocksUnenrolledLearner() {
        when(repo.existsActiveMembership(anyString(), any())).thenReturn(false);
        LearnerContentAccessGuard guard = new LearnerContentAccessGuard(repo, true);
        assertThrows(VacademyException.class, () -> guard.requireEnrolled(user("STUDENT"), "ps-1"));
    }

    @Test
    @DisplayName("On: an enrolled learner passes")
    void allowsEnrolledLearner() {
        when(repo.existsActiveMembership("u1", List.of("ps-1"))).thenReturn(true);
        LearnerContentAccessGuard guard = new LearnerContentAccessGuard(repo, true);
        assertDoesNotThrow(() -> guard.requireEnrolled(user("STUDENT"), "ps-1"));
    }

    @Test
    @DisplayName("On: staff (admin preview) are never checked")
    void staffSkipCheck() {
        LearnerContentAccessGuard guard = new LearnerContentAccessGuard(repo, true);
        assertDoesNotThrow(() -> guard.requireEnrolled(user("STUDENT", "ADMIN"), "ps-1"));
        verifyNoInteractions(repo);
    }
}
