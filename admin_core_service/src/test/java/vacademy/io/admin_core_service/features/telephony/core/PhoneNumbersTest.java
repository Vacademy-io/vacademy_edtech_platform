package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PhoneNumbersTest {

    /** Incident 2026-09-11: 43 leads stored as "…94.0" were dialled as Sri Lanka. */
    @Test
    void spreadsheetFloatSuffixIsNotACountryCode() {
        assertEquals("+919425677707", PhoneNumbers.toE164("9425677707.0"));
        assertEquals("+919425677707", PhoneNumbers.toE164("9425677707.00"));
        assertEquals("+919425677707", PhoneNumbers.toE164(" 9425677707.0 "));
    }

    @Test
    void scientificNotationHasAlreadyLostDigitsAndIsRefused() {
        assertNull(PhoneNumbers.toE164("9.425677707E9"));
        assertNull(PhoneNumbers.toE164("9.43E+09"));
    }

    @Test
    void indianFormsAllResolveToPlus91() {
        assertEquals("+919425677707", PhoneNumbers.toE164("9425677707"));
        assertEquals("+919425677707", PhoneNumbers.toE164("09425677707"));
        assertEquals("+919425677707", PhoneNumbers.toE164("919425677707"));
        assertEquals("+919425677707", PhoneNumbers.toE164("+91 94256 77707"));
        assertEquals("+919425677707", PhoneNumbers.toE164("+91-94256-77707"));
    }

    @Test
    void genuineInternationalNumbersPassThrough() {
        assertEquals("+971501234567", PhoneNumbers.toE164("+971 50 123 4567"));
        assertEquals("+14155552671", PhoneNumbers.toE164("+1 (415) 555-2671"));
    }

    @Test
    void nothingDialableIsNull() {
        assertNull(PhoneNumbers.toE164(null));
        assertNull(PhoneNumbers.toE164(""));
        assertNull(PhoneNumbers.toE164("n/a"));
        assertNull(PhoneNumbers.toE164("98765"));                 // too short to be a phone
        assertNull(PhoneNumbers.toE164("1234567890123456"));      // 16 digits: not a phone
    }
}
