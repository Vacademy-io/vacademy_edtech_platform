package vacademy.io.auth_service.feature.selfsignup.service;

import java.util.Locale;
import java.util.Set;

/**
 * Throwaway-inbox domains refused by the no-code demo, where an email is the only thing that stops
 * one person from opening many free workspaces. Not exhaustive: it stops the common ones.
 */
final class DisposableEmailDomains {

    private static final Set<String> DOMAINS = Set.of(
            "mailinator.com", "mailinator.net", "yopmail.com", "yopmail.net", "guerrillamail.com",
            "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "sharklasers.com", "grr.la",
            "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io",
            "tempmailo.com", "tempmail.dev", "tempmail.plus", "tmpmail.org", "tmpmail.net", "trashmail.com",
            "trashmail.de", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "throwawaymail.com",
            "fakeinbox.com", "moakt.com", "emailondeck.com", "mintemail.com", "mohmal.com", "burnermail.io",
            "mailnesia.com", "mytemp.email", "spamgourmet.com", "getairmail.com", "inboxkitten.com",
            "emailfake.com", "fakemail.net", "tempinbox.com", "mail.tm", "mail.gw", "dropmail.me",
            "1secmail.com", "1secmail.net", "1secmail.org", "minuteinbox.com", "discard.email", "spambox.us");

    private DisposableEmailDomains() {
    }

    static boolean isDisposable(String domain) {
        return domain != null && DOMAINS.contains(domain.trim().toLowerCase(Locale.ROOT));
    }
}
