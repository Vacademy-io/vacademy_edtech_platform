package vacademy.io.admin_core_service.features.notification.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class UnifiedSendResponse {

    private String batchId;
    private int total;
    private int accepted;
    private int failed;
    private String status; // COMPLETED, PROCESSING, PARTIAL, FAILED

    private List<RecipientResult> results;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class RecipientResult {
        private String phone;
        private String email;
        private boolean success;
        private String status;
        private String error;
        /** The provider's message id of an accepted send (notification-service sends it; null when none). */
        private String messageId;
    }
}
