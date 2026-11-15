package vacademy.io.admin_core_service.features.payments.util;

import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.util.UserDtoCopies;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.Map;

/**
 * The customer a payment gateway is given at checkout.
 *
 * <p>An existing account keeps its own mobile number: create-or-get does not add a typed number
 * to it. Gateways such as Cashfree need a phone for the order and Razorpay uses it as the
 * customer contact, so when the account has no mobile number yet, the number the buyer typed at
 * checkout is passed to the gateway on a copy of the user. The account itself, and the user
 * returned to the caller, are left unchanged.
 */
public final class GatewayCustomerContact {

    /**
     * Enrolment extra-data key (set by the server, never from a request body): the mobile number
     * typed with this enrolment. The learner enrolment request carries the user create-or-get
     * answered, which holds only what the account holds, so the typed number travels here, to be
     * used for the gateway only.
     */
    public static final String CHECKOUT_MOBILE_NUMBER = "CHECKOUT_MOBILE_NUMBER";

    private GatewayCustomerContact() {
    }

    /**
     * Same as {@link #withCheckoutPhone(UserDTO, UserDTO)}, preferring the number kept under
     * {@link #CHECKOUT_MOBILE_NUMBER} in the enrolment's extra data.
     */
    public static UserDTO withCheckoutPhone(UserDTO account, UserDTO typed, Map<String, Object> extraData) {
        Object kept = extraData == null ? null : extraData.get(CHECKOUT_MOBILE_NUMBER);
        if (kept instanceof String number && StringUtils.hasText(number)) {
            UserDTO typedNumber = new UserDTO();
            typedNumber.setMobileNumber(number);
            return withCheckoutPhone(account, typedNumber);
        }
        return withCheckoutPhone(account, typed);
    }

    /**
     * @param account the user create-or-get returned (what the account holds)
     * @param typed   the user details sent with the checkout
     * @return {@code account} itself when it has a mobile number or nothing usable was typed;
     *         otherwise a copy of it carrying the typed number (digits only, as an account stores it)
     */
    public static UserDTO withCheckoutPhone(UserDTO account, UserDTO typed) {
        if (account == null || StringUtils.hasText(account.getMobileNumber())
                || typed == null || !StringUtils.hasText(typed.getMobileNumber())) {
            return account;
        }
        String digits = typed.getMobileNumber().replaceAll("[^0-9]", "");
        if (digits.isEmpty()) {
            return account;
        }
        UserDTO copy = UserDtoCopies.copyOf(account);
        copy.setMobileNumber(digits);
        return copy;
    }
}
