package vacademy.io.assessment_service.features.question_bank.manager;


import com.fasterxml.jackson.core.JsonProcessingException;
import jakarta.persistence.EntityNotFoundException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.evaluation.service.QuestionEvaluationService;
import vacademy.io.assessment_service.features.question_bank.dto.AddQuestionDTO;
import vacademy.io.assessment_service.features.question_bank.dto.AddQuestionPaperDTO;
import vacademy.io.assessment_service.features.question_bank.dto.AddedQuestionPaperResponseDto;
import vacademy.io.assessment_service.features.question_bank.dto.EditQuestionPaperDTO;
import vacademy.io.assessment_service.features.question_bank.entity.QuestionPaper;
import vacademy.io.assessment_service.features.question_bank.enums.QuestionStatusEnum;
import vacademy.io.assessment_service.features.question_bank.repository.QuestionPaperRepository;
import vacademy.io.assessment_service.features.question_core.dto.*;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.enums.EvaluationTypes;
import vacademy.io.assessment_service.features.question_core.enums.QuestionAccessLevel;
import vacademy.io.assessment_service.features.question_core.enums.QuestionResponseTypes;
import vacademy.io.assessment_service.features.question_core.enums.QuestionTypes;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.assessment_service.features.tags.entities.repository.EntityTagCommunityRepository;
import vacademy.io.assessment_service.features.tags.entities.repository.TagCommunityRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static vacademy.io.assessment_service.features.assessment.enums.AssessmentSetStatusEnum.DELETED;

@Slf4j
@Component
public class AddQuestionPaperFromImportManager {

    @Autowired
    QuestionRepository questionRepository;

    @Autowired
    OptionRepository optionRepository;

    @Autowired
    QuestionPaperRepository questionPaperRepository;
    @Autowired
    QuestionEvaluationService questionEvaluationService;

    @Autowired
    EntityTagCommunityRepository entityTagCommunityRepository;

    @Autowired
    TagCommunityRepository tagCommunityRepository;

    @Transactional
    public AddedQuestionPaperResponseDto addQuestionPaper(CustomUserDetails user, AddQuestionPaperDTO questionRequestBody, Boolean isPublicPaper) throws JsonProcessingException {

        var questionPaper = createQuestionPaper(user, questionRequestBody, isPublicPaper);

        addEntityTagOfQuestionPaper(questionPaper, questionRequestBody);
        List<Question> questions = new ArrayList<>();
        List<Option> options = new ArrayList<>();
        for (int i = 0; i < questionRequestBody.getQuestions().size(); i++) {
            Question question = makeQuestionAndOptionFromImportQuestion(questionRequestBody.getQuestions().get(i), isPublicPaper, null);

            options.addAll(question.getOptions());
            if (questionRequestBody.getQuestions().get(i).getParentRichText() != null) {
                question.setParentRichText(AssessmentRichTextData.fromDTO(questionRequestBody.getQuestions().get(i).getParentRichText()));
            }
            // Denormalised from the paper (V42) so the question-level browse endpoint can
            // scope by institute without walking question -> mapping -> paper -> institute
            // for every candidate row. Only for private papers: a public paper's questions
            // belong to no single institute.
            if (!isPublicPaper) {
                question.setInstituteId(questionRequestBody.getInstituteId());
            }
            questions.add(question);
        }


        questions = questionRepository.saveAll(questions);
        options = optionRepository.saveAll(options);

        addQuestionEntityTags(questions, questionRequestBody.getQuestions(), questionRequestBody.getInstituteId());

        List<String> savedQuestionIds = questions.stream().map(Question::getId).toList();

        questionPaperRepository.bulkInsertQuestionsToQuestionPaper(questionPaper.getId(), savedQuestionIds);

        if (!isPublicPaper)
            questionPaperRepository.linkInstituteToQuestionPaper(UUID.randomUUID().toString(), questionPaper.getId(), questionRequestBody.getInstituteId(), "ACTIVE", questionRequestBody.getLevelId(), questionRequestBody.getSubjectId());

        return new AddedQuestionPaperResponseDto(questionPaper.getId());

    }

