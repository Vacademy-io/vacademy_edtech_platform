package vacademy.io.admin_core_service.features.engagement.report;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The two rules the daily report's money and reply numbers rest on. */
class EngagementDailyReportRulesTest {

    private static Signal whatsapp(String phone, long sentAt, Long replyAt, String status) {
        return new Signal("WHATSAPP", phone, sentAt, null, status, null, "META", "tpl", "en", "UTILITY",
                null, null, null, null, false, false, false, false, false, false, replyAt);
    }

    private static Signal email(Long replyAt) {
        return new Signal("EMAIL", "a@b.com", 1L, "Hi", null, null, null, null, null, null,
                null, null, null, null, true, false, false, false, false, true, replyAt);
    }

    /** One inbound WhatsApp is credited to one message: the latest send before it. */
    @Nested
    class ReplyAttribution {

        @Test
        void aReplyBelongsToTheLatestSendBeforeIt() {
            // Monday and Tuesday sends; notification_service gives both the Tuesday reply.
            Map<String, Long> replies = EngagementDailyReportService.attributeReplies(Map.of(
                    "mon", whatsapp("919876500001", 1_000, 5_000L, "READ"),
                    "tue", whatsapp("+91 98765 00001", 4_000, 5_000L, "READ")));

            assertEquals(Map.of("tue", 5_000L), replies);
        }

        @Test
        void aReplyBeforeTheNextSendStaysWithTheFirst() {
            Map<String, Long> replies = EngagementDailyReportService.attributeReplies(Map.of(
                    "mon", whatsapp("919876500001", 1_000, 2_000L, "READ"),
                    "tue", whatsapp("919876500001", 4_000, null, "DELIVERED")));

            assertEquals(Map.of("mon", 2_000L), replies);
        }

        @Test
        void aFailedSendNeitherTakesNorBlocksAReply() {
            Map<String, Long> replies = EngagementDailyReportService.attributeReplies(Map.of(
                    "mon", whatsapp("919876500001", 1_000, 5_000L, "READ"),
                    "tue", whatsapp("919876500001", 4_000, 5_000L, "FAILED")));

            assertEquals(Map.of("mon", 5_000L), replies);
        }

        @Test
        void differentPhonesAndEmailRepliesAreKept() {
            Map<String, Long> replies = EngagementDailyReportService.attributeReplies(Map.of(
                    "a", whatsapp("919876500001", 1_000, 2_000L, "READ"),
                    "b", whatsapp("919876500002", 1_500, 3_000L, "READ"),
                    "e", email(9_000L)));

            assertEquals(Map.of("a", 2_000L, "b", 3_000L, "e", 9_000L), replies);
        }
    }

    /** Longest country-code prefix, then the latest rate in effect on the day. */
    @Nested
    class RateCard {

        @SuppressWarnings("unchecked")
        private WhatsAppRateCardService card(List<WhatsAppRateCardService.Rate> rates) {
            NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
            when(jdbc.query(anyString(), any(SqlParameterSource.class), any(RowMapper.class))).thenReturn(rates);
            return new WhatsAppRateCardService(jdbc);
        }

        private final List<WhatsAppRateCardService.Rate> rates = List.of(
                new WhatsAppRateCardService.Rate("91", "marketing", "INR", 0.7846, LocalDate.of(2025, 1, 1)),
                new WhatsAppRateCardService.Rate("91", "marketing", "INR", 0.8631, LocalDate.of(2026, 1, 1)),
                new WhatsAppRateCardService.Rate("91", "utility", "INR", 0.115, LocalDate.of(2026, 1, 1)),
                new WhatsAppRateCardService.Rate("971", "marketing", "AED", 0.12, LocalDate.of(2026, 1, 1)),
                new WhatsAppRateCardService.Rate("9", "marketing", "USD", 9.99, LocalDate.of(2026, 1, 1)));

        @Test
        void picksTheLatestRateInEffectOnTheDay() {
            WhatsAppRateCardService c = card(rates);

            assertEquals(0.8631, c.priceFor("919876500001", "MARKETING", LocalDate.of(2026, 10, 29)).rate());
            assertEquals(0.7846, c.priceFor("919876500001", "marketing", LocalDate.of(2025, 6, 1)).rate());
        }

        @Test
        void longestCountryCodeWins() {
            WhatsAppRateCardService.Price p = card(rates).priceFor("+971 50 123 4567", "marketing",
                    LocalDate.of(2026, 10, 29));

            assertEquals("971", p.countryCode());
            assertEquals("AED", p.currency());
        }

        @Test
        void noRateIsNullNotZero() {
            WhatsAppRateCardService c = card(rates);

            assertNull(c.priceFor("919876500001", "authentication", LocalDate.of(2026, 10, 29)));
            assertNull(c.priceFor("447700900123", "marketing", LocalDate.of(2026, 10, 29)));
            assertNull(c.priceFor("919876500001", "utility", LocalDate.of(2025, 6, 1)));
        }

        @SuppressWarnings("unchecked")
        @Test
        void anUnreadableRateCardFailsLoudlyInsteadOfPricingAtZero() {
            NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
            when(jdbc.query(anyString(), any(SqlParameterSource.class), any(RowMapper.class)))
                    .thenThrow(new IllegalStateException("relation does not exist"));
            WhatsAppRateCardService c = new WhatsAppRateCardService(jdbc);

            assertThrows(RuntimeException.class,
                    () -> c.priceFor("919876500001", "marketing", LocalDate.of(2026, 10, 29)));
            assertFalse(rates.isEmpty());
        }
    }
}
