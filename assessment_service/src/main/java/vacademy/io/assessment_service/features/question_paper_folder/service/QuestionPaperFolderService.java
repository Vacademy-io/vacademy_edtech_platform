package vacademy.io.assessment_service.features.question_paper_folder.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.question_paper_folder.dto.*;
import vacademy.io.assessment_service.features.question_paper_folder.entity.QuestionPaperFolder;
import vacademy.io.assessment_service.features.question_paper_folder.entity.QuestionPaperFolderMapping;
import vacademy.io.assessment_service.features.question_paper_folder.repository.QuestionPaperFolderMappingRepository;
import vacademy.io.assessment_service.features.question_paper_folder.repository.QuestionPaperFolderRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Folders of the Question Banks and Papers page. A paper sits in at most one folder of an
 * institute; deleting a folder keeps its papers, which then show under "Not in a folder".
 */
@Service
public class QuestionPaperFolderService {

    public static final String STATUS_ACTIVE = "ACTIVE";
    private static final int MAX_NAME_LENGTH = 255;

    @Autowired
    private QuestionPaperFolderRepository folderRepository;

    @Autowired
    private QuestionPaperFolderMappingRepository mappingRepository;

    public List<QuestionPaperFolderDto> list(String instituteId) {
        requireInstitute(instituteId);
        return folderRepository.findAdminFolders(instituteId).stream().map(this::toDto).toList();
    }

    @Transactional
    public QuestionPaperFolderDto create(CustomUserDetails user, String instituteId, QuestionPaperFolderRequest request) {
        requireInstitute(instituteId);
        if (request == null) throw new VacademyException("Folder name is required");
        String name = cleanName(request.getName());
        Integer maxOrder = folderRepository.findMaxDisplayOrder(instituteId);
        QuestionPaperFolder folder = QuestionPaperFolder.builder()
                .instituteId(instituteId)
                .name(name)
                .description(trimToNull(request.getDescription()))
                .imageUrl(trimToNull(request.getImageUrl()))
                .displayOrder((maxOrder == null ? -1 : maxOrder) + 1)
                .status(STATUS_ACTIVE)
                .createdBy(user == null ? null : user.getUserId())
                .build();
        folder = folderRepository.save(folder);
        long moved = 0;
        List<String> paperIds = cleanIds(request.getQuestionPaperIds());
        if (!paperIds.isEmpty()) {
            moved = moveInto(instituteId, folder.getId(), paperIds);
        }
        QuestionPaperFolderDto dto = toDto(folder);
        dto.setPaperCount(moved);
        return dto;
    }

    @Transactional
    public QuestionPaperFolderDto update(String instituteId, String folderId, QuestionPaperFolderRequest request) {
        QuestionPaperFolder folder = getFolder(instituteId, folderId);
        if (request == null) throw new VacademyException("Folder name is required");
        if (request.getName() != null) folder.setName(cleanName(request.getName()));
        // description / image are sent in full by the edit form, so an empty value clears them.
        folder.setDescription(trimToNull(request.getDescription()));
        folder.setImageUrl(trimToNull(request.getImageUrl()));
        folder.setUpdatedAt(new Date());
        return toDto(folderRepository.save(folder));
    }

    /** Deletes the folder only; its papers stay and become unfiled. */
    @Transactional
    public String delete(String instituteId, String folderId) {
        QuestionPaperFolder folder = getFolder(instituteId, folderId);
        mappingRepository.deleteByFolderId(folder.getId());
        folderRepository.delete(folder);
        return "Folder deleted";
    }

    @Transactional
    public String reorder(String instituteId, ReorderQuestionPaperFoldersRequest request) {
        requireInstitute(instituteId);
        List<String> ids = request == null ? List.of() : cleanIds(request.getFolderIds());
        if (ids.isEmpty()) return "Nothing to reorder";
        Map<String, QuestionPaperFolder> byId = folderRepository.findByInstituteIdAndIdIn(instituteId, ids).stream()
                .collect(Collectors.toMap(QuestionPaperFolder::getId, f -> f));
        int order = 0;
        List<QuestionPaperFolder> changed = new ArrayList<>();
        for (String id : ids) {
            QuestionPaperFolder folder = byId.get(id);
            if (folder == null) continue;
            folder.setDisplayOrder(order++);
            changed.add(folder);
        }
        folderRepository.saveAll(changed);
        return "Folders reordered";
    }

