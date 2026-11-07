package vacademy.io.common.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import vacademy.io.common.auth.entity.User;

import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Data
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class UserWithRolesDTO {
    private String id;
    private String username;
    private String email;
    private String fullName;
    private String addressLine;
    private String city;
    private String region;
    private String pinCode;
    private String mobileNumber;
    private Date dateOfBirth;
    private String gender;
    private boolean isRootUser;
    private String password;
    private String profilePicFileId;
    private String authorSubtitle;
    private String authorDescription;
    private Set<UserRoleDTO> roles;
    private String status;
    /**
     * Last successful sign-in (users.last_login_time); null = has never signed in. Set only by
     * the authenticated Teams listing (see UserService#toUserWithRolesDtoWithPassword), never by
     * the constructor that also feeds unauthenticated endpoints.
     */
    private Date lastLoginTime;

    public UserWithRolesDTO() {
        // Default constructor
    }

    public UserWithRolesDTO(User user) {
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
        this.authorSubtitle = user.getAuthorSubtitle();
        this.authorDescription = user.getAuthorDescription();
        this.roles = user.getRoles().stream()
                .map(UserRoleDTO::new).collect(Collectors.toSet());
    }
}
