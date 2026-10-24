package vacademy.io.auth_service.feature.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class AuthRequestDto {
    private String userName;
    private String password;
    private String clientName;
    private String instituteId;
    private String email;
    private String otp;
    private String phoneNumber;
    private String deviceType; // NEW: "WEB", "MOBILE", "TABLET" — optional, defaults to "WEB" in session
                               // creation
    // Optional WhatsApp template override for generic OTP sends (e.g. a live
    // session's configured OTP template, or a form field configured to verify
    // itself). Null = institute default template.
    private String templateName;
    // Language of the named template. Only read alongside templateName; null
    // falls back to English. A Meta template is registered per language, so a
    // template approved only in "en_US" must say so or the send is rejected.
    private String languageCode;
}
