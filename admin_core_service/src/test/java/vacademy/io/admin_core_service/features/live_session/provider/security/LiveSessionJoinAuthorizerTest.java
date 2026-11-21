package vacademy.io.admin_core_service.features.live_session.provider.security;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link LiveSessionJoinAuthorizer} — the P0 join/host guard.
 * Covers: server-derived host role (creator + admin authority), enrolment gate,
 * public-session bypass, and cross-institute isolation.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LiveSessionJoinAuthorizerTest {

    private static final String SCHEDULE_ID = "sch-1";
    private static final String SESSION_ID = "sess-1";
    private static final String INSTITUTE_ID = "inst-1";
    private static final String CREATOR_ID = "creator-1";
    private static final String LEARNER_ID = "learner-1";

    @Mock private SessionScheduleRepository scheduleRepository;
    @Mock private LiveSessionRepository liveSessionRepository;
    @Mock private LiveSessionParticipantRepository participantRepository;
    @Mock private InstituteAccessValidator instituteAccessValidator;
    // Added to LiveSessionJoinAuthorizer after this test was written; without the mock
    // @InjectMocks leaves it null and the payment gate NPEs before any assertion runs.
    @Mock private vacademy.io.admin_core_service.features.live_session.service.LiveSessionPaymentService paymentService;

    @InjectMocks private LiveSessionJoinAuthorizer authorizer;

    private void givenSession(String createdByUserId, String accessLevel) {
        SessionSchedule schedule = SessionSchedule.builder()
                .id(SCHEDULE_ID).sessionId(SESSION_ID).build();
        LiveSession session = LiveSession.builder()
                .id(SESSION_ID).instituteId(INSTITUTE_ID)
                .createdByUserId(createdByUserId).accessLevel(accessLevel).build();
        when(scheduleRepository.findById(SCHEDULE_ID)).thenReturn(Optional.of(schedule));
        when(liveSessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(session));
    }

    private CustomUserDetails user(String userId, String... authorities) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn(userId);
        doReturn(java.util.Arrays.stream(authorities).map(SimpleGrantedAuthority::new).toList())
                .when(u).getAuthorities();
        return u;
    }

    @Test
    void creatorIsHost() {
        givenSession(CREATOR_ID, "private");
        JoinAuthorization auth = authorizer.authorize(SCHEDULE_ID, user(CREATOR_ID), null);
        assertEquals(JoinRole.HOST, auth.role());
        assertEquals(1, auth.role().toZoomRole());
    }

    @Test
    void adminOfThisInstituteIsHost() {
        givenSession(CREATOR_ID, "private");
        // validateUserAccess is a void no-op here → caller is an admin OF this institute.
        JoinAuthorization auth = authorizer.authorize(SCHEDULE_ID, user("admin-9", "ADMIN"), null);
        assertEquals(JoinRole.HOST, auth.role());
    }

    @Test
    void crossInstituteAdminIsNotHost() {
        // Admin authority, but NOT of this session's institute → validateUserAccess throws.
        givenSession(CREATOR_ID, "private");
        doThrow(new VacademyException("Access denied: user does not belong to institute"))
                .when(instituteAccessValidator).validateUserAccess(any(), any());
        when(participantRepository.isUserParticipantOfSession(SESSION_ID, "admin-of-B")).thenReturn(false);

        // Not creator, admin-but-wrong-institute, not enrolled → rejected (definitely not HOST).
        VacademyException ex = assertThrows(VacademyException.class,
                () -> authorizer.authorize(SCHEDULE_ID, user("admin-of-B", "ADMIN"), null));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
    }

    @Test
    void crossInstituteAdminEnrolledIsParticipantNotHost() {
        givenSession(CREATOR_ID, "private");
        doThrow(new VacademyException("Access denied"))
                .when(instituteAccessValidator).validateUserAccess(any(), any());
        when(participantRepository.isUserParticipantOfSession(SESSION_ID, "admin-of-B")).thenReturn(true);

        JoinAuthorization auth = authorizer.authorize(SCHEDULE_ID, user("admin-of-B", "ADMIN"), null);
        assertEquals(JoinRole.PARTICIPANT, auth.role()); // downgraded — no cross-institute ZAK
    }

    @Test
    void enrolledLearnerIsParticipant() {
        givenSession(CREATOR_ID, "private");
        when(participantRepository.isUserParticipantOfSession(SESSION_ID, LEARNER_ID)).thenReturn(true);
        JoinAuthorization auth = authorizer.authorize(SCHEDULE_ID, user(LEARNER_ID, "STUDENT"), null);
        assertEquals(JoinRole.PARTICIPANT, auth.role());
        assertEquals(0, auth.role().toZoomRole());
    }

    @Test
    void nonEnrolledLearnerIsRejected() {
        givenSession(CREATOR_ID, "private");
        when(participantRepository.isUserParticipantOfSession(SESSION_ID, LEARNER_ID)).thenReturn(false);
        VacademyException ex = assertThrows(VacademyException.class,
                () -> authorizer.authorize(SCHEDULE_ID, user(LEARNER_ID, "STUDENT"), null));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
    }

    @Test
    void publicSessionAllowsNonEnrolledAsParticipant() {
        givenSession(CREATOR_ID, "public");
        when(participantRepository.isUserParticipantOfSession(SESSION_ID, LEARNER_ID)).thenReturn(false);
        JoinAuthorization auth = authorizer.authorize(SCHEDULE_ID, user(LEARNER_ID, "STUDENT"), null);
        assertEquals(JoinRole.PARTICIPANT, auth.role());
    }

    @Test
    void instituteMismatchIsRejected() {
        givenSession(CREATOR_ID, "private");
        VacademyException ex = assertThrows(VacademyException.class,
                () -> authorizer.authorize(SCHEDULE_ID, user(LEARNER_ID, "STUDENT"), "other-institute"));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
    }

    @Test
    void nullUserIsUnauthorized() {
        VacademyException ex = assertThrows(VacademyException.class,
                () -> authorizer.authorize(SCHEDULE_ID, null, null));
        assertEquals(HttpStatus.UNAUTHORIZED, ex.getStatus());
    }
}
