package vacademy.io.community_service.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.util.AntPathMatcher;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.community_service.feature.diagnostics.controller.DiagnosticsController;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Mirrors the filter chain order: SIGNED_IN_PATHS first, then ALLOWED_PATHS, then "authenticated".
 */
class PresentationAndDiagnosticsRoutesTest {

    private static final AntPathMatcher MATCHER = new AntPathMatcher();

    private static boolean open(String path) {
        if (Arrays.stream(CommunityApplicationSecurityConfig.SIGNED_IN_PATHS).anyMatch(p -> MATCHER.match(p, path))) {
            return false;
        }
        return Arrays.stream(CommunityApplicationSecurityConfig.ALLOWED_PATHS).anyMatch(p -> MATCHER.match(p, path));
    }

    @Test
    @DisplayName("presentation editing, the deck list, session history and content-structure writes need sign-in")
    void signedInRoutes() {
        assertThat(open("/community-service/presentation/add-presentation")).isFalse();
        assertThat(open("/community-service/presentation/edit-presentation")).isFalse();
        assertThat(open("/community-service/presentation/get-all-presentation")).isFalse();
        assertThat(open("/community-service/presentation/add-slide/after/3")).isFalse();
        assertThat(open("/community-service/engage/admin/presentation/p-1/sessions")).isFalse();
        assertThat(open("/community-service/subject/add-chapters")).isFalse();
        assertThat(open("/community-service/subject/add-chapters-with-topics")).isFalse();
        assertThat(open("/community-service/chapter/add-topics")).isFalse();
        assertThat(open("/community-service/diagnostics/kubernetes/pods")).isFalse();
        assertThat(open("/community-service/diagnostics/kubernetes/events")).isFalse();
        assertThat(open("/community-service/diagnostics/database")).isFalse();
        assertThat(open("/community-service/diagnostics/redis")).isFalse();
        assertThat(open("/community-service/diagnostics/connectivity")).isFalse();
    }

    @Test
    @DisplayName("the public viewer, live engage, reads and the health dashboard stay open")
    void openRoutes() {
        assertThat(open("/community-service/presentation/get-presentation")).isTrue();
        assertThat(open("/community-service/engage/learner/join")).isTrue();
        assertThat(open("/community-service/engage/admin/create")).isTrue();
        assertThat(open("/community-service/subject/all-chapters")).isTrue();
        assertThat(open("/community-service/chapter/all-topics")).isTrue();
        assertThat(open("/community-service/diagnostics/health")).isTrue();
        assertThat(open("/community-service/diagnostics/health/quick")).isTrue();
    }

    @Test
    @DisplayName("detailed diagnostics are for platform super admins (allowlist unset in tests: refused)")
    void detailedDiagnosticsNeedSuperAdmin() {
        DiagnosticsController controller = new DiagnosticsController();
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("admin-1");
        dto.setUsername("admin-1");
        dto.setAuthorities(List.of("ADMIN"));
        CustomUserDetails admin = new CustomUserDetails(dto);
        assertThatThrownBy(() -> controller.getKubernetesPodStatus(admin)).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> controller.getKubernetesEvents(admin)).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> controller.getConnectivityStatus(admin)).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> controller.getDatabaseHealth(admin)).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> controller.getRedisHealth(admin)).isInstanceOf(VacademyException.class);
    }
}
