package vacademy.io.assessment_service.features.question_bank.manager;


import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.question_bank.dto.AllQuestionPaperResponse;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionPaperDTO;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionPaperFilter;
import vacademy.io.assessment_service.features.question_bank.repository.QuestionPaperRepository;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.tags.dto.TagDTO;
import vacademy.io.assessment_service.features.tags.entities.repository.EntityTagCommunityRepository;
import vacademy.io.assessment_service.features.tags.entities.repository.TagCommunityRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static vacademy.io.common.core.standard_classes.ListService.createSortObject;

@Component
public class GetQuestionPaperManager {


    @Autowired
    QuestionPaperRepository questionPaperRepository;

    @Autowired
    TagCommunityRepository tagCommunityRepository;

    @Autowired
    EntityTagCommunityRepository entityTagCommunityRepository;

    // Enrich a list of question DTOs with their saved SUBJECT tags (single batched query, no N+1),
    // so edit/preview screens show existing tags.
    public void attachSubjectTags(List<QuestionDTO> questions) {
        List<String> questionIds = questions.stream()
                .map(QuestionDTO::getId)
                .filter(Objects::nonNull)
                .toList();
        if (questionIds.isEmpty()) return;

        Map<String, List<String>> tagsByQuestion = new HashMap<>();
        for (Object[] row : entityTagCommunityRepository.findSubjectTagsForQuestions(questionIds)) {
            String questionId = (String) row[0];
            String tagName = (String) row[2];
            tagsByQuestion.computeIfAbsent(questionId, k -> new ArrayList<>()).add(tagName);
        }

        for (QuestionDTO question : questions) {
            List<String> tags = tagsByQuestion.get(question.getId());
            if (tags != null) {
                question.setSubjectTags(tags);
            }
        }
    }

    // Tag vocabulary for an institute, used for autocomplete in upload tagging and the assessment filter.
    public List<TagDTO> getQuestionTags(String instituteId, String search) {
        String normalizedSearch = (search == null || search.isBlank()) ? null : search.trim();
        return tagCommunityRepository.findTagsByInstitute(instituteId, normalizedSearch).stream()
                .map(row -> new TagDTO((String) row[0], (String) row[1]))
                .toList();
    }

    public AllQuestionPaperResponse getQuestionPapers(CustomUserDetails user, QuestionPaperFilter questionPaperFilter, String instituteId, int pageNo, int pageSize) {
        // Create a sorting object based on the provided sort columns
        Sort thisSort = createSortObject(questionPaperFilter.getSortColumns());

        //TODO: Check user permission

        // Create a pageable instance for pagination
        Pageable pageable = PageRequest.of(pageNo, pageSize, thisSort);

        makeFilterFieldEmptyArrayIfNull(questionPaperFilter);

        // Pass selected tag ids as a nullable CSV: null skips the tag filter entirely
        // (avoids empty-IN binding issues with native queries).
        String tagIdsCsv = (questionPaperFilter.getTagIds() == null || questionPaperFilter.getTagIds().isEmpty())
                ? null
                : String.join(",", questionPaperFilter.getTagIds());

        // Question Papers page with folders on: one folder, or the papers in no folder.
        // Every other caller sends neither and keeps the original query below.
        String folderId = StringUtils.hasText(questionPaperFilter.getFolderId())
                ? questionPaperFilter.getFolderId().trim()
                : null;
        String unfiledFlag = folderId == null && Boolean.TRUE.equals(questionPaperFilter.getUnfiledOnly()) ? "Y" : null;
        if (folderId != null || unfiledFlag != null) {
            Page<Object[]> folderPage = questionPaperRepository.findQuestionPapersByFiltersInFolder(questionPaperFilter.getName(), questionPaperFilter.getStatuses(), questionPaperFilter.getLevelIds(), questionPaperFilter.getSubjectIds(), instituteId, tagIdsCsv, folderId, unfiledFlag, pageable);
            return createAllQuestionPaperResponseFromPaginatedData(folderPage);
        }

        // Retrieve employees based on the filter criteria
        Page<Object[]> employeePage = questionPaperRepository.findQuestionPapersByFilters(questionPaperFilter.getName(), questionPaperFilter.getStatuses(), questionPaperFilter.getLevelIds(), questionPaperFilter.getSubjectIds(), null, List.of(instituteId), tagIdsCsv, pageable);

        return createAllQuestionPaperResponseFromPaginatedData(employeePage);

    }

    private void makeFilterFieldEmptyArrayIfNull(QuestionPaperFilter questionPaperFilter) {

        if (questionPaperFilter.getLevelIds() == null) {
            questionPaperFilter.setLevelIds(new ArrayList<>());
        }
        if (questionPaperFilter.getSubjectIds() == null) {
            questionPaperFilter.setSubjectIds(new ArrayList<>());
        }
        if (questionPaperFilter.getStatuses() == null) {
            questionPaperFilter.setStatuses(new ArrayList<>());
        }
    }

    private AllQuestionPaperResponse createAllQuestionPaperResponseFromPaginatedData(Page<Object[]> questionPapers) {
        List<QuestionPaperDTO> content = new ArrayList<>();
        if (!Objects.isNull(questionPapers)) {
            content = questionPapers.getContent().stream().map(object -> new QuestionPaperDTO(
                    (String) object[0], // id
                    (String) object[1], // title
                    (String) object[2], // status
                    (String) object[3], // levelId
                    (String) object[4], // subjectId
                    (Date) object[5], // createdOn
                    (Date) object[6], // updatedOn
                    (String) object[7]  // createdByUserId
            )).toList();
            return AllQuestionPaperResponse.builder().content(content).pageNo(questionPapers.getNumber()).last(questionPapers.isLast()).pageSize(questionPapers.getSize()).totalPages(questionPapers.getTotalPages()).totalElements(questionPapers.getTotalElements()).build();
        }
        return AllQuestionPaperResponse.builder().totalPages(0).content(content).pageNo(0).totalPages(0).build();
    }
}
