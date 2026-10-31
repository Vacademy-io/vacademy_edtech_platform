package vacademy.io.admin_core_service.features.invoice.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * BILL TO for channel-partner invoices is composed from the spawned sub-org institute's
 * address columns. Registrants often type city/state/pincode into the free-text street line
 * as well, so the composer must not print them twice.
 */
class InvoicePostalAddressTest {

    @Test
    void streetLineThatAlreadyCarriesThePincodeIsNotFollowedByALocalityLine() {
        // The live smartbrains registration: line1 + line2 joined, both naming Dibrugarh/Assam.
        // The repeat is collapsed, and no third "Dibrugarh, Assam - 786003" line is appended.
        String street = "Lane L,House No. 20, West Milan Nagar, Dibrugarh, Assam-786003, Dibrugarh, Assam-786003";
        assertEquals("Lane L, House No. 20, West Milan Nagar, Dibrugarh, Assam-786003",
                InvoiceService.composePostalAddress(street, "Dibrugarh", "Assam", "786003", null));
    }

    @Test
    void repeatedSegmentsAreDroppedCaseInsensitivelyButDistinctOnesStay() {
        assertEquals("12 Park St, Kolkata, West Bengal",
                InvoiceService.dedupeAddressSegments("12 Park St, Kolkata, kolkata, West Bengal, KOLKATA"));
        assertEquals("Flat 4, Block B, Flat 4B",
                InvoiceService.dedupeAddressSegments("Flat 4, Block B, Flat 4B"));
    }

    @Test
    void localityLineIsAddedWhenTheStreetLineLacksThePincode() {
        assertEquals("25, gangapuram hapur road Ghaziabad\nGhaziabad, Uttar Pradesh - 201001",
                InvoiceService.composePostalAddress("25, gangapuram hapur road Ghaziabad",
                        "Ghaziabad", "Uttar Pradesh", "201001", null));
    }

    @Test
    void countryIsItsOwnLineOnlyWhenSet() {
        assertEquals("MG Road\nBengaluru, Karnataka - 560001\nIndia",
                InvoiceService.composePostalAddress("MG Road", "Bengaluru", "Karnataka", "560001", "India"));
        assertEquals("MG Road\nBengaluru, Karnataka - 560001",
                InvoiceService.composePostalAddress("MG Road", "Bengaluru", "Karnataka", "560001", ""));
    }

    @Test
    void blanksProduceNothingRatherThanStrayPunctuation() {
        assertEquals("", InvoiceService.composePostalAddress(null, null, null, null, null));
        assertEquals("560001", InvoiceService.composePostalAddress("", "", "", "560001", ""));
        assertEquals("Bengaluru", InvoiceService.composePostalAddress(" ", "Bengaluru", null, null, null));
    }

    @Test
    void moneyReadsAsADocumentAmount() {
        assertEquals("8,000.00", InvoiceService.money(new BigDecimal("8000.0")));
        assertEquals("1,396.00", InvoiceService.money(BigDecimal.valueOf(1396)));
        assertEquals("137.14", InvoiceService.money(new BigDecimal("137.142857")));
        assertEquals("0.00", InvoiceService.money(null));
    }
}
