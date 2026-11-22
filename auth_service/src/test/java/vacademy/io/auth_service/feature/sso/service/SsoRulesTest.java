package vacademy.io.auth_service.feature.sso.service;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import vacademy.io.auth_service.feature.sso.dto.SsoGroupRule;
import vacademy.io.auth_service.feature.sso.entity.InstituteSsoConnection;

import java.net.InetAddress;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The pure rules behind single sign-on: who gets in, which batches, which URLs are safe. */
class SsoRulesTest {

    // ── access ───────────────────────────────────────────────────────────────

    @Test
    void everyoneGetsInWhenModeIsAll() {
        assertTrue(SsoAccessPolicy.isAllowed("ALL", List.of(), List.of()));
        assertTrue(SsoAccessPolicy.isAllowed(null, null, null));
    }

    @Test
    void groupModeNeedsAMatchingGroupIgnoringCaseAndSpaces() {
        assertTrue(SsoAccessPolicy.isAllowed("GROUPS", List.of("LMS-Sales"), List.of("other", " lms-sales ")));
        assertFalse(SsoAccessPolicy.isAllowed("GROUPS", List.of("LMS-Sales"), List.of("LMS-HR")));
        assertFalse(SsoAccessPolicy.isAllowed("GROUPS", List.of("LMS-Sales"), List.of()));
        assertFalse(SsoAccessPolicy.isAllowed("GROUPS", List.of(), List.of("LMS-Sales")), "no allowed groups = nobody");
    }

    @Test
    void batchesAreDefaultsPlusEveryMatchingRule() {
        List<SsoGroupRule> rules = List.of(
                new SsoGroupRule("LMS-Sales", List.of("ps-sales", "ps-product")),
                new SsoGroupRule("LMS-HR", List.of("ps-hr")),
                new SsoGroupRule(null, List.of("ps-ignored")));
        Set<String> desired = SsoAccessPolicy.desiredPackageSessions(List.of("ps-conduct"), rules, List.of("lms-sales"));
        assertEquals(Set.of("ps-conduct", "ps-sales", "ps-product"), desired);
    }

    @Test
    void onlyBatchesThisConnectionGrantedAreRemoved() {
        Set<String> desired = Set.of("a");
        assertEquals(Set.of("b"), SsoAccessPolicy.toRemove(List.of("a", "b"), desired, true));
        assertTrue(SsoAccessPolicy.toRemove(List.of("a", "b"), desired, false).isEmpty());
    }

    @Test
    void onlyWhatAdminCoreReallyAddedCountsAsGranted() {
        // "x" was already held (paid / added by an admin): admin-core reports it as not added,
        // so it is never recorded and losing the group can never switch it off.
        assertEquals(Set.of("a", "new"),
                SsoAccessPolicy.grantedAfterSync(List.of("a", "b"), List.of("b"), List.of("new")));
        assertEquals(Set.of(), SsoAccessPolicy.grantedAfterSync(List.of(), List.of(), List.of()));
    }

    // ── email domains ────────────────────────────────────────────────────────

    @Test
    void domainsAreParsedAndPublicMailIsRefused() {
        assertEquals(List.of("acme.com", "acme.co.in"), SsoEmailDomains.parse(" @Acme.com, acme.co.in\nacme.com "));
        assertNull(SsoEmailDomains.validate(List.of("acme.com")));
        assertNotNull(SsoEmailDomains.validate(List.of("gmail.com")));
        assertNotNull(SsoEmailDomains.validate(List.of("not a domain")));
        assertNotNull(SsoEmailDomains.validate(List.of()));
    }

    @Test
    void emailMustBeInAConnectionDomain() {
        List<String> domains = List.of("acme.com");
        assertTrue(SsoEmailDomains.covers(domains, "Rahul@ACME.com"));
        assertFalse(SsoEmailDomains.covers(domains, "rahul@acme.com.evil.io"));
        assertFalse(SsoEmailDomains.covers(domains, "rahul@sub.acme.com"));
        assertFalse(SsoEmailDomains.covers(domains, "no-at-sign"));
    }

    // ── claims ───────────────────────────────────────────────────────────────

    @Test
    void claimsAreReadThroughTheConnectionsNames() {
        InstituteSsoConnection entra = InstituteSsoConnection.builder()
                .claimUserId("oid").claimGroups("groups").claimPhone("mobile").build();
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("sub", "pairwise-sub");
        claims.put("oid", "0f6c-oid");
        claims.put("preferred_username", "Rahul.Sharma@Acme.com");
        claims.put("given_name", "Rahul");
        claims.put("family_name", "Sharma");
        claims.put("groups", List.of("g1", "g2", "g1"));
        claims.put("mobile", "+91 98765 43210");
        SsoClaims read = SsoClaims.from(claims, entra);
        assertEquals("0f6c-oid", read.subject());
        assertEquals("rahul.sharma@acme.com", read.email(), "falls back to preferred_username, lower case");
        assertNull(read.emailVerified(), "Entra sends no email_verified");
        assertEquals("Rahul Sharma", read.fullName());
        assertEquals(List.of("g1", "g2"), read.groups());
        assertEquals("+91 98765 43210", read.phone());
    }

