package io.vacademy.admin.app.panel.update;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * The checks the direct-channel updater applies before it downloads or installs an APK.
 * Plain Java with no Android types, so the rules are unit-tested on the JVM
 * (src/testDirect). {@link PanelUpdaterPlugin} calls these; it never decides on its own.
 */
public final class UpdateRules {

    /** Download overrun allowed above the size the server announced. */
    public static final long SIZE_SLACK_BYTES = 1024L * 1024L;
    /** No classroom APK comes close to this; a larger announced size is refused outright. */
    public static final long MAX_APK_BYTES = 300L * 1024L * 1024L;

    private UpdateRules() {}

    /**
     * The update hosts this build was made with ({@code R.string.panel_update_hosts}, comma
     * separated), lower-cased, blanks dropped.
     */
    public static List<String> parseHosts(String commaSeparated) {
        if (commaSeparated == null || commaSeparated.trim().isEmpty()) return Collections.emptyList();
        List<String> hosts = new ArrayList<>();
        for (String part : commaSeparated.split(",")) {
            String host = part.trim().toLowerCase(Locale.ROOT);
            if (!host.isEmpty()) hosts.add(host);
        }
        return hosts;
    }

    /**
     * The URI when {@code url} is an absolute https URL on the default port, without user
     * info, whose host is exactly one of {@code allowedHosts}. Otherwise null.
     */
    public static URI allowedDownloadUri(String url, List<String> allowedHosts) {
        if (url == null || url.isEmpty() || allowedHosts == null || allowedHosts.isEmpty()) return null;
        if (!url.equals(url.trim()) || url.indexOf('\\') >= 0) return null;
        for (int i = 0; i < url.length(); i++) {
            char c = url.charAt(i);
            if (c <= 0x20 || c >= 0x7f) return null;
        }
        URI uri;
        try {
            uri = new URI(url);
        } catch (URISyntaxException e) {
            return null;
        }
        if (!uri.isAbsolute() || uri.isOpaque()) return null;
        if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
        if (uri.getRawUserInfo() != null) return null;
        if (uri.getPort() != -1 && uri.getPort() != 443) return null;
        String host = uri.getHost();
        if (host == null || host.isEmpty()) return null;
        if (!allowedHosts.contains(host.toLowerCase(Locale.ROOT))) return null;
        return uri;
    }

    /** Lower-case hex when {@code value} is exactly 64 hex characters, else null. */
    public static String normalizeSha256(String value) {
        if (value == null) return null;
        String hex = value.trim().toLowerCase(Locale.ROOT);
        if (hex.length() != 64) return null;
        for (int i = 0; i < hex.length(); i++) {
            char c = hex.charAt(i);
            boolean ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            if (!ok) return null;
        }
        return hex;
    }

    /**
     * A whole number from a JSON value (Integer, Long, or a Double without a fraction), else
     * null. Strings are not accepted.
     */
    public static Long wholeNumber(Object value) {
        if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) {
            return ((Number) value).longValue();
        }
        if (value instanceof Double || value instanceof Float) {
            double d = ((Number) value).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d) || d != Math.rint(d) || Math.abs(d) > 9.007199254740991E15) return null;
            return (long) d;
        }
        return null;
    }

    /** True when the announced size is usable: positive and below {@link #MAX_APK_BYTES}. */
    public static boolean isAcceptableSize(long announcedBytes) {
        return announcedBytes > 0 && announcedBytes <= MAX_APK_BYTES;
    }

    /** True once a download has gone past what the server announced plus the slack. */
    public static boolean exceedsAnnounced(long receivedBytes, long announcedBytes) {
        return receivedBytes > announcedBytes + SIZE_SLACK_BYTES;
    }

    /** Lower-case hex of {@code bytes}. */
    public static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16));
            sb.append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    /**
     * Why a downloaded archive may not replace the installed app, or null when it may.
     *
     * @param installedPackage this app's package name
     * @param installedVersionCode this app's version code
     * @param installedSigners SHA-256 hex digests of the installed app's signing certificates
     * @param archivePackage the archive's package name (null when it could not be parsed)
     * @param archiveVersionCode the archive's version code
     * @param expectedVersionCode the version code the server announced
     * @param archiveSigners SHA-256 hex digests of the archive's signing certificates
     * @param archiveMinSdk the archive's minSdkVersion (0 when unknown)
     * @param deviceSdk this device's SDK level
     */
    public static String archiveProblem(
        String installedPackage,
        long installedVersionCode,
        List<String> installedSigners,
        String archivePackage,
        long archiveVersionCode,
        long expectedVersionCode,
        List<String> archiveSigners,
        int archiveMinSdk,
        int deviceSdk
    ) {
        if (archivePackage == null) return UpdateErrors.INVALID_APK;
        if (!archivePackage.equals(installedPackage)) return UpdateErrors.PACKAGE_MISMATCH;
        if (archiveVersionCode != expectedVersionCode) return UpdateErrors.VERSION_MISMATCH;
        if (archiveVersionCode <= installedVersionCode) return UpdateErrors.NOT_NEWER;
        if (!sameSigners(installedSigners, archiveSigners)) return UpdateErrors.SIGNATURE_MISMATCH;
        if (archiveMinSdk > 0 && archiveMinSdk > deviceSdk) return UpdateErrors.SDK_TOO_LOW;
        return null;
    }

    /**
     * True only when both sides have at least one certificate and the two sets are equal.
     * Duplicates are ignored; an empty or missing side never matches.
     */
    public static boolean sameSigners(List<String> a, List<String> b) {
        if (a == null || b == null || a.isEmpty() || b.isEmpty()) return false;
        List<String> left = distinctLower(a);
        List<String> right = distinctLower(b);
        if (left == null || right == null) return false;
        return left.size() == right.size() && left.containsAll(right);
    }

    private static List<String> distinctLower(List<String> values) {
        List<String> out = new ArrayList<>();
        for (String v : values) {
            if (v == null || v.isEmpty()) return null;
            String lower = v.toLowerCase(Locale.ROOT);
            if (!out.contains(lower)) out.add(lower);
        }
        return out;
    }
}
