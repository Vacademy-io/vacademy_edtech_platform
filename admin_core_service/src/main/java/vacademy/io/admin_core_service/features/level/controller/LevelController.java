package vacademy.io.admin_core_service.features.level.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithCourseDTO;
import vacademy.io.admin_core_service.features.level.service.LevelService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.institute.dto.LevelDTO;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/level/v1")
@RequiredArgsConstructor
public class LevelController {
    private final LevelService levelService;

    @GetMapping("/get-levels")
    public ResponseEntity<List<LevelDTO>> getLevelsByInstitute(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(levelService.getLevelsByInstituteId(instituteId));
    }

    @PostMapping("/add-level")
    public ResponseEntity<String> addLevel(@RequestBody AddLevelWithCourseDTO addLevelWithCourseDTO,
                                           @RequestAttribute("user") CustomUserDetails user,
                                           @RequestParam("packageId") String packageId,
                                           @RequestParam("sessionId") String sessionId,
                                           @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(levelService.addLevel(addLevelWithCourseDTO, packageId, sessionId,instituteId, user));
    }

    @PutMapping("/update-level/{levelId}")
    public ResponseEntity<LevelDTO> updateLevel(@RequestBody LevelDTO levelDTO, @RequestAttribute("user") CustomUserDetails user, @PathVariable("levelId") String levelId) {
        return ResponseEntity.ok(levelService.updateLevel(levelId, levelDTO, user));
    }

    @DeleteMapping("/delete-level")
    public ResponseEntity<String> deleteLevels(@RequestBody List<String> levelIds,
                                               @RequestHeader(value = "clientId", required = false) String instituteId,
                                               @RequestAttribute("user") CustomUserDetails user) {
        // The institute is the clientId header: the principal's roles are loaded for exactly it.
        return ResponseEntity.ok(levelService.deleteLevels(levelIds, instituteId, user));
    }
}
