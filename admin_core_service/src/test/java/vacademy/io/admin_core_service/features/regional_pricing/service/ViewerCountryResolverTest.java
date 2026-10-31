package vacademy.io.admin_core_service.features.regional_pricing.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The API has no CDN in front, so the country comes from the real client IP (X-Real-IP, set by
 * ingress-nginx), never from a country header the client could send itself.
 */
class ViewerCountryResolverTest {

    private GeoIpCountryLookup geo;
    private ViewerCountryResolver resolver;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        geo = mock(GeoIpCountryLookup.class);
        resolver = new ViewerCountryResolver(geo);
        ReflectionTestUtils.setField(resolver, "trustedCountryHeaders", "");
        ReflectionTestUtils.setField(resolver, "clientIpHeader", "X-Real-IP");
        request = new MockHttpServletRequest();
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void countryComesFromTheIngressClientIp() {
        request.addHeader("X-Real-IP", "8.8.8.8");
        when(geo.countryOf("8.8.8.8")).thenReturn(Optional.of("US"));
        assertEquals(Optional.of("US"), resolver.currentCountry());
    }

    @Test
    void aClientSentCountryHeaderIsIgnored() {
        request.addHeader("CF-IPCountry", "NP");
        request.addHeader("CloudFront-Viewer-Country", "NP");
        request.addHeader("X-Real-IP", "49.36.0.1");
        when(geo.countryOf("49.36.0.1")).thenReturn(Optional.of("IN"));
        assertEquals(Optional.of("IN"), resolver.currentCountry());
    }

    @Test
    void aTrustedEdgeHeaderIsUsedOnlyWhenConfigured() {
        ReflectionTestUtils.setField(resolver, "trustedCountryHeaders", "CF-IPCountry");
        request.addHeader("CF-IPCountry", "gb");
        assertEquals(Optional.of("GB"), resolver.currentCountry());
        verify(geo, never()).countryOf(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void withoutTheIngressHeaderTheSocketAddressIsUsed() {
        request.setRemoteAddr("1.1.1.1");
        when(geo.countryOf("1.1.1.1")).thenReturn(Optional.of("AU"));
        assertEquals(Optional.of("AU"), resolver.currentCountry());
    }

    @Test
    void outsideARequestThereIsNoCountry() {
        RequestContextHolder.resetRequestAttributes();
        assertTrue(resolver.currentCountry().isEmpty());
    }

    @Test
    void privateAndMalformedAddressesAreNeverLookedUp() {
        assertNull(GeoIpCountryLookup.parsePublicIp("10.1.2.3"));
        assertNull(GeoIpCountryLookup.parsePublicIp("192.168.0.4"));
        assertNull(GeoIpCountryLookup.parsePublicIp("127.0.0.1"));
        assertNull(GeoIpCountryLookup.parsePublicIp("::1"));
        assertNull(GeoIpCountryLookup.parsePublicIp("example.com")); // never resolved via DNS
        assertNull(GeoIpCountryLookup.parsePublicIp(""));
        assertNull(GeoIpCountryLookup.parsePublicIp(null));
        assertNotNull(GeoIpCountryLookup.parsePublicIp("8.8.8.8"));
        assertNotNull(GeoIpCountryLookup.parsePublicIp("2001:4860:4860::8888"));
    }
}
