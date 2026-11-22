package vacademy.io.auth_service.feature.sso.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The email domains a connection signs in. A provider is trusted only for its own domains, so a
 * public mailbox domain is refused: a connection claiming gmail.com would let one institute's
 * provider speak for every Gmail user.
 */
public final class SsoEmailDomains {

    private static final Pattern DOMAIN = Pattern.compile("^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$");

    static final Set<String> PUBLIC_MAIL_DOMAINS = Set.of(
            "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "ymail.com",
            "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
            "aol.com", "proton.me", "protonmail.com", "zoho.com", "zohomail.com", "zohomail.in",
            "rediffmail.com", "gmx.com", "gmx.net", "mail.com", "yandex.com", "yandex.ru",
            "hey.com", "fastmail.com", "tutanota.com", "qq.com", "163.com", "126.com");

    private SsoEmailDomains() {
    }

    /** Lower-cased, de-duplicated domains from a comma / space / newline separated list. */
    public static List<String> parse(String raw) {
        Set<String> out = new LinkedHashSet<>();
        if (raw != null) {
            for (String part : raw.split("[,;\\s]+")) {
                String domain = part.trim().toLowerCase(Locale.ROOT);
                if (domain.startsWith("@")) {
                    domain = domain.substring(1);
                }
                if (!domain.isEmpty()) {
                    out.add(domain);
                }
            }
        }
        return new ArrayList<>(out);
    }

    /** @return an error message, or null when every domain is acceptable. */
    public static String validate(List<String> domains) {
        if (domains == null || domains.isEmpty()) {
            return "Add at least one email domain";
        }
        for (String domain : domains) {
            if (!DOMAIN.matcher(domain).matches()) {
                return "Not a valid email domain: " + domain;
            }
            if (PUBLIC_MAIL_DOMAINS.contains(domain)) {
                return domain + " is a public email service and cannot be used for single sign-on";
            }
        }
        return null;
    }

    /** The domain part of an email, lower case, or null. */
    public static String domainOf(String email) {
        if (email == null) {
            return null;
        }
        int at = email.lastIndexOf('@');
        if (at < 1 || at == email.length() - 1) {
            return null;
        }
        return email.substring(at + 1).trim().toLowerCase(Locale.ROOT);
    }

    public static boolean covers(List<String> domains, String email) {
        String domain = domainOf(email);
        return domain != null && domains != null && domains.contains(domain);
    }
}
