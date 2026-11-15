package vacademy.io.admin_core_service.features.commerce.otp;

/**
 * Why a shopper proves a phone number. A verified-phone token is good for its own purpose
 * only, so a code asked for on the track-order form cannot place a COD order.
 */
public enum CommerceOtpPurpose {
    /** The typed track-order form. */
    TRACK_ORDER,
    /** Before an online COD order is created (WP-31). */
    COD,
    /** Before or during checkout (proves the buyer's phone), and to see own orders. */
    CHECKOUT,
    /** The shop's account page: own orders, addresses and consent. */
    ACCOUNT;

    /** The purpose of a name sent by a client, or null. Case is ignored. */
    public static CommerceOtpPurpose of(String name) {
        if (name == null) {
            return null;
        }
        for (CommerceOtpPurpose purpose : values()) {
            if (purpose.name().equalsIgnoreCase(name.trim())) {
                return purpose;
            }
        }
        return null;
    }
}
