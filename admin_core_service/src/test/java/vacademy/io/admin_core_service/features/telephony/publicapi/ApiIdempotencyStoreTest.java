package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Idempotency-Key for the v1.3 creates: one create per key, replays, conflicts, release on failure. */
class ApiIdempotencyStoreTest {

    private ApiIdempotencyStore store;
    private final AtomicInteger creates = new AtomicInteger();

    @BeforeEach
    void setUp() {
        store = spy(new ApiIdempotencyStore(mock(NamedParameterJdbcTemplate.class)));
        doReturn(null).when(store).find(any(), any(), any());
        doReturn(true).when(store).claim(any(), any(), any(), any(), any());
        doNothing().when(store).complete(any(), any(), any(), any());
        doNothing().when(store).release(any(), any(), any());
        doNothing().when(store).expire(any(), any(), any());
        doNothing().when(store).releaseStale(any(), any(), any());
    }

    private ApiIdempotencyStore.Outcome run(String key, Object request) {
        return store.run("inst-1", "key-1", "agent.create", key, request, () -> {
            creates.incrementAndGet();
            return new ApiIdempotencyStore.Created("a-1", new LinkedHashMap<>(Map.of("id", "a-1")), true);
        }, id -> new LinkedHashMap<>(Map.of("id", id)));
    }

    @Test
    void noKeyJustCreates() {
        ApiIdempotencyStore.Outcome o = run(null, Map.of("name", "x"));
        assertTrue(o.created());
        assertFalse(o.replay());
        verify(store, never()).claim(any(), any(), any(), any(), any());
    }

    @Test
    void aFirstRequestClaimsCreatesAndCompletes() {
        run("k", Map.of("name", "x"));
        verify(store).claim(eq("inst-1"), eq("agent.create"), eq("k"), anyString(), eq("key-1"));
        verify(store).complete("inst-1", "agent.create", "k", "a-1");
        assertEquals(1, creates.get());
    }

    @Test
    void theSameRequestAgainIsAReplay() {
        String hash = ApiIdempotencyStore.hash(Map.of("name", "x"));
        doReturn(new ApiIdempotencyStore.Row(hash, "a-1", Instant.now())).when(store).find(any(), any(), any());
        ApiIdempotencyStore.Outcome o = run("k", Map.of("name", "x"));
        assertTrue(o.replay());
        assertEquals(true, o.body().get("idempotent_replay"));
        assertEquals(0, creates.get());
    }

    @Test
    void aDifferentRequestWithTheKeyIs409() {
        doReturn(new ApiIdempotencyStore.Row("other", "a-1", Instant.now())).when(store).find(any(), any(), any());
        assertEquals("idempotency_key_reused",
                assertThrows(AiCallingApiException.class, () -> run("k", Map.of("name", "x"))).getCode());
    }

    @Test
    void aRequestStillRunningIs409WithRetryAfter() {
        String hash = ApiIdempotencyStore.hash(Map.of("name", "x"));
        doReturn(false).when(store).claim(any(), any(), any(), any(), any());
        doReturn(null).doReturn(new ApiIdempotencyStore.Row(hash, null, Instant.now())).when(store).find(any(), any(), any());
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> run("k", Map.of("name", "x")));
        assertEquals("request_in_progress", e.getCode());
        assertNotNull(e.getRetryAfterSeconds());
        assertEquals(0, creates.get());
    }

    @Test
    void aClaimLeftByADeadRequestIsTakenOverAfterTwoMinutes() {
        String hash = ApiIdempotencyStore.hash(Map.of("name", "x"));
        doReturn(new ApiIdempotencyStore.Row(hash, null, Instant.now().minus(Duration.ofMinutes(3))))
                .when(store).find(any(), any(), any());
        ApiIdempotencyStore.Outcome o = run("k", Map.of("name", "x"));
        assertTrue(o.created());
        verify(store).releaseStale("inst-1", "agent.create", "k");
        assertEquals(1, creates.get());
    }

    @Test
    void anExpiredKeyMayBeReused() {
        doReturn(new ApiIdempotencyStore.Row("other", "a-0", Instant.now().minus(Duration.ofHours(25))))
                .when(store).find(any(), any(), any());
        ApiIdempotencyStore.Outcome o = run("k", Map.of("name", "x"));
        assertTrue(o.created());
        verify(store).expire("inst-1", "agent.create", "k");
    }

    @Test
    void aFailedCreateReleasesTheKey() {
        assertThrows(IllegalStateException.class, () -> store.run("inst-1", "key-1", "agent.create", "k", Map.of(),
                () -> {
                    throw new IllegalStateException("boom");
                }, id -> Map.of()));
        verify(store).release("inst-1", "agent.create", "k");
        verify(store, never()).complete(any(), any(), any(), any());
    }

    @Test
    void theHashIgnoresKeyOrder() {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("a", 1);
        a.put("b", 2);
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("b", 2);
        b.put("a", 1);
        assertEquals(ApiIdempotencyStore.hash(a), ApiIdempotencyStore.hash(b));
        assertEquals(64, ApiIdempotencyStore.hash(a).length());
    }
}
