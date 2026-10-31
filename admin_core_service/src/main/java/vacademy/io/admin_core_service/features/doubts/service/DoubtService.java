package vacademy.io.admin_core_service.features.doubts.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.chapter.entity.ChapterToSlides;
import vacademy.io.admin_core_service.features.chapter.repository.ChapterToSlidesRepository;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtActivityDto;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtAssigneeDto;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsDto;
import vacademy.io.admin_core_service.features.doubts.entity.DoubtActivity;
import vacademy.io.admin_core_service.features.doubts.entity.DoubtAssignee;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtAssigneeStatusEnum;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtStatusEnum;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtsSourceEnum;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtActivityRepository;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtsAssigneeRepository;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtsRepository;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.module.service.ModuleService;
import vacademy.io.admin_core_service.features.slide.dto.SlideMetadataProjection;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.slide.service.SlideMetaDataService;
import vacademy.io.common.institute.entity.module.Module;

import java.util.*;

@Slf4j
@Service
public class DoubtService {

    @Autowired
    DoubtsRepository doubtsRepository;

    @Autowired
    DoubtsAssigneeRepository doubtsAssigneeRepository;

    @Autowired
    SlideRepository slideRepository;

    @Autowired
    private SlideMetaDataService slideMetaDataService;

    @Autowired
    private ModuleService moduleService;

    @Autowired
    private ChapterToSlidesRepository chapterToSlidesRepository;

    @Autowired
    private DoubtActivityRepository doubtActivityRepository;

    @Autowired
    private InstituteSettingService instituteSettingService;

    /** Lenient like DoubtsManager's — an unknown key in the settings blob must not blank the catalog. */
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    public Optional<Doubts> getDoubtById(String id){
        return doubtsRepository.findById(id);
    }

    /** Append one audit-trail row. Best-effort: the trail must never fail the doubt operation itself. */
    public void recordActivity(DoubtActivity activity) {
        if (activity == null || activity.getDoubtId() == null) return;
        try {
            doubtActivityRepository.save(activity);
        } catch (Exception e) {
            log.warn("Failed to record doubt activity {} for doubt {}: {}",
                    activity.getAction(), activity.getDoubtId(), e.getMessage());
        }
    }

    public List<DoubtActivityDto> getActivity(String doubtId) {
        return doubtActivityRepository.findByDoubtIdOrderByCreatedAtAsc(doubtId).stream()
                .map(a -> DoubtActivityDto.builder()
                        .id(a.getId())
                        .doubtId(a.getDoubtId())
                        .action(a.getAction())
                        .actorType(a.getActorType())
                        .actorUserId(a.getActorUserId())
                        .targetUserId(a.getTargetUserId())
                        .fromValue(a.getFromValue())
                        .toValue(a.getToValue())
                        .ruleSource(a.getRuleSource())
                        .remark(a.getRemark())
                        .createdAt(a.getCreatedAt())
                        .build())
                .toList();
    }

    /**
     * The institute's workflow-status catalog (built-ins guaranteed). Null-safe on a missing or
     * unreadable setting — you always get at least PENDING + RESOLVED.
     */
    public List<DoubtManagementSettingDataDto.WorkflowStatusConfig> getStatusCatalog(String instituteId) {
        if (instituteId == null || instituteId.isEmpty()) return DoubtStatusCatalog.defaults();
        try {
            Object raw = instituteSettingService.getSettingByInstituteIdAndKey(
                    instituteId, SettingKeyEnums.DOUBT_MANAGEMENT_SETTING.name());
            DoubtManagementSettingDataDto setting = raw == null
                    ? null : objectMapper.convertValue(raw, DoubtManagementSettingDataDto.class);
            return DoubtStatusCatalog.resolve(setting);
        } catch (Exception e) {
            log.warn("Failed to read doubt status catalog for institute {}: {}", instituteId, e.getMessage());
            return DoubtStatusCatalog.defaults();
        }
    }

    public Doubts updateOrCreateDoubt(Doubts doubts){
        return doubtsRepository.save(doubts);
    }

    public List<DoubtAssignee> saveOrUpdateDoubtsAssignee(List<DoubtAssignee> allAssignees){
        return doubtsAssigneeRepository.saveAll(allAssignees);
    }


