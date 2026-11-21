package vacademy.io.admin_core_service.core.external;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Locale;

/**
 * Decides whether an outbound request target configured by an institute (an automation HTTP node)
 * points at a public address. Same address rules as the AI-calling webhook URL check
 * ({@code AiCallingWebhookService.validateUrl}): every resolved address must be public -- not
 * loopback, private (site-local), link-local (incl. the cloud metadata address), any-local,
 * multicast, IPv6 unique-local or carrier-grade NAT. Unlike that check, http and any port are
 * allowed, because self-hosted LMS sites are reached over plain http on custom ports.
 */
public final class OutboundUrlGuard {

    private OutboundUrlGuard() {
    }

    /** Null when the URL may be called; otherwise a short reason (safe to log: no path or query). */
    public static String blockReason(URI uri) {
        if (uri == null) {
            return "no URL";
        }
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
            return "scheme is not http/https";
        }
        if (uri.getRawUserInfo() != null) {
            return "URL contains credentials";
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            return "URL has no host";
        }
        String h = host.toLowerCase(Locale.ROOT);
        if (h.endsWith(".")) {
            h = h.substring(0, h.length() - 1);
        }
        if (h.startsWith("[") && h.endsWith("]")) {
            h = h.substring(1, h.length() - 1);
        }
        if (h.equals("localhost") || h.endsWith(".localhost")
                || h.endsWith(".svc") || h.endsWith(".cluster.local") || h.endsWith(".internal")
                || (!h.contains(".") && !h.contains(":"))) {
            return "internal host name";
        }
        try {
            for (InetAddress a : InetAddress.getAllByName(h)) {
                if (isNonPublic(a)) {
                    return "host resolves to a non-public address";
                }
            }
        } catch (UnknownHostException e) {
            return "host does not resolve";
        }
        return null;
    }

    static boolean isNonPublic(InetAddress a) {
        return a.isLoopbackAddress() || a.isSiteLocalAddress() || a.isLinkLocalAddress()
                || a.isAnyLocalAddress() || a.isMulticastAddress() || isUniqueLocalOrCgnat(a);
    }

    private static boolean isUniqueLocalOrCgnat(InetAddress a) {
        byte[] b = a.getAddress();
        if (b.length == 16) return (b[0] & 0xfe) == 0xfc;                       // fc00::/7
        return (b[0] & 0xff) == 100 && (b[1] & 0xc0) == 64;                     // 100.64.0.0/10
    }
}
