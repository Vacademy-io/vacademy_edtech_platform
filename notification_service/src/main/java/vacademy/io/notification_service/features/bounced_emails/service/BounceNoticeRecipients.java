package vacademy.io.notification_service.features.bounced_emails.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The addresses named as undeliverable in a bounce notice email from SES. Deliberately narrow: only
 * SES's own sender and the two wordings that mean the address cannot receive mail. A notice about a
 * misconfigured remote server or a closed group says nothing about the address, so it blocks nothing.
 */
public final class BounceNoticeRecipients {

    public static final String BOUNCE_TYPE = "Undetermined";
    public static final String BOUNCE_SUB_TYPE = "BounceNoticeEmail";

    private static final Pattern SES_SENDER =
            Pattern.compile("(?i)^mailer-daemon@([a-z0-9-]+\\.)*amazonses\\.com$");
    private static final String ADDRESS = "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}";
    private static final Pattern ADDRESS_ONLY = Pattern.compile(ADDRESS);
    private static final Pattern RECIPIENT_LIST = Pattern.compile(
            "(?i)to the following recipients:\\s*(" + ADDRESS + "(?:[\\s,]+" + ADDRESS + ")*)");
    private static final Pattern ADDRESS_NOT_FOUND = Pattern.compile(
            "(?i)wasn't delivered to\\s+(" + ADDRESS + ")\\s+because the address couldn't be found");

    private BounceNoticeRecipients() {
    }

    /** Lowercase addresses this notice reports; empty when it is not a bounce notice from SES. */
    public static List<String> parse(String fromAddress, String body) {
        if (fromAddress == null || body == null || !SES_SENDER.matcher(fromAddress.trim()).matches()) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        Matcher list = RECIPIENT_LIST.matcher(body);
        if (list.find()) {
            Matcher address = ADDRESS_ONLY.matcher(list.group(1));
            while (address.find()) out.add(address.group().toLowerCase(Locale.ROOT));
        }
        Matcher notFound = ADDRESS_NOT_FOUND.matcher(body.replace('’', '\''));
        if (notFound.find()) out.add(notFound.group(1).toLowerCase(Locale.ROOT));
        return out.stream().distinct().toList();
    }
}
