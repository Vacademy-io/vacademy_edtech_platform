package vacademy.io.admin_core_service.features.commerce.shipment.carrier;

import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.InvalidRequestException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** What staff type for a courier they booked themselves: checked, trimmed, never called out. */
class ManualCarrierAdapterTest {

    private final ManualCarrierAdapter adapter = new ManualCarrierAdapter();

    private static void refused(Runnable call) {
        InvalidRequestException e = assertThrows(InvalidRequestException.class, call::run);
        assertTrue(e.getMessage().startsWith("VALIDATION: "), e.getMessage());
    }

    @Test
    void aGoodBookingIsTrimmedAndStoredAsManual() {
        CarrierAdapter.Booked booked = adapter.book(new CarrierAdapter.Booking("  India Post ", " EM123456789IN ",
                "https://www.indiapost.gov.in/track?id=EM123456789IN", 500));
        assertEquals("MANUAL", booked.carrierCode());
        assertEquals("India Post", booked.carrierName());
        assertEquals("EM123456789IN", booked.trackingNumber());
        assertEquals("https://www.indiapost.gov.in/track?id=EM123456789IN", booked.trackingUrl());
        assertNull(booked.payloadJson());
        assertEquals("MANUAL", adapter.code());
    }

    @Test
    void theCourierAndTheTrackingNumberAreRequired() {
        refused(() -> adapter.book(null));
        refused(() -> adapter.book(new CarrierAdapter.Booking(" ", "AB1", null, null)));
        refused(() -> adapter.book(new CarrierAdapter.Booking("Courier", null, null, null)));
        refused(() -> adapter.book(new CarrierAdapter.Booking("x".repeat(101), "AB1", null, null)));
        assertEquals("x".repeat(100), adapter.book(new CarrierAdapter.Booking("x".repeat(100), "AB1", null, null))
                .carrierName());
    }

    @Test
    void aTrackingNumberIsLettersDigitsAndAFewMarks() {
        assertEquals("AB 12/34.5_6-7", ManualCarrierAdapter.trackingNumber("AB 12/34.5_6-7", true));
        assertEquals("A".repeat(64), ManualCarrierAdapter.trackingNumber("A".repeat(64), true));
        refused(() -> ManualCarrierAdapter.trackingNumber("A".repeat(65), true));
        refused(() -> ManualCarrierAdapter.trackingNumber("AB<script>", true));
        refused(() -> ManualCarrierAdapter.trackingNumber("AB\n12", true));
        assertNull(ManualCarrierAdapter.trackingNumber("  ", false), "optional on a correction");
    }

    @Test
    void theTrackingLinkIsHttpsOnly() {
        assertNull(ManualCarrierAdapter.trackingUrl(null));
        assertNull(ManualCarrierAdapter.trackingUrl("  "));
        refused(() -> ManualCarrierAdapter.trackingUrl("http://courier.example/track"));
        refused(() -> ManualCarrierAdapter.trackingUrl("javascript:alert(1)"));
        refused(() -> ManualCarrierAdapter.trackingUrl("https://"));
        refused(() -> ManualCarrierAdapter.trackingUrl("https://user:pass@courier.example/t"));
        refused(() -> ManualCarrierAdapter.trackingUrl("https://courier.example/" + "a".repeat(500)));
        refused(() -> ManualCarrierAdapter.trackingUrl("https://bad host/"));
        assertEquals("HTTPS://Courier.example/t", ManualCarrierAdapter.trackingUrl("HTTPS://Courier.example/t"));
    }
}
