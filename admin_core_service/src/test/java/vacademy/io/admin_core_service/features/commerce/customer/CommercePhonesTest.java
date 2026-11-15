package vacademy.io.admin_core_service.features.commerce.customer;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class CommercePhonesTest {

    @Test
    void anIndianMobileHasOneSpelling() {
        assertEquals("919876543210", CommercePhones.normalise("9876543210"));
        assertEquals("919876543210", CommercePhones.normalise("09876543210"));
        assertEquals("919876543210", CommercePhones.normalise("919876543210"));
        assertEquals("919876543210", CommercePhones.normalise("+91 98765 43210"));
        assertEquals("919876543210", CommercePhones.normalise("+91-98765-43210"));
        assertEquals("919876543210", CommercePhones.normalise(" (+91) 9876543210 "));
    }

    @Test
    void whatIsNotAPhoneIsNull() {
        assertNull(CommercePhones.normalise(null));
        assertNull(CommercePhones.normalise(""));
        assertNull(CommercePhones.normalise("98765"));
        assertNull(CommercePhones.normalise("1234567890"));
        assertNull(CommercePhones.normalise("98765x3210"));
        assertNull(CommercePhones.normalise("9876543210; DROP"));
        // Eleven digits and more are a number of another country only with a plus sign.
        assertNull(CommercePhones.normalise("447911123456"));
        assertEquals("447911123456", CommercePhones.normalise("+44 7911 123456"));
        assertNull(CommercePhones.normalise("+1234567890123456"));
    }

    @Test
    void theMaskKeepsFourDigits() {
        assertEquals("••••••3210", CommercePhones.mask("919876543210"));
        assertNull(CommercePhones.mask(null));
        assertNull(CommercePhones.mask("12"));
    }
}
