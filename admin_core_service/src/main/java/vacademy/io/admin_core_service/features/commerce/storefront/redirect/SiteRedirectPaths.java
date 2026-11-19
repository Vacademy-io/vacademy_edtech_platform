package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The two path forms a redirect row stores: {@code from_path} in the resolver's normal form
 * ({@link SiteRedirectResolver#normalise}) and {@code to_path} as plain ASCII, so it can go into
 * a {@code Location} header as it is.
 */
public final class SiteRedirectPaths {

    private static final char[] HEX = "0123456789ABCDEF".toCharArray();
    private static final Pattern SCHEME = Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*:");

    private SiteRedirectPaths() {
    }

    /**
     * Every character outside printable ASCII (a Devanagari slug, a space, a control character)
     * percent-encoded as UTF-8. What is already ASCII is kept: an existing {@code %XX} escape is
     * not encoded again and {@code ? & = #} keep their meaning; a {@code %} that starts no escape
     * becomes {@code %25}. A lone surrogate is written as U+FFFD.
     */
    public static String ascii(String value) {
        if (value == null) {
            return null;
        }
        StringBuilder out = new StringBuilder(value.length() + 16);
        int i = 0;
        while (i < value.length()) {
            int code = value.codePointAt(i);
            int width = Character.charCount(code);
            if (code == '%') {
                boolean escape = i + 2 < value.length()
                        && isHex(value.charAt(i + 1)) && isHex(value.charAt(i + 2));
                out.append(escape ? "%" : "%25");
            } else if (code > 0x20 && code < 0x7F) {
                out.append((char) code);
            } else {
                String one = Character.isSurrogate((char) code) ? "�" : new String(Character.toChars(code));
                for (byte b : one.getBytes(StandardCharsets.UTF_8)) {
                    out.append('%').append(HEX[(b >> 4) & 0xF]).append(HEX[b & 0xF]);
                }
            }
            i += width;
        }
        return out.toString();
    }

    /**
     * What an admin may type as {@code from_path}: a path, or a full {@code http(s)} URL of the old
     * site, reduced to its path and query. A {@code #fragment} is dropped (a browser never sends
     * it). Null when the value names no path. The result still has to pass
     * {@link SiteRedirectResolver#normalise}.
     */
    public static String pathOfOldAddress(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.trim();
        String lower = value.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            int hostStart = value.indexOf("://") + 3;
            int pathStart = indexOfAny(value, hostStart, "/?#");
            if (pathStart < 0) {
                return "/";
            }
            value = value.charAt(pathStart) == '/' ? value.substring(pathStart) : "/" + value.substring(pathStart);
        }
        int hash = value.indexOf('#');
        return hash < 0 ? value : value.substring(0, hash);
    }

    /** True when the value carries a {@code #fragment}. */
    public static boolean hasFragment(String raw) {
        return raw != null && raw.indexOf('#') >= 0;
    }

    /**
     * True for a value that leaves the site: one with a scheme ({@code https:}, {@code javascript:})
     * or a protocol-relative one ({@code //host}, {@code /\\host}, {@code \\host}).
     */
    public static boolean leavesSite(String value) {
        if (value == null) {
            return false;
        }
        String v = value.trim();
        if (v.startsWith("//") || v.startsWith("/\\") || v.startsWith("\\")) {
            return true;
        }
        return SCHEME.matcher(v).find();
    }

    /** The part before {@code ?} or {@code #}. */
    public static String pathPart(String value) {
        int end = indexOfAny(value, 0, "?#");
        return end < 0 ? value : value.substring(0, end);
    }

    /**
     * What is wrong with a target once its path is read the way a browser or a later reader may
     * read it: percent-decoded once, slashes left as they are. {@code OFF_SITE_TARGET} for a path
     * that then starts with {@code //} or {@code /\}, holds a backslash or has a {@code .} or
     * {@code ..} segment (each can turn into another host or climb out of the path);
     * {@code INVALID_TO_PATH} for a control character; null when the path is fine.
     */
    public static String targetProblem(String target) {
        if (target == null) {
            return null;
        }
        String decoded = decodePath(pathPart(target));
        if (decoded.startsWith("//") || decoded.startsWith("/\\") || decoded.indexOf('\\') >= 0) {
            return "OFF_SITE_TARGET";
        }
        for (String segment : decoded.split("/", -1)) {
            if (".".equals(segment) || "..".equals(segment)) {
                return "OFF_SITE_TARGET";
            }
        }
        for (int i = 0; i < decoded.length(); i++) {
            char c = decoded.charAt(i);
            if (c < 0x20 || c == 0x7F) {
                return "INVALID_TO_PATH";
            }
        }
        return null;
    }

    /**
     * Every {@code %XX} escape decoded once, as UTF-8 (a broken sequence becomes U+FFFD); a
     * {@code %} that starts no escape and a {@code +} are kept. Nothing else is changed: slashes
     * are not collapsed and no Unicode normal form is applied.
     */
    public static String decodePath(String value) {
        if (value == null || value.indexOf('%') < 0) {
            return value;
        }
        StringBuilder out = new StringBuilder(value.length());
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int i = 0;
        while (i < value.length()) {
            char c = value.charAt(i);
            if (c == '%' && i + 2 < value.length()
                    && isHex(value.charAt(i + 1)) && isHex(value.charAt(i + 2))) {
                bytes.write(Integer.parseInt(value.substring(i + 1, i + 3), 16));
                i += 3;
                continue;
            }
            if (bytes.size() > 0) {
                out.append(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
                bytes.reset();
            }
            out.append(c);
            i++;
        }
        if (bytes.size() > 0) {
            out.append(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        }
        return out.toString();
    }

    /**
     * A stored {@code from_path} as a file the import takes back to the same row: the path part is
     * stored decoded, so a {@code %} in it is a percent sign and is written as {@code %25} (the
     * import decodes once). The query part is stored as a browser sends it and is written as it is.
     */
    public static String fromPathForFile(String fromPath) {
        if (fromPath == null) {
            return null;
        }
        int at = fromPath.indexOf('?');
        String path = at < 0 ? fromPath : fromPath.substring(0, at);
        return path.replace("%", "%25") + (at < 0 ? "" : fromPath.substring(at));
    }

    private static boolean isHex(char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    }

    private static int indexOfAny(String value, int from, String chars) {
        for (int i = from; i < value.length(); i++) {
            if (chars.indexOf(value.charAt(i)) >= 0) {
                return i;
            }
        }
        return -1;
    }
}
