package vacademy.io.admin_core_service.features.telephony.controller.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * A person who may be given a provider extension in Settings → Calling.
 *
 * <p>Deliberately not the counsellor picker's shape: the extension map is not a
 * lead-assignment target list. Admins belong on it too — an admin who calls a
 * learner from the LMS side-view needs an extension of their own, and before
 * this the picker only offered COUNSELLOR-role users so there was no way to give
 * one to an admin.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TelephonyEndpointUserDTO {
    private String id;
    private String fullName;
    private String email;
    /** Institute roles held, e.g. ["ADMIN"] — rendered as a badge so an admin
     *  picking from a mixed list can tell who is who. */
    private List<String> roles;
}
