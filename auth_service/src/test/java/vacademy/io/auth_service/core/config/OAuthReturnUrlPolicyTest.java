package vacademy.io.auth_service.core.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.client.ResourceAccessException;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

class OAuthReturnUrlPolicyTest {

    /** Domain-routing rows as domain|subdomain, shaped like production's. */
    private static final Set<String> ROWS = Set.of(
            "shikshanation.com|admin",
            "parchamclasses.in|*",
            "parchamclasses.in|www",
            "co.in|the7cs");

    private final List<String> lookups = new ArrayList<>();
    private final AtomicBoolean adminCoreDown = new AtomicBoolean(false);

    private final OAuthReturnUrlPolicy policy =
            new OAuthReturnUrlPolicy("http://admin-core", "https://dash.vacademy.io", "vacademy.io, vimotion.ai") {
                @Override
                boolean rowExists(String domain, String subdomain) {
                    lookups.add(domain + "|" + subdomain);
                    if (adminCoreDown.get()) {
                        throw new ResourceAccessException("timeout");
                    }
                    return ROWS.contains(domain + "|" + subdomain)
                            || ROWS.contains(domain + "|*");
                }
            };

    private boolean allowed(String url) {
        return policy.isAllowed(url, host -> false);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://dash.vacademy.io/login/oauth/redirect?assess=false&lms=false",
            "https://shiksha-nation.vacademy.io/login/oauth/learner",
            "https://vacademy.io/x",
            "https://app.vimotion.ai/",
            "https://DASH.VACADEMY.IO./login",
            "http://localhost:5173/login",
            "https://127.0.0.1:5173/login",
            "https://admin.shikshanation.com/login",
            "https://parchamclasses.in/login/oauth/learner",
            "https://www.parchamclasses.in/login",
            "https://anything.parchamclasses.in/login",
            "https://the7cs.co.in/login"
    })
    void knownHostsAreAllowed(String url) {
        assertThat(allowed(url)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://example.com/login",
            "https://vacademy.io.example.com/login",
            "https://notvacademy.io/login",
            "https://localhost.example.com/login",
            "https://learner.shikshanation.com/login",
            "https://shikshanation.com/login",
            "https://other.co.in/login",
            "http://dash.vacademy.io/login",
            "http://admin.shikshanation.com/login",
            "https://dash.vacademy.io@example.com/login",
            "https://user:pass@dash.vacademy.io/login",
            "https://example.com\\@dash.vacademy.io/login",
            "javascript:alert(1)",
            "io.vacademy.app://login",
            "//dash.vacademy.io/login",
            "not a url",
            ""
    })
    void everythingElseIsRefused(String url) {
        assertThat(allowed(url)).isFalse();
    }

    @Test
    void nullIsRefused() {
        assertThat(allowed(null)).isFalse();
    }

    @Test
    void theCallerCanTrustAHostForThisLogin() {
        assertThat(policy.isAllowed("https://signup.example.com/start", "signup.example.com"::equals)).isTrue();
        assertThat(policy.isAllowed("http://signup.example.com/start", "signup.example.com"::equals)).isFalse();
    }

    @Test
    void anAnswerIsCached() {
        allowed("https://admin.shikshanation.com/a");
        allowed("https://admin.shikshanation.com/b");

        assertThat(lookups).containsExactly("shikshanation.com|admin");
    }

    @Test
    void anOutageRefusesAHostNeverSeen() {
        adminCoreDown.set(true);

        assertThat(allowed("https://admin.shikshanation.com/login")).isFalse();
    }

    @Test
    void anOutageIsNotRememberedAsAnUnknownHost() {
        adminCoreDown.set(true);
        allowed("https://admin.shikshanation.com/login");
        adminCoreDown.set(false);

        assertThat(allowed("https://admin.shikshanation.com/login")).isTrue();
    }

    @Test
    void platformHostsNeedNoLookup() {
        adminCoreDown.set(true);

        assertThat(allowed("https://dash.vacademy.io/login")).isTrue();
        assertThat(lookups).isEmpty();
    }
}
