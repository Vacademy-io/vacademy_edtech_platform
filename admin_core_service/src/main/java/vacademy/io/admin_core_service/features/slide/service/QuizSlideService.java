package vacademy.io.admin_core_service.features.slide.service;

import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.entity.RichTextData;
import vacademy.io.admin_core_service.features.common.service.RichTextDataService;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideQuestionDTO;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideQuestionOptionDTO;
import vacademy.io.admin_core_service.features.slide.dto.SlideDTO;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlide;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestion;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestionOption;
import vacademy.io.admin_core_service.features.slide.enums.SlideTypeEnum;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class QuizSlideService {

    @Autowired
    private SlideService slideService;

    @Autowired
    private QuizSlideRepository quizSlideRepository;

    @Autowired
    private RichTextDataService richTextDataService;

    @Transactional
    public String addOrUpdateQuizSlide(SlideDTO slideDTO, String chapterId, String packageSessionId, String moduleId,
            String subjectId, CustomUserDetails userDetails) {
        if (slideDTO.isNewSlide()) {
            return addQuizSlide(slideDTO, chapterId, userDetails);
        }
        return updateQuizSlide(slideDTO, chapterId, packageSessionId, moduleId, subjectId, userDetails);
    }

    public String addOrUpdateQuizSlideRequest(SlideDTO slideDTO, String chapterId, CustomUserDetails userDetails) {
        return addQuizSlide(slideDTO, chapterId, userDetails);
    }

    public String addQuizSlide(SlideDTO slideDTO, String chapterId, CustomUserDetails user) {
        QuizSlide quizSlide = new QuizSlide(slideDTO.getQuizSlide());

        QuizSlide savedQuizSlide = quizSlideRepository.save(quizSlide);

        String slideId = slideService.saveSlide(
                slideDTO.getId(),
                savedQuizSlide.getId(),
                SlideTypeEnum.QUIZ.name(),
                slideDTO.getStatus(),
                slideDTO.getTitle(),
                slideDTO.getDescription(),
                slideDTO.getImageFileId(),
                slideDTO.getSlideOrder(),
                chapterId
                /* , user */ // TODO: restore once SlideService audit refactor is pushed
        );

        return slideId;
    }

    public String updateQuizSlide(SlideDTO slideDTO, String chapterId, String packageSessionId, String moduleId,
            String subjectId, CustomUserDetails user) {
        QuizSlideDTO quizSlideDTO = slideDTO.getQuizSlide();

        QuizSlide quizSlide = quizSlideRepository.findById(quizSlideDTO.getId())
                .orElseThrow(() -> new VacademyException("Quiz slide not found"));

        updateData(quizSlideDTO, quizSlide);

        quizSlideRepository.save(quizSlide);

        slideService.updateSlide(
                slideDTO.getId(),
                slideDTO.getStatus(),
                slideDTO.getTitle(),
                slideDTO.getDescription(),
                slideDTO.getImageFileId(),
                slideDTO.getSlideOrder(),
                chapterId,
                packageSessionId,
                moduleId,
                subjectId
                /* , user */ // TODO: restore once SlideService audit refactor is pushed
        );

        return "success";
    }

    public void updateData(QuizSlideDTO dto, QuizSlide quizSlide) {
        quizSlide.setDescriptionRichText(new RichTextData(dto.getDescription()));
        quizSlide.setTimeLimitInMinutes(dto.getTimeLimitInMinutes());
        quizSlide.setMarksPerQuestion(dto.getMarksPerQuestion() != null ? dto.getMarksPerQuestion() : 1.0);
        quizSlide.setNegativeMarking(dto.getNegativeMarking() != null ? dto.getNegativeMarking() : 0.0);
        quizSlide.setPassPercentage(dto.getPassPercentage());
        // Null = the caller does not know about this setting (older payload builders):
        // keep what is stored rather than silently switching partial marking off.
        if (dto.getPartialMarking() != null) {
            quizSlide.setPartialMarking(dto.getPartialMarking());
        }
        quizSlide.setReAttemptCount(dto.getReAttemptCount());
        addOrUpdateQuestionsInBulk(quizSlide, dto.getQuestions());
    }

    private void addOrUpdateQuestionsInBulk(QuizSlide quizSlide, List<QuizSlideQuestionDTO> quizSlideQuestionDTOs) {
        if (quizSlide.getQuestions() == null) {
            quizSlide.setQuestions(new ArrayList<>());
        }

        if (quizSlideQuestionDTOs == null || quizSlideQuestionDTOs.isEmpty()) {
            quizSlide.getQuestions().clear();
            return;
        }

        Map<String, QuizSlideQuestion> existingQuestionsMap = quizSlide.getQuestions().stream()
                .collect(Collectors.toMap(QuizSlideQuestion::getId, Function.identity()));

        List<QuizSlideQuestion> updatedQuestions = new ArrayList<>();

        for (QuizSlideQuestionDTO dto : quizSlideQuestionDTOs) {
            if (dto.getId() != null && existingQuestionsMap.containsKey(dto.getId())) {
                QuizSlideQuestion existingQuestion = existingQuestionsMap.get(dto.getId());
                updateExistingQuestion(existingQuestion, dto);
                updatedQuestions.add(existingQuestion);
            } else {
                QuizSlideQuestion newQuestion = new QuizSlideQuestion(dto, quizSlide);
                if (newQuestion.getId() == null) {
                    newQuestion.setId(UUID.randomUUID().toString());
                }
                updatedQuestions.add(newQuestion);
            }
        }

        quizSlide.getQuestions().clear();
        quizSlide.getQuestions().addAll(updatedQuestions);
    }

    private void updateExistingQuestion(QuizSlideQuestion existingQuestion, QuizSlideQuestionDTO dto) {
        // Update basic properties
        if (dto.getParentRichText() != null) {
            if (existingQuestion.getParentRichText() != null) {
                existingQuestion.getParentRichText().setContent(dto.getParentRichText().getContent());
                existingQuestion.getParentRichText().setType(dto.getParentRichText().getType());
            } else {
                existingQuestion.setParentRichText(new RichTextData(dto.getParentRichText()));
            }
        } else {
            existingQuestion.setParentRichText(null);
        }

        if (dto.getText() != null) {
            String incomingTextContent = dto.getText().getContent();
            if (existingQuestion.getText() != null) {
                // Only overwrite if the incoming content is non-empty, to avoid wiping
                // existing titles when the frontend sends an empty string on passthrough.
                if (incomingTextContent != null && !incomingTextContent.isEmpty()) {
                    existingQuestion.getText().setContent(incomingTextContent);
                    existingQuestion.getText().setType(dto.getText().getType());
                }
            } else if (incomingTextContent != null && !incomingTextContent.isEmpty()) {
                existingQuestion.setText(new RichTextData(dto.getText()));
            }
        } else {
            existingQuestion.setText(null);
        }

        if (dto.getExplanationText() != null) {
            if (existingQuestion.getExplanationText() != null) {
                existingQuestion.getExplanationText().setContent(dto.getExplanationText().getContent());
                existingQuestion.getExplanationText().setType(dto.getExplanationText().getType());
            } else {
                existingQuestion.setExplanationText(new RichTextData(dto.getExplanationText()));
            }
        } else {
            existingQuestion.setExplanationText(null);
        }

        existingQuestion.setMediaId(dto.getMediaId());
        existingQuestion.setStatus(dto.getStatus());

        if (dto.getQuestionResponseType() != null) {
            existingQuestion.setQuestionResponseType(dto.getQuestionResponseType());
        }

        if (dto.getQuestionType() != null) {
            existingQuestion.setQuestionType(dto.getQuestionType());
        }

        if (dto.getAccessLevel() != null) {
            existingQuestion.setAccessLevel(dto.getAccessLevel());
        }

        existingQuestion.setAutoEvaluationJson(dto.getAutoEvaluationJson());
        existingQuestion.setEvaluationType(dto.getEvaluationType());
        existingQuestion.setQuestionOrder(dto.getQuestionOrder());
        existingQuestion.setCanSkip(dto.getCanSkip());
        existingQuestion.setMarks(dto.getMarks());
        existingQuestion.setNegativeMarking(dto.getNegativeMarking());
        existingQuestion.setUpdatedAt(LocalDateTime.now());

        // Update options
        updateQuestionOptions(existingQuestion, dto.getOptions());
    }

    private void updateQuestionOptions(QuizSlideQuestion question, List<QuizSlideQuestionOptionDTO> optionDTOs) {
        if (question.getQuizSlideQuestionOptions() == null) {
            question.setQuizSlideQuestionOptions(new ArrayList<>());
        }

        if (optionDTOs == null || optionDTOs.isEmpty()) {
            question.getQuizSlideQuestionOptions().clear();
            return;
        }

        Map<String, QuizSlideQuestionOption> existingOptionsMap = question.getQuizSlideQuestionOptions().stream()
                .collect(Collectors.toMap(QuizSlideQuestionOption::getId, Function.identity()));

        List<QuizSlideQuestionOption> updatedOptions = new ArrayList<>();

        for (QuizSlideQuestionOptionDTO dto : optionDTOs) {
            if (dto.getId() != null && existingOptionsMap.containsKey(dto.getId())) {
                QuizSlideQuestionOption existingOption = existingOptionsMap.get(dto.getId());
                updateExistingOption(existingOption, dto);
                updatedOptions.add(existingOption);
            } else {
                QuizSlideQuestionOption newOption = new QuizSlideQuestionOption(dto, question);
                if (newOption.getId() == null) {
                    newOption.setId(UUID.randomUUID().toString());
                }
                updatedOptions.add(newOption);
            }
        }

        question.getQuizSlideQuestionOptions().clear();
        question.getQuizSlideQuestionOptions().addAll(updatedOptions);
    }

    private void updateExistingOption(QuizSlideQuestionOption existingOption, QuizSlideQuestionOptionDTO dto) {
        if (dto.getText() != null) {
            String incomingOptionContent = dto.getText().getContent();
            if (existingOption.getText() != null) {
                // Only overwrite if the incoming content is non-empty
                if (incomingOptionContent != null && !incomingOptionContent.isEmpty()) {
                    existingOption.getText().setContent(incomingOptionContent);
                    existingOption.getText().setType(dto.getText().getType());
                }
            } else if (incomingOptionContent != null && !incomingOptionContent.isEmpty()) {
                existingOption.setText(new RichTextData(dto.getText()));
            }
        } else {
            existingOption.setText(null);
        }

        if (dto.getExplanationText() != null) {
            if (existingOption.getExplanationText() != null) {
                existingOption.getExplanationText().setContent(dto.getExplanationText().getContent());
                existingOption.getExplanationText().setType(dto.getExplanationText().getType());
            } else {
                existingOption.setExplanationText(new RichTextData(dto.getExplanationText()));
            }
        } else {
            existingOption.setExplanationText(null);
        }

        existingOption.setMediaId(dto.getMediaId());
        existingOption.setUpdatedOn(LocalDateTime.now());
    }

    /**
     * Copy quiz slide and return new quiz slide ID
     */
    public String copyQuizSlide(String sourceQuizSlideId) {
        QuizSlide originalQuizSlide = quizSlideRepository.findById(sourceQuizSlideId)
                .orElseThrow(() -> new VacademyException("Quiz slide not found"));

        QuizSlide newQuizSlide = new QuizSlide();
        newQuizSlide.setId(UUID.randomUUID().toString());
        newQuizSlide.setTitle(originalQuizSlide.getTitle());
        newQuizSlide.setTimeLimitInMinutes(originalQuizSlide.getTimeLimitInMinutes());
        newQuizSlide.setMarksPerQuestion(originalQuizSlide.getMarksPerQuestion() != null ? originalQuizSlide.getMarksPerQuestion() : 1.0);
        newQuizSlide.setNegativeMarking(originalQuizSlide.getNegativeMarking() != null ? originalQuizSlide.getNegativeMarking() : 0.0);
        newQuizSlide.setPassPercentage(originalQuizSlide.getPassPercentage());
        newQuizSlide.setPartialMarking(Boolean.TRUE.equals(originalQuizSlide.getPartialMarking()));
        newQuizSlide.setReAttemptCount(originalQuizSlide.getReAttemptCount());

        // Copy description RichTextData if it exists
        if (originalQuizSlide.getDescriptionRichText() != null) {
            RichTextData newDescriptionRichText = new RichTextData();
            newDescriptionRichText.setId(UUID.randomUUID().toString());
            newDescriptionRichText.setType(originalQuizSlide.getDescriptionRichText().getType());
            newDescriptionRichText.setContent(originalQuizSlide.getDescriptionRichText().getContent());
            newQuizSlide.setDescriptionRichText(newDescriptionRichText);
        }

        // Copy questions if they exist
        if (originalQuizSlide.getQuestions() != null && !originalQuizSlide.getQuestions().isEmpty()) {
            List<QuizSlideQuestion> newQuestions = originalQuizSlide.getQuestions().stream()
                    .map(this::copyQuizSlideQuestion)
                    .collect(Collectors.toList());
            newQuizSlide.setQuestions(newQuestions);
        }

        QuizSlide savedQuizSlide = quizSlideRepository.save(newQuizSlide);
        return savedQuizSlide.getId();
    }

    /**
     * Copy individual quiz slide question
     */
    private QuizSlideQuestion copyQuizSlideQuestion(QuizSlideQuestion originalQuestion) {
        QuizSlideQuestion newQuestion = new QuizSlideQuestion();
        newQuestion.setId(UUID.randomUUID().toString());
        newQuestion.setMediaId(originalQuestion.getMediaId());
        newQuestion.setStatus(originalQuestion.getStatus());
        newQuestion.setQuestionResponseType(originalQuestion.getQuestionResponseType());
        newQuestion.setQuestionType(originalQuestion.getQuestionType());
        newQuestion.setAccessLevel(originalQuestion.getAccessLevel());
        newQuestion.setAutoEvaluationJson(originalQuestion.getAutoEvaluationJson());
        newQuestion.setEvaluationType(originalQuestion.getEvaluationType());
        newQuestion.setQuestionOrder(originalQuestion.getQuestionOrder());
        newQuestion.setCanSkip(originalQuestion.getCanSkip());
        newQuestion.setCreatedAt(LocalDateTime.now());
        newQuestion.setUpdatedAt(LocalDateTime.now());

        // Copy RichTextData if they exist
        if (originalQuestion.getParentRichText() != null) {
            RichTextData newParentRichText = new RichTextData();
            newParentRichText.setId(UUID.randomUUID().toString());
            newParentRichText.setType(originalQuestion.getParentRichText().getType());
            newParentRichText.setContent(originalQuestion.getParentRichText().getContent());
            newQuestion.setParentRichText(newParentRichText);
        }

        if (originalQuestion.getText() != null) {
            RichTextData newText = new RichTextData();
            newText.setId(UUID.randomUUID().toString());
            newText.setType(originalQuestion.getText().getType());
            newText.setContent(originalQuestion.getText().getContent());
            newQuestion.setText(newText);
        }

        if (originalQuestion.getExplanationText() != null) {
            RichTextData newExplanationText = new RichTextData();
            newExplanationText.setId(UUID.randomUUID().toString());
            newExplanationText.setType(originalQuestion.getExplanationText().getType());
            newExplanationText.setContent(originalQuestion.getExplanationText().getContent());
            newQuestion.setExplanationText(newExplanationText);
        }

        return newQuestion;
    }
}