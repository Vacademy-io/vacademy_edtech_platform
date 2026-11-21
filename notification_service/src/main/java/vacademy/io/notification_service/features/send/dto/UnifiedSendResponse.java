package vacademy.io.notification_service.features.send.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UnifiedSendResponse {

    private String batchId;
    private int total;
    private int accepted;
    private int failed;

    /**
     * COMPLETED (sync, all done), PROCESSING (async batch), PARTIAL (some failed)
     */
    private String status;

    private List<RecipientResult> results;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RecipientResult {
        private String phone;
        private String email;
        private boolean success;
        private String status; // SENT, FAILED, SKIPPED_OPT_OUT, QUEUED
        private String error;

        /**
         * Provider message id (WhatsApp wamid) for an accepted send. The caller needs it to ask what
         * actually happened afterwards: this response can only report that the provider took the
         * message, and the delivery verdict arrives later on the status webhook. Null for channels
         * or paths that issue no id, and for a send the provider refused outright.
         */
        private String messageId;
    }
}
