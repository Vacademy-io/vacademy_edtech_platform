package vacademy.io.auth_service.feature.user.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.BeanUtils;
import vacademy.io.common.auth.dto.UserDTO;

/**
 * What an invite answers with: the user (as before, so every caller that reads a UserDTO —
 * admin_core's faculty and sub-org flows — keeps working) plus whether the email already had
 * an account on the platform.
 *
 * <p>For an existing account {@code password} is always null: their stored password is theirs,
 * and is neither emailed nor shown to the inviter. The dashboard says "Existing account — they
 * sign in with their current login" instead of showing login details.
 */
@Getter
@Setter
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class InvitedUserDTO extends UserDTO {

    /** The email already had an account: roles were added to it, no credentials were sent. */
    private boolean existingAccount;

    /**
     * Existing account that already held every requested role ACTIVE here: nothing changed and
     * no email was sent. The dashboard says they're already a member.
     */
    private boolean alreadyMember;

    public static InvitedUserDTO of(UserDTO source, boolean existingAccount) {
        InvitedUserDTO dto = new InvitedUserDTO();
        BeanUtils.copyProperties(source, dto);
        dto.setExistingAccount(existingAccount);
        return dto;
    }
}
