package vacademy.io.admin_core_service.features.hr_approval.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_approval.dto.ApprovalActionDTO;
import vacademy.io.admin_core_service.features.hr_approval.dto.ApprovalActionInputDTO;
import vacademy.io.admin_core_service.features.hr_approval.dto.ApprovalChainDTO;
import vacademy.io.admin_core_service.features.hr_approval.dto.ApprovalRequestDTO;
import vacademy.io.admin_core_service.features.hr_approval.entity.ApprovalAction;
import vacademy.io.admin_core_service.features.hr_approval.entity.ApprovalChain;
import vacademy.io.admin_core_service.features.hr_approval.entity.ApprovalRequest;
import vacademy.io.admin_core_service.features.hr_approval.enums.ApprovalStatus;
import vacademy.io.admin_core_service.features.hr_approval.repository.ApprovalActionRepository;
import vacademy.io.admin_core_service.features.hr_approval.repository.ApprovalChainRepository;
import vacademy.io.admin_core_service.features.hr_approval.repository.ApprovalRequestRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class ApprovalService {

    @Autowired
    private ApprovalChainRepository approvalChainRepository;

    @Autowired
    private ApprovalRequestRepository approvalRequestRepository;

    @Autowired
    private ApprovalActionRepository approvalActionRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    // ======================== Chain Management ========================

    @Transactional
    public String saveChain(ApprovalChainDTO dto, String instituteId) {
        // Upsert by the VALIDATED instituteId + entityType — never the dto's instituteId,
        // which would allow cross-tenant writes of approval chains
        Optional<ApprovalChain> existingOpt = approvalChainRepository
                .findByInstituteIdAndEntityType(instituteId, dto.getEntityType());

        ApprovalChain chain;
        if (existingOpt.isPresent()) {
            chain = existingOpt.get();
        } else {
            chain = new ApprovalChain();
            chain.setInstituteId(instituteId);
            chain.setEntityType(dto.getEntityType());
        }

        chain.setApprovalLevels(dto.getApprovalLevels());
        chain.setLevelConfig(dto.getLevelConfig());
        chain.setAutoApproveAfterDays(dto.getAutoApproveAfterDays());
        chain.setStatus(dto.getStatus() != null ? dto.getStatus() : "ACTIVE");

        chain = approvalChainRepository.save(chain);
        return chain.getId();
    }

    @Transactional(readOnly = true)
    public List<ApprovalChainDTO> getChains(String instituteId) {
        List<ApprovalChain> chains = approvalChainRepository.findByInstituteIdOrderByEntityTypeAsc(instituteId);
        return chains.stream().map(this::toChainDTO).collect(Collectors.toList());
    }

    // ======================== Request Management ========================

    @Transactional
    public String createRequest(String instituteId, String entityType, String entityId, String requesterId) {
        // Check if a request already exists for this entity
        Optional<ApprovalRequest> existingOpt = approvalRequestRepository
                .findByEntityTypeAndEntityId(entityType, entityId);

        if (existingOpt.isPresent()) {
            ApprovalRequest existing = existingOpt.get();
            if (ApprovalStatus.PENDING.name().equals(existing.getStatus())) {
                throw new VacademyException("An approval request already exists and is pending for this entity");
            }
        }

        // Look up chain to determine total levels
        ApprovalChain chain = approvalChainRepository.findByInstituteIdAndEntityType(instituteId, entityType)
                .orElseThrow(() -> new VacademyException("No approval chain configured for entity type: " + entityType));

        ApprovalRequest request = new ApprovalRequest();
        request.setInstituteId(instituteId);
        request.setEntityType(entityType);
        request.setEntityId(entityId);
        request.setRequesterId(requesterId);
        request.setCurrentLevel(1);
        request.setTotalLevels(chain.getApprovalLevels());
        request.setStatus(ApprovalStatus.PENDING.name());

        request = approvalRequestRepository.save(request);
        return request.getId();
    }

    @Transactional
    public String processAction(String requestId, ApprovalActionInputDTO actionInputDTO, String actorUserId, String instituteId) {
        ApprovalRequest request = approvalRequestRepository.findById(requestId)
                .orElseThrow(() -> new VacademyException("Approval request not found"));
        hrAccessGuard.requireInstituteMatch(request.getInstituteId(), instituteId, "Approval request");

        if (!ApprovalStatus.PENDING.name().equals(request.getStatus())) {
            throw new VacademyException("Cannot process action on a " + request.getStatus() + " request");
        }

        // BUG 5 FIX: Prevent self-approval — requester cannot approve their own request
        if (request.getRequesterId().equals(actorUserId)) {
            throw new VacademyException("Cannot approve your own request");
        }

        // Prevent the same actor from acting on more than one level of the same request
        List<ApprovalAction> priorActions = approvalActionRepository.findByRequestIdAndActorId(requestId, actorUserId);
        boolean actedAtOtherLevel = priorActions.stream()
                .anyMatch(a -> a.getLevel() != null && !a.getLevel().equals(request.getCurrentLevel()));
        if (actedAtOtherLevel) {
            throw new VacademyException("You have already acted on another level of this request; a different approver is required for level " + request.getCurrentLevel());
        }

        String action = actionInputDTO.getAction();
        if (!"APPROVED".equalsIgnoreCase(action) && !"REJECTED".equalsIgnoreCase(action)) {
            throw new VacademyException("Invalid action. Must be APPROVED or REJECTED");
        }

        // Create the ApprovalAction record
        ApprovalAction approvalAction = new ApprovalAction();
        approvalAction.setRequest(request);
        approvalAction.setLevel(request.getCurrentLevel());
        approvalAction.setAction(action.toUpperCase());
        approvalAction.setActorId(actorUserId);
        approvalAction.setComments(actionInputDTO.getComments());
        approvalAction.setActedAt(LocalDateTime.now());

        approvalActionRepository.save(approvalAction);

        if ("REJECTED".equalsIgnoreCase(action)) {
            // If rejected at any level, the entire request is rejected
            request.setStatus(ApprovalStatus.REJECTED.name());
        } else if ("APPROVED".equalsIgnoreCase(action)) {
            if (request.getCurrentLevel() < request.getTotalLevels()) {
                // Move to next level
                request.setCurrentLevel(request.getCurrentLevel() + 1);
            } else {
                // All levels approved -- mark the request as fully approved
                request.setStatus(ApprovalStatus.APPROVED.name());
            }
        }

        approvalRequestRepository.save(request);
        return request.getId();
    }

    @Transactional(readOnly = true)
    public List<ApprovalRequestDTO> getPendingRequests(String instituteId) {
        List<ApprovalRequest> requests = approvalRequestRepository.findPendingRequests(instituteId);
        return requests.stream().map(r -> toRequestDTO(r, false)).collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public ApprovalRequestDTO getRequestHistory(String entityType, String entityId, String instituteId) {
        ApprovalRequest request = approvalRequestRepository.findByEntityTypeAndEntityId(entityType, entityId)
                .orElseThrow(() -> new VacademyException("Approval request not found for entity"));
        hrAccessGuard.requireInstituteMatch(request.getInstituteId(), instituteId, "Approval request");

        return toRequestDTO(request, true);
    }

    // ======================== DTO Mappers ========================

    private ApprovalChainDTO toChainDTO(ApprovalChain chain) {
        return ApprovalChainDTO.builder()
                .id(chain.getId())
                .instituteId(chain.getInstituteId())
                .entityType(chain.getEntityType())
                .approvalLevels(chain.getApprovalLevels())
                .levelConfig(chain.getLevelConfig())
                .autoApproveAfterDays(chain.getAutoApproveAfterDays())
                .status(chain.getStatus())
                .build();
    }

    private ApprovalRequestDTO toRequestDTO(ApprovalRequest request, boolean includeActions) {
        List<ApprovalActionDTO> actionDTOs;
        if (includeActions) {
            List<ApprovalAction> actions = approvalActionRepository.findByRequestIdOrderByLevelAsc(request.getId());
            actionDTOs = actions.stream()
                    .map(a -> ApprovalActionDTO.builder()
                            .id(a.getId())
                            .level(a.getLevel())
                            .action(a.getAction())
                            .actorId(a.getActorId())
                            .actorName(a.getActorId()) // Using actor ID as name proxy
                            .comments(a.getComments())
                            .actedAt(a.getActedAt())
                            .build())
                    .collect(Collectors.toList());
        } else {
            actionDTOs = Collections.emptyList();
        }

        return ApprovalRequestDTO.builder()
                .id(request.getId())
                .instituteId(request.getInstituteId())
                .entityType(request.getEntityType())
                .entityId(request.getEntityId())
                .requesterId(request.getRequesterId())
                .requesterName(request.getRequesterId()) // Using requester ID as name proxy
                .currentLevel(request.getCurrentLevel())
                .totalLevels(request.getTotalLevels())
                .status(request.getStatus())
                .actions(actionDTOs)
                .build();
    }
}