    private void addEntityTagOfQuestionPaper(QuestionPaper questionPaper, AddQuestionPaperDTO questionRequestBody) {
        if(questionRequestBody.getTags() != null){
            for (String tag : questionRequestBody.getTags()) {
                String tagId = UUID.randomUUID().toString();
                String existingOrNewTagId = tagCommunityRepository.insertTagIfNotExists(tagId, tag.toLowerCase(), questionRequestBody.getInstituteId());
                addEntityTags("QUESTION_PAPER", questionPaper.getId(), existingOrNewTagId, "TAGS");
            }
        }
    }

    private QuestionPaper createQuestionPaper(CustomUserDetails user, AddQuestionPaperDTO questionRequestBody, Boolean isPublicPaper) {
        QuestionPaper questionPaper = new QuestionPaper();
        questionPaper.setTitle(questionRequestBody.getTitle());
        questionPaper.setCreatedByUserId(user.getUserId());
        questionPaper.setDifficulty(questionRequestBody.getAiDifficulty());

        if(questionRequestBody.getCommunityChapterIds() == null || questionRequestBody.getCommunityChapterIds().isEmpty()){
            questionPaper.setCommunityChapterIds(null);
        }
        else{
            questionPaper.setCommunityChapterIds(String.join(",", questionRequestBody.getCommunityChapterIds()));
        }


        if (isPublicPaper)
            questionPaper.setAccess(QuestionAccessLevel.PUBLIC.name());
        else
            questionPaper.setAccess(QuestionAccessLevel.PRIVATE.name());

        questionPaper = questionPaperRepository.save(questionPaper);
        return questionPaper;
    }

    @Transactional
    public Boolean updateQuestionPaper(CustomUserDetails user, AddQuestionPaperDTO questionRequestBody, Boolean isPublicPaper) throws JsonProcessingException {

        // Fetch the existing question paper by ID
        QuestionPaper questionPaper = questionPaperRepository.findById(questionRequestBody.getId())
                .orElseThrow(() -> new EntityNotFoundException("Question Paper not found"));

        // Update title only if it's not null
        if (questionRequestBody.getTitle() != null) {
            questionPaper.setTitle(questionRequestBody.getTitle());
        }

        // Update createdBy and access level
        questionPaper.setCreatedByUserId(user.getUserId());
        questionPaper.setAccess(isPublicPaper ? QuestionAccessLevel.PUBLIC.name() : QuestionAccessLevel.PRIVATE.name());

        // Save updated question paper
        questionPaper = questionPaperRepository.save(questionPaper);

        // Process and insert new questions directly (no need to check for duplicates)
        List<Question> newQuestions = new ArrayList<>();
        List<Option> newOptions = new ArrayList<>();

        for (var importQuestion : questionRequestBody.getQuestions()) {
            Question question = makeQuestionAndOptionFromImportQuestion(importQuestion, isPublicPaper, null);
            if (importQuestion.getParentRichText() != null) {
                question.setParentRichText(AssessmentRichTextData.fromDTO(importQuestion.getParentRichText()));
            }
            if (!isPublicPaper) {
                question.setInstituteId(questionRequestBody.getInstituteId());
            }
            newQuestions.add(question);
            List<Option> questionOptions = question.getOptions();
            question.setOptions(new ArrayList<>());
            newOptions.addAll(questionOptions);
        }

        // Save new questions and options
        if (!newQuestions.isEmpty()) {
            newQuestions = questionRepository.saveAll(newQuestions);
            newOptions = optionRepository.saveAll(newOptions);

            // Get the IDs of newly added questions
            List<String> newQuestionIds = newQuestions.stream().map(Question::getId).toList();

            // Associate new questions with the existing question paper
            questionPaperRepository.bulkInsertQuestionsToQuestionPaper(questionPaper.getId(), newQuestionIds);
        }

        // If not public, link to an institute
        if (!isPublicPaper) {
            linkOrUpdateInstitute(questionPaper.getId(), questionRequestBody.getInstituteId(),
                    questionRequestBody.getLevelId(), questionRequestBody.getSubjectId());
        }

        return true;
    }

