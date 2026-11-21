package vacademy.io.admin_core_service.features.commerce.shipment.carrier;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Staff booked the courier themselves: the courier name, the tracking number and an optional
 * https tracking link are typed. Nothing is called.
 */
@Component
public class ManualCarrierAdapter implements CarrierAdapter {

    static final Pattern TRACKING = Pattern.compile("^[A-Za-z0-9 _/.-]{1,64}$");
    static final int MAX_NAME = 100;
    static final int MAX_URL = 500;

    @Override
    public String code() {
        return CommerceShipment.CARRIER_MANUAL;
    }

    @Override
    public Booked book(Booking booking) {
        if (booking == null) {
            throw new InvalidRequestException("VALIDATION: the courier is required");
        }
        String name = carrierName(booking.carrierName(), true);
        String tracking = trackingNumber(booking.trackingNumber(), true);
        String url = trackingUrl(booking.trackingUrl());
        return new Booked(code(), name, tracking, url, null);
    }

    /** A courier name of 1 to 100 characters; null when not required and blank. */
    public static String carrierName(String raw, boolean required) {
        String name = raw == null ? null : raw.trim();
        if (name == null || name.isEmpty()) {
            if (required) {
                throw new InvalidRequestException("VALIDATION: carrier_name is required (1 to 100 characters)");
            }
            return null;
        }
        if (name.length() > MAX_NAME) {
            throw new InvalidRequestException("VALIDATION: carrier_name is at most 100 characters");
        }
        return name;
    }

    /** A tracking number of 1 to 64 letters, digits, spaces and _ / . - characters. */
    public static String trackingNumber(String raw, boolean required) {
        String number = raw == null ? null : raw.trim();
        if (number == null || number.isEmpty()) {
            if (required) {
                throw new InvalidRequestException("VALIDATION: tracking_number is required");
            }
            return null;
        }
        if (!TRACKING.matcher(number).matches()) {
            throw new InvalidRequestException("VALIDATION: tracking_number is 1 to 64 letters, digits, spaces "
                    + "or _ / . -");
        }
        return number;
    }

    /** An https link of at most 500 characters, or null. */
    public static String trackingUrl(String raw) {
        String url = raw == null ? null : raw.trim();
        if (url == null || url.isEmpty()) {
            return null;
        }
        if (url.length() > MAX_URL) {
            throw new InvalidRequestException("VALIDATION: tracking_url is at most 500 characters");
        }
        try {
            URI uri = URI.create(url);
            if (uri.getScheme() == null || !"https".equals(uri.getScheme().toLowerCase(Locale.ROOT))
                    || uri.getHost() == null || uri.getHost().isBlank() || uri.getUserInfo() != null) {
                throw new IllegalArgumentException("not https");
            }
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException("VALIDATION: tracking_url must be an https link");
        }
        return url;
    }
}
