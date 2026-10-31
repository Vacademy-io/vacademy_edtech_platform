package vacademy.io.admin_core_service.features.doubts.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.doubts.dtos.AllDoubtsResponse;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtActivityDto;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsDto;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsRequestFilter;
import vacademy.io.admin_core_service.features.doubts.manager.DoubtsManager;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

import static vacademy.io.common.auth.config.PageConstants.DEFAULT_PAGE_NUMBER;
import static vacademy.io.common.auth.config.PageConstants.DEFAULT_PAGE_SIZE;

@RestController
@RequestMapping("/admin-core-service/institute/v1/doubts")
public class DoubtsController {

    @Autowired
    DoubtsManager doubtsManager;

    @PostMapping("/create")
    ResponseEntity<String> addDoubts(@RequestAttribute("user") CustomUserDetails userDetails,
                                             @RequestParam(name = "doubtId", required = false) String doubtId,
                                             @RequestBody DoubtsDto request){
        return doubtsManager.updateOrCreateDoubt(userDetails,doubtId,request);
    }

    @PostMapping("/get-all")
    ResponseEntity<AllDoubtsResponse> addDoubts(@RequestAttribute("user") CustomUserDetails userDetails,
                                                        @RequestBody DoubtsRequestFilter filter,
                                                        @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
                                                        @RequestParam(value = "pageSize", defaultValue = DEFAULT_PAGE_SIZE, required = false) int pageSize){
        return doubtsManager.getAllDoubts(userDetails,filter,pageNo,pageSize);
    }

    /**
     * Fetch a single doubt by id, mapped to the same {@link DoubtsDto} shape the inbox list uses.
     * Powers the email/notification deep link (?doubtId=X): the inbox can open a specific doubt even
     * when it isn't on the first page of the paginated list. Returns 404 when the id doesn't exist,
     * 403 when the caller is not its author, staff of its institute, or an assignee / batch faculty.
     */
    @GetMapping("/{doubtId}")
    ResponseEntity<DoubtsDto> getDoubtById(@RequestAttribute("user") CustomUserDetails userDetails,
                                           @PathVariable("doubtId") String doubtId){
        return doubtsManager.getDoubtById(userDetails, doubtId);
    }

    /**
     * Audit trail for one doubt — who assigned whom (by hand or by which routing rule), status
     * changes and remarks, oldest first. Staff only; learners get a 4xx.
     */
    @GetMapping("/{doubtId}/activity")
    ResponseEntity<List<DoubtActivityDto>> getDoubtActivity(@RequestAttribute("user") CustomUserDetails userDetails,
                                                             @PathVariable("doubtId") String doubtId){
        return doubtsManager.getDoubtActivity(userDetails, doubtId);
    }
}
