package vacademy.io.admin_core_service.features.live_session.provider.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * link_type is written by two different paths and so appears in prod as the
 * frontend-friendly "zoom"/"ZOOM" and as the enum name "ZOOM_MEETING". The host-url
 * refresh keys off this value; a miss means the caller silently keeps the stale
 * start url whose ZAK has already expired, which is the failure this guards.
 */
class ZoomLinkTypeTest {

    @Test
    @DisplayName("every shape of zoom link_type seen in prod is recognised")
    void recognisesZoomVariants() {
        assertTrue(LiveSessionProviderService.isZoom("zoom"));
        assertTrue(LiveSessionProviderService.isZoom("ZOOM"));
        assertTrue(LiveSessionProviderService.isZoom("ZOOM_MEETING"));
    }

    @Test
    @DisplayName("other providers and absent values are left alone")
    void ignoresNonZoom() {
        assertFalse(LiveSessionProviderService.isZoom(null));
        assertFalse(LiveSessionProviderService.isZoom(""));
        assertFalse(LiveSessionProviderService.isZoom("bbb"));
        assertFalse(LiveSessionProviderService.isZoom("BBB_MEETING"));
        assertFalse(LiveSessionProviderService.isZoom("GOOGLE_MEET"));
        assertFalse(LiveSessionProviderService.isZoom("youtube"));
    }
}
