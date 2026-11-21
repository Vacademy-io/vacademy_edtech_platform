package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** An engine alerts several team members, in the order they were picked, and only this institute's staff. */
class EngagementNotifyContactsLimitTest {

    private EngagementEngineService service;
    private AuthService auth;

    @BeforeEach
    void setUp() {
        service = mock(EngagementEngineService.class, Mockito.CALLS_REAL_METHODS);
        auth = mock(AuthService.class);
        ReflectionTestUtils.setField(service, "authService", auth);
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
    }

    private String validate(List<String> ids) {
        return ReflectionTestUtils.invokeMethod(service, "validNotifyUsersJson", ids, "i1");
    }

    private void allStaff(List<String> ids) {
        Map<String, List<String>> roles = ids.stream().collect(Collectors.toMap(i -> i, i -> List.of("ADMIN")));
        when(auth.getInstituteRoles(eq("i1"), anyList())).thenReturn(roles);
    }

    @Test
    @DisplayName("several contacts are kept, in the order picked, so the first stays the meeting owner")
    void keepsSeveralInOrder() {
        allStaff(List.of("b", "a"));
        assertEquals("[\"b\",\"a\"]", validate(List.of("b", "a")));
    }

    @Test
    @DisplayName("the most allowed pass; one more is refused with the limit in the message")
    void enforcesTheLimit() {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < EngagementEngineService.MAX_NOTIFY_USERS; i++) ids.add("u" + i);
        allStaff(ids);
        assertNotNull(validate(ids));

        ids.add("one-too-many");
        var ex = assertThrows(VacademyException.class, () -> validate(ids));
        assertTrue(ex.getMessage().contains(String.valueOf(EngagementEngineService.MAX_NOTIFY_USERS)), ex.getMessage());
    }

    @Test
    @DisplayName("someone not on the team is still refused when others are valid")
    void stillChecksEachPerson() {
        when(auth.getInstituteRoles(eq("i1"), anyList()))
                .thenReturn(Map.of("staff", List.of("ADMIN"), "learner", List.of("STUDENT")));
        var ex = assertThrows(VacademyException.class, () -> validate(List.of("staff", "learner")));
        assertTrue(ex.getMessage().contains("learner"), ex.getMessage());
    }
}
