package vacademy.io.community_service.feature.bbb;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The BBB pool routes (health check, start/stop) are for the Super Admin portal only, and the
 * server slug reaches the GitHub workflow dispatch only when it is "all" or a pool slug.
 */
class BbbHealthCheckAccessTest {

    private static CustomUserDetails instituteAdmin() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("not-on-the-allowlist");
        dto.setUsername("admin@example.com");
        dto.setFullName("Admin");
        dto.setAuthorities(List.of("ADMIN"));
        return new CustomUserDetails(dto);
    }

    private static void assertForbidden(Runnable call) {
        assertThatThrownBy(call::run)
                .isInstanceOf(VacademyException.class)
                .satisfies(e -> assertThat(((VacademyException) e).getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    @DisplayName("every BBB pool route refuses a caller who is not a platform super admin")
    void routesNeedSuperAdmin() {
        BbbHealthCheckService service = mock(BbbHealthCheckService.class);
        BbbHealthCheckController controller = new BbbHealthCheckController(service);

        for (CustomUserDetails caller : new CustomUserDetails[] { null, instituteAdmin() }) {
            assertForbidden(() -> controller.triggerHealthCheck(caller));
            assertForbidden(() -> controller.triggerPoolHealthCheck(caller, true));
            assertForbidden(() -> controller.triggerServerAction(caller, "start"));
            assertForbidden(() -> controller.triggerPoolAction(caller, "start", "all", 2));
        }
        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("a server slug outside a-z, 0-9 and - is refused before any dispatch")
    void slugIsValidated() {
        BbbHealthCheckService service = new BbbHealthCheckService();
        for (String slug : new String[] { "x\",\"ref\":\"evil", "bbb-pool-1; id", "$(id)", "BBB-POOL-1", "", null,
                "a".repeat(41) }) {
            Map<String, Object> result = service.triggerPoolAction("start", slug, 1);
            assertThat(result.get("error")).as(String.valueOf(slug)).asString().startsWith("Invalid serverSlug");
        }
        assertThat(service.triggerPoolAction("reboot", "all", 1).get("error")).asString()
                .startsWith("Invalid action");
        // Valid input gets past validation (and stops at the missing GitHub token in tests).
        assertThat(service.triggerPoolAction("start", "bbb-pool-2", 1).get("error"))
                .isEqualTo("GH_ACTION_TOKEN not configured");
        assertThat(service.triggerPoolAction("stop", "all", 0).get("error"))
                .isEqualTo("GH_ACTION_TOKEN not configured");
    }

    @Test
    @DisplayName("the dispatch body is JSON with string inputs")
    void dispatchBodyIsJson() throws Exception {
        JsonNode body = new ObjectMapper().readTree(BbbHealthCheckService.dispatchBody("start", "bbb-pool-1", 2));
        assertThat(body.get("ref").asText()).isEqualTo("main");
        assertThat(body.get("inputs").get("action").asText()).isEqualTo("start");
        assertThat(body.get("inputs").get("server_slug").asText()).isEqualTo("bbb-pool-1");
        assertThat(body.get("inputs").get("server_count").isTextual()).isTrue();
        assertThat(body.get("inputs").get("server_count").asText()).isEqualTo("2");
        assertThat(body.get("inputs").size()).isEqualTo(3);
    }
}
