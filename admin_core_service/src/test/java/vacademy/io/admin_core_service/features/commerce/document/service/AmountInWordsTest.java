package vacademy.io.admin_core_service.features.commerce.document.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.tax.service.GstinValidator;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AmountInWordsTest {

    @Test
    void amountsAreSpelledInTheIndianSystem() {
        assertEquals("Rupees Zero Only", AmountInWords.rupees(new BigDecimal("0.00")));
        assertEquals("Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only",
                AmountInWords.rupees(new BigDecimal("1234.50")));
        assertEquals("Rupees One Lakh Only", AmountInWords.rupees(new BigDecimal("100000")));
        assertEquals("Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Five Paise Only",
                AmountInWords.rupees(new BigDecimal("1234567.05")));
        assertEquals("Rupees Two Crore Five Only", AmountInWords.rupees(new BigDecimal("20000005")));
        assertEquals("Rupees Nineteen Only", AmountInWords.rupees(new BigDecimal("19.00")));
        assertEquals("Rupees Zero and Ninety Nine Paise Only", AmountInWords.rupees(new BigDecimal("0.99")));
    }

    @Test
    void gstinShapeChecksumAndState() {
        // A well-known sample number from GST documentation, not a party to any test data.
        assertTrue(GstinValidator.isValid("27AAPFU0939F1ZV"));
        assertTrue(GstinValidator.isValid(" 27aapfu0939f1zv "));
        assertEquals("27", GstinValidator.stateCode("27AAPFU0939F1ZV"));
        assertFalse(GstinValidator.isValid("27AAPFU0939F1ZW"), "wrong check character");
        assertFalse(GstinValidator.isValid("27AAPFU0939F1Z"), "too short");
        assertFalse(GstinValidator.isValid("00AAPFU0939F1ZV"), "state 00");
        assertFalse(GstinValidator.isValid("2AAAPFU0939F1ZV"), "state must be two digits");
        assertFalse(GstinValidator.isValid(null));
        assertNull(GstinValidator.normalise("   "));
    }
}