    /**
     * Link a paper to an institute, or refresh the existing link.
     * <p>
     * Insert-only left a duplicate row behind on every save of an already-linked paper.
     */
    private void linkOrUpdateInstitute(String questionPaperId, String instituteId, String levelId, String subjectId) {
        if (instituteId == null) return;
        if (questionPaperRepository.countInstituteQuestionPaperLink(questionPaperId, instituteId) > 0) {
            questionPaperRepository.updateInstituteQuestionPaperLink(questionPaperId, instituteId, "ACTIVE", levelId, subjectId);
            return;
        }
        questionPaperRepository.linkInstituteToQuestionPaper(UUID.randomUUID().toString(), questionPaperId,
                instituteId, "ACTIVE", levelId, subjectId);
    }


    public Question makeQuestionAndOptionFromImportQuestion(QuestionDTO questionRequest, Boolean isPublic, Question existingQuestion) throws JsonProcessingException {        // Todo: check Question Validation

        Question question = initializeQuestion(questionRequest, existingQuestion);
        List<String> correctOptionIds = new ArrayList<>();

        switch (QuestionTypes.valueOf(questionRequest.getQuestionType())) {
            case NUMERIC:
                handleNumericQuestion(question, questionRequest);
                break;
            case TRUE_FALSE:
            case MCQS:
            case MCQM:
                correctOptionIds = createOptions(question, questionRequest);
                handleMCQQuestion(question, questionRequest, question.getOptions(), correctOptionIds);
                break;
            case ONE_WORD:
                handleOneWordQuestion(question, questionRequest);
                break;
            case LONG_ANSWER:
                handleLongAnswerQuestion(question, questionRequest);
                break;
            case CODING:
                // CODING stores the full config inside autoEvaluationJson which
                // initializeQuestion already copied over. No options to build,
                // no validAnswers to parse — nothing else to do here.
                break;
            default:
                throw new IllegalArgumentException("Unsupported question type: " + questionRequest.getQuestionType());
        }

        setQuestionMetadata(question, questionRequest, isPublic, question.getOptions());
        return question;

    }