    public Page<Doubts> getAllDoubtsWithFilter(List<String> contentTypes,
                                               List<String> contentPositions,
                                               List<String> sources,
                                               List<String> sourceIds,
                                               Date startDate,
                                               Date endDate,
                                               List<String> userIds,
                                               List<String> status,
                                               List<String> batchIds,
                                               Pageable pageable) {
        // Unscoped (viewerUserId null) → admin path; the FSPSSM scope flags are irrelevant.
        return getAllDoubtsWithFilter(contentTypes, contentPositions, sources, sourceIds, null, startDate, endDate,
                userIds, status, batchIds, null, null, false, false, null, false, null, pageable);
    }

    /**
     * @param types        configurable query type keys (DOUBT, TECHNICAL, PAYMENT, ...) to filter by.
     * @param instituteId  scopes admin (unscoped) callers to one institute. Required for the admin
     *                     path now that batch is optional — GENERAL queries have no batch.
     * @param viewerUserId when non-null, restricts results to doubts visible to that viewer via
     *                     self-raised, direct doubt_assignee rows, or live FSPSSM scope.
     *                     Pass {@code null} for admin/root callers — no visibility filter is applied.
     * @param scopeBatch   when {@code true}, the viewer additionally sees every doubt in any batch
     *                     they have an active FSPSSM mapping to (batch-teacher visibility). Set for
     *                     BATCH_TEACHER/BOTH and the no-setting default. Ignored when viewer is null.
     * @param scopeSubject when {@code true}, the viewer additionally sees doubts via a batch-level
     *                     (subject_id IS NULL) FSPSSM mapping or a subject-level mapping that resolves
     *                     to the doubt's slide (subject-teacher visibility). Set for SUBJECT_TEACHER.
     * @param assigneeUserIds  only doubts with an ACTIVE explicit assignee among these ids (empty ⇒ off).
     * @param unassignedOnly   only doubts with no ACTIVE explicit assignee; OR-ed with assigneeUserIds.
     * @param workflowStatuses configurable status keys; legacy rows match via their coarse status.
     */
    public Page<Doubts> getAllDoubtsWithFilter(List<String> contentTypes,
                                               List<String> contentPositions,
                                               List<String> sources,
                                               List<String> sourceIds,
                                               List<String> types,
                                               Date startDate,
                                               Date endDate,
                                               List<String> userIds,
                                               List<String> status,
                                               List<String> batchIds,
                                               String instituteId,
                                               String viewerUserId,
                                               boolean scopeBatch,
                                               boolean scopeSubject,
                                               List<String> assigneeUserIds,
                                               boolean unassignedOnly,
                                               List<String> workflowStatuses,
                                               Pageable pageable) {
        List<String> filteredContentTypes = Optional.ofNullable(contentTypes).orElse(Collections.emptyList());
        List<String> filteredContentPositions = Optional.ofNullable(contentPositions).orElse(Collections.emptyList());
        List<String> filteredSources = Optional.ofNullable(sources).orElse(Collections.emptyList());
        List<String> filteredSourceIds = Optional.ofNullable(sourceIds).orElse(Collections.emptyList());
        List<String> filteredTypes = Optional.ofNullable(types).orElse(Collections.emptyList());
        List<String> filteredUserIds = Optional.ofNullable(userIds).orElse(Collections.emptyList());
        List<String> filteredStatus = Optional.ofNullable(status).orElse(Collections.emptyList());
        List<String> filteredBatchIds = (batchIds == null ? Collections.emptyList() : batchIds);
        boolean hasBatchIds = !filteredBatchIds.isEmpty();
        // Postgres can't parse `IN ()`; pass a non-matching placeholder when no batch filter is set
        // (the hasBatchIds guard short-circuits it anyway).
        List<String> batchIdsForQuery = hasBatchIds ? filteredBatchIds : List.of("");
        String scopeInstituteId = (instituteId != null && !instituteId.isBlank()) ? instituteId : null;
        // Same placeholder trick as batchIds for the two new list filters.
        List<String> filteredAssigneeIds = assigneeUserIds == null ? List.of()
                : assigneeUserIds.stream().filter(id -> id != null && !id.isBlank()).toList();
        boolean hasAssigneeIds = !filteredAssigneeIds.isEmpty();
        List<String> assigneeIdsForQuery = hasAssigneeIds ? filteredAssigneeIds : List.of("");
        List<String> filteredWorkflow = workflowStatuses == null ? List.of()
                : workflowStatuses.stream().filter(k -> k != null && !k.isBlank())
                        .map(k -> k.trim().toUpperCase()).toList();
        boolean hasWorkflow = !filteredWorkflow.isEmpty();
        List<String> workflowForQuery = hasWorkflow ? filteredWorkflow : List.of("");

        // Admin callers (no viewer scope) must scope by institute now that batch is optional —
        // otherwise the inbox would return every doubt across all institutes. A batch filter (when
        // supplied) narrows further; GENERAL queries are reachable with institute-only scope.
        if (viewerUserId == null) {
            if (scopeInstituteId == null && !hasBatchIds) {
                return Page.empty(pageable);
            }
            return doubtsRepository.findDoubtsWithFilter(filteredContentPositions, filteredContentTypes, filteredSources,
                    filteredSourceIds, filteredTypes, filteredUserIds, filteredStatus, scopeInstituteId,
                    batchIdsForQuery, hasBatchIds, assigneeIdsForQuery, hasAssigneeIds, unassignedOnly,
                    workflowForQuery, hasWorkflow, startDate, endDate, pageable);
        }

        // Scoped (teacher/student) callers: the visibility predicates in the query already restrict
        // results to doubts the user can see. An empty batch list here means "no explicit batch
        // filter" rather than "no visible doubts" — critical for teachers who are directly assigned
        // to a doubt on a batch they don't have FSPSSM access to.
        return doubtsRepository.findDoubtsWithFilterForViewer(filteredContentPositions, filteredContentTypes, filteredSources,
                filteredSourceIds, filteredTypes, filteredUserIds, filteredStatus, scopeInstituteId, batchIdsForQuery,
                hasBatchIds, assigneeIdsForQuery, hasAssigneeIds, unassignedOnly, workflowForQuery, hasWorkflow,
                startDate, endDate, viewerUserId, scopeBatch, scopeSubject, pageable);
    }

