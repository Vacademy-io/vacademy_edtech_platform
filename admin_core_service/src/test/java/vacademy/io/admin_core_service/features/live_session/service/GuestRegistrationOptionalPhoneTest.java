package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.live_session.entity.SessionGuestRegistration;
import vacademy.io.admin_core_service.features.live_session.repository.SessionGuestRegistrationRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A registration form may leave Phone Number optional. The phone widget on the learner form keeps
 * the selected country's dial code in the box, so a skipped field arrives as {@code "+91"} — a
 * value every learner who skipped it shares. Registering anyone BY that dial code would hand the
 * second such learner the first one's registration, and their answers would overwrite theirs.
 */
class GuestRegistrationOptionalPhoneTest {

    private static final String SESSION = "sess-1";

    private RegistrationService service;
    private SessionGuestRegistrationRepository repository;

    @BeforeEach
    void setUp() {
        service = new RegistrationService();
        repository = mock(SessionGuestRegistrationRepository.class);
        ReflectionTestUtils.setField(service, "sessionGuestRegistration", repository);

        when(repository.findBySessionIdAndEmail(anyString(), anyString())).thenReturn(Optional.empty());
        when(repository.findBySessionIdAndMobileNumber(anyString(), anyString())).thenReturn(Optional.empty());
        when(repository.save(any(SessionGuestRegistration.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
    }

    private SessionGuestRegistration saved() {
        ArgumentCaptor<SessionGuestRegistration> captor =
                ArgumentCaptor.forClass(SessionGuestRegistration.class);
        verify(repository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("a skipped optional phone is not stored or looked up as an identity")
    void dialCodeOnlyIsNotAnIdentity() {
        service.registerGuest("asha@example.com", "+91", SESSION);

        assertNull(saved().getMobileNumber(), "a country code identifies nobody");
        verify(repository, never()).findBySessionIdAndMobileNumber(anyString(), anyString());
    }

    @Test
    @DisplayName("two learners who both skip the phone field stay two registrations")
    void twoSkippedPhonesDoNotCollide() {
        SessionGuestRegistration first = SessionGuestRegistration.builder()
                .id("guest-1")
                .sessionId(SESSION)
                .email("asha@example.com")
                .build();
        // Nothing can be stored under the bare dial code any more, but a row from before this
        // guard must not be matched either.
        when(repository.findBySessionIdAndMobileNumber(SESSION, "91")).thenReturn(Optional.of(first));

        String secondId = service.registerGuest("bharat@example.com", "+91", SESSION);

        assertNotEquals("guest-1", secondId, "the second learner must get their own registration");
    }

    @Test
    @DisplayName("a real number is still an identity")
    void realNumberStillRegisters() {
        service.registerGuest(null, "+91 98765-43210", SESSION);

        assertEquals("919876543210", saved().getMobileNumber());
    }

    @Test
    @DisplayName("a form with no email and only a skipped phone is rejected, not half-registered")
    void noIdentityAtAllIsRejected() {
        assertThrows(RuntimeException.class, () -> service.registerGuest("  ", "+91", SESSION));
        verify(repository, never()).save(any(SessionGuestRegistration.class));
    }
}
