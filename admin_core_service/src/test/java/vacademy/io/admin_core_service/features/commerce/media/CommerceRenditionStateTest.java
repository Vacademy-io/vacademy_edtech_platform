package vacademy.io.admin_core_service.features.commerce.media;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CommerceRenditionStateTest {

    private static final String FILE = "file-1";
    private static final long NOW = 1_800_000_000L;

    @Test
    void aRowThatWasNeverProcessedIsPendingAndDue() {
        assertEquals(CommerceRenditionState.PENDING, CommerceRenditionState.status(null));
        assertTrue(CommerceRenditionState.isDue(null, FILE, NOW));
        assertTrue(CommerceRenditionState.urls(null).isEmpty());
    }

    @Test
    void publicReadersGetWidthsAndUrlsOnly() {
        Map<String, Object> claim = CommerceRenditionState.processing(null, FILE, NOW);
        Map<String, Object> ready = CommerceRenditionState.ready(claim, FILE,
                Map.of(640, "https://cdn/w640.webp", 320, "https://cdn/w320.webp", 800, "https://cdn/w800.webp"), 1);

        assertEquals(CommerceRenditionState.READY, CommerceRenditionState.status(ready));
        assertEquals(List.of(320, 640, 800), List.copyOf(CommerceRenditionState.urls(ready).keySet()));
        assertEquals("https://cdn/w640.webp", ready.get("640"));
        assertEquals(1, CommerceRenditionState.attempts(ready));
        assertFalse(CommerceRenditionState.isDue(ready, FILE, NOW + 1_000_000));
        for (String key : ready.keySet()) {
            assertTrue(key.startsWith("_") || key.chars().allMatch(Character::isDigit), key);
        }
    }

    @Test
    void aPlainWidthMapWithoutStateReadsAsReady() {
        Map<String, Object> flat = new HashMap<>();
        flat.put("320", "https://cdn/a.webp");
        assertEquals(CommerceRenditionState.READY, CommerceRenditionState.status(flat));
        assertFalse(CommerceRenditionState.isDue(flat, FILE, NOW));
    }

    @Test
    void aClaimIsNotDueUntilItGoesStale() {
        Map<String, Object> claim = CommerceRenditionState.processing(null, FILE, NOW);

        assertEquals(CommerceRenditionState.PROCESSING, CommerceRenditionState.status(claim));
        assertFalse(CommerceRenditionState.isDue(claim, FILE, NOW + 30));
        assertTrue(CommerceRenditionState.isDue(claim, FILE, NOW + CommerceRenditionState.STALE_CLAIM_SECONDS + 1));
    }

    @Test
    void aPassingFailureWaitsLongerEachTimeAndThenStops() {
        Map<String, Object> state = null;
        long[] waits = {60, 300, 1800, 7200};
        for (int attempt = 1; attempt <= 4; attempt++) {
            Map<String, Object> claim = CommerceRenditionState.processing(state, FILE, NOW);
            state = CommerceRenditionState.afterFailure(claim, FILE, "STORAGE_ERROR", true, NOW);
            assertEquals(CommerceRenditionState.PENDING, CommerceRenditionState.status(state));
            assertEquals(attempt, CommerceRenditionState.attempts(state));
            assertFalse(CommerceRenditionState.isDue(state, FILE, NOW + waits[attempt - 1] - 1));
            assertTrue(CommerceRenditionState.isDue(state, FILE, NOW + waits[attempt - 1]));
        }
        Map<String, Object> last = CommerceRenditionState.afterFailure(
                CommerceRenditionState.processing(state, FILE, NOW), FILE, "STORAGE_ERROR", true, NOW);
        assertEquals(CommerceRenditionState.FAILED, CommerceRenditionState.status(last));
        assertEquals(CommerceRenditionState.MAX_ATTEMPTS, CommerceRenditionState.attempts(last));
        assertFalse(CommerceRenditionState.isDue(last, FILE, NOW + 10_000_000));
    }

    @Test
    void aFileThatIsNotAnImageFailsAtOnce() {
        Map<String, Object> claim = CommerceRenditionState.processing(null, FILE, NOW);
        Map<String, Object> failed = CommerceRenditionState.afterFailure(claim, FILE, "NOT_AN_IMAGE", false, NOW);

        assertEquals(CommerceRenditionState.FAILED, CommerceRenditionState.status(failed));
        assertEquals("NOT_AN_IMAGE", failed.get(CommerceRenditionState.KEY_ERROR));
        assertNull(failed.get(CommerceRenditionState.KEY_NEXT_ATTEMPT_AT));
    }

    @Test
    void renditionsOfTheSameFileStayWhileItIsProcessedAgain() {
        Map<String, Object> ready = CommerceRenditionState.ready(CommerceRenditionState.processing(null, FILE, NOW),
                FILE, Map.of(320, "https://cdn/w320.webp"), 1);
        ready.putAll(CommerceRenditionState.requeuePatch());

        assertTrue(CommerceRenditionState.isDue(ready, FILE, NOW));
        Map<String, Object> claim = CommerceRenditionState.processing(ready, FILE, NOW);
        assertEquals("https://cdn/w320.webp", claim.get("320"));
        assertEquals(1, CommerceRenditionState.attempts(claim));
    }

    @Test
    void renditionsOfAnotherFileAreDropped() {
        Map<String, Object> ready = CommerceRenditionState.ready(CommerceRenditionState.processing(null, FILE, NOW),
                FILE, Map.of(320, "https://cdn/w320.webp"), 1);

        assertTrue(CommerceRenditionState.isDue(ready, "file-2", NOW));
        Map<String, Object> claim = CommerceRenditionState.processing(ready, "file-2", NOW);
        assertTrue(CommerceRenditionState.urls(claim).isEmpty());
        assertEquals(1, CommerceRenditionState.attempts(claim));
        assertEquals("file-2", claim.get(CommerceRenditionState.KEY_MEDIA_ID));
    }
}