    public List<DoubtsDto> createDtoFromDoubts(List<Doubts> allDoubts) {
        if(allDoubts == null || allDoubts.isEmpty()) return new ArrayList<>();

        // One settings read per institute per page (not per doubt) for the learner-facing status.
        Map<String, List<DoubtManagementSettingDataDto.WorkflowStatusConfig>> catalogByInstitute = new HashMap<>();

        List<DoubtsDto> response = new ArrayList<>();
        allDoubts.forEach(doubt -> {
            // Recursively fetch all replies
            List<Doubts> childDoubts = doubtsRepository.findByParentIdAndStatusNotIn(
                    doubt.getId(), List.of(DoubtStatusEnum.DELETED.name())
            );

            List<DoubtAssigneeDto> allAssigneeDto = new ArrayList<>();
            List<String> excludedAssigneeUserIds = new ArrayList<>();
            String moduleId = null;
            String chapterId = null;

            if(doubt.getParentId() == null){
                allAssigneeDto = getAssigneeDtoFromDoubt(doubt);
                excludedAssigneeUserIds = getExcludedAssigneeUserIds(doubt);
                Optional<Module> module = moduleService.getModuleBySlideIdAndPackageSessionIdWithStatusFilters(doubt.getSourceId(), doubt.getPackageSessionId());
                if(module.isPresent()){
                    moduleId = module.get().getId();
                }

                Optional<ChapterToSlides> chapterToSlides = chapterToSlidesRepository.findBySlideId(doubt.getSourceId());
                if(chapterToSlides.isPresent()) chapterId = chapterToSlides.get().getChapter().getId();
            }

            String workflowStatus = null;
            vacademy.io.admin_core_service.features.doubts.dtos.DoubtStatusDto learnerStatus = null;
            if (doubt.getParentId() == null) {
                workflowStatus = DoubtStatusCatalog.effectiveKey(doubt);
                String instKey = doubt.getInstituteId() == null ? "" : doubt.getInstituteId();
                List<DoubtManagementSettingDataDto.WorkflowStatusConfig> catalog =
                        catalogByInstitute.computeIfAbsent(instKey, this::getStatusCatalog);
                learnerStatus = DoubtStatusCatalog.toLearnerStatus(catalog, doubt);
            }

            String subjectId = null;
            String sourceName = null;

            if (DoubtsSourceEnum.SLIDE.name().equals(doubt.getSource())) {
                Optional<Slide> slideOptional = slideRepository.findById(doubt.getSourceId());
                if (slideOptional.isPresent()) {
                    sourceName = slideOptional.get().getTitle();

                    Optional<SlideMetadataProjection> slideMetadataProjection = slideMetaDataService.getSlideMetadataForAdmin(doubt.getSourceId());
                    if(slideMetadataProjection.isPresent()){
                        subjectId = slideMetadataProjection.get().getSubjectId();
                    }
                }
            }

            response.add(DoubtsDto.builder()
                    .id(doubt.getId())
                    .userId(doubt.getUserId())
                    .contentPosition(doubt.getContentPosition())
                    .contentType(doubt.getContentType())
                    .htmlText(doubt.getHtmlText())
                    .parentId(doubt.getParentId())
                    .parentLevel(doubt.getParentLevel()==null ? 0 : doubt.getParentLevel())
                    .source(doubt.getSource())
                    .sourceId(doubt.getSourceId())
                    .type(doubt.getType())
                    .instituteId(doubt.getInstituteId())
                    .guestName(doubt.getGuestName())
                    .guestEmail(doubt.getGuestEmail())
                    .subjectId(subjectId)
                    .sourceName(sourceName)
                    .batchId(doubt.getPackageSessionId())
                    .status(doubt.getStatus())
                    .workflowStatus(workflowStatus)
                    .learnerStatus(learnerStatus)
                    .resolvedTime(doubt.getResolvedTime())
                    .raisedTime(doubt.getRaisedTime())
                    .allDoubtAssignee(allAssigneeDto)
                    .excludedAssigneeUserIds(excludedAssigneeUserIds)
                    .moduleId(moduleId)
                    .chapterId(chapterId)
                    .replies(createDtoFromDoubts(childDoubts)) // recursive call here
                    .build());
        });
        return response;
    }

