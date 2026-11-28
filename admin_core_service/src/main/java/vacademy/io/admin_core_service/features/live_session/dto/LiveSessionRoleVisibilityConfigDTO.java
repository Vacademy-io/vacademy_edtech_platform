package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.live_session.enums.LiveSessionVisibilityModeEnum;

import java.util.List;

/**
 * One role's live-session visibility rule, stored under
 * {@code LIVE_SESSION_SETTING.roleVisibility} as a map of
 * {@code ROLE_NAME -> {mode, roles[]}}.
 *
 * <p>Keyed by role <b>name</b> (upper-cased) rather than role id so institute
 * custom roles ({@code CustomRoleController}) work with no extra plumbing —
 * role names are what auth_service reports per institute
 * ({@code InstituteRoleUserClient.findRolesOfUser}).
 *
 * <p>Unknown JSON properties are ignored: the settings blob is shared with
 * several other features and is written by the frontend as a whole document.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class LiveSessionRoleVisibilityConfigDTO {

    /** ALL | OWN | SPECIFIC_ROLES. Null or unparseable is treated as ALL. */
    private String mode;

    /** Role names whose sessions this role may see. Only read when mode = SPECIFIC_ROLES. */
    private List<String> roles;

    public static LiveSessionRoleVisibilityConfigDTO all() {
        return new LiveSessionRoleVisibilityConfigDTO(
                LiveSessionVisibilityModeEnum.ALL.name(), List.of());
    }

    /**
     * Never throws: an unrecognised mode degrades to ALL, i.e. to the legacy
     * behaviour. A visibility rule that cannot be understood must not silently
     * hide an institute's classes from it.
     */
    public LiveSessionVisibilityModeEnum resolveMode() {
        if (mode == null) {
            return LiveSessionVisibilityModeEnum.ALL;
        }
        try {
            return LiveSessionVisibilityModeEnum.valueOf(mode.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return LiveSessionVisibilityModeEnum.ALL;
        }
    }
}
