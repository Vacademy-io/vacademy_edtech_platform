package vacademy.io.notification_service.features.announcements.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/** One page of the people an announcement resolves to, before anything is sent. */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RecipientPreviewResponse {

    /** Unique users after exclusions — what delivery would create messages for. */
    private long totalCount;
    private int page;
    private int size;
    private int totalPages;
    private List<PreviewUser> users;

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PreviewUser {
        private String userId;
        private String fullName;
        private String email;
        private String mobileNumber;
    }
}
