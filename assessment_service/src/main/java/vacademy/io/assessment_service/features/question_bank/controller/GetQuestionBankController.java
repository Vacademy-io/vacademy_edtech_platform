package vacademy.io.assessment_service.features.question_bank.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionBankManager;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_NUMBER;
import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_SIZE;

/**
 * Question-level browse. The paper-level equivalent lives at
 * /assessment-service/question-paper/view/v1/get-with-filters and is unchanged.
 */
@RestController
@RequestMapping("/assessment-service/question-bank/v1")
public class GetQuestionBankController {

    @Autowired
    private GetQuestionBankManager getQuestionBankManager;

    @PostMapping("/questions/filter")
    public ResponseEntity<Page<QuestionDTO>> filterQuestions(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody(required = false) QuestionBankFilter filter,
            @RequestParam(value = "instituteId") String instituteId,
            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = DEFAULT_PAGE_SIZE, required = false) int pageSize) {
        return ResponseEntity.ok(getQuestionBankManager.getQuestions(user, filter, instituteId, pageNo, pageSize));
    }
}