    // Six saveAll batches plus a bulk insert. Without a transaction a failure part-way
    // through left a half-edited paper: some questions added, others not, tags dangling.
    // Both sibling methods (addQuestionPaper, updateQuestionPaper) are already transactional.
    @Transactional
    public Boolean editQuestionPaper(CustomUserDetails user, EditQuestionPaperDTO questionRequestBody) throws JsonProcessingException {
        Optional<QuestionPaper> questionPaper = questionPaperRepository.findById(questionRequestBody.getId());

        if (questionPaper.isEmpty())
            return false;

        // Update title only if it's not null
        if (questionRequestBody.getTitle() != null) {
            questionPaper.get().setTitle(questionRequestBody.getTitle());
        }

        // Update createdBy and access level
        questionPaper.get().setCreatedByUserId(user.getUserId());

        // Save updated question paper
        questionPaper = Optional.of(questionPaperRepository.save(questionPaper.get()));

        // Process and insert new questions directly (no need to check for duplicates)
        List<Question> newQuestions = new ArrayList<>();
        List<Option> newOptions = new ArrayList<>();

        for (var importQuestion : questionRequestBody.getAddedQuestions()) {
            Question question = makeQuestionAndOptionFromImportQuestion(importQuestion, false, null);
            if (importQuestion.getParentRichText() != null) {
                question.setParentRichText(AssessmentRichTextData.fromDTO(importQuestion.getParentRichText()));
            }
            question.setInstituteId(questionRequestBody.getInstituteId());
            newQuestions.add(question);
            List<Option> questionOptions = question.getOptions();
            newOptions.addAll(questionOptions);
        }


        var savedQuestions = questionRepository.saveAll(newQuestions);
        optionRepository.saveAll(newOptions);

        List<String> savedQuestionIds = savedQuestions.stream().map(Question::getId).toList();
        questionPaperRepository.bulkInsertQuestionsToQuestionPaper(questionPaper.get().getId(), savedQuestionIds);
        addQuestionEntityTags(savedQuestions, questionRequestBody.getAddedQuestions(), questionRequestBody.getInstituteId());

        updateQuestionsInPlace(questionRequestBody.getUpdatedQuestions(), questionRequestBody.getInstituteId());

        newQuestions = new ArrayList<>();
        newOptions = new ArrayList<>();
        for (var importQuestion : questionRequestBody.getDeletedQuestions()) {
            Optional<Question> existingQuestion = questionRepository.findById(importQuestion.getId());

            if (existingQuestion.isEmpty())
                continue;
            existingQuestion.get().setStatus(DELETED.name());
            newQuestions.add(existingQuestion.get());
        }
        questionRepository.saveAll(newQuestions);
        optionRepository.saveAll(newOptions);

        return true;

    }

    /**
     * Rewrite existing questions (text, options, answer key, explanation) by id,
     * keeping their ids so every assessment section and question paper that
     * maps to them sees the edit. Shared by the question-paper edit and by
     * editing an assessment's questions directly, which has no paper to go
     * through - questions added to an assessment by upload or SQL never had one.
     */
    @Transactional
    public List<Question> updateQuestionsInPlace(List<QuestionDTO> updatedQuestions, String instituteId) throws JsonProcessingException {
        List<Question> newQuestions = new ArrayList<>();
        List<Option> newOptions = new ArrayList<>();
        for (var importQuestion : updatedQuestions) {
            if (importQuestion.getId() == null) continue;
            Optional<Question> existingQuestion = questionRepository.findById(importQuestion.getId());

            if (existingQuestion.isEmpty())
                continue;
            Question question = makeQuestionAndOptionFromImportQuestion(importQuestion, false, existingQuestion.get());
            if (importQuestion.getParentRichText() != null) {
                question.setParentRichText(AssessmentRichTextData.fromDTO(importQuestion.getParentRichText()));
            }
            List<Option> questionOptions = question.getOptions();
            newQuestions.add(question);
            newOptions.addAll(questionOptions);
        }

        var savedUpdatedQuestions = questionRepository.saveAll(newQuestions);
        optionRepository.saveAll(newOptions);
        addQuestionEntityTags(savedUpdatedQuestions, updatedQuestions, instituteId);
        return savedUpdatedQuestions;
    }

    public AddQuestionDTO addPrivateQuestions(CustomUserDetails user, AddQuestionDTO questionRequestBody, boolean isPublicQuestion) throws JsonProcessingException {

        List<Option> options = new ArrayList<>();
        for (int i = 0; i < questionRequestBody.getQuestions().size(); i++) {
            Question question = makeQuestionAndOptionFromImportQuestion(questionRequestBody.getQuestions().get(i), isPublicQuestion, null);
            options.addAll(question.getOptions());
            question = questionRepository.save(question);
            questionRequestBody.getQuestions().get(i).setId(question.getId());
            options = optionRepository.saveAll(options);
            options.clear();
        }

        return questionRequestBody;
    }

