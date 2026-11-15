package vacademy.io.admin_core_service.features.commerce.otp;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpService.VerifiedPhone;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The code (made here, kept as an HMAC, compared here), the limits, the wrong-guess counter,
 * expiry, single use and the verified-phone token. The transport only delivers: the test reads
 * the code from what it was asked to send. The challenge rows live in a list that applies the
 * same conditions as the conditional UPDATEs of the repository.
 */
class CommerceOtpServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "9876543210";
    private static final String NORMALISED = "919876543210";

    /** A clock the test moves. */
    private static final class TestClock extends Clock {
        private long millis = 1_800_000_000_000L;

        void advance(Duration by) {
            millis += by.toMillis();
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
            return Instant.ofEpochMilli(millis);
        }
    }

    private final List<CommerceOtpChallenge> rows = new ArrayList<>();
    private TestClock clock;
    private CommerceOtpTransport transport;
    private CommerceRateLimiter limiter;
    private CommerceOtpChallengeRepository challenges;
    private CommerceOtpService service;
    /** The code the transport was last asked to deliver. */
    private String sentCode;

    @BeforeEach
    void setUp() {
        clock = new TestClock();
        transport = mock(CommerceOtpTransport.class);
        doAnswer(call -> {
            sentCode = call.getArgument(2);
            return null;
        }).when(transport).send(anyString(), anyString(), anyString());
        limiter = mock(CommerceRateLimiter.class);
        when(limiter.allow(anyString(), anyString(), anyString(), any(), anyInt())).thenReturn(true);
        challenges = inMemoryChallenges();
        service = new CommerceOtpService(transport, challenges, limiter, clock, "unit-test-only-not-a-secret");
    }

    /** A code that is certainly not the one that was sent. */
    private String wrongCode() {
        return "000000".equals(sentCode) ? "111111" : "000000";
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    private CommerceOtpChallenge row(String id) {
        return rows.stream().filter(r -> r.getId().equals(id)).findFirst().orElse(null);
    }

    private CommerceOtpChallengeRepository inMemoryChallenges() {
        CommerceOtpChallengeRepository repo = mock(CommerceOtpChallengeRepository.class);
        when(repo.save(any())).thenAnswer(call -> {
            CommerceOtpChallenge c = call.getArgument(0);
            c.setId("challenge-" + (rows.size() + 1));
            c.setCreatedAt(new Date(clock.millis() + rows.size())); // a later row is newer
            rows.add(c);
            return c;
        });
        when(repo.findById(anyString())).thenAnswer(call -> Optional.ofNullable(row(call.getArgument(0))));
        when(repo.findFirstByInstituteIdAndPhoneHashAndPurposeAndStatusOrderByCreatedAtDesc(anyString(), anyString(),
                anyString(), anyString())).thenAnswer(call -> rows.stream()
                .filter(r -> r.getInstituteId().equals(call.getArgument(0))
                        && r.getPhoneHash().equals(call.getArgument(1))
                        && r.getPurpose().equals(call.getArgument(2))
                        && r.getStatus().equals(call.getArgument(3)))
                .max(Comparator.comparing(CommerceOtpChallenge::getCreatedAt)));
        when(repo.supersede(anyString(), anyString(), anyString(), any())).thenAnswer(call -> {
            int n = 0;
            for (CommerceOtpChallenge r : rows) {
                if (r.getInstituteId().equals(call.getArgument(0)) && r.getPhoneHash().equals(call.getArgument(1))
                        && r.getPurpose().equals(call.getArgument(2)) && "SENT".equals(r.getStatus())) {
                    r.setStatus("SUPERSEDED");
                    n++;
                }
            }
            return n;
        });
        when(repo.countAttempt(anyString(), anyInt(), any())).thenAnswer(call -> {
            CommerceOtpChallenge r = row(call.getArgument(0));
            Date now = call.getArgument(2);
            int max = call.getArgument(1);
            if (r == null || !"SENT".equals(r.getStatus()) || r.getAttempts() >= max || !r.getExpiresAt().after(now)) {
                return 0;
            }
            r.setAttempts(r.getAttempts() + 1);
            return 1;
        });
        when(repo.lock(anyString(), any())).thenAnswer(call -> {
            CommerceOtpChallenge r = row(call.getArgument(0));
            if (r == null || !"SENT".equals(r.getStatus())) {
                return 0;
            }
            r.setStatus("LOCKED");
            return 1;
        });
        when(repo.markVerified(anyString(), anyString(), any(), any())).thenAnswer(call -> {
            CommerceOtpChallenge r = row(call.getArgument(0));
            if (r == null || !"SENT".equals(r.getStatus())) {
                return 0;
            }
            r.setStatus("VERIFIED");
            r.setTokenKey(call.getArgument(1));
            r.setTokenExpiresAt(call.getArgument(2));
            r.setVerifiedAt(call.getArgument(3));
            return 1;
        });
        when(repo.consume(anyString(), any())).thenAnswer(call -> {
            CommerceOtpChallenge r = row(call.getArgument(0));
            Date now = call.getArgument(1);
            if (r == null || !"VERIFIED".equals(r.getStatus()) || !r.getTokenExpiresAt().after(now)) {
                return 0;
            }
            r.setStatus("CONSUMED");
            return 1;
        });
        return repo;
    }

    private static String code(CommerceOtpException e) {
        return e.getCode();
    }

    private String verifiedToken(String purpose) {
        service.requestOtp(INSTITUTE, PHONE, purpose, "203.0.113.7");
        return service.verifyOtp(INSTITUTE, PHONE, sentCode, purpose, "203.0.113.7");
    }

    // ── Request and its limits ───────────────────────────────────────────────

    @Test
    void aCodeIsSentToTheNormalisedPhoneAndTheRowKeepsOnlyAHash() {
        CommerceOtpService.OtpSent sent = service.requestOtp(INSTITUTE, "+91 98765-43210", "track_order", "203.0.113.7");

        verify(transport).send(eq(INSTITUTE), eq(NORMALISED), anyString());
        assertEquals(540, sent.expiresInSeconds());
        assertEquals(60, sent.resendAfterSeconds());
        assertEquals(1, rows.size());
        assertEquals("TRACK_ORDER", rows.get(0).getPurpose());
        assertEquals(64, rows.get(0).getPhoneHash().length());
        assertFalse(rows.get(0).getPhoneHash().contains("9876543210"));
    }

    @Test
    void everyLimitIsCountedPerPhonePerAddressAndPerInstitute() {
        service.requestOtp(INSTITUTE, PHONE, "COD", "203.0.113.7");

        String hash = CommerceOtpService.phoneHash(INSTITUTE, NORMALISED);
        verify(limiter).allow(INSTITUTE, "otp-send-gap", hash, Duration.ofMinutes(1), 1);
        verify(limiter).allow(INSTITUTE, "otp-send-phone", hash, Duration.ofMinutes(10), 3);
        verify(limiter).allow(INSTITUTE, "otp-send-phone-day", hash, Duration.ofDays(1), 8);
        verify(limiter).allow(INSTITUTE, "otp-send-ip", "203.0.113.7", Duration.ofMinutes(10), 10);
        verify(limiter).hits(INSTITUTE, "otp-send-institute", "*", Duration.ofHours(1));
    }

    @Test
    void aPhoneOverItsLimitGetsNoCode() {
        when(limiter.allow(eq(INSTITUTE), eq("otp-send-phone"), anyString(), any(), anyInt())).thenReturn(false);

        CommerceOtpException refused = assertThrows(CommerceOtpException.class,
                () -> service.requestOtp(INSTITUTE, PHONE, "COD", "203.0.113.7"));

        assertEquals(CommerceOtpException.RATE_LIMITED, code(refused));
        assertTrue(refused.getRetryAfterSeconds() >= 1 && refused.getRetryAfterSeconds() <= 600);
        verify(transport, never()).send(anyString(), anyString(), anyString());
        assertTrue(rows.isEmpty());
    }

    @Test
    void anAddressOverItsLimitGetsNoCode() {
        when(limiter.allow(eq(INSTITUTE), eq("otp-send-ip"), eq("203.0.113.7"), any(), anyInt())).thenReturn(false);

        assertEquals(CommerceOtpException.RATE_LIMITED, code(assertThrows(CommerceOtpException.class,
                () -> service.requestOtp(INSTITUTE, PHONE, "COD", "203.0.113.7"))));
        verify(transport, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void anInstituteOverItsLimitGetsNoCode() {
        when(limiter.hits(eq(INSTITUTE), eq("otp-send-institute"), anyString(), any())).thenReturn(301);

        assertEquals(CommerceOtpException.RATE_LIMITED, code(assertThrows(CommerceOtpException.class,
                () -> service.requestOtp(INSTITUTE, PHONE, "COD", null))));
        verify(transport, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void theInstituteCapIsTheShopsSetting() {
        CommerceOtpService capped = new CommerceOtpService(transport, challenges, limiter, institute -> 50, clock,
                "unit-test-only-not-a-secret");
        when(limiter.hits(eq(INSTITUTE), eq("otp-send-institute"), anyString(), any())).thenReturn(50, 51);

        capped.requestOtp(INSTITUTE, PHONE, "COD", null);
        clock.advance(Duration.ofMinutes(2));
        assertEquals(CommerceOtpException.RATE_LIMITED, code(assertThrows(CommerceOtpException.class,
                () -> capped.requestOtp(INSTITUTE, PHONE, "COD", null))));
        verify(transport, times(1)).send(anyString(), anyString(), anyString());
    }

    @Test
    void aSettingThatCannotBeReadFallsBackTo300() {
        CommerceOtpService broken = new CommerceOtpService(transport, challenges, limiter, institute -> {
            throw new IllegalStateException("settings down");
        }, clock, "unit-test-only-not-a-secret");
        when(limiter.hits(eq(INSTITUTE), eq("otp-send-institute"), anyString(), any())).thenReturn(300, 301);

        broken.requestOtp(INSTITUTE, PHONE, "COD", null);
        clock.advance(Duration.ofMinutes(2));
        assertThrows(CommerceOtpException.class, () -> broken.requestOtp(INSTITUTE, PHONE, "COD", null));
    }

    @Test
    void anInstituteLimiterThatCannotCountSendsNothing() {
        when(limiter.hits(eq(INSTITUTE), eq("otp-send-institute"), anyString(), any()))
                .thenThrow(new IllegalStateException("database down"));

        assertEquals(CommerceOtpException.UNAVAILABLE, code(assertThrows(CommerceOtpException.class,
                () -> service.requestOtp(INSTITUTE, PHONE, "COD", null))));
        verify(transport, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void accountIsAPurposeOfItsOwn() {
        String token = service.requestOtp(INSTITUTE, PHONE, "account", "203.0.113.7") == null ? null
                : service.verifyOtp(INSTITUTE, PHONE, sentCode, "ACCOUNT", "203.0.113.7");

        assertEquals(NORMALISED, service.verifyToken(INSTITUTE, token, "ACCOUNT"));
        assertThrows(CommerceOtpException.class, () -> service.verifyToken(INSTITUTE, token, "CHECKOUT"));
    }

    @Test
    void aLimiterThatCannotCountSendsNothing() {
        when(limiter.allow(anyString(), anyString(), anyString(), any(), anyInt()))
                .thenThrow(new IllegalStateException("database down"));

        assertEquals(CommerceOtpException.UNAVAILABLE, code(assertThrows(CommerceOtpException.class,
                () -> service.requestOtp(INSTITUTE, PHONE, "COD", null))));
        verify(transport, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void aBadPhoneOrPurposeIsRefusedBeforeAnythingIsCounted() {
        assertEquals(CommerceOtpException.INVALID_REQUEST, code(assertThrows(CommerceOtpException.class,
                () -> service.requestOtp(INSTITUTE, "12345", "COD", null))));
        assertEquals(CommerceOtpException.INVALID_REQUEST, code(assertThrows(CommerceOtpException.class,
                () -> service.requestOtp(INSTITUTE, PHONE, "LOGIN", null))));
        verify(limiter, never()).allow(anyString(), anyString(), anyString(), any(), anyInt());
    }

    @Test
    void aSendThatFailsLeavesNoChallenge() {
        doThrow(new CommerceOtpException(CommerceOtpException.UNAVAILABLE, "no sender"))
                .when(transport).send(eq(INSTITUTE), eq(NORMALISED), anyString());

        assertThrows(CommerceOtpException.class, () -> service.requestOtp(INSTITUTE, PHONE, "COD", null));
        assertTrue(rows.isEmpty());
    }

    @Test
    void itRefusesToRunInsideATransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);

        assertThrows(IllegalStateException.class, () -> service.requestOtp(INSTITUTE, PHONE, "COD", null));
        assertThrows(IllegalStateException.class, () -> service.verifyOtp(INSTITUTE, PHONE, "123456", "COD"));
        assertTrue(rows.isEmpty());
        verify(transport, never()).send(anyString(), anyString(), anyString());
    }

    // ── Verify: attempts, expiry, single use ─────────────────────────────────

    @Test
    void fiveWrongGuessesLockTheCodeEvenForTheRightOne() {
        service.requestOtp(INSTITUTE, PHONE, "COD", null);
        for (int i = 0; i < 5; i++) {
            assertEquals(CommerceOtpException.INVALID_CODE, code(assertThrows(CommerceOtpException.class,
                    () -> service.verifyOtp(INSTITUTE, PHONE, wrongCode(), "COD"))));
        }

        assertEquals(CommerceOtpException.LOCKED, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp(INSTITUTE, PHONE, sentCode, "COD"))));
        assertEquals("LOCKED", rows.get(0).getStatus());
        assertEquals(5, rows.get(0).getAttempts());
    }

    @Test
    void aCodeIsAcceptedOnce() {
        service.requestOtp(INSTITUTE, PHONE, "COD", null);
        service.verifyOtp(INSTITUTE, PHONE, sentCode, "COD");

        assertEquals(CommerceOtpException.INVALID_CODE, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp(INSTITUTE, PHONE, sentCode, "COD"))));
        assertEquals("VERIFIED", rows.get(0).getStatus());
    }

    @Test
    void anExpiredCodeIsRefusedWithoutACheck() {
        service.requestOtp(INSTITUTE, PHONE, "COD", null);
        clock.advance(Duration.ofMinutes(9).plusSeconds(1));

        assertEquals(CommerceOtpException.INVALID_CODE, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp(INSTITUTE, PHONE, sentCode, "COD"))));
        assertEquals(0, rows.get(0).getAttempts());
    }

    @Test
    void aCodeAskedForOnePurposeVerifiesNoOther() {
        service.requestOtp(INSTITUTE, PHONE, "TRACK_ORDER", null);

        assertEquals(CommerceOtpException.INVALID_CODE, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp(INSTITUTE, PHONE, sentCode, "COD"))));
        assertEquals(CommerceOtpException.INVALID_CODE, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp("inst-2", PHONE, sentCode, "TRACK_ORDER"))));
    }

    // ── The code belongs to commerce: made here, kept as an HMAC, compared here (B1) ──

    @Test
    void theCodeIsSixDigitsAndTheRowKeepsOnlyItsHmac() {
        service.requestOtp(INSTITUTE, PHONE, "COD", null);

        assertTrue(sentCode.matches("[0-9]{6}"), "six digits are delivered");
        String kept = rows.get(0).getCodeHash();
        assertTrue(kept.matches("[0-9a-f]{64}"), "an HMAC-SHA256 in hex");
        assertFalse(kept.contains(sentCode));
        // Not a plain hash of the code: without the server key the row cannot be tried offline.
        assertNotEquals(CommerceRateLimiter.hash(sentCode), kept);
    }

    @Test
    void theRightCodeIsDecidedHere_noOtherServiceIsAskedAndNoOtherStoreCanProveIt() {
        service.requestOtp(INSTITUTE, PHONE, "COD", null);

        String token = service.verifyOtp(INSTITUTE, PHONE, sentCode, "COD");

        assertEquals(NORMALISED, service.verifyToken(token));
        // The transport delivered once and was never asked whether a code is right: there is
        // no such call. The shop decides a code only against its own challenge row.
        verify(transport, times(1)).send(anyString(), anyString(), anyString());
        org.mockito.Mockito.verifyNoMoreInteractions(transport);
    }

    @Test
    void aCodeSentForOnePurposeDoesNotOpenAChallengeOfAnotherPurposeOfTheSamePhone() {
        service.requestOtp(INSTITUTE, PHONE, "TRACK_ORDER", null);
        String trackCode = sentCode;
        clock.advance(Duration.ofMinutes(2));
        service.requestOtp(INSTITUTE, PHONE, "CHECKOUT", null);
        String checkoutCode = sentCode;
        org.junit.jupiter.api.Assumptions.assumeFalse(trackCode.equals(checkoutCode), "one in a million");

        // Both challenges are SENT, and each challenge has its own code.
        assertEquals(CommerceOtpException.INVALID_CODE, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp(INSTITUTE, PHONE, checkoutCode, "TRACK_ORDER"))));
        assertEquals(CommerceOtpException.INVALID_CODE, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp(INSTITUTE, PHONE, trackCode, "CHECKOUT"))));
        assertEquals(NORMALISED, service.verifyToken(service.verifyOtp(INSTITUTE, PHONE, trackCode, "TRACK_ORDER")));
    }

    @Test
    void aRowWithoutAnHmacAcceptsNoCode() {
        service.requestOtp(INSTITUTE, PHONE, "COD", null);
        rows.get(0).setCodeHash(null);

        assertEquals(CommerceOtpException.INVALID_CODE, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp(INSTITUTE, PHONE, sentCode, "COD"))));
    }

    @Test
    void withoutAServerSecretNoCodeIsSent() {
        CommerceOtpService noSecret = new CommerceOtpService(transport, challenges, limiter, clock, "  ");

        assertEquals(CommerceOtpException.UNAVAILABLE, code(assertThrows(CommerceOtpException.class,
                () -> noSecret.requestOtp(INSTITUTE, PHONE, "COD", null))));
        verify(transport, never()).send(anyString(), anyString(), anyString());
        verify(limiter, never()).allow(anyString(), anyString(), anyString(), any(), anyInt());
    }

    @Test
    void aServerSideCallerIsCountedOnItsOwnAddress_theShopperItNamesIsOnlyASecondBucket() {
        service.requestOtp(INSTITUTE, PHONE, "COD", "203.0.113.7", "198.51.100.1");

        // The address the request came from is the key; it cannot be chosen by the caller.
        verify(limiter).allow(INSTITUTE, "otp-send-ip", "203.0.113.7", Duration.ofMinutes(10), 30);
        verify(limiter).allow(INSTITUTE, "otp-send-named", "198.51.100.1", Duration.ofMinutes(10), 10);
    }

    @Test
    void aNewNamedShopperEachTimeDoesNotEscapeTheLimitOfTheAddress() {
        when(limiter.allow(eq(INSTITUTE), eq("otp-send-ip"), eq("203.0.113.7"), any(), anyInt())).thenReturn(false);

        for (String named : List.of("198.51.100.1", "198.51.100.2", "198.51.100.3")) {
            assertEquals(CommerceOtpException.RATE_LIMITED, code(assertThrows(CommerceOtpException.class,
                    () -> service.requestOtp(INSTITUTE, PHONE, "COD", "203.0.113.7", named))));
        }
        verify(transport, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void aNewCodeEndsTheEarlierOne() {
        service.requestOtp(INSTITUTE, PHONE, "COD", null);
        service.requestOtp(INSTITUTE, PHONE, "COD", null);

        assertEquals("SUPERSEDED", rows.get(0).getStatus());
        assertEquals("SENT", rows.get(1).getStatus());
    }

    @Test
    void triesAreLimitedPerAddress() {
        service.requestOtp(INSTITUTE, PHONE, "COD", null);
        when(limiter.allow(eq(INSTITUTE), eq("otp-verify-ip"), eq("203.0.113.7"), any(), anyInt())).thenReturn(false);

        assertEquals(CommerceOtpException.RATE_LIMITED, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyOtp(INSTITUTE, PHONE, sentCode, "COD", "203.0.113.7"))));
        assertEquals(0, rows.get(0).getAttempts());
    }

    // ── Token ────────────────────────────────────────────────────────────────

    @Test
    void theTokenProvesThePhoneTheInstituteAndThePurposeAndNothingElse() {
        String token = verifiedToken("COD");

        VerifiedPhone verified = service.readToken(token);
        assertEquals(NORMALISED, verified.phone());
        assertEquals(INSTITUTE, verified.instituteId());
        assertEquals(CommerceOtpPurpose.COD, verified.purpose());
        assertEquals(NORMALISED, service.verifyToken(token));
        assertEquals(NORMALISED, service.verifyToken(INSTITUTE, token, "COD"));

        // Three dot-separated parts with a version of its own: not a platform JWT.
        assertTrue(token.startsWith("v1."));
        assertEquals(3, token.split("\\.").length);
        // The key that signs it stays on the row.
        assertFalse(token.contains(rows.get(0).getTokenKey()));
    }

    @Test
    void aTokenIsRefusedForAnotherPurposeOrInstitute() {
        String token = verifiedToken("TRACK_ORDER");

        assertEquals(CommerceOtpException.INVALID_TOKEN, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyToken(INSTITUTE, token, "COD"))));
        assertEquals(CommerceOtpException.INVALID_TOKEN, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyToken("inst-2", token, "TRACK_ORDER"))));
    }

    @Test
    void aTokenExpiresAfterFifteenMinutes() {
        String token = verifiedToken("COD");

        clock.advance(Duration.ofMinutes(14));
        assertEquals(NORMALISED, service.verifyToken(token));

        clock.advance(Duration.ofMinutes(1).plusSeconds(1));
        assertEquals(CommerceOtpException.INVALID_TOKEN, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyToken(token))));
    }

    @Test
    void aChangedTokenIsRefused() {
        String token = verifiedToken("COD");
        String[] parts = token.split("\\.");
        String otherPhone = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                new String(java.util.Base64.getUrlDecoder().decode(parts[1])).replace(NORMALISED, "919000000000")
                        .getBytes());

        for (String forged : List.of(parts[0] + "." + otherPhone + "." + parts[2],
                parts[0] + "." + parts[1] + "." + parts[2].substring(1) + "A",
                "v2." + parts[1] + "." + parts[2], parts[1], "", "a.b.c")) {
            assertEquals(CommerceOtpException.INVALID_TOKEN, code(assertThrows(CommerceOtpException.class,
                    () -> service.verifyToken(forged))), forged);
        }
        assertEquals(CommerceOtpException.INVALID_TOKEN, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyToken(null))));
    }

    @Test
    void twoTokensAreSignedWithDifferentKeys() {
        String first = verifiedToken("COD");
        clock.advance(Duration.ofMinutes(2));
        String second = verifiedToken("COD");

        assertNotEquals(rows.get(0).getTokenKey(), rows.get(1).getTokenKey());
        assertNotEquals(first.split("\\.")[2], second.split("\\.")[2]);
    }

    @Test
    void aSpentTokenIsNeverValidAgain() {
        String token = verifiedToken("COD");

        assertEquals(NORMALISED, service.consumeToken(token).phone());

        assertEquals(CommerceOtpException.INVALID_TOKEN, code(assertThrows(CommerceOtpException.class,
                () -> service.consumeToken(token))));
        assertEquals(CommerceOtpException.INVALID_TOKEN, code(assertThrows(CommerceOtpException.class,
                () -> service.verifyToken(token))));
    }
}
