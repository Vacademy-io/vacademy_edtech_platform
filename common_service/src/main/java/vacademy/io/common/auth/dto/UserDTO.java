package vacademy.io.common.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.common.auth.entity.User;

import java.util.Date;
import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class UserDTO {
    private String id;

    @Size(max = 255, message = "Username must not exceed 255 characters")
    private String username;

    @Email(message = "Email must be a valid email address")
    @Size(max = 320, message = "Email must not exceed 320 characters")
    private String email;

    @Size(max = 255, message = "Full name must not exceed 255 characters")
    private String fullName;

    @Size(max = 512, message = "Address must not exceed 512 characters")
    private String addressLine;

    @Size(max = 255, message = "City must not exceed 255 characters")
    private String city;

    @Size(max = 255, message = "Region must not exceed 255 characters")
    private String region;

    @Pattern(regexp = "^(\\d{6}|)$", message = "Pin code must be exactly 6 digits")
    private String pinCode;

    @Size(max = 15, message = "Mobile number must not exceed 15 characters")
    private String mobileNumber;

    private Date dateOfBirth;

    @Pattern(regexp = "^(MALE|FEMALE|OTHER|)$", message = "Gender must be MALE, FEMALE, or OTHER")
    private String gender;

    private boolean isRootUser;
    private String password;
    private String profilePicFileId;
    private List<String> roles;
    private Date lastLoginTime;
    private Boolean isParent;
    private String linkedParentId;

    // BCP-47 language tag (serialized as preferred_locale); null = no preference
    @Size(max = 10, message = "Preferred locale must not exceed 10 characters")
    private String preferredLocale;

    // Author metadata (serialized as author_subtitle / author_description).
    // Set from the Add Course -> Add Authors flow; surfaced on catalogue and
    // course-detail instructor lists. Optional - null when not set.
    @Size(max = 255, message = "Author subtitle must not exceed 255 characters")
    private String authorSubtitle;
    private String authorDescription;

    // Request-only hints for the institute's username strategy (Settings > Student
    // Display > Login & Signup). Never stored; omitted from responses when unset.
    // usernameExplicit: an admin typed this username by hand, so the strategy must not
    // replace it. usernameFieldValues: custom field values captured with this
    // enrollment, keyed by custom field id, so a field such as roll number can
    // become the username.
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Boolean usernameExplicit;
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Map<String, String> usernameFieldValues;

    // Response-only: this person's display role in ONE course (Author / Instructor /
    // Acharya ...), set by admin-core on course instructor lists from the faculty
    // mapping. Never stored on the user; omitted when unset.
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String roleLabel;

    public UserDTO(User user) {
        this.id = user.getId();
        this.username = user.getUsername();
        this.email = user.getEmail();
        this.fullName = user.getFullName();
        this.addressLine = user.getAddressLine();
        this.city = user.getCity();
        this.pinCode = user.getPinCode();
        this.mobileNumber = user.getMobileNumber();
        this.dateOfBirth = user.getDateOfBirth();
        this.gender = user.getGender();
        this.isRootUser = user.isRootUser();
        this.profilePicFileId = user.getProfilePicFileId();
        this.setLastLoginTime(user.getLastLoginTime());
        this.roles = user.getRoles().stream().map((ur) -> ur.getRole().getName()).toList();
        this.isParent=user.getIsParent();
        this.linkedParentId=user.getLinkedParentId();
        this.preferredLocale = user.getPreferredLocale();
        this.authorSubtitle = user.getAuthorSubtitle();
        this.authorDescription = user.getAuthorDescription();
    }

    public UserDTO(User user, UserDTO userDTO) {
        this.id = user.getId();
        this.username = user.getUsername();
        this.email = user.getEmail();
        this.fullName = user.getFullName();
        this.addressLine = user.getAddressLine();
        this.city = user.getCity();
        this.pinCode = user.getPinCode();
        this.mobileNumber = user.getMobileNumber();
        this.dateOfBirth = user.getDateOfBirth();
        this.gender = user.getGender();
        this.isRootUser = user.isRootUser();
        this.profilePicFileId = user.getProfilePicFileId();
        this.region = userDTO.getRegion();
        this.setLastLoginTime(user.getLastLoginTime());
        this.roles = user.getRoles().stream().map((ur) -> ur.getRole().getName()).toList();
        this.isParent=user.getIsParent();
        this.linkedParentId=user.getLinkedParentId();
        this.preferredLocale = user.getPreferredLocale();
        this.authorSubtitle = user.getAuthorSubtitle();
        this.authorDescription = user.getAuthorDescription();

    }
}
