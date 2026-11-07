package vacademy.io.assessment_service.features.open_evaluation.auth;

import com.github.benmanes.caffeine.cache.Ticker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiInstituteFlags;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.apikey.ApiKeyVerifierUnavailableException;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The key cache in front of admin_core (spec 6.4): known keys cached and refreshed, unknown
 * keys cached briefly, an outage never turned into "unknown", and a revocation picked up
 * on refresh.
 */
class AssessmentApiKeyVerifierTest {

    private static final String HASH = "a".repeat(64);

    private final AtomicLong nanos = new AtomicLong(1_000_000_000L);
    private final Ticker ticker = nanos::get;
    private AdminCoreApiKeyClient client;
    private ApiInstituteFlags flags;
    private AssessmentApiKeyVerifier verifier;

    @BeforeEach
    void setUp() {
        client = mock(AdminCoreApiKeyClient.class);
        flags = new ApiInstituteFlags();
        // Direct executor: background refreshes complete before get() returns.
        verifier = new AssessmentApiKeyVerifier(client, flags, ticker, Runnable::run);
    }

    private void advance(Duration d) {
        nanos.addAndGet(d.toNanos());
    }

    private static ApiKeyVerifyResponse response(String keyId, boolean fireWorkflowEvents) {
        ApiKeyVerifyResponse r = new ApiKeyVerifyResponse();
        r.setKeyId(keyId);
        r.setInstituteId("inst-1");
        r.setName("ERP prod");
        r.setProducts(List.of("evaluation"));
        r.setScopes(List.of("evaluation:read", "evaluation:write"));
        r.setStatus("ACTIVE");
        r.setAccessEnabled(true);
        r.setFireWorkflowEvents(fireWorkflowEvents);
        r.setDailyCopyQuota(3000);
        return r;
    }

    @Test
    void known_key_is_served_from_cache_without_a_second_call() {
        when(client.verify(HASH)).thenReturn(Optional.of(response("k1", false)));

        Optional<ApiKeyPrincipal> first = verifier.verify(HASH);
        Optional<ApiKeyPrincipal> second = verifier.verify(HASH);

        assertThat(first).isPresent();
        assertThat(first.get().getKeyId()).isEqualTo("k1");
        assertThat(first.get().getDailyCopyQuota()).isEqualTo(3000);
        assertThat(second.get()).isSameAs(first.get());
        verify(client, times(1)).verify(HASH);
    }

    @Test
    void unknown_key_is_cached_for_30_seconds_only() {
        when(client.verify(HASH)).thenReturn(Optional.empty());

        assertThat(verifier.verify(HASH)).isEmpty();
        advance(Duration.ofSeconds(29));
        assertThat(verifier.verify(HASH)).isEmpty();
        verify(client, times(1)).verify(HASH);

        advance(Duration.ofSeconds(2));
        assertThat(verifier.verify(HASH)).isEmpty();
        verify(client, times(2)).verify(HASH);
    }

    @Test
    void outage_with_nothing_cached_is_unavailable_not_unknown() {
        when(client.verify(HASH)).thenThrow(new ApiKeyVerifierUnavailableException("admin_core down"));

        assertThatThrownBy(() -> verifier.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
        // A failure is not cached: the next call asks again.
        assertThatThrownBy(() -> verifier.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
        verify(client, times(2)).verify(HASH);
    }

    @Test
    void unexpected_loader_error_is_reported_as_unavailable() {
        when(client.verify(HASH)).thenThrow(new IllegalStateException("bug"));

        assertThatThrownBy(() -> verifier.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
    }

    @Test
    void outage_during_refresh_keeps_serving_the_cached_key_until_it_expires() {
        when(client.verify(HASH))
                .thenReturn(Optional.of(response("k1", false)))
                .thenThrow(new ApiKeyVerifierUnavailableException("admin_core down"));

        assertThat(verifier.verify(HASH)).isPresent();

        advance(Duration.ofSeconds(61)); // past refresh, refresh fails
        assertThat(verifier.verify(HASH)).isPresent();
        advance(Duration.ofMinutes(5));
        assertThat(verifier.verify(HASH)).isPresent();

        advance(Duration.ofMinutes(5)); // past the 10 minute expiry of the last good load
        assertThatThrownBy(() -> verifier.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
    }

    @Test
    void revocation_is_picked_up_by_the_refresh_after_60_seconds() {
        when(client.verify(HASH))
                .thenReturn(Optional.of(response("k1", false)))
                .thenReturn(Optional.empty());

        assertThat(verifier.verify(HASH)).isPresent();
        advance(Duration.ofSeconds(30));
        assertThat(verifier.verify(HASH)).isPresent();
        verify(client, times(1)).verify(HASH);

        advance(Duration.ofSeconds(31));
        verifier.verify(HASH); // triggers the refresh (may still answer from the old value)
        assertThat(verifier.verify(HASH)).isEmpty();
    }

    @Test
    void refreshed_key_gets_a_fresh_ten_minute_lifetime() {
        when(client.verify(HASH)).thenReturn(Optional.of(response("k1", false)));

        verifier.verify(HASH);
        advance(Duration.ofMinutes(9));
        verifier.verify(HASH); // refresh succeeds, resets expiry
        when(client.verify(HASH)).thenThrow(new ApiKeyVerifierUnavailableException("down"));
        advance(Duration.ofMinutes(5)); // 14 min after first load, 5 after refresh

        assertThat(verifier.verify(HASH)).isPresent();
    }

    @Test
    void verified_key_teaches_the_institute_workflow_flag() {
        when(client.verify(HASH)).thenReturn(Optional.of(response("k1", true)));

        verifier.verify(HASH);

        assertThat(flags.fireWorkflowEvents("inst-1")).isTrue();
        assertThat(flags.fireWorkflowEvents("other")).isFalse();
    }

    @Test
    void blank_hash_is_unknown_without_a_call() {
        assertThat(verifier.verify(" ")).isEmpty();
        assertThat(verifier.verify(null)).isEmpty();
        verify(client, times(0)).verify(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void cache_is_bounded_at_ten_thousand_entries() {
        when(client.verify(org.mockito.ArgumentMatchers.anyString())).thenReturn(Optional.empty());
        for (int i = 0; i < 10_050; i++) {
            verifier.verify(String.format("%064d", i));
        }
        assertThat(verifier.estimatedSize()).isLessThanOrEqualTo(AssessmentApiKeyVerifier.MAX_ENTRIES);
    }
}
