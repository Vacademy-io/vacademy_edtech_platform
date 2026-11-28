package vacademy.io.admin_core_service.features.commerce.common;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** How a quantity, a unit sign and a rate print for measured and counted goods. */
class CommerceUnitsTest {

    @Test
    void signs() {
        for (String metre : new String[] {"MTR", "M", "METER", "METRE", "mtr", " Mtr "}) {
            assertEquals("m", CommerceUnits.sign(metre), metre);
        }
        assertEquals("cm", CommerceUnits.sign("CMS"));
        assertEquals("kg", CommerceUnits.sign("KGS"));
        assertEquals("g", CommerceUnits.sign("GMS"));
        assertEquals("l", CommerceUnits.sign("LTR"));
        assertEquals("ml", CommerceUnits.sign("MLT"));
        assertEquals("yd", CommerceUnits.sign("YD"), "an unknown code prints in lower case");
        assertNull(CommerceUnits.sign("PCS"));
        assertNull(CommerceUnits.sign("NOS"));
        assertNull(CommerceUnits.sign(" "));
        assertNull(CommerceUnits.sign(null));
        assertEquals("g", CommerceUnits.sign("GM"), "the shop's list has GM");
    }

    /** P NIT-7: one piece-code list on the server, the admin and the shop. */
    @Test
    void everyPieceCodeOfTheShopPrintsNoSignAndCannotCarryAMeasuredItem() {
        for (String piece : new String[] {"PCS", "PC", "NOS", "NO", "PIECE", "PIECES", "pieces", " pc "}) {
            assertNull(CommerceUnits.sign(piece), piece);
            assertFalse(CommerceUnits.measuredUnit(piece), piece);
        }
        assertFalse(CommerceUnits.measuredUnit(""));
        assertFalse(CommerceUnits.measuredUnit(null));
        assertTrue(CommerceUnits.measuredUnit("MTR"));
        assertTrue(CommerceUnits.measuredUnit("YD"));
        assertEquals("2.5", CommerceUnits.quantity(25, 10, "PIECE"));
    }

    /** P NIT-1: a Hindi email prints the shop's word. */
    @Test
    void hindiQuantities() {
        assertEquals("2.5 मी", CommerceUnits.shortQuantityHindi(25, 10, "MTR"));
        assertEquals("1.25 किग्रा", CommerceUnits.shortQuantityHindi(1250, 1000, "KGS"));
        assertEquals("1.5 yd", CommerceUnits.shortQuantityHindi(15, 10, "YD"));
        assertEquals("2", CommerceUnits.shortQuantityHindi(2, 1, "PCS"));
        assertEquals("मी", CommerceUnits.hindiSign("MTR"));
        assertNull(CommerceUnits.hindiSign("PCS"));
    }

    @Test
    void quantities() {
        assertEquals("2.5 m", CommerceUnits.quantity(25, 10, "MTR"));
        assertEquals("3 m", CommerceUnits.quantity(30, 10, "MTR"));
        assertEquals("3.4 m", CommerceUnits.quantity(34, 10, "MTR"));
        assertEquals("0.07 m", CommerceUnits.quantity(7, 100, "MTR"));
        assertEquals("1.25 kg", CommerceUnits.quantity(1250, 1000, "KGS"));
        assertEquals("1.5 yd", CommerceUnits.quantity(15, 10, "YD"));
        assertEquals("2 PCS", CommerceUnits.quantity(2, 1, "PCS"), "a counted line keeps its old text");
        assertEquals("2", CommerceUnits.quantity(2, 1, null));
        assertEquals("2.5", CommerceUnits.quantity(25, 10, "PCS"), "a measured line with no sign prints the number");
        assertEquals("2.5 m", CommerceUnits.shortQuantity(25, 10, "MTR"));
        assertEquals("2", CommerceUnits.shortQuantity(2, 1, "PCS"));
        assertEquals("2.5", CommerceUnits.number(25, 10));
        assertEquals("-2.5", CommerceUnits.number(-25, 10));
        assertEquals("120", CommerceUnits.number(120, 1));
        assertEquals("12", CommerceUnits.number(120, 10));
    }

    @Test
    void ratesPerDisplayUnit() {
        assertEquals(new BigDecimal("123.40"), CommerceUnits.perUnit(new BigDecimal("12.34"), 10));
        assertEquals(new BigDecimal("450.00"), CommerceUnits.perUnit(new BigDecimal("450"), 1));
        assertNull(CommerceUnits.perUnit(null, 10));
        assertEquals(" / m", CommerceUnits.rateSuffix(10, "MTR"));
        assertEquals("", CommerceUnits.rateSuffix(1, "MTR"), "a counted rate has no unit");
        assertEquals("", CommerceUnits.rateSuffix(10, "PCS"));
    }

    @Test
    void allowedScales() {
        for (int scale : new int[] {1, 10, 100, 1000}) {
            assertTrue(CommerceUnits.allowedScale(scale), "scale " + scale);
        }
        for (int scale : new int[] {0, 2, 4, 7, 50, 10000}) {
            assertFalse(CommerceUnits.allowedScale(scale), "scale " + scale);
        }
    }
}
