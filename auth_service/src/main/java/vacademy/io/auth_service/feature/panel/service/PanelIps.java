package vacademy.io.auth_service.feature.panel.service;

import java.util.ArrayList;
import java.util.List;

/**
 * IP literals for the rate limiter and the trusted-proxy setting. Parsing is done here by hand so
 * that no value from a request header can ever reach a DNS lookup.
 */
public final class PanelIps {

    private PanelIps() {
    }

    /** A network and prefix length, e.g. 10.0.0.0/8 or 2001:db8::/32. A bare address is a full-length prefix. */
    public record Cidr(byte[] network, int bits) {
        public boolean contains(byte[] address) {
            if (address == null || address.length != network.length) {
                return false;
            }
            int full = bits / 8;
            for (int i = 0; i < full; i++) {
                if (address[i] != network[i]) {
                    return false;
                }
            }
            int rest = bits % 8;
            if (rest == 0) {
                return true;
            }
            int mask = (0xFF << (8 - rest)) & 0xFF;
            return (address[full] & mask) == (network[full] & mask);
        }
    }

    /** Comma-separated CIDRs or addresses. Blank gives an empty list; anything unreadable fails at boot. */
    public static List<Cidr> parseCidrs(String csv) {
        List<Cidr> out = new ArrayList<>();
        if (csv == null || csv.isBlank()) {
            return out;
        }
        for (String part : csv.split(",")) {
            String entry = part.trim();
            if (entry.isEmpty()) {
                continue;
            }
            int slash = entry.indexOf('/');
            byte[] network = parse(slash < 0 ? entry : entry.substring(0, slash));
            if (network == null) {
                throw new IllegalArgumentException("panel.trusted-proxies: not an address: " + entry);
            }
            network = unmapped(network);
            int bits = network.length * 8;
            if (slash >= 0) {
                try {
                    bits = Integer.parseInt(entry.substring(slash + 1));
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("panel.trusted-proxies: bad prefix: " + entry);
                }
                if (bits < 0 || bits > network.length * 8) {
                    throw new IllegalArgumentException("panel.trusted-proxies: bad prefix: " + entry);
                }
            }
            out.add(new Cidr(network, bits));
        }
        return out;
    }

    /** 4 or 16 bytes for an IPv4 or IPv6 literal, an IPv4-mapped IPv6 address as 4 bytes, else null. */
    public static byte[] address(String raw) {
        byte[] parsed = parse(raw);
        return parsed == null ? null : unmapped(parsed);
    }

    /**
     * The rate-limit key for an address. One IPv6 host usually holds a whole /64, so IPv6 is keyed
     * by that prefix. IPv4, and anything that is not an address, is keyed as given.
     */
    public static String limitKey(String ip) {
        byte[] parsed = address(ip);
        if (parsed == null) {
            return ip;
        }
        if (parsed.length == 4) {
            return (parsed[0] & 0xFF) + "." + (parsed[1] & 0xFF) + "." + (parsed[2] & 0xFF) + "." + (parsed[3] & 0xFF);
        }
        StringBuilder key = new StringBuilder();
        for (int i = 0; i < 8; i += 2) {
            key.append(Integer.toHexString(((parsed[i] & 0xFF) << 8) | (parsed[i + 1] & 0xFF))).append(':');
        }
        return key.append(":/64").toString();
    }

    static byte[] parse(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.trim();
        if (s.startsWith("[") && s.endsWith("]")) {
            s = s.substring(1, s.length() - 1);
        }
        int zone = s.indexOf('%');
        if (zone >= 0) {
            s = s.substring(0, zone);
        }
        if (s.isEmpty() || s.length() > 45) {
            return null;
        }
        return s.indexOf(':') < 0 ? parseV4(s) : parseV6(s);
    }

    private static byte[] parseV4(String s) {
        String[] parts = s.split("\\.", -1);
        if (parts.length != 4) {
            return null;
        }
        byte[] out = new byte[4];
        for (int i = 0; i < 4; i++) {
            String part = parts[i];
            if (part.isEmpty() || part.length() > 3 || !part.chars().allMatch(c -> c >= '0' && c <= '9')) {
                return null;
            }
            int value = Integer.parseInt(part);
            if (value > 255) {
                return null;
            }
            out[i] = (byte) value;
        }
        return out;
    }

    private static byte[] parseV6(String s) {
        byte[] v4Tail = null;
        int lastColon = s.lastIndexOf(':');
        if (s.indexOf('.', lastColon) >= 0) {
            v4Tail = parseV4(s.substring(lastColon + 1));
            if (v4Tail == null) {
                return null;
            }
            s = s.substring(0, lastColon + 1) + "0:0";
        }
        int gap = s.indexOf("::");
        if (gap >= 0 && s.indexOf("::", gap + 1) >= 0) {
            return null;
        }
        List<Integer> head;
        List<Integer> tail;
        if (gap >= 0) {
            head = groups(s.substring(0, gap));
            tail = groups(s.substring(gap + 2));
            if (head == null || tail == null || head.size() + tail.size() > 7) {
                return null;
            }
        } else {
            head = groups(s);
            tail = List.of();
            if (head == null || head.size() != 8) {
                return null;
            }
        }
        int[] words = new int[8];
        for (int i = 0; i < head.size(); i++) {
            words[i] = head.get(i);
        }
        for (int i = 0; i < tail.size(); i++) {
            words[8 - tail.size() + i] = tail.get(i);
        }
        byte[] out = new byte[16];
        for (int i = 0; i < 8; i++) {
            out[2 * i] = (byte) (words[i] >> 8);
            out[2 * i + 1] = (byte) words[i];
        }
        if (v4Tail != null) {
            System.arraycopy(v4Tail, 0, out, 12, 4);
        }
        return out;
    }

    private static List<Integer> groups(String part) {
        List<Integer> out = new ArrayList<>();
        if (part.isEmpty()) {
            return out;
        }
        for (String group : part.split(":", -1)) {
            if (group.isEmpty() || group.length() > 4) {
                return null;
            }
            for (char c : group.toCharArray()) {
                if (Character.digit(c, 16) < 0) {
                    return null;
                }
            }
            out.add(Integer.parseInt(group, 16));
        }
        return out;
    }

    private static byte[] unmapped(byte[] address) {
        if (address.length != 16) {
            return address;
        }
        for (int i = 0; i < 10; i++) {
            if (address[i] != 0) {
                return address;
            }
        }
        if (address[10] != (byte) 0xFF || address[11] != (byte) 0xFF) {
            return address;
        }
        return new byte[] { address[12], address[13], address[14], address[15] };
    }
}
