package vacademy.io.assessment_service.features.assessment_folder.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment_folder.dto.*;
import vacademy.io.assessment_service.features.assessment_folder.entity.AssessmentFolder;
import vacademy.io.assessment_service.features.assessment_folder.entity.AssessmentFolderMapping;
import vacademy.io.assessment_service.features.assessment_folder.repository.AssessmentFolderMappingRepository;
import vacademy.io.assessment_service.features.assessment_folder.repository.AssessmentFolderRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class AssessmentFolderService {

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_HIDDEN = "HIDDEN";
    /** Folder test order: by name, A to Z. Every mapping of the folder has display_order 0. */
    public static final String ORDER_NAME = "NAME";
    /** Folder test order: arranged by an admin. Mappings have display_order 1..N. */
    public static final String ORDER_CUSTOM = "CUSTOM";
    private static final int MAX_NAME_LENGTH = 255;
    /** Bound for IN lists so an empty audience still binds a valid query. */
    private static final String NO_MATCH = "__none__";

    @Autowired
    private AssessmentFolderRepository folderRepository;

    @Autowired
    private AssessmentFolderMappingRepository mappingRepository;

    public List<AssessmentFolderDto> listForAdmin(String instituteId) {
        requireInstitute(instituteId);
        return folderRepository.findAdminFolders(instituteId).stream().map(this::toDto).toList();
    }

    @Transactional
    public AssessmentFolderDto create(CustomUserDetails user, String instituteId, AssessmentFolderRequest request) {
        requireInstitute(instituteId);
        String name = cleanName(request.getName());
        Integer maxOrder = folderRepository.findMaxDisplayOrder(instituteId);
        AssessmentFolder folder = AssessmentFolder.builder()
                .instituteId(instituteId)
                .name(name)
                .description(trimToNull(request.getDescription()))
                .imageUrl(trimToNull(request.getImageUrl()))
                .displayOrder((maxOrder == null ? -1 : maxOrder) + 1)
                .status(cleanStatus(request.getStatus(), STATUS_ACTIVE))
                .createdBy(user == null ? null : user.getUserId())
                .build();
        folder = folderRepository.save(folder);
        long moved = 0;
        if (request.getAssessmentIds() != null && !request.getAssessmentIds().isEmpty()) {
            moved = moveInto(instituteId, folder.getId(), request.getAssessmentIds());
        }
        AssessmentFolderDto dto = toDto(folder);
        dto.setAssessmentCount(moved);
        return dto;
    }

    @Transactional
    public AssessmentFolderDto update(String instituteId, String folderId, AssessmentFolderRequest request) {
        AssessmentFolder folder = getFolder(instituteId, folderId);
        if (request.getName() != null) folder.setName(cleanName(request.getName()));
        // description / image are sent in full by the edit form, so an empty value clears them.
        folder.setDescription(trimToNull(request.getDescription()));
        folder.setImageUrl(trimToNull(request.getImageUrl()));
        folder.setStatus(cleanStatus(request.getStatus(), folder.getStatus()));
        folder.setUpdatedAt(new Date());
        return toDto(folderRepository.save(folder));
    }

    /** Deletes the folder only; its assessments stay and become unfiled. */
    @Transactional
    public String delete(String instituteId, String folderId) {
        AssessmentFolder folder = getFolder(instituteId, folderId);
        mappingRepository.deleteByFolderId(folder.getId());
        folderRepository.delete(folder);
        return "Folder deleted";
    }

    @Transactional
    public String reorder(String instituteId, ReorderFoldersRequest request) {
        requireInstitute(instituteId);
        List<String> ids = request == null || request.getFolderIds() == null ? List.of() : request.getFolderIds();
        if (ids.isEmpty()) return "Nothing to reorder";
        Map<String, AssessmentFolder> byId = folderRepository.findByInstituteIdAndIdIn(instituteId, ids).stream()
                .collect(Collectors.toMap(AssessmentFolder::getId, f -> f));
        int order = 0;
        List<AssessmentFolder> changed = new ArrayList<>();
        for (String id : ids) {
            AssessmentFolder folder = byId.get(id);
            if (folder == null) continue;
            folder.setDisplayOrder(order++);
            changed.add(folder);
        }
        folderRepository.saveAll(changed);
        return "Folders reordered";
    }

    /** Moves assessments into a folder, or out of every folder when folderId is blank. */
    @Transactional
    public String move(String instituteId, MoveAssessmentsRequest request) {
        requireInstitute(instituteId);
        List<String> ids = request == null || request.getAssessmentIds() == null ? List.of()
                : request.getAssessmentIds().stream().filter(StringUtils::hasText).distinct().toList();
        if (ids.isEmpty()) throw new VacademyException("Select at least one assessment");
        if (!StringUtils.hasText(request.getFolderId())) {
            List<String> own = mappingRepository.findInstituteAssessmentIds(instituteId, ids);
            if (!own.isEmpty()) mappingRepository.deleteByAssessmentIds(own);
            return "Removed from folder";
        }
        AssessmentFolder folder = getFolder(instituteId, request.getFolderId());
        long moved = moveInto(instituteId, folder.getId(), ids);
        return moved + " moved to " + folder.getName();
    }

    /** The folder's test order (NAME or CUSTOM) and its draft + published tests in that order. */
    public FolderTestOrderDto getTestOrder(String instituteId, String folderId) {
        AssessmentFolder folder = getFolder(instituteId, folderId);
        return testOrderOf(folder.getId());
    }

    /**
     * NAME puts every test back at 0, so students see the folder A to Z. CUSTOM numbers the
     * tests 1..N in the order given; tests left out of the list follow in their current order.
     */
    @Transactional
    public FolderTestOrderDto saveTestOrder(String instituteId, FolderTestOrderRequest request) {
        if (request == null) throw new VacademyException("Folder id is required");
        AssessmentFolder folder = getFolder(instituteId, request.getFolderId());
        String mode = request.getMode() == null ? "" : request.getMode().trim().toUpperCase(Locale.ROOT);
        if (ORDER_NAME.equals(mode)) {
            mappingRepository.resetDisplayOrder(folder.getId());
            return testOrderOf(folder.getId());
        }
        if (!ORDER_CUSTOM.equals(mode)) throw new VacademyException("Invalid test order");

        List<String> currentOrder = mappingRepository.findFolderTestsInOrder(folder.getId()).stream()
                .map(row -> (String) row[0]).toList();
        Map<String, AssessmentFolderMapping> byAssessment = mappingRepository.findByFolderId(folder.getId()).stream()
                .collect(Collectors.toMap(AssessmentFolderMapping::getAssessmentId, m -> m, (a, b) -> a));
        LinkedHashSet<String> order = new LinkedHashSet<>();
        if (request.getAssessmentIds() != null) {
            request.getAssessmentIds().stream().filter(byAssessment::containsKey).forEach(order::add);
        }
        order.addAll(currentOrder);
        // Deleted tests still mapped here: numbered last so the folder stays fully CUSTOM.
        order.addAll(byAssessment.keySet());
        int position = 1;
        List<AssessmentFolderMapping> changed = new ArrayList<>();
        for (String assessmentId : order) {
            AssessmentFolderMapping mapping = byAssessment.get(assessmentId);
            mapping.setDisplayOrder(position++);
            changed.add(mapping);
        }
        mappingRepository.saveAll(changed);
        mappingRepository.flush();
        return testOrderOf(folder.getId());
    }

    public List<AssessmentFolderLinkDto> foldersForAssessments(String instituteId, List<String> assessmentIds) {
        requireInstitute(instituteId);
        if (assessmentIds == null || assessmentIds.isEmpty()) return List.of();
        return mappingRepository.findByInstituteIdAndAssessmentIdIn(instituteId, assessmentIds).stream()
                .map(m -> new AssessmentFolderLinkDto(m.getAssessmentId(), m.getFolderId()))
                .toList();
    }

    public LearnerFolderListResponse listForLearner(String instituteId, LearnerFolderListRequest request) {
        requireInstitute(instituteId);
        List<String> batchIds = orNoMatch(request == null ? null : request.getBatchIds());
        List<String> userIds = orNoMatch(request == null ? null : request.getUserIds());
        List<String> requestedTypes = request == null || request.getAssessmentTypes() == null ? List.of()
                : request.getAssessmentTypes().stream().filter(StringUtils::hasText).toList();
        // Same flag + non-empty list pattern as the assessment list queries: a null list breaks IN expansion.
        Boolean checkTypes = requestedTypes.isEmpty() ? null : true;
        List<String> types = requestedTypes.isEmpty() ? List.of(NO_MATCH) : requestedTypes;
        List<AssessmentFolderDto> folders = folderRepository
                .findLearnerFolders(instituteId, batchIds, userIds, checkTypes, types).stream().map(this::toDto).toList();
        Long unfiled = folderRepository.countLearnerUnfiled(instituteId, batchIds, userIds, checkTypes, types);
        return LearnerFolderListResponse.builder().folders(folders).unfiledCount(unfiled == null ? 0L : unfiled).build();
    }

    private long moveInto(String instituteId, String folderId, List<String> assessmentIds) {
        List<String> own = mappingRepository.findInstituteAssessmentIds(instituteId, assessmentIds);
        if (own.isEmpty()) throw new VacademyException("Assessments not found in this institute");
        mappingRepository.deleteByAssessmentIds(own);
        mappingRepository.flush();
        Integer maxOrder = mappingRepository.findMaxDisplayOrder(folderId);
        // A folder in name order (every test at 0) keeps new tests at 0, so they take their
        // place by name. A folder an admin arranged (1..N) gets them at the end.
        boolean custom = maxOrder != null && maxOrder > 0;
        int order = custom ? maxOrder + 1 : 0;
        Map<String, Integer> position = new HashMap<>();
        for (int i = 0; i < assessmentIds.size(); i++) position.putIfAbsent(assessmentIds.get(i), i);
        List<String> ordered = new ArrayList<>(own);
        ordered.sort(Comparator.comparingInt(id -> position.getOrDefault(id, Integer.MAX_VALUE)));
        List<AssessmentFolderMapping> rows = new ArrayList<>();
        for (String id : ordered) {
            rows.add(AssessmentFolderMapping.builder()
                    .folderId(folderId)
                    .assessmentId(id)
                    .instituteId(instituteId)
                    .displayOrder(custom ? order++ : 0)
                    .build());
        }
        mappingRepository.saveAll(rows);
        return rows.size();
    }

    private FolderTestOrderDto testOrderOf(String folderId) {
        List<Object[]> rows = mappingRepository.findFolderTestsInOrder(folderId);
        boolean custom = rows.stream().anyMatch(row -> row[3] != null && ((Number) row[3]).intValue() > 0);
        List<FolderTestOrderDto.Item> items = rows.stream()
                .map(row -> new FolderTestOrderDto.Item((String) row[0], (String) row[1], (String) row[2]))
                .toList();
        return FolderTestOrderDto.builder()
                .folderId(folderId)
                .mode(custom ? ORDER_CUSTOM : ORDER_NAME)
                .assessments(new ArrayList<>(items))
                .build();
    }

    private AssessmentFolder getFolder(String instituteId, String folderId) {
        requireInstitute(instituteId);
        if (!StringUtils.hasText(folderId)) throw new VacademyException("Folder id is required");
        return folderRepository.findByIdAndInstituteId(folderId, instituteId)
                .orElseThrow(() -> new VacademyException("Folder not found"));
    }

    private AssessmentFolderDto toDto(AssessmentFolder f) {
        return AssessmentFolderDto.builder()
                .id(f.getId())
                .name(f.getName())
                .description(f.getDescription())
                .imageUrl(f.getImageUrl())
                .displayOrder(f.getDisplayOrder())
                .status(f.getStatus())
                .parentId(f.getParentId())
                .assessmentCount(0L)
                .build();
    }

    private AssessmentFolderDto toDto(Object[] row) {
        return AssessmentFolderDto.builder()
                .id((String) row[0])
                .name((String) row[1])
                .description((String) row[2])
                .imageUrl((String) row[3])
                .displayOrder(row[4] == null ? 0 : ((Number) row[4]).intValue())
                .status((String) row[5])
                .parentId((String) row[6])
                .assessmentCount(row[7] == null ? 0L : ((Number) row[7]).longValue())
                .build();
    }

    private static void requireInstitute(String instituteId) {
        if (!StringUtils.hasText(instituteId)) throw new VacademyException("Institute id is required");
    }

    private static String cleanName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) throw new VacademyException("Folder name is required");
        if (name.length() > MAX_NAME_LENGTH) throw new VacademyException("Folder name is too long");
        return name;
    }

    private static String cleanStatus(String raw, String fallback) {
        if (raw == null) return fallback == null ? STATUS_ACTIVE : fallback;
        String status = raw.trim().toUpperCase(Locale.ROOT);
        if (!STATUS_ACTIVE.equals(status) && !STATUS_HIDDEN.equals(status)) {
            throw new VacademyException("Invalid folder status");
        }
        return status;
    }

    private static String trimToNull(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        return v.isEmpty() ? null : v;
    }

    private static List<String> orNoMatch(List<String> ids) {
        List<String> clean = ids == null ? List.of() : ids.stream().filter(StringUtils::hasText).distinct().toList();
        return clean.isEmpty() ? List.of(NO_MATCH) : clean;
    }
}
