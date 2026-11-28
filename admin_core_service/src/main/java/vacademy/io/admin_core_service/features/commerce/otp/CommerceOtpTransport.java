package vacademy.io.admin_core_service.features.commerce.otp;

/**
 * Delivers a code to a phone, and nothing else: the code is made, kept (as an HMAC) and
 * compared by {@link CommerceOtpService}. The one implementation sends a WhatsApp template
 * message through the platform; tests put a stub here. The call goes over the network and is
 * never made inside a database transaction.
 */
public interface CommerceOtpTransport {

    /**
     * Sends {@code code} to {@code phone} with the institute's sender and OTP template.
     *
     * @throws CommerceOtpException {@code OTP_UNAVAILABLE} when nothing was sent
     */
    void send(String instituteId, String phone, String code);
}
