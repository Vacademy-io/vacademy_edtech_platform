package vacademy.io.auth_service.feature.admin_core_service.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InstituteSignupPolicy {
    private String passwordStrategy; // manual | auto | null
    private String passwordDelivery; // none | email | null
    private boolean allowLearnersToCreateCourses; // controls TEACHER role
    private String userNameStrategy; // email | random | manual | phone | customField
    private String usernameCustomFieldId; // for customField
    private String usernamePrefix; // optional, put in front of phone / custom field values
    private boolean usernameApplyToAll; // also apply to admin adds, invites, payments, forms
    private boolean usernameOverrideTyped; // with usernameApplyToAll: also over a username an admin typed
}