    private Question initializeQuestion(QuestionDTO questionRequest, Question existingQuestion) {
        Question question = new Question();

        if (existingQuestion != null) {
            question = existingQuestion;
        }
        question.setStatus(QuestionStatusEnum.ACTIVE.name());
        if (questionRequest.getParentRichText() != null) {
            question.setParentRichText(AssessmentRichTextData.fromDTO(questionRequest.getParentRichText()));
        }
        if (questionRequest.getText() != null) {
            question.setTextData(AssessmentRichTextData.fromDTO(questionRequest.getText()));
        }
        if (questionRequest.getExplanationText() != null) {
            question.setExplanationTextData(AssessmentRichTextData.fromDTO(questionRequest.getExplanationText()));
        }
        if (questionRequest.getAutoEvaluationJson() != null) {
            question.setAutoEvaluationJson((questionRequest.getAutoEvaluationJson()));
        }
        if (questionRequest.getMediaId() != null) {
            question.setMediaId((questionRequest.getMediaId()));
        }
        if (questionRequest.getOptionsJson() != null) {
            question.setOptionsJson((questionRequest.getOptionsJson()));
        }
        if (questionRequest.getAiDifficultyLevel() != null) {
            question.setDifficulty((questionRequest.getAiDifficultyLevel()));
        }
        if (questionRequest.getProblemType() != null) {
            question.setProblemType((questionRequest.getProblemType()));
        }
        // Provenance (V42). Null-guarded like everything else here, so an edit that does
        // not resend it keeps whatever the question was originally created with.
        if (questionRequest.getSourceType() != null) {
            question.setSourceType(questionRequest.getSourceType());
        }
        if (questionRequest.getSourceMeta() != null) {
            question.setSourceMeta(questionRequest.getSourceMeta());
        }
        // The rubric the AI evaluator grades against. A generated paper carries
        // its own marking scheme; without this line the evaluator ignored it and
        // invented a rubric from the question text.
        if (questionRequest.getEvaluationCriteriaJson() != null
                && !questionRequest.getEvaluationCriteriaJson().isBlank()) {
            question.setEvaluationCriteriaJson(questionRequest.getEvaluationCriteriaJson());
        }
        question.setQuestionType(questionRequest.getQuestionType());
        switch (questionRequest.getQuestionType()) {
            case "NUMERIC":
                question.setQuestionResponseType(QuestionResponseTypes.INTEGER.name());
                break;
            case "TRUE_FALSE":
            case "MCQS":
            case "MCQM":
                question.setQuestionResponseType(QuestionResponseTypes.OPTION.name());
                break;
            // Each case breaks. Without the breaks ONE_WORD fell through LONG_ANSWER
            // into CODING and every one of them ended up as CODE. It was masked only
            // because handleOneWordQuestion/handleLongAnswerQuestion re-set the value
            // immediately afterwards, so adding the breaks changes nothing at runtime —
            // it just removes a trap for the next person who reorders this method.
            case "ONE_WORD":
                question.setQuestionResponseType(QuestionResponseTypes.ONE_WORD.name());
                break;
            case "LONG_ANSWER":
                question.setQuestionResponseType(QuestionResponseTypes.LONG_ANSWER.name());
                break;
            case "CODING":
                question.setQuestionResponseType(QuestionResponseTypes.CODE.name());
                break;
            default:
                break;
        }
        return question;
    }

