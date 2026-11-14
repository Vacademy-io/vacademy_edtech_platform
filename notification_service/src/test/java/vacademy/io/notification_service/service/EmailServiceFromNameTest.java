package vacademy.io.notification_service.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * From-header display name for outbound mail. The inbox reply path passes the institute's
 * sender as a bare address with no name; the configured "Name <addr>" name must still be used,
 * or Gmail shows the local-part ("neeraj") as the sender.
 */
class EmailServiceFromNameTest {

    private static final String CONFIGURED = "Neeraj from Vacademy <neeraj@vacademy.ai>";

    @Test
    @DisplayName("bare custom address that is the configured sender reuses the configured name")
    void bareAddressMatchingConfiguredSenderGetsConfiguredName() {
        assertThat(EmailService.resolveFromName("neeraj@vacademy.ai", null, CONFIGURED))
                .isEqualTo("Neeraj from Vacademy");
        assertThat(EmailService.resolveFromName("  NEERAJ@vacademy.ai ", "  ", CONFIGURED))
                .isEqualTo("Neeraj from Vacademy");
    }

    @Test
    void explicitCustomNameWins() {
        assertThat(EmailService.resolveFromName("neeraj@vacademy.ai", "Admissions Desk", CONFIGURED))
                .isEqualTo("Admissions Desk");
    }

    @Test
    @DisplayName("a different custom address, or a formatted one, gets no injected name")
    void otherOrFormattedCustomAddressesAreLeftAlone() {
        assertThat(EmailService.resolveFromName("other@vacademy.ai", null, CONFIGURED)).isNull();
        assertThat(EmailService.resolveFromName("Someone <neeraj@vacademy.ai>", null, CONFIGURED)).isNull();
        assertThat(EmailService.resolveFromName(null, null, CONFIGURED)).isNull();
    }

    @Test
    void configuredSenderWithoutANameYieldsNull() {
        assertThat(EmailService.resolveFromName("neeraj@vacademy.ai", null, "neeraj@vacademy.ai")).isNull();
    }
}
