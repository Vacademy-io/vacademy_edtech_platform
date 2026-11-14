package vacademy.io.common.notification.dto;


import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Builder;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
@Builder
public class EmailOTPRequest {
    private String to;
    private String subject;
    private String service;
    private String name;
    private String otp;
    /** A product that mails under its own name (see notification_service's OtpBrand); else null. */
    private String product;
}