    private List<String> createOptions(Question question, QuestionDTO questionRequest) throws JsonProcessingException {
        List<Option> options = new ArrayList<>();
        MCQEvaluationDTO requestEvaluation = (MCQEvaluationDTO) questionEvaluationService.getEvaluationJson(questionRequest.getAutoEvaluationJson(), MCQEvaluationDTO.class);

        // The incoming answer key. Null-guarded end to end: a snake_case or absent
        // `correct_option_ids` used to leave this list null and NPE right here, taking
        // the whole paper save down with it.
        Set<String> incomingCorrectMarkers = new HashSet<>();
        if (requestEvaluation != null && requestEvaluation.getData() != null
                && requestEvaluation.getData().getCorrectOptionIds() != null) {
            for (String marker : requestEvaluation.getData().getCorrectOptionIds()) {
                if (marker != null) incomingCorrectMarkers.add(marker);
            }
        }

        List<String> correctOptionIds = new ArrayList<>();
        for (OptionDTO optionDTO : questionRequest.getOptions()) {
            Option option = new Option();
            UUID optionId = UUID.randomUUID();
            option.setId(optionId.toString());
            if (optionDTO.getId() != null) {
                Optional<Option> existingOption = optionRepository.findById(optionDTO.getId());
                if (existingOption.isPresent()) {
                    option = existingOption.get();
                }
            }
            option.setText(AssessmentRichTextData.fromDTO(optionDTO.getText()));
            option.setQuestion(question);
            option.setMediaId(optionDTO.getMediaId());

            // On CREATE the answer key refers to options by previewId. On EDIT the
            // client sends real option ids and previewId is null — and the old code
            // compared String.valueOf(null), i.e. the literal "null", which matched
            // nothing. The result was an EMPTY correct-option array written back over a
            // perfectly good answer key, after which every learner was graded INCORRECT
            // and given negative marks.
            //
            // Accepting either marker is additive: everything that matched before still
            // matches.
            if (isMarkedCorrect(incomingCorrectMarkers, optionDTO, option.getId())) {
                correctOptionIds.add(option.getId());
            }
            options.add(option);
        }
        question.setOptions(new ArrayList<>());
        question.setOptions(options);
        return correctOptionIds;
    }

    /** True when the answer key names this option, by previewId (create) or id (edit). */
    private boolean isMarkedCorrect(Set<String> correctMarkers, OptionDTO optionDTO, String resolvedOptionId) {
        if (correctMarkers.isEmpty()) return false;
        if (optionDTO.getPreviewId() != null && correctMarkers.contains(String.valueOf(optionDTO.getPreviewId()))) {
            return true;
        }
        if (optionDTO.getId() != null && correctMarkers.contains(optionDTO.getId())) {
            return true;
        }
        return resolvedOptionId != null && correctMarkers.contains(resolvedOptionId);
    }


    private void handleNumericQuestion(Question question, QuestionDTO questionRequest) throws JsonProcessingException {
        // Retrieve the numerical evaluation from the request
        NumericalEvaluationDto requestNumericalEvaluation = (NumericalEvaluationDto) questionEvaluationService.getEvaluationJson(
                questionRequest.getAutoEvaluationJson(), NumericalEvaluationDto.class);

        // Create a new NumericalEvaluationDto object
        NumericalEvaluationDto numericalEvaluation = new NumericalEvaluationDto();
        numericalEvaluation.setType(QuestionTypes.NUMERIC.name());

        // Check if valid answers are not null before setting them
        if (requestNumericalEvaluation.getData() != null && requestNumericalEvaluation.getData().getValidAnswers() != null) {
            numericalEvaluation.setData(new NumericalEvaluationDto.NumericalData(requestNumericalEvaluation.getData().getValidAnswers()));
        }

        // Set the auto evaluation JSON only if numerical evaluation is not null
        question.setAutoEvaluationJson(questionEvaluationService.setEvaluationJson(numericalEvaluation));

        // Set options JSON only if it's not null
        if (questionRequest.getOptionsJson() != null) {
            question.setOptionsJson(questionRequest.getOptionsJson());
        }

        // Set question response type only if it's not null; otherwise, set a default value
        if (questionRequest.getQuestionResponseType() != null) {
            question.setQuestionResponseType(questionRequest.getQuestionResponseType());
        } else {
            question.setQuestionResponseType(QuestionResponseTypes.INTEGER.name());
        }
    }


