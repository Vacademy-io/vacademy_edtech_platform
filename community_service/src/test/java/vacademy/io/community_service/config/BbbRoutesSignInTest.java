package vacademy.io.community_service.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.util.AntPathMatcher;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

/** /community-service/bbb/** is not in the open-path list, so it falls to "authenticated". */
class BbbRoutesSignInTest {

    private static final AntPathMatcher MATCHER = new AntPathMatcher();

    private static boolean open(String path) {
        String[] allowed = (String[]) ReflectionTestUtils.getField(CommunityApplicationSecurityConfig.class,
                "ALLOWED_PATHS");
        return Arrays.stream(allowed).anyMatch(pattern -> MATCHER.match(pattern, path));
    }

    @Test
    @DisplayName("BBB pool routes need sign-in; the public status and diagnostics routes stay open")
    void bbbRoutesAreNotOpen() {
        assertThat(open("/community-service/bbb/health-check")).isFalse();
        assertThat(open("/community-service/bbb/pool/health-check")).isFalse();
        assertThat(open("/community-service/bbb/server")).isFalse();
        assertThat(open("/community-service/bbb/pool/action")).isFalse();

        assertThat(open("/community-service/diagnostics/health")).isTrue();
        assertThat(open("/community-service/public/v1/status/incidents")).isTrue();
        assertThat(open("/community-service/platform-health/status")).isTrue();
    }
}
