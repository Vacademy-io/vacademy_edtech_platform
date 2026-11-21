package vacademy.io.notification_service.features.announcements.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class TestSendAnnouncementResponse {

    private List<Result> results;

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Result {
        private String email;
        private boolean sent;
        /** True when the address belongs to a user, so name placeholders show that user's values. */
        private boolean matchedUser;
        private String error;
    }
}
