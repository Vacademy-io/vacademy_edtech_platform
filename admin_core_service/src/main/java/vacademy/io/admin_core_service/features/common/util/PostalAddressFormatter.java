package vacademy.io.admin_core_service.features.common.util;

import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Turns the address columns an institute row carries (street line, city, state, pincode,
 * country) into the lines a document prints. Shared by the invoice BILL TO block and the
 * partner-affiliation certificate so the same organisation never reads two different ways.
 */
public final class PostalAddressFormatter {

    private PostalAddressFormatter() {
    }

    /**
     * Street line, then "city, state - pincode", then country — each part only when present, and
     * the city/state/pincode line only when the street line does not already carry the pincode.
     * Registrants routinely type the whole address, city and state included, into the free-text
     * line; without that check "…Dibrugarh, Assam-786003" would be followed by a second
     * "Dibrugarh, Assam - 786003".
     *
     * @return newline-separated lines; empty string when nothing is set
     */
    public static String compose(String street, String city, String state, String pinCode, String country) {
        List<String> lines = new ArrayList<>();
        String streetLine = StringUtils.hasText(street) ? dedupeSegments(street) : "";
        if (!streetLine.isEmpty()) {
            lines.add(streetLine);
        }
        boolean pinAlreadyInStreet = StringUtils.hasText(pinCode) && streetLine.contains(pinCode.trim());
        if (!pinAlreadyInStreet) {
            List<String> locality = new ArrayList<>();
            if (StringUtils.hasText(city)) {
                locality.add(city.trim());
            }
            if (StringUtils.hasText(state)) {
                locality.add(state.trim());
            }
            String localityLine = String.join(", ", locality);
            if (StringUtils.hasText(pinCode)) {
                localityLine = localityLine.isEmpty() ? pinCode.trim() : localityLine + " - " + pinCode.trim();
            }
            if (!localityLine.isEmpty()) {
                lines.add(localityLine);
            }
        }
        if (StringUtils.hasText(country)) {
            lines.add(country.trim());
        }
        return String.join("\n", lines);
    }

    /**
     * Drops comma-separated segments that already appeared earlier in the same line. The
     * registration form joins "address line 1, address line 2", and registrants routinely end
     * line 1 with the city/state/pincode and then type the same into line 2 — so the stored
     * street line reads "…, Dibrugarh, Assam-786003, Dibrugarh, Assam-786003". A repeated
     * segment is never a different place, so this only ever removes noise.
     */
    public static String dedupeSegments(String street) {
        List<String> kept = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String raw : street.split(",")) {
            String segment = raw.trim();
            if (segment.isEmpty()) {
                continue;
            }
            if (seen.add(segment.toLowerCase(Locale.ROOT))) {
                kept.add(segment);
            }
        }
        return String.join(", ", kept);
    }
}
