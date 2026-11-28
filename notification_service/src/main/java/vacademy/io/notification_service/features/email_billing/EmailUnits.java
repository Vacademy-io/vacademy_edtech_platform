package vacademy.io.notification_service.features.email_billing;

import java.util.Collection;
import java.util.Map;
import java.util.Objects;

/**
 * Billing units for one email: one per recipient copy (TO plus each CC/BCC, as SES bills per
 * recipient), times one more for every full MiB of attachments carried by each copy.
 */
public final class EmailUnits {

    static final long MIB = 1024L * 1024L;

    private EmailUnits() {
    }

    public static int of(Collection<String> copyRecipients, long attachmentBytes) {
        int copies = copyRecipients == null ? 0
                : (int) copyRecipients.stream().filter(Objects::nonNull).map(String::trim)
                        .filter(s -> !s.isEmpty()).distinct().count();
        return ofCount(copies, attachmentBytes);
    }

    /** Units for one email with {@code copies} CC/BCC addresses besides the TO recipient. */
    public static int ofCount(int copies, long attachmentBytes) {
        long recipients = 1 + Math.max(0, copies);
        long perCopy = 1 + Math.max(0, attachmentBytes) / MIB;
        return (int) Math.min(Integer.MAX_VALUE, recipients * perCopy);
    }

    public static long attachmentBytes(Map<String, byte[]> attachments) {
        if (attachments == null) {
            return 0;
        }
        return attachments.values().stream().filter(Objects::nonNull).mapToLong(b -> b.length).sum();
    }
}
