package vacademy.io.common.auth.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.service.UserRoleService;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.stream.Collectors;

@JsonIgnoreProperties(ignoreUnknown = true)
public class CustomUserDetails extends User implements UserDetails {

    private String password;

    @Getter
    private String userId;

    @JsonProperty("authorities")
    private List<String> storedAuthorities = new ArrayList<>();

    public CustomUserDetails() {
        super();
        this.password = null;
        this.userId = null;
        this.storedAuthorities = new ArrayList<>();
    }

    /**
     * Constructor for CustomUserDetails, creating an instance from a User object.
     *
     * @param user The User object to extract details from.
     */
    public CustomUserDetails(User user, String instituteId, List<UserRole> userRoles) {

        if (user == null || instituteId == null) {
            throw new IllegalArgumentException("User or Institute cannot be null");
        }
        // Set the username and full name from the provided User object
        this.setUsername(user.getUsername());
        this.setFullName(user.getFullName());

        // Set the password securely from the User object
        this.password = user.getPassword();
        this.userId = user.getId();
        this.setRootUser(user.isRootUser());

        // Create a list to store authorities strings
        List<String> auths = new ArrayList<>();

        // Iterate through each UserRole the user still holds in this institute. Revoked roles
        // (disabled / deleted / cancelled) grant nothing, even while an old token is alive.
        for (UserRole role : userRoles.stream()
                .filter((role) -> role.getInstituteId().equals(instituteId))
                .filter(UserRoleService::grantsAccess)
                .toList()) {
            // Get individual authorities from the role and convert them to uppercase
            role.getRole().getAuthorities().forEach(
                    userAuthority -> auths.add(userAuthority.getName().toUpperCase()));

            // Add the role name itself
            auths.add(role.getRole().getName().toUpperCase());
        }

        // Assign the collected authorities to the storage field
        this.storedAuthorities = auths;
    }

    public CustomUserDetails(UserServiceDTO user) {
        // Set the username from the provided User object
        this.setUsername(user.getUsername());
        this.setFullName(user.getFullName());
        this.password = "";
        this.userId = user.getUserId();
        this.setRootUser(user.isRootUser());

        // Create a list to store authorities strings
        List<String> auths = new ArrayList<>();

        // Iterate through each UserRole for the user
        for (String auth : user.getAuthorities()) {
            // Add the role name itself
            auths.add(auth.toUpperCase());
        }

        // Assign the collected authorities to the storage field
        this.storedAuthorities = auths;
    }

    @Override
    @JsonIgnore
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return storedAuthorities.stream()
                .map(SimpleGrantedAuthority::new)
                .collect(Collectors.toList());
    }

    @Override
    public String getPassword() {
        return password;
    }

    // setPassword is kept from previous step? checking below.
    public void setPassword(String password) {
        this.password = password;
        super.setPassword(password);
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return true;
    }

}