package vacademy.io.admin_core_service.features.catalog_api.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.website.InstituteWebsiteService;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyResponse;
import vacademy.io.admin_core_service.features.institute_api.service.ApiKeySecrets;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class CatalogApiAuthTest {

    private static final String INSTITUTE = "inst-1";
    private static final String KEY = "vak_pub_" + "a1".repeat(24);

    private InstituteApiKeyService keyService;
    private InstituteWebsiteService websiteService;
    private CatalogApiAuth auth;
    private final AtomicLong now = new AtomicLong(1_760_000_000_000L);

    @BeforeEach
    void setUp() {
        keyService = mock(InstituteApiKeyService.class);
        websiteService = mock(InstituteWebsiteService.class);
        auth = new CatalogApiAuth(keyService, websiteService);
        auth.setClock(now::get);
        when(websiteService.verifiedHosts(INSTITUTE)).thenReturn(Set.of("x.com"));
        stubKey(List.of("catalog"), List.of("catalog:read", "leads:write"));
    }

    private void stubKey(List<String> products, List<String> scopes) {
        ApiKeyVerifyResponse v = new ApiKeyVerifyResponse("k1", INSTITUTE, "Site", products, scopes, "ACTIVE", null,
                null, null, null, 0, 0, 0, null, null, null, false, true);
        when(keyService.verify(eq(ApiKeySecrets.sha256Hex(KEY)), any())).thenReturn(Optional.of(v));
    }

    private static MockHttpServletRequest request(String origin) {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.addHeader("X-API-Key", KEY);
        if (origin != null) r.addHeader("Origin", origin);
        return r;
    }

    private CatalogApiException fails(MockHttpServletRequest r, String scope) {
        return assertThrows(CatalogApiException.class, () -> auth.authenticate(r, scope));
    }

    // ── key ──────────────────────────────────────────────────────────────────

    @Test
    void aServerSideCallWithAValidKeyAuthenticates() {
        CatalogApiAuth.Principal p = auth.authenticate(request(null), CatalogApiAuth.SCOPE_READ);
        assertEquals(INSTITUTE, p.instituteId());
        assertEquals("k1", p.keyId());
        assertTrue(p.has("leads:write"));
        verifyNoInteractions(websiteService); // no Origin, no lookup
    }

    @Test
    void theKeyComesFromXApiKeyOrABearerToken() {
        MockHttpServletRequest r = new MockHttpServletRequest();
        assertNull(CatalogApiAuth.presentedKey(r));
        r.addHeader("Authorization", "Bearer " + KEY);
        assertEquals(KEY, CatalogApiAuth.presentedKey(r));
        assertEquals("k1", auth.authenticate(r, null).keyId());
    }

    @Test
    void missingWrongPrefixAndMalformedKeysAre401WithoutALookup() {
        CatalogApiException missing = fails(new MockHttpServletRequest(), null);
        assertEquals(HttpStatus.UNAUTHORIZED, missing.getStatus());
        assertEquals("missing_api_key", missing.getCode());

        MockHttpServletRequest call = new MockHttpServletRequest();
        call.addHeader("X-API-Key", "vak_call_" + "0".repeat(48));
        assertEquals("invalid_api_key", fails(call, null).getCode());

        MockHttpServletRequest shortKey = new MockHttpServletRequest();
        shortKey.addHeader("X-API-Key", "vak_pub_abc");
        assertEquals("invalid_api_key", fails(shortKey, null).getCode());
        verify(keyService, never()).verify(anyString(), any());
    }

    @Test
    void anUnknownOrRevokedKeyIs401() {
        when(keyService.verify(eq(ApiKeySecrets.sha256Hex(KEY)), any())).thenReturn(Optional.empty());
        CatalogApiException e = fails(request(null), null);
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertEquals("invalid_api_key", e.getCode());
    }

    @Test
    void aKeyOfAnotherProductIsProductNotEnabled() {
        stubKey(List.of("ai_calling"), List.of("calls:read"));
        CatalogApiException e = fails(request(null), null);
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("product_not_enabled", e.getCode());
    }

    @Test
    void aMissingScopeIsInsufficientScope() {
        stubKey(List.of("catalog"), List.of("catalog:read"));
        CatalogApiException e = fails(request(null), CatalogApiAuth.SCOPE_LEADS_WRITE);
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("insufficient_scope", e.getCode());
        assertEquals("leads:write", e.getDetails().get("required_scope"));
    }

    @Test
    void aKeyStoreOutageIsA503WithRetryAfter() {
        when(keyService.verify(anyString(), any())).thenThrow(new RuntimeException("db down"));
        CatalogApiException e = fails(request(null), null);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertEquals("auth_unavailable", e.getCode());
        assertEquals(5, e.getRetryAfterSeconds());
    }

    @Test
    void successfulVerifiesAreCachedBriefly() {
        auth.authenticate(request(null), null);
        auth.authenticate(request(null), null);
        verify(keyService, times(1)).verify(anyString(), any());
        now.addAndGet(CatalogApiAuth.VERIFY_CACHE_TTL_MS + 1);
        auth.authenticate(request(null), null);
        verify(keyService, times(2)).verify(anyString(), any());
    }

    // ── origin lock ──────────────────────────────────────────────────────────

    @Test
    void verifiedHostsAndTheirSubdomainsAreAllowed() {
        for (String origin : List.of("https://x.com", "https://www.x.com", "http://shop.x.com:8080", "https://X.COM")) {
            assertEquals("k1", auth.authenticate(request(origin), null).keyId(), origin);
        }
    }

    @Test
    void localDevelopmentIsAllowedWithoutAnyWebsite() {
        when(websiteService.verifiedHosts(INSTITUTE)).thenReturn(Set.of());
        for (String origin : List.of("http://localhost:3000", "https://localhost", "http://127.0.0.1:5173",
                "http://[::1]:3000")) {
            assertEquals("k1", auth.authenticate(request(origin), null).keyId(), origin);
        }
    }

    @Test
    void lookAlikeAndUnverifiedOriginsAreRefused() {
        for (String origin : List.of("https://evilx.com", "https://x.com.evil.io", "https://localhost.evil.io",
                "https://other.org", "null", "chrome-extension://abc", "https://x.com@evil.io")) {
            CatalogApiException e = fails(request(origin), null);
            assertEquals(HttpStatus.FORBIDDEN, e.getStatus(), origin);
            assertEquals("origin_not_allowed", e.getCode(), origin);
        }
        CatalogApiException e = fails(request("https://evilx.com"), null);
        assertTrue(e.getMessage().contains("Add and verify evilx.com"), e.getMessage());
    }

    @Test
    void onlyVerifiedRowsCount() {
        // The service returns VERIFIED hosts only; an institute with none (e.g. all PENDING) is locked.
        when(websiteService.verifiedHosts(INSTITUTE)).thenReturn(Set.of());
        assertEquals("origin_not_allowed", fails(request("https://x.com"), null).getCode());
    }

    // ── rate limits ──────────────────────────────────────────────────────────

    @Test
    void readsAreLimitedPerKeyPerMinute() {
        for (int i = 0; i < CatalogApiAuth.READS_PER_MINUTE; i++) auth.hit("read:k1", CatalogApiAuth.READS_PER_MINUTE, "x");
        CatalogApiException e = fails(request(null), null);
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatus());
        assertEquals("rate_limited", e.getCode());
        assertNotNull(e.getRetryAfterSeconds());
        assertTrue(e.getRetryAfterSeconds() >= 1 && e.getRetryAfterSeconds() <= 60);
        now.addAndGet(60_000L); // next window
        assertEquals("k1", auth.authenticate(request(null), null).keyId());
    }

    @Test
    void leadsAreLimitedPerVisitorIpOnBrowserCalls() {
        CatalogApiAuth.Principal p = auth.authenticate(request(null), null);
        MockHttpServletRequest browser = request("https://x.com");
        browser.addHeader("CF-Connecting-IP", "1.1.1.1");
        browser.addHeader("X-Client-IP", "9.9.9.9"); // ignored for a browser call
        for (int i = 0; i < CatalogApiAuth.LEADS_PER_MINUTE_PER_CLIENT; i++) auth.rateLimitLead(p, browser);
        assertEquals("rate_limited", assertThrows(CatalogApiException.class, () -> auth.rateLimitLead(p, browser)).getCode());

        MockHttpServletRequest other = request("https://x.com");
        other.addHeader("X-Forwarded-For", "2.2.2.2, 10.0.0.1");
        auth.rateLimitLead(p, other); // a different visitor is unaffected
        assertEquals("2.2.2.2", CatalogApiAuth.endUserIp(other));
        assertEquals("1.1.1.1", CatalogApiAuth.endUserIp(browser));
    }

    @Test
    void serverSideLeadsUseXClientIpOrOnlyThePerKeyLimit() {
        CatalogApiAuth.Principal p = auth.authenticate(request(null), null);
        MockHttpServletRequest server = request(null);
        server.addHeader("CF-Connecting-IP", "3.3.3.3"); // the institute's server, not the visitor
        assertNull(CatalogApiAuth.endUserIp(server));
        MockHttpServletRequest withClient = request(null);
        withClient.addHeader("X-Client-IP", "4.4.4.4");
        assertEquals("4.4.4.4", CatalogApiAuth.endUserIp(withClient));

        // Without X-Client-IP only the per-key budget applies.
        for (int i = 0; i < CatalogApiAuth.LEADS_PER_MINUTE; i++) auth.rateLimitLead(p, server);
        CatalogApiException e = assertThrows(CatalogApiException.class, () -> auth.rateLimitLead(p, server));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatus());
        assertEquals(CatalogApiAuth.LEADS_PER_MINUTE, e.getDetails().get("limit_per_minute"));
    }
}
