package vacademy.io.notification_service.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/** A phone keeps its last four digits and an e-mail address its first letter and domain; nothing more. */
class LogMaskTest {

    @Test
    void aPhoneShowsOnlyItsLastFourDigits() {
        assertEquals("••••3210", LogMask.phone("919876543210"));
        assertEquals("••••3210", LogMask.phone("+91 98765-43210"));
        assertFalse(LogMask.phone("919876543210").contains("98765"));
        assertEquals("••••", LogMask.phone("12"));
        assertEquals("null", LogMask.phone(null));
    }

    @Test
    void anEmailShowsOnlyItsFirstLetterAndDomain() {
        assertEquals("a•••@example.com", LogMask.email("asha.k@example.com"));
        assertEquals("a•••@example.com", LogMask.email("  asha@example.com "));
        assertFalse(LogMask.email("asha.k@example.com").contains("asha"));
        assertEquals("•••", LogMask.email("not-an-address"));
        assertEquals("•••", LogMask.email("@example.com"));
        assertEquals("null", LogMask.email(null));
    }
}
