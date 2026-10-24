package vacademy.io.admin_core_service.features.catalog_api.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class CatalogMediaResolverTest {

    @Test
    void resolvesInOneBatchCachesAndPassesUrlsThrough() {
        MediaService media = mock(MediaService.class);
        when(media.getPublicUrlsWithoutExpiry(any())).thenReturn(Map.of("a", "https://cdn/a", "b", "https://cdn/b"));
        CatalogMediaResolver r = new CatalogMediaResolver(media);
        Map<String, String> out = r.resolve(List.of("a", "b", "https://x/y.png", "a"));
        assertEquals("https://cdn/a", out.get("a"));
        assertEquals("https://x/y.png", out.get("https://x/y.png"));
        r.resolve(List.of("a", "b"));
        verify(media, times(1)).getPublicUrlsWithoutExpiry(any()); // second call is all cache hits
        verify(media, never()).getFilePublicUrlByIdWithoutExpiry(any());
    }

    @Test
    void aFailedBatchFallsBackPerIdAndRemembersMisses() {
        MediaService media = mock(MediaService.class);
        when(media.getPublicUrlsWithoutExpiry(any())).thenThrow(new RuntimeException("File Not Found"));
        when(media.getFilePublicUrlByIdWithoutExpiry("good")).thenReturn("https://cdn/good");
        when(media.getFilePublicUrlByIdWithoutExpiry("gone")).thenThrow(new RuntimeException("404"));
        CatalogMediaResolver r = new CatalogMediaResolver(media);
        Map<String, String> out = r.resolve(List.of("good", "gone"));
        assertEquals(Map.of("good", "https://cdn/good"), out);
        r.resolve(List.of("good", "gone"));
        verify(media, times(1)).getPublicUrlsWithoutExpiry(any());
        verify(media, times(1)).getFilePublicUrlByIdWithoutExpiry("gone");
    }

    @Test
    void aHangingMediaServiceIsCutOffAndSkippedForAMinute() {
        MediaService media = mock(MediaService.class);
        when(media.getPublicUrlsWithoutExpiry(any())).thenAnswer(inv -> {
            Thread.sleep(CatalogMediaResolver.BATCH_TIMEOUT_MS + 5_000);
            return Map.of();
        });
        CatalogMediaResolver r = new CatalogMediaResolver(media);
        long t0 = System.currentTimeMillis();
        assertEquals(Map.of(), r.resolve(List.of("a")));
        long took = System.currentTimeMillis() - t0;
        assertTrue(took < CatalogMediaResolver.BATCH_TIMEOUT_MS + 2_000, "cut off at the deadline, took " + took);
        assertTrue(r.isDown());
        // While down: no remote call at all, and the id is not remembered as missing.
        assertEquals(Map.of(), r.resolve(List.of("a", "https://x/y.png")).entrySet().stream()
                .filter(e -> !e.getKey().startsWith("http")).collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));
        verify(media, times(1)).getPublicUrlsWithoutExpiry(any());
    }
}
