package vacademy.io.community_service.feature.session.manager;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class PresenterKeyServiceTest {

    private static final class MovableClock extends Clock {
        private Instant now = Instant.parse("2026-11-04T08:00:00Z");

        void advance(Duration by) {
            now = now.plus(by);
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
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

    private final MovableClock clock = new MovableClock();
    private final PresenterKeyService service = new PresenterKeyService(clock);

    private boolean allows(String sessionId, String presentedKey) {
        return service.allows(sessionId, PresenterKeyService.hash(presentedKey));
    }

    @Test
    void keyIs256BitsAndUrlSafe() {
        String key = service.issue("s1");

        assertThat(key).matches("[A-Za-z0-9_-]+");
        assertThat(Base64.getUrlDecoder().decode(key)).hasSize(32);
        assertThat(service.issue("s2")).isNotEqualTo(key);
    }

    @Test
    void sessionWithoutAKeyIsNotChecked() {
        assertThat(service.hasKey("plain")).isFalse();
        assertThat(allows("plain", null)).isTrue();
        assertThat(allows("plain", "anything")).isTrue();
    }

    @Test
    void nullSessionIdIsLeftForTheCallerToReport() {
        assertThat(service.hasKey(null)).isFalse();
        assertThat(allows(null, null)).isTrue();
        service.retire(null);
    }

    @Test
    void keyedSessionNeedsItsOwnKey() {
        String key = service.issue("s1");
        String otherKey = service.issue("s2");

        assertThat(service.hasKey("s1")).isTrue();
        assertThat(allows("s1", key)).isTrue();
        assertThat(allows("s1", null)).isFalse();
        assertThat(allows("s1", "")).isFalse();
        assertThat(allows("s1", "wrong")).isFalse();
        assertThat(allows("s1", otherKey)).isFalse();
        assertThat(allows("s1", key + "x")).isFalse();
    }

    @Test
    void finishedSessionKeepsItsKeyUntilGraceEnds() {
        String key = service.issue("s1");
        service.retire("s1");

        clock.advance(PresenterKeyService.FINISHED_GRACE.minusSeconds(1));
        assertThat(allows("s1", null)).isFalse();
        assertThat(allows("s1", key)).isTrue();

        clock.advance(Duration.ofSeconds(1));
        assertThat(service.hasKey("s1")).isFalse();
    }

    @Test
    void graceOutlastsTheHourlySessionSweep() {
        assertThat(PresenterKeyService.FINISHED_GRACE).isGreaterThan(Duration.ofHours(1));
        assertThat(PresenterKeyService.UNFINISHED_TTL).isGreaterThan(Duration.ofHours(25));
    }

    @Test
    void repeatedRetireDoesNotExtend() {
        service.issue("s1");
        service.retire("s1");
        clock.advance(PresenterKeyService.FINISHED_GRACE.minusSeconds(1));
        service.retire("s1");

        clock.advance(Duration.ofSeconds(1));
        assertThat(service.hasKey("s1")).isFalse();
    }

    @Test
    void retireCannotLengthenAKeyAboutToLapse() {
        service.issue("s1");
        clock.advance(PresenterKeyService.UNFINISHED_TTL.minusSeconds(1));
        service.retire("s1");

        clock.advance(Duration.ofSeconds(1));
        assertThat(service.hasKey("s1")).isFalse();
    }

    @Test
    void unfinishedSessionLapsesAfterItsTtl() {
        service.issue("s1");

        clock.advance(PresenterKeyService.UNFINISHED_TTL.minusSeconds(1));
        assertThat(service.hasKey("s1")).isTrue();

        clock.advance(Duration.ofSeconds(1));
        assertThat(service.hasKey("s1")).isFalse();
    }

    @Test
    void issuingPurgesLapsedEntries() throws Exception {
        service.issue("old");
        clock.advance(PresenterKeyService.UNFINISHED_TTL);
        service.issue("new");

        var field = PresenterKeyService.class.getDeclaredField("entries");
        field.setAccessible(true);
        assertThat(((Map<?, ?>) field.get(service)).keySet()).hasSize(1);
        assertThat(((Map<?, ?>) field.get(service)).containsKey("new")).isTrue();
    }
}