    private void handleOneWordQuestion(Question question, QuestionDTO questionRequest) throws JsonProcessingException {
        // Retrieve the one-word evaluation from the request
        OneWordEvaluationDTO requestOneWordEvaluation = (OneWordEvaluationDTO) questionEvaluationService.getEvaluationJson(
                questionRequest.getAutoEvaluationJson(), OneWordEvaluationDTO.class);

        // Create a new OneWordEvaluationDTO object
        OneWordEvaluationDTO oneWordEvaluation = new OneWordEvaluationDTO();
        oneWordEvaluation.setType(QuestionTypes.ONE_WORD.name());

        // Check if valid answer is not null before setting it
        if (requestOneWordEvaluation != null && requestOneWordEvaluation.getData() != null
                && requestOneWordEvaluation.getData().getAnswer() != null) {
            oneWordEvaluation.setData(new OneWordEvaluationDTO.OneWordEvaluationData(requestOneWordEvaluation.getData().getAnswer()));
        }

        // Set the auto evaluation JSON only if one-word evaluation is not null
        question.setAutoEvaluationJson(questionEvaluationService.setEvaluationJson(oneWordEvaluation));

        // Set question response type only if it's not null; otherwise, set a default value
        if (questionRequest.getQuestionResponseType() != null) {
            question.setQuestionResponseType(questionRequest.getQuestionResponseType());
        } else {
            question.setQuestionResponseType(QuestionResponseTypes.ONE_WORD.name());
        }
    }


    private void handleLongAnswerQuestion(Question question, QuestionDTO questionRequest) throws JsonProcessingException {
        // Retrieve the long answer evaluation from the request
        LongAnswerEvaluationDTO requestLongAnswerEvaluation = (LongAnswerEvaluationDTO) questionEvaluationService.getEvaluationJson(
                questionRequest.getAutoEvaluationJson(), LongAnswerEvaluationDTO.class);

        // Create a new LongAnswerEvaluationDTO object
        LongAnswerEvaluationDTO longAnswerEvaluation = new LongAnswerEvaluationDTO();
        longAnswerEvaluation.setType(QuestionTypes.LONG_ANSWER.name());

        // Check if valid answer is not null before setting it
        if (requestLongAnswerEvaluation != null && requestLongAnswerEvaluation.getData() != null
                && requestLongAnswerEvaluation.getData().getAnswer() != null) {
            longAnswerEvaluation.setData(new LongAnswerEvaluationDTO.LongAnswerEvaluationData(requestLongAnswerEvaluation.getData().getAnswer()));
        }

        // Set the auto evaluation JSON only if long answer evaluation is not null
        question.setAutoEvaluationJson(questionEvaluationService.setEvaluationJson(longAnswerEvaluation));

        // Set question response type only if it's not null; otherwise, set a default value
        if (questionRequest.getQuestionResponseType() != null) {
            question.setQuestionResponseType(questionRequest.getQuestionResponseType());
        } else {
            question.setQuestionResponseType(QuestionResponseTypes.LONG_ANSWER.name());
        }
    }


    private void handleMCQQuestion(Question question, QuestionDTO questionRequest, List<Option> options, List<String> correctOptionIds) throws JsonProcessingException {

        MCQEvaluationDTO mcqEvaluation = new MCQEvaluationDTO();
        if (question.getQuestionType() != null) mcqEvaluation.setType(question.getQuestionType());
        if (correctOptionIds != null) {
            mcqEvaluation.setData(new MCQEvaluationDTO.MCQData(correctOptionIds));
            question.setAutoEvaluationJson(questionEvaluationService.setEvaluationJson(mcqEvaluation));
        }
    }


    private void setQuestionMetadata(Question question, QuestionDTO questionRequest, Boolean isPublic, List<Option> options) {

        question.setAccessLevel(isPublic ? QuestionAccessLevel.PUBLIC.name() : QuestionAccessLevel.PRIVATE.name());

        question.setEvaluationType(
                (questionRequest.getEvaluationType() != null) ? questionRequest.getEvaluationType() : EvaluationTypes.AUTO.name());

        question.setMediaId(questionRequest.getMediaId());

        question.setQuestionType(questionRequest.getQuestionType());
        question.setExplanationTextData(AssessmentRichTextData.fromDTO(questionRequest.getExplanationText()));
    }

