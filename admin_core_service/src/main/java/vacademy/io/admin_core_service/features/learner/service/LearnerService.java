package vacademy.io.admin_core_service.features.learner.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.learner.dto.LearnerDetailsDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerDetailsEditDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerExtraDetails;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.UserNotFoundException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
public class LearnerService {
    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    @Autowired
    private AuthService authService;

    @Autowired
    private LearnerLmsUserSyncService learnerLmsUserSyncService;

    public String editLearnerDetails(LearnerDetailsEditDTO learnerDetailsEditDTO, CustomUserDetails user) {
        if (Objects.isNull(learnerDetailsEditDTO)) {
            throw new VacademyException("Invalid request");
        }
        Student student = instituteStudentRepository.findTopByUserId(learnerDetailsEditDTO.getUserId())
                .orElseThrow(() -> new UserNotFoundException("User not found"));
        // Captured before mutation: the LMS sync looks the user up by their
        // CURRENT email on the LMS, and only fires when name/email changed.
        String previousEmail = student.getEmail();
        String previousFullName = student.getFullName();
        if (StringUtils.hasText(learnerDetailsEditDTO.getEmail()))
            student.setEmail(learnerDetailsEditDTO.getEmail());
        if (StringUtils.hasText(learnerDetailsEditDTO.getFullName()))
            student.setFullName(learnerDetailsEditDTO.getFullName());
        if (StringUtils.hasText(learnerDetailsEditDTO.getContactNumber()))
            student.setMobileNumber(learnerDetailsEditDTO.getContactNumber());
        if (StringUtils.hasText(learnerDetailsEditDTO.getGender()))
            student.setGender(learnerDetailsEditDTO.getGender());
        if (StringUtils.hasText(learnerDetailsEditDTO.getAddressLine()))
            student.setAddressLine(learnerDetailsEditDTO.getAddressLine());
        if (StringUtils.hasText(learnerDetailsEditDTO.getState()))
            student.setRegion(learnerDetailsEditDTO.getState());
        if (StringUtils.hasText(learnerDetailsEditDTO.getPinCode()))
            student.setPinCode(learnerDetailsEditDTO.getPinCode());
        if (StringUtils.hasText(learnerDetailsEditDTO.getInstituteName()))
            student.setLinkedInstituteName(learnerDetailsEditDTO.getInstituteName());
        if (StringUtils.hasText(learnerDetailsEditDTO.getFatherName()))
            student.setFatherName(learnerDetailsEditDTO.getFatherName());
        if (StringUtils.hasText(learnerDetailsEditDTO.getMotherName()))
            student.setMotherName(learnerDetailsEditDTO.getMotherName());
        if (StringUtils.hasText(learnerDetailsEditDTO.getParentsMobileNumber()))
            student.setParentToMotherMobileNumber(learnerDetailsEditDTO.getParentsMobileNumber());
        if (StringUtils.hasText(learnerDetailsEditDTO.getParentsEmail()))
            student.setParentsEmail(learnerDetailsEditDTO.getParentsEmail());
        if (StringUtils.hasText(learnerDetailsEditDTO.getUserName())) {
            student.setUsername(learnerDetailsEditDTO.getUserName());
        }
        student.setFaceFileId(learnerDetailsEditDTO.getFaceFileId());
        instituteStudentRepository.save(student);
        UserDTO userDTO = new UserDTO();
        userDTO.setId(learnerDetailsEditDTO.getUserId());
        userDTO.setFullName(learnerDetailsEditDTO.getFullName());
        userDTO.setEmail(learnerDetailsEditDTO.getEmail());
        userDTO.setMobileNumber(learnerDetailsEditDTO.getContactNumber());
        userDTO.setProfilePicFileId(learnerDetailsEditDTO.getFaceFileId());
        userDTO.setUsername(learnerDetailsEditDTO.getUserName());
        authService.updateUser(userDTO, learnerDetailsEditDTO.getUserId());

        syncProfileToLms(learnerDetailsEditDTO.getUserId(), previousEmail, previousFullName,
                learnerDetailsEditDTO.getEmail(), learnerDetailsEditDTO.getFullName());
        return "success";
    }

    /**
     * Mirror name/email changes to any WordPress LMS the learner's courses are
     * connected to (async, best-effort — never blocks or fails the profile edit).
     * The LMS looks the user up by their PREVIOUS email, so callers must capture
     * it before mutating the Student entity.
     */
    private void syncProfileToLms(String userId, String previousEmail, String previousFullName,
            String newEmail, String newFullName) {
        syncProfileToLms(userId, previousEmail, previousFullName, newEmail, newFullName, null);
    }

