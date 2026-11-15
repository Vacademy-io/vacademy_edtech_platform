package vacademy.io.admin_core_service.features.commerce.customer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderAccessTokens;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The seven-day shopper session: issue, verify, and every way a token must be refused. The
 * customer table is a map; nothing leaves the JVM.
 */
class CommerceShopperSessionsTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919876543210";
    private static final String SECRET = "unit-test-only-not-a-secret";

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

    /** A customer row as the session reads it. */
    private static final class Row implements CommerceCustomerRepository.SessionRow {
        String id;
        String institute;
        String phone;
        int epoch;
        Date anonymisedAt;

        Row(String id, String institute, String phone) {
            this.id = id;
            this.institute = institute;
            this.phone = phone;
        }

        @Override
        public String getId() {
            return id;
        }

        @Override
        public String getPhone() {
            return phone;
        }

        @Override
        public Integer getSessionEpoch() {
            return epoch;
        }

        @Override
        public Date getAnonymisedAt() {
            return anonymisedAt;
        }
    }

    private final Map<String, Row> rows = new HashMap<>();
    private CommerceCustomerRepository repository;
    private TestClock clock;
    private CommerceShopperSessions sessions;

    @BeforeEach
    void setUp() {
        repository = mock(CommerceCustomerRepository.class);
        clock = new TestClock();
        when(repository.insertIfAbsent(anyString(), anyString(), anyString())).thenAnswer(call -> {
            String institute = call.getArgument(1);
            String phone = call.getArgument(2);
            boolean exists = rows.values().stream().anyMatch(r -> r.institute.equals(institute)
                    && r.phone.equals(phone));
            if (exists) {
                return 0;
            }
            Row row = new Row(call.getArgument(0), institute, phone);
            rows.put(row.id, row);
            return 1;
        });
        when(repository.findSessionRowByPhone(anyString(), anyString())).thenAnswer(call -> rows.values().stream()
                .filter(r -> r.institute.equals(call.getArgument(0)) && r.phone.equals(call.getArgument(1)))
                .findFirst().map(r -> (CommerceCustomerRepository.SessionRow) r));
        when(repository.findSessionRow(anyString(), anyString())).thenAnswer(call -> Optional.ofNullable(
                rows.get((String) call.getArgument(0))).filter(r -> r.institute.equals(call.getArgument(1)))
                .map(r -> (CommerceCustomerRepository.SessionRow) r));
        when(repository.bumpSessionEpoch(anyString(), anyString())).thenAnswer(call -> {
            Row row = rows.get((String) call.getArgument(0));
            if (row == null || !row.institute.equals(call.getArgument(1))) {
                return 0;
            }
            row.epoch++;
            return 1;
        });
        sessions = new CommerceShopperSessions(repository, new TransactionTemplate(mock(PlatformTransactionManager.class)),
                clock, SECRET);
    }

    private Row onlyRow() {
        assertEquals(1, rows.size());
        return rows.values().iterator().next();
    }

    @Test
    void anOtpGivesASevenDaySessionThatProvesThePhoneInThisShop() {
        CommerceShopperSessions.Issued issued = sessions.issueForPhone(INSTITUTE, PHONE);

        assertNotNull(issued);
        assertTrue(issued.token().startsWith("s1."));
        assertTrue(issued.token().length() <= CommerceShopperSessions.MAX_TOKEN_LENGTH);
        assertEquals(clock.instant().plus(Duration.ofDays(7)), issued.expiresAt());
        assertFalse(issued.token().contains(PHONE), "the token carries a hash prefix, not the phone");

        CommerceShopperSessions.Session session = sessions.verify(INSTITUTE, issued.token());
        assertNotNull(session);
        assertEquals(PHONE, session.phone());
        assertEquals(onlyRow().id, session.customerId());
        assertEquals(INSTITUTE, session.instituteId());
    }

    @Test
    void aPhoneTheShopKnowsKeepsItsRow_andAnUnknownOneGetsARowWithThePhoneOnly() {
        sessions.issueForPhone(INSTITUTE, PHONE);
        sessions.issueForPhone(INSTITUTE, PHONE);

        assertEquals(1, rows.size());
        verify(repository, never()).upsert(any(), any(), any(), any(), any(), any());
    }

    @Test
    void anotherInstituteRefusesIt() {
        String token = sessions.issueForPhone(INSTITUTE, PHONE).token();
        assertNull(sessions.verify("inst-2", token));
    }

    @Test
    void anExpiredSessionIsRefused() {
        String token = sessions.issueForPhone(INSTITUTE, PHONE).token();
        clock.advance(Duration.ofDays(7).minusSeconds(1));
        assertNotNull(sessions.verify(INSTITUTE, token));
        clock.advance(Duration.ofSeconds(1));
        assertNull(sessions.verify(INSTITUTE, token));
    }

    @Test
    void aForgedOrEditedTokenIsRefused() {
        String token = sessions.issueForPhone(INSTITUTE, PHONE).token();
        String[] parts = token.split("\\.");

        // Signed with another secret.
        CommerceShopperSessions other = new CommerceShopperSessions(repository,
                new TransactionTemplate(mock(PlatformTransactionManager.class)), clock, "another-secret");
        assertNull(sessions.verify(INSTITUTE, other.issueForPhone(INSTITUTE, PHONE).token()));

        // Payload edited: another customer id, same signature.
        String payload = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
        String edited = payload.replace(onlyRow().id, "someone-else");
        String forged = parts[0] + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(edited.getBytes(StandardCharsets.UTF_8)) + "." + parts[2];
        assertNull(sessions.verify(INSTITUTE, forged));

        // Signature changed, wrong version, garbage, too long.
        assertNull(sessions.verify(INSTITUTE, parts[0] + "." + parts[1] + ".AAAA"));
        assertNull(sessions.verify(INSTITUTE, "v1." + parts[1] + "." + parts[2]));
        assertNull(sessions.verify(INSTITUTE, "s1.not-base64!.x"));
        assertNull(sessions.verify(INSTITUTE, token + "x".repeat(600)));
        assertNull(sessions.verify(INSTITUTE, null));
        assertNull(sessions.verify(INSTITUTE, " "));
    }

    @Test
    void signingOutEverywhereEndsEverySessionOfThePhone() {
        String first = sessions.issueForPhone(INSTITUTE, PHONE).token();
        String second = sessions.issueForPhone(INSTITUTE, PHONE).token();

        sessions.endAll(INSTITUTE, onlyRow().id);

        assertNull(sessions.verify(INSTITUTE, first));
        assertNull(sessions.verify(INSTITUTE, second));
        assertNotNull(sessions.verify(INSTITUTE, sessions.issueForPhone(INSTITUTE, PHONE).token()),
                "a new OTP gives a new session");
    }

    @Test
    void anAnonymisedCustomerOrAChangedPhoneEndsTheSession() {
        String token = sessions.issueForPhone(INSTITUTE, PHONE).token();
        onlyRow().phone = "919000000000";
        assertNull(sessions.verify(INSTITUTE, token));

        onlyRow().phone = PHONE;
        assertNotNull(sessions.verify(INSTITUTE, token));
        onlyRow().anonymisedAt = new Date();
        assertNull(sessions.verify(INSTITUTE, token));
        assertNull(sessions.issueForPhone(INSTITUTE, PHONE), "no session for an anonymised customer");
    }

    @Test
    void anEmptySessionSecretFallsBackToTheOrderTokenSecret() {
        CommerceShopperSessions fallback = new CommerceShopperSessions(repository,
                mock(PlatformTransactionManager.class), " ", SECRET);
        String token = sessions.issueForPhone(INSTITUTE, PHONE).token();
        assertNotNull(fallback.verify(INSTITUTE, token));
        CommerceShopperSessions own = new CommerceShopperSessions(repository,
                mock(PlatformTransactionManager.class), "own-secret", SECRET);
        assertNull(own.verify(INSTITUTE, token), "rotating the session secret signs everyone out");
    }

    @Test
    void withoutASecretNoSessionIsIssuedOrAccepted() {
        CommerceShopperSessions off = new CommerceShopperSessions(repository,
                new TransactionTemplate(mock(PlatformTransactionManager.class)), clock, " ");
        String token = sessions.issueForPhone(INSTITUTE, PHONE).token();

        assertFalse(off.isConfigured());
        assertNull(off.issueForPhone(INSTITUTE, PHONE));
        assertNull(off.verify(INSTITUTE, token));
    }

    @Test
    void orderAndPhoneTokensAreNotSessions_andASessionIsNotAnOrderToken() {
        CommerceOrderAccessTokens orderTokens = new CommerceOrderAccessTokens(SECRET);
        String orderToken = orderTokens.issue(INSTITUTE, "order-1");
        // The verified-phone token of an OTP has the same three-part form, version v1.
        String phoneToken = "v1." + Base64.getUrlEncoder().withoutPadding().encodeToString(
                ("{\"c\":\"ch-1\",\"i\":\"" + INSTITUTE + "\",\"p\":\"" + PHONE + "\",\"u\":\"ACCOUNT\",\"e\":"
                        + (clock.millis() + 60_000) + "}").getBytes(StandardCharsets.UTF_8)) + ".c2ln";

        assertNull(sessions.verify(INSTITUTE, orderToken));
        assertNull(sessions.verify(INSTITUTE, phoneToken));
        // Rewritten with the session's version, the order token's signature still does not match.
        assertNull(sessions.verify(INSTITUTE, "s1" + orderToken.substring(2)));

        String session = sessions.issueForPhone(INSTITUTE, PHONE).token();
        assertNull(orderTokens.verify(session));
        assertNull(orderTokens.verify("v1" + session.substring(2)), "the keys differ by their prefix");
    }

    @Test
    void aDatabaseFaultIsNoSessionNotAnError() {
        String token = sessions.issueForPhone(INSTITUTE, PHONE).token();
        when(repository.findSessionRow(anyString(), eq(INSTITUTE))).thenThrow(new IllegalStateException("down"));
        assertNull(sessions.verify(INSTITUTE, token));
    }
}
