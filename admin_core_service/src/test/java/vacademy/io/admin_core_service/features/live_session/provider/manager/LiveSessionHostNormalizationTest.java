package vacademy.io.admin_core_service.features.live_session.provider.manager;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The normalised value becomes the ORIGIN of a URL that learners are redirected
 * into, so these cases are a security boundary rather than a formatting nicety.
 * Anything that is not a plain hostname must come back null (meaning "fall back
 * to the platform default") rather than being coerced into something plausible.
 */
class LiveSessionHostNormalizationTest {

    private static String norm(String raw) {
        return BbbMeetingManager.normalizeLiveSessionHost(raw);
    }

    @Nested
    @DisplayName("accepts and normalises real hosts")
    class Accepts {

        @Test
        @DisplayName("a bare hostname passes through")
        void bareHost() {
            assertEquals("meet.zoeedtech.com", norm("meet.zoeedtech.com"));
        }

        @Test
        @DisplayName("scheme and trailing slash are stripped")
        void schemeAndSlash() {
            assertEquals("meet.zoeedtech.com", norm("https://meet.zoeedtech.com"));
            assertEquals("meet.zoeedtech.com", norm("https://meet.zoeedtech.com/"));
            assertEquals("meet.zoeedtech.com", norm("http://meet.zoeedtech.com/bigbluebutton/api"));
        }

        @Test
        @DisplayName("case and surrounding whitespace are normalised")
        void caseAndWhitespace() {
            assertEquals("meet.zoeedtech.com", norm("  MEET.ZoeEdTech.COM  "));
        }

        @Test
        @DisplayName("deep subdomains and hyphens are fine")
        void subdomains() {
            assertEquals("live-classes.a.b.school.co.in", norm("live-classes.a.b.school.co.in"));
        }
    }

    @Nested
    @DisplayName("rejects anything that is not a plain hostname")
    class Rejects {

        @Test
        @DisplayName("absent values")
        void absent() {
            assertNull(norm(null));
            assertNull(norm(""));
            assertNull(norm("   "));
        }

        @Test
        @DisplayName("a port would not match the certificate or the pool listener")
        void ports() {
            assertNull(norm("meet.zoeedtech.com:8443"));
            assertNull(norm("https://meet.zoeedtech.com:8443"));
        }

        @Test
        @DisplayName("a non-network scheme cannot smuggle through")
        void hostileScheme() {
            assertNull(norm("javascript:alert(1)"));
            assertNull(norm("data:text/html,x"));
        }

        @Test
        @DisplayName("single labels and malformed hosts")
        void malformed() {
            assertNull(norm("localhost"));
            assertNull(norm("meet"));
            assertNull(norm("meet..com"));
            assertNull(norm("-lead.example.com"));
            assertNull(norm("trail-.example.com"));
            assertNull(norm("meet.zoeedtech.c"));
            assertNull(norm("192.168.1.10"));
        }

        @Test
        @DisplayName("over-long hosts")
        void tooLong() {
            assertNull(norm("a".repeat(250) + ".example.com"));
        }
    }

    @Nested
    @DisplayName("userinfo cannot disguise the real host")
    class Userinfo {

        /**
         * "evil.com@good.com" resolves to good.com per URL rules, so returning the
         * part AFTER the @ is correct — the test pins that we read it the same way a
         * browser does, and never treat the decoy prefix as the host.
         */
        @Test
        @DisplayName("the authority after @ wins, matching browser parsing")
        void authorityAfterAt() {
            assertEquals("meet.zoeedtech.com", norm("evil.example.com@meet.zoeedtech.com"));
            assertEquals("evil.example.com", norm("https://meet.zoeedtech.com@evil.example.com"));
        }
    }
}
