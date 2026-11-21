package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Collections;
import java.util.List;

/**
 * Envelope for {@code GET /admin-core-service/get-sessions/learner/past}.
 * Always carries {@code display_flags} so the learner FE can render/hide the
 * Past tab and its recordings/attendance/activity columns from this single
 * response, without a second settings fetch (see plan section A2).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class LearnerPastSessionsResponseDTO {

    private DisplayFlagsDTO displayFlags;
    private List<LearnerPastSessionDTO> content;
    private int page;
    private int size;
    private int totalPages;
    private long totalElements;
    private boolean last;

    public static LearnerPastSessionsResponseDTO empty(DisplayFlagsDTO flags, int page, int size) {
        return LearnerPastSessionsResponseDTO.builder()
                .displayFlags(flags)
                .content(Collections.emptyList())
                .page(page)
                .size(size)
                .totalPages(0)
                .totalElements(0)
                .last(true)
                .build();
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
    public static class DisplayFlagsDTO {
        private boolean showPastSessions;
        private boolean showRecordings;
        private boolean showAttendance;
        private boolean showActivityStats;
        private boolean showClassMaterials;
        private boolean showUnassignedPublicSessions;

        public static DisplayFlagsDTO from(LearnerDisplaySettingsFlags flags) {
            return DisplayFlagsDTO.builder()
                    .showPastSessions(flags.showPastSessions())
                    .showRecordings(flags.showRecordings())
                    .showAttendance(flags.showAttendance())
                    .showActivityStats(flags.showActivityStats())
                    .showClassMaterials(flags.showClassMaterials())
                    .showUnassignedPublicSessions(flags.showUnassignedPublicSessions())
                    .build();
        }
    }
}