    @Test
    void userinfoNeverReplacesTheSubject() {
        Map<String, Object> token = Map.of("sub", "alice", "email", "alice@acme.com");
        Map<String, Object> sameSub = Map.of("sub", "alice", "groups", List.of("x"), "email", "other@acme.com");
        Map<String, Object> merged = SsoClaims.merge(token, sameSub);
        assertEquals("alice@acme.com", merged.get("email"), "ID token wins");
        assertEquals(List.of("x"), merged.get("groups"), "userinfo fills gaps");
        Map<String, Object> otherSub = Map.of("sub", "mallory", "groups", List.of("admins"));
        assertNull(SsoClaims.merge(token, otherSub).get("groups"), "userinfo for another subject is ignored");
    }

    // ── URLs ─────────────────────────────────────────────────────────────────

    @Test
    void returnPathStaysOnTheSite() {
        assertEquals("/study-library/courses?x=1", SsoLoginService.safeReturnPath("/study-library/courses?x=1"));
        assertNull(SsoLoginService.safeReturnPath("//evil.com/x"));
        assertNull(SsoLoginService.safeReturnPath("/\\evil.com"));
        assertNull(SsoLoginService.safeReturnPath("https://evil.com"));
        assertNull(SsoLoginService.safeReturnPath("/a\nb"));
        assertNull(SsoLoginService.safeReturnPath("/a b"));
        assertNull(SsoLoginService.safeReturnPath("/a|b{c}"));
        assertEquals("/course", SsoLoginService.safeReturnPath("/course#section-2"));
        assertNull(SsoLoginService.safeReturnPath(null));
    }

    @Test
    void portalOriginIsHttpsOrLocalhost() {
        assertEquals("https://learn.acme.com", SsoLoginService.originOf("https://Learn.Acme.com/login?x=1"));
        assertEquals("https://learn.acme.com", SsoLoginService.originOf("learn.acme.com"));
        assertEquals("http://localhost:8100", SsoLoginService.originOf("http://localhost:8100/"));
        assertNull(SsoLoginService.originOf("http://learn.acme.com"));
        assertNull(SsoLoginService.originOf("javascript:alert(1)"));
        assertNull(SsoLoginService.originOf("https://user:pw@learn.acme.com"));
    }

    @Test
    void privateAddressesAreBlocked() throws Exception {
        assertTrue(OidcProviderClient.isNonPublic(InetAddress.getByName("127.0.0.1")));
        assertTrue(OidcProviderClient.isNonPublic(InetAddress.getByName("10.2.3.4")));
        assertTrue(OidcProviderClient.isNonPublic(InetAddress.getByName("192.168.1.1")));
        assertTrue(OidcProviderClient.isNonPublic(InetAddress.getByName("169.254.169.254")));
        assertTrue(OidcProviderClient.isNonPublic(InetAddress.getByName("100.64.0.1")));
        assertTrue(OidcProviderClient.isNonPublic(InetAddress.getByName("::1")));
        assertTrue(OidcProviderClient.isNonPublic(InetAddress.getByName("fd00::1")));
        assertFalse(OidcProviderClient.isNonPublic(InetAddress.getByName("8.8.8.8")));
    }

    // ── ID token checks ──────────────────────────────────────────────────────

    @Test
    void audienceAndAuthorizedPartyMustBeUs() {
        assertFalse(OidcProviderClient.audienceMatches("client-1", jwt(List.of("client-1"), null)).hasErrors());
        assertTrue(OidcProviderClient.audienceMatches("client-1", jwt(List.of("client-2"), null)).hasErrors());
        assertTrue(OidcProviderClient.audienceMatches("client-1", jwt(List.of("client-1", "api"), null)).hasErrors(),
                "several audiences need azp");
        assertFalse(OidcProviderClient.audienceMatches("client-1", jwt(List.of("client-1", "api"), "client-1")).hasErrors());
        assertTrue(OidcProviderClient.audienceMatches("client-1", jwt(List.of("client-1"), "someone-else")).hasErrors());
    }

    @Test
    void issuerComparesWithoutTrailingSlash() {
        Jwt token = Jwt.withTokenValue("t").header("alg", "RS256").claim("iss", "https://login.acme.com/")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
        assertFalse(OidcProviderClient.issuerMatches("https://login.acme.com", token).hasErrors());
        assertTrue(OidcProviderClient.issuerMatches("https://evil.com", token).hasErrors());
    }

    @Test
    void onlyAsymmetricSignaturesAreAccepted() {
        assertEquals(List.of(SignatureAlgorithm.RS256),
                OidcProviderClient.signatureAlgorithms(List.of("HS256", "none")));
        assertEquals(List.of(SignatureAlgorithm.RS256, SignatureAlgorithm.ES256),
                OidcProviderClient.signatureAlgorithms(List.of("RS256", "ES256")));
    }

    @Test
    void pkceChallengeMatchesRfc7636Example() {
        // RFC 7636 appendix B
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
                SsoLoginService.s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }

    private static Jwt jwt(List<String> aud, String azp) {
        Jwt.Builder builder = Jwt.withTokenValue("t").header("alg", "RS256").audience(aud)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60));
        if (azp != null) {
            builder.claim("azp", azp);
        }
        return builder.build();
    }
}
