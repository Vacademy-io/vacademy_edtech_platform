package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class BulkLiveSessionResponseDTO {

    private int totalRequested;
    private int totalCreated;
    private int totalFailed;
    private List<RowResult> results;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class RowResult {
        /** zero-based position of the row in the original request */
        private int index;
        private boolean success;
        private String sessionId;
        private String title;
        /** present only when {@code success == false} */
        private String error;
        /** true when the optional step2 template was applied successfully */
        private boolean step2Applied;
        /**
         * Non-fatal problems with a row that still succeeded — currently
         * instructor identifiers that matched nobody in the institute. The row
         * was created; the admin just needs to know one name didn't stick.
         */
        private List<String> warnings;
    }
}