    /** As above, with an optional new password carried in the same LMS call. */
    private void syncProfileToLms(String userId, String previousEmail, String previousFullName,
            String newEmail, String newFullName, String newPassword) {
        String effectiveEmail = StringUtils.hasText(newEmail) ? newEmail : previousEmail;
        String effectiveFullName = StringUtils.hasText(newFullName) ? newFullName : previousFullName;
        boolean emailChanged = StringUtils.hasText(previousEmail)
                && !previousEmail.trim().equalsIgnoreCase(effectiveEmail != null ? effectiveEmail.trim() : "");
        boolean nameChanged = !Objects.equals(
                previousFullName != null ? previousFullName.trim() : null,
                effectiveFullName != null ? effectiveFullName.trim() : null);
        if (emailChanged || nameChanged) {
            learnerLmsUserSyncService.syncProfileUpdate(userId, previousEmail, effectiveEmail, effectiveFullName,
                    newPassword);
        }
    }

    public String updateFaceFileId(String faceFileId, CustomUserDetails userDetails) {
        if (StringUtils.hasText(userDetails.getId()) && StringUtils.hasText(faceFileId)) {
            Student student = instituteStudentRepository.findTopByUserId(userDetails.getId())
                    .orElseThrow(() -> new UserNotFoundException("User not found"));
            student.setFaceFileId(faceFileId);
            instituteStudentRepository.save(student);
            return "success";
        }
        return "failed";
    }

    @Transactional(readOnly = true)
    public List<LearnerDetailsDTO> getStudentsByPackageSessionId(String packageSessionId, String instituteId,
            CustomUserDetails user) {
        return instituteStudentRepository
                .findStudentsByPackageSessionIdAndInstituteIdAndStatus(packageSessionId, instituteId,
                        List.of(LearnerStatusEnum.ACTIVE.name()))
                .stream()
                .map(student -> new LearnerDetailsDTO(student.getFullName(), student.getUserId()))
                .collect(Collectors.toList());
    }

    public String updateLearnerDetail(UserDTO userDTO, LearnerExtraDetails learnerExtraDetails) {
        Student student = instituteStudentRepository.findTopByUserId(userDTO.getId())
                .orElseThrow(() -> new UserNotFoundException("User not found"));

        // Captured before mutation — the LMS sync below matches the WordPress
        // user on their previous email.
        String previousEmail = student.getEmail();
        String previousFullName = student.getFullName();

        if (StringUtils.hasText(userDTO.getUsername()))
            student.setUsername(userDTO.getUsername());
        if (StringUtils.hasText(userDTO.getEmail()))
            student.setEmail(userDTO.getEmail());
        if (StringUtils.hasText(userDTO.getFullName()))
            student.setFullName(userDTO.getFullName());
        if (StringUtils.hasText(userDTO.getAddressLine()))
            student.setAddressLine(userDTO.getAddressLine());
        if (StringUtils.hasText(userDTO.getRegion()))
            student.setRegion(userDTO.getRegion());
        if (StringUtils.hasText(userDTO.getCity()))
            student.setCity(userDTO.getCity());
        if (StringUtils.hasText(userDTO.getPinCode()))
            student.setPinCode(userDTO.getPinCode());
        if (StringUtils.hasText(userDTO.getMobileNumber()))
            student.setMobileNumber(userDTO.getMobileNumber());
        if (userDTO.getDateOfBirth() != null)
            student.setDateOfBirth(userDTO.getDateOfBirth());
        if (StringUtils.hasText(userDTO.getGender()))
            student.setGender(userDTO.getGender());
        if (learnerExtraDetails != null) {
            if (StringUtils.hasText(learnerExtraDetails.getFathersName()))
                student.setFatherName(learnerExtraDetails.getFathersName());
            if (StringUtils.hasText(learnerExtraDetails.getMothersName()))
                student.setMotherName(learnerExtraDetails.getMothersName());
            if (StringUtils.hasText(learnerExtraDetails.getParentsMobileNumber()))
                student.setParentsMobileNumber(learnerExtraDetails.getParentsMobileNumber());
            if (StringUtils.hasText(learnerExtraDetails.getParentsEmail()))
                student.setParentsEmail(learnerExtraDetails.getParentsEmail());
            if (StringUtils.hasText(learnerExtraDetails.getLinkedInstituteName()))
                student.setLinkedInstituteName(learnerExtraDetails.getLinkedInstituteName());
            if (StringUtils.hasText(learnerExtraDetails.getParentsToMotherEmail()))
                student.setParentsToMotherEmail(learnerExtraDetails.getParentsToMotherEmail());
            if (StringUtils.hasText(learnerExtraDetails.getParentsToMotherMobileNumber()))
                student.setParentToMotherMobileNumber(learnerExtraDetails.getParentsToMotherMobileNumber());
        }
        // Deliberately unconditional: the edit dialog sends an empty file id to
        // remove the learner's profile picture.
        student.setFaceFileId(userDTO.getProfilePicFileId());

        instituteStudentRepository.save(student);

        syncProfileToLms(userDTO.getId(), previousEmail, previousFullName,
                userDTO.getEmail(), userDTO.getFullName());
        return "done";
    }