    private List<DoubtAssigneeDto> getAssigneeDtoFromDoubt(Doubts doubt) {
        List<DoubtAssignee> allAssignee = doubtsAssigneeRepository.findByDoubtIdAndStatusNotIn(doubt.getId(), List.of(DoubtAssigneeStatusEnum.DELETED.name()));
        List<DoubtAssigneeDto> response = new ArrayList<>();
        allAssignee.forEach(assignee->{
            response.add(assignee.getAssigneeDto());
        });

        return response;
    }

    /**
     * Returns the USER-scoped user ids that the admin has explicitly excluded from this doubt's
     * default (FSPSSM-implicit) assignee list. Persisted as DoubtAssignee rows with status
     * {@code DELETED} and {@code source=USER}.
     */
    private List<String> getExcludedAssigneeUserIds(Doubts doubt) {
        List<DoubtAssignee> deleted = doubtsAssigneeRepository.findByDoubtIdAndStatusNotIn(
                doubt.getId(), List.of(DoubtAssigneeStatusEnum.ACTIVE.name()));
        return deleted.stream()
                .filter(a -> DoubtAssigneeStatusEnum.DELETED.name().equalsIgnoreCase(a.getStatus()))
                .filter(a -> "USER".equalsIgnoreCase(a.getSource()))
                .map(DoubtAssignee::getSourceId)
                .filter(id -> id != null && !id.isEmpty())
                .distinct()
                .toList();
    }

    public void deleteAssigneeForDoubt(List<String> deleteAssigneeRequest) {
        if(deleteAssigneeRequest.isEmpty()) return;
        List<DoubtAssignee> allAssignee = doubtsAssigneeRepository.findAllById(deleteAssigneeRequest);

        allAssignee.forEach(assignee->{
            assignee.setStatus(DoubtAssigneeStatusEnum.DELETED.name());
        });

        doubtsAssigneeRepository.saveAll(allAssignee);
    }
}
