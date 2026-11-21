package vacademy.io.admin_core_service.features.learner_quiz.service;

import lombok.RequiredArgsConstructor;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.QuizMetaRow;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.QuizOptionRow;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.QuizQuestionRow;
import vacademy.io.common.core.i18n.LocaleRegistry;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** A quiz slide's marking rules and active questions, in the learner's language. */
@Component
@RequiredArgsConstructor
public class QuizLoader {

    private final LearnerQuizAttemptRepository repository;

    public record LoadedQuiz(QuizMetaRow meta, QuizGrader.Rules rules, List<QuizGrader.Question> questions) {
    }

    public Optional<LoadedQuiz> load(String slideId) {
        return repository.findQuizBySlideId(slideId).map(meta -> {
            String lang = LocaleRegistry.normalize(LocaleContextHolder.getLocale().toLanguageTag());
            Map<String, List<QuizGrader.Option>> options = new HashMap<>();
            for (QuizOptionRow row : repository.findOptions(meta.getQuizId(), lang)) {
                options.computeIfAbsent(row.getQuestionId(), k -> new ArrayList<>())
                        .add(new QuizGrader.Option(row.getOptionId(), row.getTextContent()));
            }
            List<QuizGrader.Question> questions = new ArrayList<>();
            for (QuizQuestionRow row : repository.findActiveQuestions(meta.getQuizId(), lang)) {
                questions.add(new QuizGrader.Question(row.getQuestionId(), row.getQuestionType(), row.getMarks(),
                        row.getNegativeMarking(), row.getAutoEvaluationJson(), row.getTextContent(),
                        row.getExplanationContent(), options.getOrDefault(row.getQuestionId(), List.of())));
            }
            QuizGrader.Rules rules = new QuizGrader.Rules(
                    meta.getMarksPerQuestion() == null ? 1.0 : meta.getMarksPerQuestion(),
                    meta.getNegativeMarking() == null ? 0.0 : meta.getNegativeMarking(),
                    Boolean.TRUE.equals(meta.getPartialMarking()));
            return new LoadedQuiz(meta, rules, questions);
        });
    }
}
