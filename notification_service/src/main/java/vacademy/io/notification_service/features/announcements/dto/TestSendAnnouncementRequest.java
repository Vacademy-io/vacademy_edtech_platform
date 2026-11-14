package vacademy.io.notification_service.features.announcements.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * Send the email of an announcement — saved or still a draft — to a few addresses only. Nothing is
 * persisted and the real audience is not touched.
 */
@Getter
@Setter
@NoArgsConstructor
public class TestSendAnnouncementRequest {

    @NotBlank(message = "Institute ID is required")
    private String instituteId;

    @NotBlank(message = "Title is required")
    @Size(max = 500)
    private String title;

    @NotNull(message = "Content is required")
    @Valid
    private CreateAnnouncementRequest.RichTextDataRequest content;

    /** The EMAIL medium config the announcement would be sent with (subject, sender, preview text). */
    @Valid
    private CreateAnnouncementRequest.MediumRequest emailMedium;

    private String createdByName;

    @NotEmpty(message = "At least one test email is required")
    @Size(max = 10, message = "A test can go to at most 10 addresses")
    private List<@NotBlank @Email(message = "Invalid email address") String> emails;
}
