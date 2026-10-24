package vacademy.io.common.payment.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Reply to eWay's {@code CreateAccessCodeShared}: the Responsive Shared Page handshake.
 *
 * <p>Unlike the Direct {@code /Transaction} calls this does NOT take a payment. It reserves an
 * access code and hands back the URL of eWay's own hosted card page; the learner is sent
 * there, pays, and is returned to our RedirectUrl with the access code, which we then look up
 * to find out what actually happened. Card number and CVN never reach us.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class EwaySharedPageResponseDTO {

    /** Identifies this payment attempt for the lifetime of the hosted session. */
    @JsonProperty("AccessCode")
    public String AccessCode;

    /** The hosted page to send the learner's browser to. */
    @JsonProperty("SharedPaymentUrl")
    public String SharedPaymentUrl;

    /** Form post target, returned for the self-hosted variant; unused by the shared page. */
    @JsonProperty("FormActionURL")
    public String FormActionURL;

    /** Comma-separated eWay error codes. Non-null means no usable access code was issued. */
    @JsonProperty("Errors")
    public String Errors;
}