    public String updateLearnerDetail(UserDTO userDTO) {
        Student student = instituteStudentRepository.findTopByUserId(userDTO.getId())
                .orElseThrow(() -> new UserNotFoundException("User not found"));

        // Captured before mutation, as in the other edit paths: the LMS sync below
        // matches the WordPress user on their previous email.
        String previousEmail = student.getEmail();
        String previousFullName = student.getFullName();

        if (StringUtils.hasText(userDTO.getUsername())) {
            student.setUsername(userDTO.getUsername());
        }
        if (StringUtils.hasText(userDTO.getEmail())) {
            student.setEmail(userDTO.getEmail());
        }
        if (StringUtils.hasText(userDTO.getFullName())) {
            student.setFullName(userDTO.getFullName());
        }
        if (StringUtils.hasText(userDTO.getAddressLine())) {
            student.setAddressLine(userDTO.getAddressLine());
        }
        if (StringUtils.hasText(userDTO.getRegion())) {
            student.setRegion(userDTO.getRegion());
        }
        if (StringUtils.hasText(userDTO.getCity())) {
            student.setCity(userDTO.getCity());
        }
        if (StringUtils.hasText(userDTO.getPinCode())) {
            student.setPinCode(userDTO.getPinCode());
        }
        if (StringUtils.hasText(userDTO.getMobileNumber())) {
            student.setMobileNumber(userDTO.getMobileNumber());
        }
        if (userDTO.getDateOfBirth() != null) {
            student.setDateOfBirth(userDTO.getDateOfBirth());
        }
        if (StringUtils.hasText(userDTO.getGender())) {
            student.setGender(userDTO.getGender());
        }
        if (StringUtils.hasText(userDTO.getProfilePicFileId())) {
            student.setFaceFileId(userDTO.getProfilePicFileId());
        }
        instituteStudentRepository.save(student);

        // auth_service reaches this from the learner profile update and from Portal Access
        // when a username change also moves the email. Portal Access sends the password here
        // too, so the rename and the password land on the LMS in one edit-user call.
        syncProfileToLms(userDTO.getId(), previousEmail, previousFullName,
                userDTO.getEmail(), userDTO.getFullName(), userDTO.getPassword());
        return "done";
    }

    public void updateLearnerExtraDetails(LearnerExtraDetails learnerExtraDetails, String userId) {
        if (learnerExtraDetails == null || !StringUtils.hasText(userId)) {
            return;
        }

        Student student = instituteStudentRepository.findTopByUserId(userId)
                .orElseThrow(() -> new UserNotFoundException("User not found"));

        if (StringUtils.hasText(learnerExtraDetails.getFathersName())) {
            student.setFatherName(learnerExtraDetails.getFathersName());
        }
        if (StringUtils.hasText(learnerExtraDetails.getMothersName())) {
            student.setMotherName(learnerExtraDetails.getMothersName());
        }
        if (StringUtils.hasText(learnerExtraDetails.getParentsMobileNumber())) {
            student.setParentsMobileNumber(learnerExtraDetails.getParentsMobileNumber());
        }
        if (StringUtils.hasText(learnerExtraDetails.getParentsEmail())) {
            student.setParentsEmail(learnerExtraDetails.getParentsEmail());
        }
        if (StringUtils.hasText(learnerExtraDetails.getLinkedInstituteName())) {
            student.setLinkedInstituteName(learnerExtraDetails.getLinkedInstituteName());
        }
        if (StringUtils.hasText(learnerExtraDetails.getParentsToMotherEmail())) {
            student.setParentsToMotherEmail(learnerExtraDetails.getParentsToMotherEmail());
        }
        if (StringUtils.hasText(learnerExtraDetails.getParentsToMotherMobileNumber())) {
            student.setParentToMotherMobileNumber(learnerExtraDetails.getParentsToMotherMobileNumber());
        }

        instituteStudentRepository.save(student);
    }
}
