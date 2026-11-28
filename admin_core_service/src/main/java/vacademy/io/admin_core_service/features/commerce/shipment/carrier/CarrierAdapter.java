package vacademy.io.admin_core_service.features.commerce.shipment.carrier;

/**
 * Books a parcel with a courier. Phase 1 has only {@link ManualCarrierAdapter}: staff book the
 * courier themselves and type what it gave them. A courier API (Phase 2) implements this and is
 * called before the ship transaction, never inside it.
 */
public interface CarrierAdapter {

    /** What staff (or a courier API) say about the parcel. */
    record Booking(String carrierName, String trackingNumber, String trackingUrl, Integer weightGrams) {
    }

    /** What is stored on the shipment. */
    record Booked(String carrierCode, String carrierName, String trackingNumber, String trackingUrl,
                  String payloadJson) {
    }

    /** The carrier code stored on the shipment. */
    String code();

    /**
     * Checks and normalises a booking.
     *
     * @throws vacademy.io.common.exceptions.InvalidRequestException (400) when it is not usable
     */
    Booked book(Booking booking);
}
