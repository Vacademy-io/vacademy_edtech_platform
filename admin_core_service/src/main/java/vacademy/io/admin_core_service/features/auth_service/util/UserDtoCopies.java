package vacademy.io.admin_core_service.features.auth_service.util;

import vacademy.io.common.auth.dto.UserDTO;

import java.util.ArrayList;

/** Copies of a {@link UserDTO}, for passing a changed user on without changing the original. */
public final class UserDtoCopies {

    private UserDtoCopies() {
    }

    /** A field-by-field copy, so changing the copy never changes {@code source}. */
    public static UserDTO copyOf(UserDTO source) {
        UserDTO copy = UserDTO.builder()
                .id(source.getId())
                .username(source.getUsername())
                .email(source.getEmail())
                .fullName(source.getFullName())
                .addressLine(source.getAddressLine())
                .city(source.getCity())
                .region(source.getRegion())
                .pinCode(source.getPinCode())
                .mobileNumber(source.getMobileNumber())
                .dateOfBirth(source.getDateOfBirth())
                .gender(source.getGender())
                .isRootUser(source.isRootUser())
                .password(source.getPassword())
                .profilePicFileId(source.getProfilePicFileId())
                .roles(source.getRoles() == null ? null : new ArrayList<>(source.getRoles()))
                .lastLoginTime(source.getLastLoginTime())
                .isParent(source.getIsParent())
                .linkedParentId(source.getLinkedParentId())
                .preferredLocale(source.getPreferredLocale())
                .authorSubtitle(source.getAuthorSubtitle())
                .authorDescription(source.getAuthorDescription())
                .usernameExplicit(source.getUsernameExplicit())
                .usernameFieldValues(source.getUsernameFieldValues())
                .roleLabel(source.getRoleLabel())
                .build();
        return copy;
    }
}
