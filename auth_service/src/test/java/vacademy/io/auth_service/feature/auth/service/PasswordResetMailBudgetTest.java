package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The forgot-password mail used to make no admin_core call. Its branding lookups are now
 * best-effort with a short budget: a slow or failing admin_core sends the mail unbranded,
 * quickly, with the same username and password.
 */
class PasswordResetMailBudgetTest {

    private UserRepository users;
    private NotificationService notifications;
    private InstituteInternalService institutes;
    private PasswordResetManager manager;

    @BeforeEach
    void setUp() {
        users = mock(UserRepository.class);
        notifications = mock(NotificationService.class);
        OriginInstituteResolver origin = mock(OriginInstituteResolver.class);
        institutes = mock(InstituteInternalService.class);
        manager = new PasswordResetManager(users, notifications, origin);
        ReflectionTestUtils.setField(manager, "instituteInternalService", institutes);

        UserRole role = new UserRole();
        role.setInstituteId("inst-1");
        User user = new User();
        user.setId("user-1");
        user.setFullName("Asha Patil");
        user.setUsername("asha01");
        user.setPassword("pw-123");
        user.setRoles(Set.of(role));
        when(users.findMostRecentUserByEmailAndRoleStatusAndRoleNames(eq("asha@example.com"), anyList(), anyList()))
                .thenReturn(Optional.of(user));
        when(origin.chooseInstituteIdFor(anyCollection())).thenReturn("inst-1");
        when(notifications.sendGenericHtmlMailViaUnifiedAsBoolean(any(), anyString())).thenReturn(true);
    }

    private String sentBody() {
        ArgumentCaptor<GenericEmailRequest> mail = ArgumentCaptor.forClass(GenericEmailRequest.class);
        verify(notifications).sendGenericHtmlMailViaUnifiedAsBoolean(mail.capture(), eq("inst-1"));
        return mail.getValue().getBody();
    }

    @Test
    void institute_name_signs_the_mail_when_admin_core_answers() {
        InstituteInfoDTO info = new InstituteInfoDTO();
        info.setInstituteName("Sample Classes");
        when(institutes.getInstituteByInstituteId("inst-1")).thenReturn(info);

        manager.sendPasswordToUser("asha@example.com", "LEARNER");

        String body = sentBody();
        assertTrue(body.contains("Sample Classes"));
        assertTrue(body.contains("asha01") && body.contains("pw-123"));
    }

    @Test
    void a_hung_admin_core_does_not_hold_the_reset() {
        when(institutes.getInstituteByInstituteId("inst-1")).thenAnswer(inv -> {
            Thread.sleep(20_000);
            return new InstituteInfoDTO();
        });

        long start = System.currentTimeMillis();
        manager.sendPasswordToUser("asha@example.com", "LEARNER");
        long took = System.currentTimeMillis() - start;

        assertTrue(took < 10_000, "reset waited " + took + " ms");
        String body = sentBody();
        assertTrue(body.contains("asha01") && body.contains("pw-123"));
        assertFalse(body.contains("Sample Classes"));
    }

    @Test
    void a_failing_admin_core_still_sends_the_mail() {
        when(institutes.getInstituteByInstituteId("inst-1")).thenThrow(new RuntimeException("admin-core down"));

        assertEquals("Email sent successfully", manager.sendPasswordToUser("asha@example.com", "LEARNER"));
        assertTrue(sentBody().contains("pw-123"));
    }
}
