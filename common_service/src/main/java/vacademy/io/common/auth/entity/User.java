package vacademy.io.common.auth.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import org.hibernate.annotations.Where;
import vacademy.io.common.auth.dto.UserTopLevelDto;
import vacademy.io.common.core.utils.TextSanitizer;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Date;
import java.util.Set;

@Getter
@Setter
@Builder
@ToString
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "users")
public class User {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;
    @Column(name = "username")
    private String username;
    @Column(name = "email")
    private String email;
    @JsonIgnore
    @Column(name = "password_hash")
    private String password;
    @Column(name = "full_name")
    private String fullName;
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @Where(clause = "status IN ('ACTIVE', 'INVITED')")
    private Set<UserRole> roles;
    @Column(name = "address_line")
    private String addressLine;
    @Column(name = "city")
    private String city;
    @Column(name = "pin_code")
    private String pinCode;
    @Column(name = "mobile_number")
    private String mobileNumber;

    @Column(name = "date_of_birth")
    private Date dateOfBirth;

    @Column(name = "gender")
    private String gender;

    @Column(name = "profile_pic_file_id")
    private String profilePicFileId;

    @Column(name = "is_root_user")
    private boolean isRootUser;

    @Column(name = "is_parent")
    private Boolean isParent;

    @Column(name = "linked_parent_id")
    private String linkedParentId;

    // BCP-47 language tag ("en", "ar", "hi", ...); validated against
    // LocaleRegistry before persisting. NULL = no explicit preference.
    @Column(name = "preferred_locale")
    private String preferredLocale;

    // Author metadata surfaced on course pages / catalogue (set from the
    // Add Course → Add Authors flow). NULL = not an author / not set.
    @Column(name = "author_subtitle")
    private String authorSubtitle;

    @Column(name = "author_description", columnDefinition = "TEXT")
    private String authorDescription;

    @Column(name = "last_token_update_time")
    @Temporal(TemporalType.TIMESTAMP)
    private Date lastTokenUpdateTime;

    @Column(name = "last_login_time")
    @Temporal(TemporalType.TIMESTAMP)
    private Date lastLoginTime;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    public UserTopLevelDto getUserTopLevelDto() {
        return UserTopLevelDto.builder()
                .fullName(this.fullName)
                .mobileNumber(this.mobileNumber)
                .id(this.id)
                .addressLine(this.addressLine)
                .gender(this.gender)
                .dateOfBirth(this.dateOfBirth)
                .isRootUser(this.isRootUser)
                .city(this.city)
                .email(this.email)
                .pinCode(this.pinCode)
                .profilePicFileId(this.profilePicFileId)
                .authorSubtitle(this.authorSubtitle)
                .authorDescription(this.authorDescription)
                .preferredLocale(this.preferredLocale)
                .roles(this.roles != null ? roles.stream().map(UserRole::getRoleDto).toList() : new ArrayList<>())
                .build();
    }

    @PrePersist
    @PreUpdate
    private void normalizeIdentifiers() {
        // Strip invisible characters before anything is written. An email pasted
        // from a spreadsheet or mail client can carry a leading ZERO WIDTH SPACE
        // or BOM; it is invisible in every UI, survives trim(), and then makes the
        // login lookup miss forever — the user simply cannot authenticate. This is
        // the single chokepoint for every write path into `users`, so keep the
        // repair here rather than in each caller. See TextSanitizer.
        this.username = TextSanitizer.cleanIdentifier(this.username);
        this.email = TextSanitizer.cleanIdentifier(this.email);
        this.fullName = TextSanitizer.clean(this.fullName);
        // clean() not cleanIdentifier(): stored numbers are formatted with spaces
        // in places and collapsing them here would change existing values on every
        // update, including the ones findLatestUserByMobileNumber matches on.
        this.mobileNumber = TextSanitizer.clean(this.mobileNumber);
        if (this.email != null) {
            this.email = this.email.toLowerCase();
        }
    }

    // Manual Getters and Setters to ensure compilation
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public Set<UserRole> getRoles() {
        return roles;
    }

    public void setRoles(Set<UserRole> roles) {
        this.roles = roles;
    }

    public String getAddressLine() {
        return addressLine;
    }

    public void setAddressLine(String addressLine) {
        this.addressLine = addressLine;
    }

    public String getCity() {
        return city;
    }

    public void setCity(String city) {
        this.city = city;
    }

    public String getPinCode() {
        return pinCode;
    }

    public void setPinCode(String pinCode) {
        this.pinCode = pinCode;
    }

    public String getMobileNumber() {
        return mobileNumber;
    }

    public void setMobileNumber(String mobileNumber) {
        this.mobileNumber = mobileNumber;
    }

    public Date getDateOfBirth() {
        return dateOfBirth;
    }

    public void setDateOfBirth(Date dateOfBirth) {
        this.dateOfBirth = dateOfBirth;
    }

    public String getGender() {
        return gender;
    }

    public void setGender(String gender) {
        this.gender = gender;
    }

    public String getProfilePicFileId() {
        return profilePicFileId;
    }

    public void setProfilePicFileId(String profilePicFileId) {
        this.profilePicFileId = profilePicFileId;
    }

    public boolean isRootUser() {
        return isRootUser;
    }

    public void setRootUser(boolean rootUser) {
        isRootUser = rootUser;
    }

    public Boolean getIsParent() {
        return isParent;
    }

    public void setIsParent(Boolean isParent) {
        this.isParent = isParent;
    }

    public String getLinkedParentId() {
        return linkedParentId;
    }

    public void setLinkedParentId(String linkedParentId) {
        this.linkedParentId = linkedParentId;
    }

    public String getPreferredLocale() {
        return preferredLocale;
    }

    public void setPreferredLocale(String preferredLocale) {
        this.preferredLocale = preferredLocale;
    }

    public String getAuthorSubtitle() {
        return authorSubtitle;
    }

    public void setAuthorSubtitle(String authorSubtitle) {
        this.authorSubtitle = authorSubtitle;
    }

    public String getAuthorDescription() {
        return authorDescription;
    }

    public void setAuthorDescription(String authorDescription) {
        this.authorDescription = authorDescription;
    }

    public Date getLastTokenUpdateTime() {
        return lastTokenUpdateTime;
    }

    public void setLastTokenUpdateTime(Date lastTokenUpdateTime) {
        this.lastTokenUpdateTime = lastTokenUpdateTime;
    }

    public Date getLastLoginTime() {
        return lastLoginTime;
    }

    public void setLastLoginTime(Date lastLoginTime) {
        this.lastLoginTime = lastLoginTime;
    }

    public Timestamp getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Timestamp createdAt) {
        this.createdAt = createdAt;
    }

    public Timestamp getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Timestamp updatedAt) {
        this.updatedAt = updatedAt;
    }

}
