package vacademy.io.admin_core_service.features.regional_pricing.service;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Arrays;
import java.util.Currency;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * The viewer's country, worked out on the server from the client IP.
 *
 * <p>The API is served straight from ingress-nginx (no CDN in front), and ingress-nginx sets
 * {@code X-Real-IP} to the TCP peer, overwriting anything the client sends. That IP is looked
 * up in the bundled country database ({@link GeoIpCountryLookup}). Country headers sent by the
 * client (CF-IPCountry and the like) are NOT trusted: without an edge in front that overwrites
 * them, anyone could pick the cheapest region by sending one. If the API is later put behind
 * an edge that stamps a country header, name it in {@code regional.pricing.country-headers}
 * and it is used before the IP lookup.
 */
@Component
@RequiredArgsConstructor
public class ViewerCountryResolver {

    private final GeoIpCountryLookup geoIpCountryLookup;

    /** Edge-stamped country headers to trust, comma-separated. Empty by default (none trusted). */
    @Value("${regional.pricing.country-headers:}")
    private String trustedCountryHeaders;

    /** Header carrying the real client IP, set by the ingress. */
    @Value("${regional.pricing.client-ip-header:X-Real-IP}")
    private String clientIpHeader;

    /** ISO-3166 alpha-2 country of the current HTTP request, if it can be determined. */
    public Optional<String> currentCountry() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        if (!(attrs instanceof ServletRequestAttributes servletAttrs)) {
            return Optional.empty();
        }
        HttpServletRequest request = servletAttrs.getRequest();
        for (String header : trustedHeaders()) {
            String normalized = normalize(request.getHeader(header));
            if (normalized != null) {
                return Optional.of(normalized);
            }
        }
        return geoIpCountryLookup.countryOf(clientIp(request));
    }

    private List<String> trustedHeaders() {
        if (!StringUtils.hasText(trustedCountryHeaders)) {
            return List.of();
        }
        return Arrays.stream(trustedCountryHeaders.split(",")).map(String::trim).filter(StringUtils::hasText).toList();
    }

    private String clientIp(HttpServletRequest request) {
        String fromIngress = request.getHeader(clientIpHeader);
        return StringUtils.hasText(fromIngress) ? fromIngress.trim() : request.getRemoteAddr();
    }

    /** Local currency of a country (IN → INR, US → USD), or empty when the JDK has none. */
    public static Optional<String> currencyOf(String countryCode) {
        if (countryCode == null) {
            return Optional.empty();
        }
        try {
            Currency c = Currency.getInstance(new Locale("", countryCode));
            return c == null ? Optional.empty() : Optional.of(c.getCurrencyCode());
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /** XX (unknown) and T1 (Tor) are not countries. */
    static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase();
        if (v.length() != 2 || "XX".equals(v) || "T1".equals(v) || !Character.isLetter(v.charAt(0))
                || !Character.isLetter(v.charAt(1))) {
            return null;
        }
        return v;
    }
}
