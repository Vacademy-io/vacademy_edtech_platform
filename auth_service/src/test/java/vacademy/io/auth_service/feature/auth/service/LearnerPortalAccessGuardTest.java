package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.OriginInstituteResolver;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A white-label learner portal admits only its own institute's learners; the shared portal, calls
 * that send no portal id, and an unresolvable shared host keep the old "any student" behaviour.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerPortalAccessGuardTest {

    private static final String SHARED = "shared-inst";
    private static final String SHIKSHA = "shiksha-inst";
    private static final List<String> ACTIVE = List.of("ACTIVE");

    @Mock OriginInstituteResolver resolver;
    @Mock UserRoleRepository userRoleRepository;
    @InjectMocks LearnerPortalAccessGuard guard;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(guard, "sharedHosts", "learner.vacademy.io");
        ReflectionTestUtils.setField(guard, "enabled", true);
        when(resolver.resolveInstituteIdFromHost("learner.vacademy.io")).thenReturn(SHARED);
    }

    private void membership(String instituteId, boolean member) {
        when(userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                "u1", instituteId, List.of("STUDENT", "PARENT"), ACTIVE))
                .thenReturn(member ? Optional.of(new UserRole()) : Optional.empty());
    }

    @Test
    void learnerOfAnotherInstituteIsRefusedOnAWhiteLabelPortal() {
        membership(SHIKSHA, false);
        VacademyException ex = assertThrows(VacademyException.class,
                () -> guard.assertUserBelongsToPortal(SHIKSHA, "u1", ACTIVE));
        assertEquals(LearnerPortalAccessGuard.NOT_A_MEMBER_MESSAGE, ex.getMessage());
    }

    @Test
    void learnerOfThePortalInstituteIsAdmitted() {
        membership(SHIKSHA, true);
        assertDoesNotThrow(() -> guard.assertUserBelongsToPortal(SHIKSHA, "u1", ACTIVE));
    }

    @Test
    void sharedPortalAdmitsEveryInstitutesLearners() {
        membership(SHARED, false);
        assertDoesNotThrow(() -> guard.assertUserBelongsToPortal(SHARED, "u1", ACTIVE));
        verify(userRoleRepository, never()).findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                anyString(), anyString(), anyList(), anyList());
    }

    @Test
    void noPortalIdMeansNoScoping() {
        assertDoesNotThrow(() -> guard.assertUserBelongsToPortal(null, "u1", ACTIVE));
        assertDoesNotThrow(() -> guard.assertUserBelongsToPortal("  ", "u1", ACTIVE));
        assertFalse(guard.appliesTo(null));
    }

    @Test
    void standsDownWhenTheSharedHostCannotBeResolved() {
        when(resolver.resolveInstituteIdFromHost(any())).thenReturn(null);
        membership(SHIKSHA, false);
        assertDoesNotThrow(() -> guard.assertUserBelongsToPortal(SHIKSHA, "u1", ACTIVE));
        assertFalse(guard.appliesTo(SHIKSHA));
    }

    @Test
    void killSwitchRestoresTheOldBehaviour() {
        ReflectionTestUtils.setField(guard, "enabled", false);
        membership(SHIKSHA, false);
        assertDoesNotThrow(() -> guard.assertUserBelongsToPortal(SHIKSHA, "u1", ACTIVE));
    }

    @Test
    void appliesOnlyToWhiteLabelPortals() {
        assertTrue(guard.appliesTo(SHIKSHA));
        assertFalse(guard.appliesTo(SHARED));
    }

    @Test
    void otpStatusesAreWhatTheCallerPasses() {
        List<String> otp = List.of("ACTIVE", "INVITED");
        when(userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                "u1", SHIKSHA, List.of("STUDENT", "PARENT"), otp)).thenReturn(Optional.of(new UserRole()));
        assertDoesNotThrow(() -> guard.assertUserBelongsToPortal(SHIKSHA, "u1", otp));
    }
}
