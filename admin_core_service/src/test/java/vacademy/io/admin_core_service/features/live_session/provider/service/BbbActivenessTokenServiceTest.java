package vacademy.io.admin_core_service.features.live_session.provider.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BbbActivenessTokenServiceTest {

    private static final String SECRET = "test-secret";
    private static final Instant NOW = Instant.parse("2026-10-23T10:00:00Z");
    private static final String SCHEDULE = "11111111-2222-3333-4444-555555555555";
    private static final String USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    private static BbbActivenessTokenService at(Instant now, String secret) {
        return new BbbActivenessTokenService(secret, Clock.fixed(now, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("a minted token verifies back to the same schedule and learner")
    void roundTrip() {
        String token = at(NOW, SECRET).mint(SCHEDULE, USER);
        assertNotNull(token);
        assertTrue(token.startsWith("v1."));
        assertFalse(token.contains("="), "base64url without padding");
        var claims = at(NOW.plusSeconds(3600), SECRET).verify(token).orElseThrow();
        assertEquals(SCHEDULE, claims.scheduleId());
        assertEquals(USER, claims.userId());
    }

    @Test
    @DisplayName("a payload swapped for another learner fails the signature")
    void tamperedPayload() {
        String token = at(NOW, SECRET).mint(SCHEDULE, USER);
        String[] parts = token.split("\\.");
        long exp = NOW.getEpochSecond() + BbbActivenessTokenService.TTL_SECONDS;
        String forged = Base64.getUrlEncoder().withoutPadding().encodeToString(
                (SCHEDULE + ":someone-else:" + exp).getBytes(StandardCharsets.UTF_8));
        assertTrue(at(NOW, SECRET).verify(parts[0] + "." + forged + "." + parts[2]).isEmpty());
    }

    @Test
    @DisplayName("a changed signature, wrong secret or wrong version is rejected")
    void tamperedSignature() {
        String token = at(NOW, SECRET).mint(SCHEDULE, USER);
        String[] parts = token.split("\\.");
        char last = parts[2].charAt(0);
        String sig = (last == 'A' ? 'B' : 'A') + parts[2].substring(1);
        assertTrue(at(NOW, SECRET).verify(parts[0] + "." + parts[1] + "." + sig).isEmpty());
        assertTrue(at(NOW, "other-secret").verify(token).isEmpty());
        assertTrue(at(NOW, SECRET).verify("v2." + parts[1] + "." + parts[2]).isEmpty());
    }

    @Test
    @DisplayName("a token past its 24h expiry is rejected")
    void expired() {
        String token = at(NOW, SECRET).mint(SCHEDULE, USER);
        Instant justValid = NOW.plusSeconds(BbbActivenessTokenService.TTL_SECONDS);
        assertTrue(at(justValid, SECRET).verify(token).isPresent());
        assertTrue(at(justValid.plusSeconds(1), SECRET).verify(token).isEmpty());
    }

    @Test
    @DisplayName("garbage input never throws, it just does not verify")
    void garbage() {
        var svc = at(NOW, SECRET);
        assertTrue(svc.verify(null).isEmpty());
        assertTrue(svc.verify("").isEmpty());
        assertTrue(svc.verify("v1").isEmpty());
        assertTrue(svc.verify("v1..").isEmpty());
        assertTrue(svc.verify("v1.!!!.???").isEmpty());
        assertTrue(svc.verify("v1.a.b.c").isEmpty());
        assertTrue(svc.verify("x".repeat(5000)).isEmpty());
    }

    @Test
    @DisplayName("blank secret = feature off: nothing is minted and nothing verifies")
    void blankSecret() {
        String token = at(NOW, SECRET).mint(SCHEDULE, USER);
        assertFalse(at(NOW, "").isConfigured());
        assertNull(at(NOW, "").mint(SCHEDULE, USER));
        assertNull(at(NOW, null).mint(SCHEDULE, USER));
        assertTrue(at(NOW, "  ").verify(token).isEmpty());
        assertNull(at(NOW, SECRET).mint(null, USER));
    }

    @org.junit.jupiter.api.Test
    void killSwitchTurnsEverythingOff() {
        BbbActivenessTokenService on = new BbbActivenessTokenService("s3cret", java.time.Clock.systemUTC(), true);
        BbbActivenessTokenService off = new BbbActivenessTokenService("s3cret", java.time.Clock.systemUTC(), false);
        String token = on.mint("sched", "user");
        org.junit.jupiter.api.Assertions.assertTrue(on.verify(token).isPresent());
        org.junit.jupiter.api.Assertions.assertFalse(off.isConfigured());
        org.junit.jupiter.api.Assertions.assertNull(off.mint("sched", "user"));
        org.junit.jupiter.api.Assertions.assertTrue(off.verify(token).isEmpty());
    }
}
