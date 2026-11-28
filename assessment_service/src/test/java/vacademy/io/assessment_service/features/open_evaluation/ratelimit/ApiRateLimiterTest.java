package vacademy.io.assessment_service.features.open_evaluation.ratelimit;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Per-key and per-institute fixed windows, enforced as a per-pod share (spec 11.5). */
class ApiRateLimiterTest {

    /** A clock the test moves by hand. */
    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-01T10:00:00Z");

        void advanceMillis(long ms) {
            now = now.plusMillis(ms);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private static ApiKeyPrincipal key(String keyId, String institute, String tier) {
        return ApiKeyPrincipal.builder().keyId(keyId).instituteId(institute).rateTier(tier)
                .products(List.of("evaluation")).status("ACTIVE").accessEnabled(true).build();
    }

    private static int allowedInBurst(ApiRateLimiter limiter, ApiKeyPrincipal p, ApiRateLimiter.Kind kind, int tries) {
        int ok = 0;
        for (int i = 0; i < tries; i++) {
            if (limiter.acquire(p, kind).allowed()) {
                ok++;
            }
        }
        return ok;
    }

    @Test
    void each_pod_enforces_its_share_of_the_published_limit() {
        ApiRateLimiter limiter = new ApiRateLimiter(new MutableClock(), 2);
        // standard writes: 5/s per key → ceil(5/2) = 3 per pod per second
        assertThat(allowedInBurst(limiter, key("k1", "i1", "standard"), ApiRateLimiter.Kind.WRITE, 10)).isEqualTo(3);
        // reads: 20/s → 10 per pod
        assertThat(allowedInBurst(limiter, key("k2", "i2", "standard"), ApiRateLimiter.Kind.READ, 30)).isEqualTo(10);
    }

    @Test
    void window_resets_after_its_span() {
        MutableClock clock = new MutableClock();
        ApiRateLimiter limiter = new ApiRateLimiter(clock, 1);
        ApiKeyPrincipal p = key("k1", "i1", "standard");
        assertThat(allowedInBurst(limiter, p, ApiRateLimiter.Kind.WRITE, 10)).isEqualTo(5);
        clock.advanceMillis(1_000);
        assertThat(allowedInBurst(limiter, p, ApiRateLimiter.Kind.WRITE, 10)).isEqualTo(5);
    }

    @Test
    void institute_window_caps_many_keys_of_one_institute() {
        ApiRateLimiter limiter = new ApiRateLimiter(new MutableClock(), 1);
        // standard institute writes: 10/s; each key alone may do 5/s.
        int total = 0;
        for (int k = 0; k < 5; k++) {
            total += allowedInBurst(limiter, key("k" + k, "same-inst", "standard"), ApiRateLimiter.Kind.WRITE, 5);
        }
        assertThat(total).isEqualTo(10);
        // another institute is unaffected
        assertThat(limiter.acquire(key("x", "other-inst", "standard"), ApiRateLimiter.Kind.WRITE).allowed()).isTrue();
    }

    @Test
    void a_refusal_gives_back_the_permits_it_took() {
        MutableClock clock = new MutableClock();
        ApiRateLimiter limiter = new ApiRateLimiter(clock, 1);
        // Upload files: 3,000/min per key, 6,000/min per institute. a and b fill the
        // institute window, which starts now.
        assertThat(limiter.acquire(key("a", "inst", "standard"), ApiRateLimiter.Kind.UPLOAD, 3_000).allowed()).isTrue();
        assertThat(limiter.acquire(key("b", "inst", "standard"), ApiRateLimiter.Kind.UPLOAD, 3_000).allowed()).isTrue();

        // 30 s later key c starts its own key window, takes 3,000 from it, then is refused
        // by the full institute window: those 3,000 must go back to c's key window.
        clock.advanceMillis(30_000);
        ApiKeyPrincipal c = key("c", "inst", "standard");
        assertThat(limiter.acquire(c, ApiRateLimiter.Kind.UPLOAD, 3_000).allowed()).isFalse();

        // 31 s later the institute window has rolled over but c's key window has not. Had
        // the refusal kept its permits, c's key window would be full now.
        clock.advanceMillis(31_000);
        assertThat(limiter.acquire(c, ApiRateLimiter.Kind.UPLOAD, 3_000).allowed()).isTrue();
    }

    @Test
    void per_minute_window_holds_across_seconds() {
        MutableClock clock = new MutableClock();
        ApiRateLimiter limiter = new ApiRateLimiter(clock, 1);
        ApiKeyPrincipal p = key("k1", "i1", "standard");
        int ok = 0;
        // 5/s for 30 s would be 150, but the minute window allows 120.
        for (int s = 0; s < 30; s++) {
            ok += allowedInBurst(limiter, p, ApiRateLimiter.Kind.WRITE, 5);
            clock.advanceMillis(1_000);
        }
        assertThat(ok).isEqualTo(120);
    }

    @Test
    void high_and_custom_tiers_get_more_and_unknown_gets_standard() {
        ApiRateLimiter limiter = new ApiRateLimiter(new MutableClock(), 1);
        assertThat(allowedInBurst(limiter, key("h", "ih", "high"), ApiRateLimiter.Kind.WRITE, 50)).isEqualTo(20);
        assertThat(allowedInBurst(limiter, key("c", "ic", "custom"), ApiRateLimiter.Kind.WRITE, 50)).isEqualTo(20);
        assertThat(allowedInBurst(limiter, key("u", "iu", "platinum"), ApiRateLimiter.Kind.WRITE, 50)).isEqualTo(5);
        assertThat(allowedInBurst(limiter, key("n", "in", null), ApiRateLimiter.Kind.WRITE, 50)).isEqualTo(5);
    }

    @Test
    void uploads_count_files_per_minute() {
        ApiRateLimiter limiter = new ApiRateLimiter(new MutableClock(), 2);
        ApiKeyPrincipal p = key("k1", "i1", "standard");
        // 3,000 files/min per key → 1,500 per pod
        assertThat(limiter.acquire(p, ApiRateLimiter.Kind.UPLOAD, 1_400).allowed()).isTrue();
        assertThat(limiter.acquire(p, ApiRateLimiter.Kind.UPLOAD, 200).allowed()).isFalse();
        assertThat(limiter.acquire(p, ApiRateLimiter.Kind.UPLOAD, 100).allowed()).isTrue();
    }

    @Test
    void decision_reports_cluster_level_headers() {
        ApiRateLimiter limiter = new ApiRateLimiter(new MutableClock(), 2);
        ApiRateLimiter.Decision d = limiter.acquire(key("k1", "i1", "standard"), ApiRateLimiter.Kind.WRITE);
        assertThat(d.allowed()).isTrue();
        // tightest window: key writes/s, published 5, pod share 3, 1 used → 2 left × 2 pods = 4
        assertThat(d.limit()).isEqualTo(5);
        assertThat(d.remaining()).isEqualTo(4);
        assertThat(d.resetSeconds()).isEqualTo(1);
    }

    @Test
    void interceptor_classifies_reads_and_writes() {
        assertThat(OpenApiRateLimitInterceptor.kindOf(new MockHttpServletRequest("GET", "/x/exams")))
                .isEqualTo(ApiRateLimiter.Kind.READ);
        assertThat(OpenApiRateLimitInterceptor.kindOf(new MockHttpServletRequest("POST", "/x/candidates/search")))
                .isEqualTo(ApiRateLimiter.Kind.READ);
        assertThat(OpenApiRateLimitInterceptor.kindOf(new MockHttpServletRequest("POST", "/x/credits/quote")))
                .isEqualTo(ApiRateLimiter.Kind.READ);
        assertThat(OpenApiRateLimitInterceptor.kindOf(new MockHttpServletRequest("POST", "/x/exams")))
                .isEqualTo(ApiRateLimiter.Kind.WRITE);
        assertThat(OpenApiRateLimitInterceptor.kindOf(new MockHttpServletRequest("PATCH", "/x/exams/1")))
                .isEqualTo(ApiRateLimiter.Kind.WRITE);
    }
}