    private void addQuestionEntityTags(List<Question> questions, List<QuestionDTO> questionRequests, String instituteId) {

        // Replace-on-save: clear existing SUBJECT links for these questions so removals in the UI
        // are respected (no-op for brand-new questions). AI 'TAGS'/'TOPIC' links are left intact.
        List<String> questionIds = questions.stream().map(Question::getId).toList();
        if (!questionIds.isEmpty()) {
            try {
                entityTagCommunityRepository.deleteSubjectTagsForQuestions(questionIds);
            } catch (Exception e) {
                log.warn("Failed to clear existing subject tags for {} questions: {}", questionIds.size(), e.getMessage());
            }
        }

        // Resolve each distinct tag name to a tag id only once per save (a paper with N questions
        // sharing a handful of subjects would otherwise run N upsert queries instead of a few).
        Map<String, String> tagIdByName = new HashMap<>();

        // Pair each saved question with ITS request, not with whatever sits at the same
        // index. editQuestionPaper's updated-questions loop skips requests whose question
        // no longer exists, so the two lists drift apart from the first skip onward — and
        // every tag after that point was being attached to the wrong question.
        Map<String, QuestionDTO> requestById = new HashMap<>();
        for (QuestionDTO request : questionRequests) {
            if (request.getId() != null) requestById.put(request.getId(), request);
        }
        boolean pairById = requestById.size() == questionRequests.size()
                && questions.stream().allMatch(q -> requestById.containsKey(q.getId()));

        for (int i = 0; i < questions.size(); i++) {
            Question question = questions.get(i);
            // Fall back to positional pairing only when ids cannot pair the two lists —
            // i.e. brand-new questions, where the request carries no id yet and the lists
            // are built in lockstep anyway.
            QuestionDTO questionRequest = pairById ? requestById.get(question.getId()) : questionRequests.get(i);
            if (questionRequest == null) continue;

            // Manual subject/topic tags entered on upload (or pre-filled from the HTML "Tags:" marker).
            for (String subjectTag : questionRequest.getSubjectTags()) {
                if (subjectTag == null || subjectTag.isBlank()) continue;
                String existingOrNewTagId = resolveTagId(tagIdByName, subjectTag.trim().toLowerCase(), instituteId);
                addEntityTags("QUESTION", question.getId(), existingOrNewTagId, "SUBJECT");
            }

            for (int j = 0; j < questionRequest.getAiTags().size(); j++) {
                String existingOrNewTagId = resolveTagId(tagIdByName, questionRequest.getAiTags().get(j).toLowerCase(), instituteId);
                addEntityTags("QUESTION", question.getId(), existingOrNewTagId, "TAGS");
            }

            for (int j = 0; j < questionRequest.getAiTopicsIds().size(); j++) {
                addEntityTags("QUESTION", question.getId(), questionRequest.getAiTopicsIds().get(j), "TOPIC");
            }
        }
    }

    // Upsert a tag once per distinct (lowercased) name, caching the resolved id for the rest of the save.
    private String resolveTagId(Map<String, String> cache, String tagName, String instituteId) {
        return cache.computeIfAbsent(tagName,
                name -> tagCommunityRepository.insertTagIfNotExists(UUID.randomUUID().toString(), name, instituteId));
    }

    private void addEntityTags(String entityName, String entityId, String tagId, String tagSource) {
        // Tagging is auxiliary to question creation: log and continue on failure, never silently swallow,
        // and never abort the whole paper save because one tag could not be linked.
        try {
            entityTagCommunityRepository.insertIgnoreConflict(entityId, entityName, tagId, tagSource);
        } catch (Exception e) {
            log.warn("Failed to link tag {} (source {}) to {} {}: {}", tagId, tagSource, entityName, entityId, e.getMessage());
        }
    }


}
