package vacademy.io.admin_core_service.features.learner_badge.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of {@code POST /learner-badge/institutes/{instituteId}/catalogue}: append ONE badge to
 * (or replace one badge by id in) the institute's badge catalogue, server-side. Exists so a
 * badge created from the student view never has to re-save the whole settings blob from
 * client state (which would clobber concurrent edits to enabled/scoring/other badges).
 *
 * <p>Everything but {@code name} is optional; the server applies the defaults documented on
 * each field. A blank {@code id} mints {@code badge_<uuid>}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class BadgeDefinitionRequest {

    /** Optional: replace the catalogue entry with this id; blank = append a new badge. learner_badge.badge_id is varchar(255). */
    @Size(max = 255, message = "id must be at most 255 characters")
    private String id;

    @NotBlank(message = "name is required")
    @Size(max = 120, message = "name must be at most 120 characters")
    private String name;

    @Size(max = 500, message = "description must be at most 500 characters")
    private String description;

    /** Phosphor icon name, {@code lib:} token or uploaded file id. Default "Star". */
    @Size(max = 255, message = "icon must be at most 255 characters")
    private String icon;

    /** Default "manual" (staff-awarded). Must be one of the known trigger keys. */
    @Size(max = 64, message = "trigger must be at most 64 characters")
    private String trigger;

    /** Default 0; forced to 0 when the trigger is manual. */
    private Long threshold;

    /** Default true. */
    private Boolean enabled;

    /** Default false. */
    private Boolean hidden;
}