    /** Moves papers into a folder, or out of every folder when folderId is blank. */
    @Transactional
    public String move(String instituteId, MoveQuestionPapersRequest request) {
        requireInstitute(instituteId);
        List<String> ids = request == null ? List.of() : cleanIds(request.getQuestionPaperIds());
        if (ids.isEmpty()) throw new VacademyException("Select at least one question paper");
        if (!StringUtils.hasText(request.getFolderId())) {
            List<String> own = mappingRepository.findInstitutePaperIds(instituteId, ids);
            if (!own.isEmpty()) mappingRepository.deleteByInstituteAndPaperIds(instituteId, own);
            return "Removed from folder";
        }
        QuestionPaperFolder folder = getFolder(instituteId, request.getFolderId());
        long moved = moveInto(instituteId, folder.getId(), ids);
        return moved + " moved to " + folder.getName();
    }

    /** Which folder each of the given papers is in (for the folder chip on paper cards). */
    public List<QuestionPaperFolderLinkDto> foldersForPapers(String instituteId, List<String> questionPaperIds) {
        requireInstitute(instituteId);
        List<String> ids = cleanIds(questionPaperIds);
        if (ids.isEmpty()) return List.of();
        return mappingRepository.findByInstituteIdAndQuestionPaperIdIn(instituteId, ids).stream()
                .map(m -> new QuestionPaperFolderLinkDto(m.getQuestionPaperId(), m.getFolderId()))
                .toList();
    }

    private long moveInto(String instituteId, String folderId, List<String> paperIds) {
        List<String> own = mappingRepository.findInstitutePaperIds(instituteId, paperIds);
        if (own.isEmpty()) throw new VacademyException("Question papers not found in this institute");
        mappingRepository.deleteByInstituteAndPaperIds(instituteId, own);
        mappingRepository.flush();
        List<QuestionPaperFolderMapping> rows = new ArrayList<>();
        for (String id : own) {
            rows.add(QuestionPaperFolderMapping.builder()
                    .folderId(folderId)
                    .questionPaperId(id)
                    .instituteId(instituteId)
                    .displayOrder(0)
                    .build());
        }
        mappingRepository.saveAll(rows);
        return rows.size();
    }

    private QuestionPaperFolder getFolder(String instituteId, String folderId) {
        requireInstitute(instituteId);
        if (!StringUtils.hasText(folderId)) throw new VacademyException("Folder id is required");
        return folderRepository.findByIdAndInstituteId(folderId, instituteId)
                .orElseThrow(() -> new VacademyException("Folder not found"));
    }

    private QuestionPaperFolderDto toDto(QuestionPaperFolder f) {
        return QuestionPaperFolderDto.builder()
                .id(f.getId())
                .name(f.getName())
                .description(f.getDescription())
                .imageUrl(f.getImageUrl())
                .displayOrder(f.getDisplayOrder())
                .status(f.getStatus())
                .parentId(f.getParentId())
                .paperCount(0L)
                .build();
    }

    private QuestionPaperFolderDto toDto(Object[] row) {
        return QuestionPaperFolderDto.builder()
                .id((String) row[0])
                .name((String) row[1])
                .description((String) row[2])
                .imageUrl((String) row[3])
                .displayOrder(row[4] == null ? 0 : ((Number) row[4]).intValue())
                .status((String) row[5])
                .parentId((String) row[6])
                .paperCount(row[7] == null ? 0L : ((Number) row[7]).longValue())
                .build();
    }

    private static void requireInstitute(String instituteId) {
        if (!StringUtils.hasText(instituteId)) throw new VacademyException("Institute id is required");
    }

    private static List<String> cleanIds(List<String> ids) {
        return ids == null ? List.of() : ids.stream().filter(StringUtils::hasText).map(String::trim).distinct().toList();
    }

    private static String cleanName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) throw new VacademyException("Folder name is required");
        if (name.length() > MAX_NAME_LENGTH) throw new VacademyException("Folder name is too long");
        return name;
    }

    private static String trimToNull(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        return v.isEmpty() ? null : v;
    }
}
