package vacademy.io.admin_core_service.features.packages.service;

import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.learner_invitation.enums.LearnerInvitationCodeStatusEnum;
import vacademy.io.admin_core_service.features.learner_invitation.enums.LearnerInvitationSourceTypeEnum;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.packages.dto.BatchProjection;
import vacademy.io.admin_core_service.features.packages.dto.PackageDTOWithBatchDetails;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.institute.dto.PackageDTO;
import vacademy.io.common.institute.entity.PackageEntity;

import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class BatchService {

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private LearnerInvitationService learnerInvitationService;

    @Autowired
    private PackageRepository packageRepository;

    @Autowired
    private StudentSessionInstituteGroupMappingRepository ssigmRepository;

    @Autowired
    private CommerceLegacyGuard commerceLegacyGuard;

    @Transactional
    public List<PackageDTOWithBatchDetails> getBatchDetails(String sessionId, String instituteId, CustomUserDetails user){
        List<PackageEntity> packages;

        if (sessionId != null && !sessionId.isEmpty()) {
            packages = packageSessionRepository.findPackagesBySessionIdAndStatuses(sessionId, instituteId, List.of(PackageSessionStatusEnum.ACTIVE.name()));
        } else {
            // Fallback: get packages from user's active package sessions via SSIGM
            List<String> packageSessionIds = ssigmRepository.findPackageSessionIdsByUserIdAndInstituteId(user.getUserId(), instituteId);
            if (packageSessionIds.isEmpty()) {
                return new ArrayList<>();
            }
            List<PackageSession> packageSessions = packageSessionRepository.findPackageSessionsByIds(packageSessionIds);
            Set<String> seenPackageIds = new HashSet<>();
            packages = packageSessions.stream()
                    .map(PackageSession::getPackageEntity)
                    .filter(p -> seenPackageIds.add(p.getId()))
                    .collect(Collectors.toList());
        }

        List<PackageDTOWithBatchDetails> packageDTOWithBatchDetails = new ArrayList<>();
        for (PackageEntity packageEntity : packages) {
            PackageDTO packageDTO = new PackageDTO(packageEntity);
            List<BatchProjection> batches = packageSessionRepository.findBatchDetailsWithLatestInviteCode(packageEntity.getId(), List.of(PackageSessionStatusEnum.ACTIVE.name()), List.of(LearnerStatusEnum.ACTIVE.name()));
            packageDTOWithBatchDetails.add(new PackageDTOWithBatchDetails(packageDTO, batches));
        }
        return packageDTOWithBatchDetails;
    }

    /**
     * Toggle the "sub-org associated" flag on package sessions. When true,
     * enrolling a learner into the session provisions a sub-org for them
     * (see {@code LearnerEnrollRequestService}, which keys off
     * {@code PackageSession.isOrgAssociated}). Surfaced on the Course Details
     * settings as the "is sub-org associated" toggle.
     */
    @Transactional
    public Boolean setOrgAssociated(List<String> packageSessionIds, boolean isOrgAssociated) {
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return false;
        }
        List<PackageSession> sessions = packageSessionRepository.findAllById(packageSessionIds);
        for (PackageSession session : sessions) {
            session.setIsOrgAssociated(isOrgAssociated);
        }
        packageSessionRepository.saveAll(sessions);
        return true;
    }

    public String deletePackageSession(String[] packageSessionIds, CustomUserDetails userDetails){
        // A variant is archived in Commerce, which keeps its own status and the legacy rows in step.
        commerceLegacyGuard.refuseVariantSessions(
                packageSessionIds == null ? null : Arrays.asList(packageSessionIds), "delete it as a batch");
        packageSessionRepository.updateStatusByPackageSessionIds(PackageSessionStatusEnum.DELETED.name(),packageSessionIds);
        learnerInvitationService.deleteLearnerInvitationBySourceAndSourceId(LearnerInvitationSourceTypeEnum.PACKAGE_SESSION.name(), Arrays.stream(packageSessionIds).toList());
        return "Package Session deleted successfully.";
    }

    @Transactional(readOnly = true)
    public Page<PackageDTOWithBatchDetails> searchPackagesByInstitute(
            String instituteId,
            List<String> statuses,
            List<String> levelIds,
            List<String> tagsToSearch,
            String searchByName,
            Pageable pageable) {

        List<String> tagsForQuery;
        if (tagsToSearch != null && !tagsToSearch.isEmpty()) {
            List<String> processedInputTags = tagsToSearch.stream()
                                                      .map(String::toLowerCase)
                                                      .map(String::trim)
                                                      .filter(tag -> !tag.isEmpty())
                                                      .collect(Collectors.toList());
            if (!processedInputTags.isEmpty()) {
                tagsForQuery = processedInputTags;
            } else {
                tagsForQuery = List.of("__EMPTY_TAGS_LIST_PLACEHOLDER__");
            }
        } else {
            tagsForQuery = List.of("__NO_TAGS_FILTER_PLACEHOLDER__");
        }

        Page<PackageEntity> packageEntityPage = packageRepository.findPackagesByCriteria(
                instituteId, statuses, levelIds, tagsForQuery, searchByName, pageable);

        List<PackageDTOWithBatchDetails> packageDetailsList = new ArrayList<>();
        for (PackageEntity packageEntity : packageEntityPage.getContent()) {
            PackageDTO packageDTO = new PackageDTO(packageEntity);
            List<BatchProjection> batches = packageSessionRepository.findBatchDetailsWithLatestInviteCode(
                    packageEntity.getId(),
                    List.of(PackageSessionStatusEnum.ACTIVE.name()),
                    List.of(LearnerStatusEnum.ACTIVE.name()));
            packageDetailsList.add(new PackageDTOWithBatchDetails(packageDTO, batches));
        }
        return new PageImpl<>(packageDetailsList, pageable, packageEntityPage.getTotalElements());
    }
}
