package vacademy.io.admin_core_service.features.learner_invitation.services;

import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.learner_invitation.dto.*;
import vacademy.io.admin_core_service.features.learner_invitation.entity.LearnerInvitation;
import vacademy.io.admin_core_service.features.learner_invitation.entity.LearnerInvitationCustomField;
import vacademy.io.admin_core_service.features.learner_invitation.enums.CustomFieldStatusEnum;
import vacademy.io.admin_core_service.features.learner_invitation.enums.LearnerInvitationCodeStatusEnum;
import vacademy.io.admin_core_service.features.learner_invitation.enums.LearnerInvitationResponseStatusEnum;
import vacademy.io.admin_core_service.features.learner_invitation.notification.LearnerInvitationNotification;
import vacademy.io.admin_core_service.features.learner_invitation.repository.LearnerInvitationRepository;
import vacademy.io.admin_core_service.features.learner_invitation.repository.LearnerInvitationCustomFieldRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.security.SecureRandom;
import java.util.*;

@Service
public class LearnerInvitationService {

    @Autowired
    private LearnerInvitationCustomFieldRepository learnerInvitationCustomFieldRepository;

    @Autowired
    private LearnerInvitationRepository learnerInvitationRepository;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private LearnerInvitationNotification notification;

    @Transactional
    public LearnerInvitationDTO createLearnerInvitationCode(AddLearnerInvitationDTO addLearnerInvitationDTO, CustomUserDetails user) {
        LearnerInvitationDTO learnerInvitationDTO = addLearnerInvitationDTO.getLearnerInvitation();
        validateRequest(learnerInvitationDTO);
        learnerInvitationDTO.setInviteCode(generateInviteCode());

        LearnerInvitation learnerInvitation = new LearnerInvitation(learnerInvitationDTO);
        learnerInvitation = learnerInvitationRepository.save(learnerInvitation);

        Institute institute = instituteRepository.findById(learnerInvitationDTO.getInstituteId())
                .orElseThrow(() -> new VacademyException("Institute not found with ID: " + learnerInvitationDTO.getInstituteId()));

        List<String> emails = addLearnerInvitationDTO.getEmailsToSendInvitation();
        if (emails != null && !emails.isEmpty()) {
            sendLearnerInvitationNotificationAsync(emails, institute, learnerInvitationDTO.getInviteCode());
        }

        return learnerInvitation.mapToDTO();
    }

    public void sendLearnerInvitationNotificationAsync(List<String> emails, Institute institute, String invitationCode) {
        notification.sendLearnerInvitationNotification(emails, institute, invitationCode);
    }

    private void validateRequest(LearnerInvitationDTO learnerInvitationDTO) {
        if (Objects.isNull(learnerInvitationDTO)) {
            throw new VacademyException("Invalid request: Learner invitation data is missing.");
        }
        if (!StringUtils.hasText(learnerInvitationDTO.getName())) {
            throw new VacademyException("Invalid request: Name cannot be null or empty.");
        }
        if (!StringUtils.hasText(learnerInvitationDTO.getStatus())) {
            throw new VacademyException("Invalid request: Status cannot be null or empty.");
        }
        if (!StringUtils.hasText(learnerInvitationDTO.getInstituteId())) {
            throw new VacademyException("Invalid request: Institute ID cannot be null or empty.");
        }
        if (Objects.isNull(learnerInvitationDTO.getExpiryDate())) {
            throw new VacademyException("Invalid request: Expiry Date cannot be null.");
        }
    }

    private String generateInviteCode() {
        String chars = "ABC0D1E2F3G4H5I6JK7L8M9NOPQR0STUVWXYZ";
        SecureRandom random = new SecureRandom();
        StringBuilder inviteCode = new StringBuilder(6);

        for (int i = 0; i < 6; i++) {
            inviteCode.append(chars.charAt(random.nextInt(chars.length())));
        }

        return inviteCode.toString();
    }

    public Page<InvitationDetailProjection> getInvitationDetails(String instituteId, LearnerInvitationDetailFilterDTO filter, int pageNo, int pageSize, CustomUserDetails user) {
        Pageable pageable = PageRequest.of(pageNo, pageSize);
        if (StringUtils.hasText(filter.getName())){
            return learnerInvitationRepository.findInvitationsWithAcceptedCountByName(instituteId,
                    filter.getStatus(),
                    List.of(LearnerInvitationResponseStatusEnum.ACTIVE.name(),
                            LearnerInvitationResponseStatusEnum.ACCEPTED.name()),
                    filter.getName(),pageable);
        }
        return learnerInvitationRepository.findInvitationsWithAcceptedCount(
               instituteId, filter.getStatus(),
               List.of(LearnerInvitationResponseStatusEnum.ACTIVE.name(),
                       LearnerInvitationResponseStatusEnum.ACCEPTED.name()),
               pageable);
    }

    @Transactional
    public String updateLearnerInvitationStatus(LearnerInvitationStatusUpdateDTO statusChangeDTO, CustomUserDetails user){
        if (Objects.isNull(statusChangeDTO) || Objects.isNull(statusChangeDTO.getLearnerInvitationIds()) || statusChangeDTO.getLearnerInvitationIds().isEmpty() || !StringUtils.hasText(statusChangeDTO.getStatus())){
            throw new VacademyException("Invalid request!!!");
        }
        List<LearnerInvitation>responses = learnerInvitationRepository.findAllById(statusChangeDTO.getLearnerInvitationIds());
        for (LearnerInvitation learnerInvitation : responses) {
            learnerInvitation.setStatus(statusChangeDTO.getStatus());
        }
        learnerInvitationRepository.saveAll(responses);
        return "Status updated successfully!!!";
    }

