package vacademy.io.admin_core_service.features.institute_api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Body of the internal verify call (contract C2): {"key_hash":"<64 hex>"}. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ApiKeyVerifyRequest {

    @JsonProperty("key_hash")
    private String keyHash;

    /** Optional extension: the partner's IP, stored as last_used_ip when the stamp is written. */
    @JsonProperty("client_ip")
    private String clientIp;
}
