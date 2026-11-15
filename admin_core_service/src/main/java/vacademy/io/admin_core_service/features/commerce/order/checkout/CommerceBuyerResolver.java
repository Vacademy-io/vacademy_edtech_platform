package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Finds or creates the auth user an order is written for.
 *
 * <p>A shop buyer is not a learner: the user gets <b>no role</b> in the institute, no
 * credentials mail and no enrolment, so nothing about who can sign in where changes.
 *
 * <p><b>A phone typed at checkout is not an identity.</b> Only a shopper who proved the phone
 * (the verified-phone token of an OTP) gets the user of that phone's {@code commerce_customer}
 * row, with no remote call. Everyone else is the account of the e-mail they gave, through the
 * platform's existing internal get-or-create route, with an empty role list and mail off. So
 * an order placed with someone else's phone is
 * never written under that person's account.
 *
 * <p>Without a proved phone the e-mail is always needed (400 {@code email_required}), whether
 * the shop knows the phone or not: the answer must not tell the two apart. The platform also
 * creates no account without one.
 *
 * <p>It is a remote call: checkout runs it before the order transaction, never inside it.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CommerceBuyerResolver {

    private final CommerceCustomerService customerService;
    private final AuthService authService;

    /**
     * @param phoneVerified true when the shopper proved {@code phone} with an OTP for this shop
     */
    public String resolveUserId(String instituteId, String phone, String name, String email,
                                boolean phoneVerified) {
        if (phoneVerified) {
            Optional<CommerceCustomer> known = customerService.findByPhone(instituteId, phone);
            if (known.isPresent() && StringUtils.hasText(known.get().getUserId())) {
                return known.get().getUserId();
            }
        }
        if (!StringUtils.hasText(email)) {
            // The platform cannot create an account without an e-mail address today
            // (auth_service: users.email is NOT NULL). Said here,
            // before the remote call, so the shopper gets a field to fill in instead of a 503.
            // The same answer for a phone the shop knows and one it does not.
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("param", "customer.email");
            throw new CheckoutException(HttpStatus.BAD_REQUEST, CheckoutException.EMAIL_REQUIRED,
                    "An e-mail address is needed to place the order.", details);
        }
        UserDTO request = new UserDTO();
        request.setFullName(name);
        request.setMobileNumber(phone);
        request.setEmail(email);
        // Empty on purpose: no STUDENT role, no staff role, nothing to sign in with.
        request.setRoles(new ArrayList<>());
        UserDTO user;
        try {
            user = authService.createUserFromAuthServiceForLearnerEnrollment(request, instituteId, false);
        } catch (RuntimeException e) {
            // The message of the remote failure may carry the phone or the e-mail: not logged.
            log.error("Could not resolve the buyer of a shop order for institute {} ({})", instituteId,
                    e.getClass().getSimpleName());
            throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.BUYER_UNAVAILABLE,
                    "The order could not be placed right now. Please try again.");
        }
        if (user == null || !StringUtils.hasText(user.getId())) {
            log.error("The auth service returned no user for a shop order of institute {}", instituteId);
            throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.BUYER_UNAVAILABLE,
                    "The order could not be placed right now. Please try again.");
        }
        return user.getId();
    }
}
