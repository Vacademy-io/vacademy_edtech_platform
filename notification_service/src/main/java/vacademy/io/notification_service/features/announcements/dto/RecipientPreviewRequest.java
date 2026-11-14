package vacademy.io.notification_service.features.announcements.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * Who would receive an announcement that has not been saved yet. Takes the same recipients /
 * exclusions shape as {@link CreateAnnouncementRequest}, so the create form can send what it would
 * submit.
 */
@Getter
@Setter
@NoArgsConstructor
public class RecipientPreviewRequest {

    @NotBlank(message = "Institute ID is required")
    private String instituteId;

    @NotEmpty(message = "At least one recipient is required")
    @Valid
    private List<CreateAnnouncementRequest.RecipientRequest> recipients;

    @Valid
    private List<CreateAnnouncementRequest.RecipientRequest> exclusions;

    @Min(0)
    private int page = 0;

    @Min(1)
    @Max(100)
    private int size = 20;
}
