package vacademy.io.notification_service.features.email_billing;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.common.auth.entity.User;
import vacademy.io.notification_service.features.announcements.client.AuthServiceClient;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.service.EmailService;

import java.util.List;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

/** Who hears that emails paused: the contact address, else a few real admins, never our staff. */
class EmailBillingNotifierRecipientsTest {

    private final AuthServiceClient auth = mock(AuthServiceClient.class);
    private final EmailBillingNotifier notifier = new EmailBillingNotifier(mock(JdbcTemplate.class),
            mock(EmailBillingSettings.class), mock(InstituteInternalService.class), mock(EmailService.class), auth);

    private static User admin(String email) {
        User u = new User();
        u.setEmail(email);
        return u;
    }

    private static InstituteInfoDTO institute(String email) {
        InstituteInfoDTO i = new InstituteInfoDTO();
        i.setEmail(email);
        return i;
    }

    @Test
    void theContactAddressWins() {
        assertEquals(List.of("office@school.in"), notifier.recipients("i1", institute(" office@school.in ")));
        verifyNoInteractions(auth);
    }

    @Test
    void withoutOneUpToFiveAdminsButNeverOurOwnStaff() {
        List<User> admins = new java.util.ArrayList<>(List.of(admin("admin-parcham@vacademy.com"),
                admin("ops@vidyayatan.com"), admin("Owner@School.in"), admin("owner@school.in"), admin(""), admin(null)));
        IntStream.range(0, 6).forEach(n -> admins.add(admin("staff" + n + "@school.in")));
        when(auth.getUsersByRole("i1", "ADMIN")).thenReturn(admins);

        assertEquals(List.of("owner@school.in", "staff0@school.in", "staff1@school.in", "staff2@school.in",
                "staff3@school.in"), notifier.recipients("i1", institute(null)));
    }

    @Test
    void onlyOurStaffMeansNobody() {
        when(auth.getUsersByRole("i1", "ADMIN")).thenReturn(List.of(admin("admin-parcham@vacademy.com")));
        assertEquals(List.of(), notifier.recipients("i1", null));
    }
}
