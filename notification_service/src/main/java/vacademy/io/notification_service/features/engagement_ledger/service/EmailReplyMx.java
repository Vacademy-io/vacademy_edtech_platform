package vacademy.io.notification_service.features.engagement_ledger.service;

import java.util.Collection;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Whether a reply to an email can reach us, from the sender domain's MX records. We set no
 * Reply-To, so a reply goes to the sender's domain, and only SES inbound hands it to
 * InboundEmailService. Pure, so the parsing is tested without DNS.
 */
final class EmailReplyMx {

    private static final Pattern SES_INBOUND = Pattern.compile("inbound-smtp\\.[a-z0-9.-]+\\.amazonaws\\.com");

    private EmailReplyMx() {
    }

    /**
     * @param records MX records as DNS returns them ("10 inbound-smtp.us-east-1.amazonaws.com.")
     * @return true when a lowest-preference host is SES inbound. No record at all is a real answer:
     *         nothing hands the mail to SES. Records none of which parse are no answer, so they
     *         count as reachable, like a failed lookup.
     */
    static boolean reachesUs(Collection<String> records) {
        if (records == null || records.isEmpty()) {
            return false;
        }
        int lowest = Integer.MAX_VALUE;
        boolean parsed = false;
        boolean ses = false;
        for (String record : records) {
            String[] parts = record == null ? new String[0] : record.trim().split("\\s+");
            if (parts.length != 2) {
                continue;
            }
            int preference;
            try {
                preference = Integer.parseInt(parts[0]);
            } catch (NumberFormatException e) {
                continue;
            }
            boolean isSes = SES_INBOUND.matcher(host(parts[1])).matches();
            if (!parsed || preference < lowest) {
                lowest = preference;
                ses = isSes;
            } else if (preference == lowest) {
                ses |= isSes;
            }
            parsed = true;
        }
        return !parsed || ses;
    }

    private static String host(String raw) {
        String host = raw.toLowerCase(Locale.ROOT);
        return host.endsWith(".") ? host.substring(0, host.length() - 1) : host;
    }

    /** The domain of a sender address, bare or "Name &lt;a@b&gt;"; null when it has none. */
    static String domainOf(String address) {
        if (address == null) {
            return null;
        }
        String s = address.trim();
        int gt = s.lastIndexOf('>');
        if (gt >= 0) {
            s = s.substring(0, gt);
        }
        int at = s.lastIndexOf('@');
        if (at < 0 || at == s.length() - 1) {
            return null;
        }
        String domain = s.substring(at + 1).trim().toLowerCase(Locale.ROOT);
        return domain.isEmpty() || domain.contains(" ") ? null : domain;
    }
}
