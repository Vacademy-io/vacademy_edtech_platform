package vacademy.io.admin_core_service.features.commerce.notify;

import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;

/** How a phone number or an e-mail address is shown or stored where the whole value must not be. */
public final class CommerceMasks {

    private CommerceMasks() {
    }

    /** {@code ••••••3210}. */
    public static String phone(String phone) {
        return CommercePhones.mask(phone);
    }

    /** {@code a•••@example.com}: the first letter and the domain; null for a holder account's address. */
    public static String email(String email) {
        if (!StringUtils.hasText(email) || isHolderEmail(email)) {
            return null;
        }
        int at = email.indexOf('@');
        if (at < 1) {
            return null;
        }
        return email.charAt(0) + "•••" + email.substring(at);
    }

    private static boolean isHolderEmail(String email) {
        return vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver.isHolderEmail(email);
    }
}