    @Transactional
    public String updateLearnerInvitation(LearnerInvitationDTO learnerInvitationDTO, CustomUserDetails user) {
        LearnerInvitation learnerInvitation = learnerInvitationRepository.findById(learnerInvitationDTO.getId())
                .orElseThrow(() -> new VacademyException("Learner invitation not found"));

        updateLearnerInvitationDetails(learnerInvitationDTO, learnerInvitation);

        if (learnerInvitationDTO.getCustomFields() != null && !learnerInvitationDTO.getCustomFields().isEmpty()) {
            updateCustomFields(learnerInvitationDTO.getCustomFields(), learnerInvitation);
        }

        return "Details updated successfully";
    }

    private void updateLearnerInvitationDetails(LearnerInvitationDTO dto, LearnerInvitation entity) {
        if (StringUtils.hasText(dto.getStatus())) entity.setStatus(dto.getStatus());
        if (StringUtils.hasText(dto.getName())) entity.setName(dto.getName());
        if (dto.getExpiryDate() != null) entity.setExpiryDate(dto.getExpiryDate());
        if (StringUtils.hasText(dto.getBatchOptionsJson())) entity.setBatchOptionsJson(dto.getBatchOptionsJson());

        learnerInvitationRepository.save(entity); // Save updated entity once
    }

    private void updateCustomFields(List<LearnerInvitationCustomFieldDTO> fieldDTOs, LearnerInvitation learnerInvitation) {
        List<LearnerInvitationCustomField> updatedFields = new ArrayList<>();

        for (LearnerInvitationCustomFieldDTO fieldDTO : fieldDTOs) {
            LearnerInvitationCustomField field = learnerInvitationCustomFieldRepository.findById(fieldDTO.getId())
                    .map(existingField -> updateExistingField(existingField, fieldDTO))
                    .orElseGet(() -> new LearnerInvitationCustomField(fieldDTO, learnerInvitation));

            updatedFields.add(field);
        }

        learnerInvitationCustomFieldRepository.saveAll(updatedFields); // Batch save for performance
    }

    private LearnerInvitationCustomField updateExistingField(LearnerInvitationCustomField field, LearnerInvitationCustomFieldDTO dto) {
        if (StringUtils.hasText(dto.getFieldName())) field.setFieldName(dto.getFieldName());
        if (StringUtils.hasText(dto.getFieldType())) field.setFieldType(dto.getFieldType());
        if (StringUtils.hasText(dto.getCommaSeparatedOptions()))
            field.setCommaSeparatedOptions(dto.getCommaSeparatedOptions());
        if (dto.getIsMandatory() != null) field.setIsMandatory(dto.getIsMandatory());
        if (StringUtils.hasText(dto.getDescription())) field.setDescription(dto.getDescription());
        if (StringUtils.hasText(dto.getDefaultValue())) field.setDefaultValue(dto.getDefaultValue());
        if (StringUtils.hasText(dto.getStatus())) field.setStatus(dto.getStatus());
        field.setFieldOrder(dto.getFieldOrder());
        return field;
    }

    public LearnerInvitationDTO getLearnerInvitationById(String learnerInvitationId, CustomUserDetails user) {
        LearnerInvitation learnerInvitation = learnerInvitationRepository.findByIdWithFilteredCustomFields(learnerInvitationId,List.of(CustomFieldStatusEnum.ACTIVE.name()))
                .orElseThrow(() -> new VacademyException("Learner invitation not found"));
        return learnerInvitation.mapToDTO();
    }

    @Transactional
    public List<LearnerInvitationDTO> createLearnerInvitationCodes(List<AddLearnerInvitationDTO> addLearnerInvitationDTOs, CustomUserDetails user) {
        List<LearnerInvitation> invitationsToSave = new ArrayList<>();
        Map<LearnerInvitation, AddLearnerInvitationDTO> invitationToDTOMap = new HashMap<>();

        for (AddLearnerInvitationDTO addDTO : addLearnerInvitationDTOs) {
            LearnerInvitationDTO dto = addDTO.getLearnerInvitation();
            validateRequest(dto);
            dto.setInviteCode(generateInviteCode());

            LearnerInvitation entity = new LearnerInvitation(dto);
            invitationsToSave.add(entity);
            invitationToDTOMap.put(entity, addDTO);
        }

        List<LearnerInvitation> savedInvitations = learnerInvitationRepository.saveAll(invitationsToSave);
        List<LearnerInvitationDTO> result = new ArrayList<>();

        for (LearnerInvitation saved : savedInvitations) {
            AddLearnerInvitationDTO originalDTO = invitationToDTOMap.get(saved);
            String instituteId = saved.getInstituteId();

            Institute institute = instituteRepository.findById(instituteId)
                    .orElseThrow(() -> new VacademyException("Institute not found with ID: " + instituteId));

            List<String> emails = originalDTO.getEmailsToSendInvitation();
            if (emails != null && !emails.isEmpty()) {
                sendLearnerInvitationNotificationAsync(emails, institute, saved.getInviteCode());
            }

            result.add(saved.mapToDTO());
        }

        return result;
    }

    @Async
    public void deleteLearnerInvitationBySourceAndSourceId(String source, List<String> sourceIds) {
        learnerInvitationRepository.updateStatusBySourceIdsAndSource(LearnerInvitationCodeStatusEnum.DELETED.name(), sourceIds, source);
    }

}
