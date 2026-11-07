package vacademy.io.admin_core_service.features.catalog_api.website;

import java.net.IDN;
import java.util.Collection;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Host rules for approved websites and the Catalogue API origin lock. Pure, no I/O.
 *
 * <ul>
 *   <li>{@link #normalize}: what an admin types ("https://www.x.com/path", "X.com:3000") to the
 *       stored host ("www.x.com", "x.com"): lower-case ASCII (punycode), no port, no trailing
 *       dot. IP literals, localhost, single-label and malformed hosts are refused.</li>
 *   <li>{@link #originHost}: the host of a browser {@code Origin} header, or null.</li>
 *   <li>{@link #covers}: a verified host covers itself and its subdomains, matched on label
 *       boundaries only ({@code x.com} covers {@code www.x.com}, never {@code evilx.com} or
 *       {@code x.com.evil.io}).</li>
 * </ul>
 */
public final class WebsiteHosts {

    public static final int MAX_HOST_LENGTH = 253;
    private static final int MAX_INPUT_LENGTH = 2048;

    /** One LDH label after IDN conversion: 1-63 chars, no leading or trailing hyphen. */
    private static final Pattern LABEL = Pattern.compile("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$");
    private static final Pattern DIGITS = Pattern.compile("^[0-9]+$");
    private static final Pattern PORT = Pattern.compile("^[0-9]{1,5}$");

    private WebsiteHosts() {
    }

    /**
     * The stored form of a website host typed by an admin.
     *
     * @throws IllegalArgumentException with a message fit for the admin when it is not a usable host
     */
    public static String normalize(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Enter a website address, e.g. www.example.com.");
        }
        String s = raw.trim();
        if (s.length() > MAX_INPUT_LENGTH) {
            throw new IllegalArgumentException("That website address is too long.");
        }
        int scheme = s.indexOf("://");
        if (scheme >= 0) {
            String proto = s.substring(0, scheme).toLowerCase(Locale.ROOT);
            if (!proto.equals("http") && !proto.equals("https")) {
                throw new IllegalArgumentException("Only http and https websites can be added.");
            }
            s = s.substring(scheme + 3);
        }
        s = cutAt(s, '/', '?', '#');
        if (s.indexOf('@') >= 0) {
            throw new IllegalArgumentException("Enter just the website address, without a user name.");
        }
        if (s.startsWith("[") || s.chars().filter(c -> c == ':').count() > 1) {
            throw new IllegalArgumentException("IP addresses cannot be added. Use the website's domain name.");
        }
        int colon = s.indexOf(':');
        if (colon >= 0) {
            if (!PORT.matcher(s.substring(colon + 1)).matches()) {
                throw new IllegalArgumentException("That website address has an invalid port.");
            }
            s = s.substring(0, colon);
        }
        String host = toAsciiHost(s);
        if (host == null) {
            throw new IllegalArgumentException("\"" + abbreviate(raw.trim()) + "\" is not a valid website address.");
        }
        if (isIpv4Like(host)) {
            throw new IllegalArgumentException("IP addresses cannot be added. Use the website's domain name.");
        }
        if (host.equals("localhost") || host.endsWith(".localhost")) {
            throw new IllegalArgumentException(
                    "localhost does not need to be added: local development is always allowed.");
        }
        if (host.indexOf('.') < 0) {
            throw new IllegalArgumentException("Enter a full domain name, e.g. www.example.com.");
        }
        return host;
    }

    /**
     * The host of an {@code Origin} header value ({@code scheme://host[:port]}), normalised like
     * stored hosts; IP literals are kept ({@code 127.0.0.1}, {@code [::1]}). Null when the value
     * is not an http(s) origin (including the literal {@code null} origin of sandboxed frames and
     * file:// pages).
     */
    public static String originHost(String origin) {
        if (origin == null) {
            return null;
        }
        String s = origin.trim();
        if (s.isEmpty() || s.length() > MAX_INPUT_LENGTH) {
            return null;
        }
        int scheme = s.indexOf("://");
        if (scheme < 0) {
            return null;
        }
        String proto = s.substring(0, scheme).toLowerCase(Locale.ROOT);
        if (!proto.equals("http") && !proto.equals("https")) {
            return null;
        }
        String authority = cutAt(s.substring(scheme + 3), '/', '?', '#');
        if (authority.isEmpty() || authority.indexOf('@') >= 0) {
            return null;
        }
        if (authority.startsWith("[")) {
            int end = authority.indexOf(']');
            if (end < 0) {
                return null;
            }
            String rest = authority.substring(end + 1);
            if (!rest.isEmpty() && !(rest.startsWith(":") && PORT.matcher(rest.substring(1)).matches())) {
                return null;
            }
            return authority.substring(0, end + 1).toLowerCase(Locale.ROOT);
        }
        int colon = authority.indexOf(':');
        if (colon >= 0) {
            if (!PORT.matcher(authority.substring(colon + 1)).matches()) {
                return null;
            }
            authority = authority.substring(0, colon);
        }
        return toAsciiHost(authority);
    }

    /** localhost, 127.0.0.1 or [::1] (any port, http or https): an institute's local development. */
    public static boolean isLocalDevHost(String host) {
        return "localhost".equals(host) || "127.0.0.1".equals(host) || "[::1]".equals(host);
    }

    /** True when {@code host} equals {@code verifiedHost} or is a subdomain of it (label boundary). */
    public static boolean covers(String verifiedHost, String host) {
        if (verifiedHost == null || host == null || verifiedHost.isEmpty()) {
            return false;
        }
        return host.equals(verifiedHost) || host.endsWith("." + verifiedHost);
    }

    /** True when any of {@code verifiedHosts} covers {@code host}. */
    public static boolean coveredByAny(Collection<String> verifiedHosts, String host) {
        if (verifiedHosts == null || host == null) {
            return false;
        }
        for (String v : verifiedHosts) {
            if (covers(v, host)) {
                return true;
            }
        }
        return false;
    }

    /** The DNS name that holds the verification TXT record of a normalised host. */
    public static String verificationRecordName(String host) {
        return "_vacademy-verification." + host;
    }

    /**
     * Lower-case punycode host with every label valid, or null. A single trailing dot (FQDN form)
     * is dropped.
     */
    private static String toAsciiHost(String s) {
        String h = s.trim();
        if (h.endsWith(".")) {
            h = h.substring(0, h.length() - 1);
        }
        if (h.isEmpty()) {
            return null;
        }
        String ascii;
        try {
            ascii = IDN.toASCII(h, IDN.USE_STD3_ASCII_RULES).toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException e) {
            return null;
        }
        if (ascii.isEmpty() || ascii.length() > MAX_HOST_LENGTH) {
            return null;
        }
        for (String label : ascii.split("\\.", -1)) {
            if (!LABEL.matcher(label).matches()) {
                return null;
            }
        }
        return ascii;
    }

    /** Dotted all-numeric (1.2.3.4) or an all-numeric last label: never a registrable domain. */
    private static boolean isIpv4Like(String host) {
        String[] labels = host.split("\\.");
        return DIGITS.matcher(labels[labels.length - 1]).matches();
    }

    private static String cutAt(String s, char... stops) {
        int end = s.length();
        for (char c : stops) {
            int i = s.indexOf(c);
            if (i >= 0 && i < end) {
                end = i;
            }
        }
        return s.substring(0, end);
    }

    private static String abbreviate(String s) {
        return s.length() <= 80 ? s : s.substring(0, 80) + "…";
    }
}
