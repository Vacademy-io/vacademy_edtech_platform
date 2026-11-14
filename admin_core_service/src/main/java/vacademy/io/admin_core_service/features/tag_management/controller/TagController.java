package vacademy.io.admin_core_service.features.tag_management.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.tag_management.dto.*;
import vacademy.io.admin_core_service.features.tag_management.service.CsvTagService;
import vacademy.io.admin_core_service.features.tag_management.service.TagService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/tag-management")
@RequiredArgsConstructor
@Slf4j
public class TagController {
    
    private final TagService tagService;
    private final CsvTagService csvTagService;
    
    // ========== TAG MANAGEMENT APIs ==========
    
    /**
     * Create a new tag for institute
     */
    @PostMapping("/institutes/{instituteId}/tags")
    @Auditable(
            entityType = "TAG",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'created tag ' + (#createTagDTO?.tagName ?: '')")
    public ResponseEntity<TagDTO> createTag(
            @PathVariable String instituteId,
            @Valid @RequestBody CreateTagDTO createTagDTO,
            @RequestAttribute("user") CustomUserDetails user) {
        
        TagDTO createdTag = tagService.createTag(createTagDTO, instituteId, user.getUserId());
        
        log.info("Created tag: {} for institute: {} by user: {}", 
                createdTag.getTagName(), instituteId, user.getUserId());
        
        return ResponseEntity.ok(createdTag);
    }
    
    /**
     * Get all tags for institute (including default tags)
     */
    @GetMapping("/institutes/{instituteId}/tags")
    public ResponseEntity<List<TagDTO>> getAllTags(
            @PathVariable String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        
        List<TagDTO> tags = tagService.getAllTagsForInstitute(instituteId);
        
        return ResponseEntity.ok(tags);
    }
    
    /**
     * Get only default tags
     */
    @GetMapping("/tags/default")
    public ResponseEntity<List<TagDTO>> getDefaultTags(
            @RequestAttribute("user") CustomUserDetails user) {
        
        List<TagDTO> defaultTags = tagService.getDefaultTags();
        return ResponseEntity.ok(defaultTags);
    }
    
    /**
     * Get only institute-specific tags
     */
    @GetMapping("/institutes/{instituteId}/tags/institute")
    public ResponseEntity<List<TagDTO>> getInstituteTags(
            @PathVariable String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        
        List<TagDTO> instituteTags = tagService.getInstituteSpecificTags(instituteId);
        
        return ResponseEntity.ok(instituteTags);
    }
    
    /**
     * Delete a tag (mark as inactive) - only non-default tags
     */
    @DeleteMapping("/institutes/{instituteId}/tags/{tagId}")
    @Auditable(
            entityType = "TAG",
            action = "DELETE",
            entityIdExpr = "#tagId",
            descriptionExpr = "'deleted a tag'")
    public ResponseEntity<String> deleteTag(
            @PathVariable String instituteId,
            @PathVariable String tagId,
            @RequestAttribute("user") CustomUserDetails user) {
        
        tagService.deleteTag(tagId, instituteId);
        
        log.info("Deleted tag: {} for institute: {} by user: {}", tagId, instituteId, user.getUserId());
        
        return ResponseEntity.ok("Tag deleted successfully");
    }
    
    /**
     * Get tag statistics for institute
     */
    @GetMapping("/institutes/{instituteId}/tags/statistics")
    public ResponseEntity<List<Map<String, Object>>> getTagStatistics(
            @PathVariable String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        
        List<Map<String, Object>> statistics = tagService.getTagStatistics(instituteId);
        
        return ResponseEntity.ok(statistics);
    }
    
    // ========== USER TAG MANAGEMENT APIs ==========
    
    /**
     * Get all tags for a specific user
     */
    @GetMapping("/institutes/{instituteId}/users/{userId}/tags")
    public ResponseEntity<UserTagsResponseDTO> getUserTags(
            @PathVariable String instituteId,
            @PathVariable String userId,
            @RequestAttribute("user") CustomUserDetails user) {
        
        UserTagsResponseDTO userTags = tagService.getUserTags(userId, instituteId);
        
        return ResponseEntity.ok(userTags);
    }
    
    /**
     * Get active tags for a specific user
     */
    @GetMapping("/institutes/{instituteId}/users/{userId}/tags/active")
    public ResponseEntity<List<TagDTO>> getActiveUserTags(
            @PathVariable String instituteId,
            @PathVariable String userId,
            @RequestAttribute("user") CustomUserDetails user) {
        
        List<TagDTO> activeTags = tagService.getActiveUserTags(userId, instituteId);
        
        return ResponseEntity.ok(activeTags);
    }
    
    /**
     * Get active tags for multiple users
     */
    @PostMapping("/institutes/{instituteId}/users/tags/active")
    public ResponseEntity<Map<String, List<TagDTO>>> getActiveUserTagsForMultipleUsers(
            @PathVariable String instituteId,
            @RequestBody List<String> userIds,
            @RequestAttribute("user") CustomUserDetails user) {
        
        Map<String, List<TagDTO>> userTags = tagService.getActiveUserTagsForMultipleUsers(userIds, instituteId);
        
        return ResponseEntity.ok(userTags);
    }
    
    /**
     * Add tags to users
     */
    @PostMapping("/institutes/{instituteId}/users/tags/add")
    @Auditable(
            entityType = "TAG",
            action = "TAG_USERS",
            descriptionExpr = "'tagged ' + (#result?.body?.successCount ?: 0) + ' contact(s)'")
    public ResponseEntity<BulkUserTagOperationResultDTO> addTagsToUsers(
            @PathVariable String instituteId,
            @Valid @RequestBody AddTagsToUsersDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        
        BulkUserTagOperationResultDTO result = tagService.addTagsToUsers(request, instituteId, user.getUserId());
        
        log.info("Bulk add tags operation completed - Success: {}, Skip: {}, Error: {}", 
                result.getSuccessCount(), result.getSkipCount(), result.getErrorCount());
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * Add single tag to multiple users
     */
    @PostMapping("/institutes/{instituteId}/tags/{tagId}/users/add")
    @Auditable(
            entityType = "TAG",
            action = "TAG_USERS",
            entityIdExpr = "#tagId",
            descriptionExpr = "'tagged ' + (#result?.body?.successCount ?: 0) + ' contact(s)'")
    public ResponseEntity<BulkUserTagOperationResultDTO> addTagToUsers(
            @PathVariable String instituteId,
            @PathVariable String tagId,
            @RequestBody List<String> userIds,
            @RequestAttribute("user") CustomUserDetails user) {
        
        BulkUserTagOperationResultDTO result = tagService.addTagToUsers(userIds, tagId, instituteId, user.getUserId());
        
        log.info("Add tag {} to users operation completed - Success: {}, Skip: {}, Error: {}", 
                tagId, result.getSuccessCount(), result.getSkipCount(), result.getErrorCount());
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * Add tag by name to multiple users (auto-creates tag if it doesn't exist)
     */
    @PostMapping("/institutes/{instituteId}/tags/by-name/{tagName}/users/add")
    @Auditable(
            entityType = "TAG",
            action = "TAG_USERS",
            descriptionExpr = "'tagged ' + (#result?.body?.successCount ?: 0) + ' contact(s) with ' + #tagName")
    public ResponseEntity<BulkUserTagOperationResultDTO> addTagByNameToUsers(
            @PathVariable String instituteId,
            @PathVariable String tagName,
            @RequestBody List<String> userIds,
            @RequestAttribute("user") CustomUserDetails user) {
        
        BulkUserTagOperationResultDTO result = tagService.addTagByNameToUsers(userIds, tagName, instituteId, user.getUserId());
        
        log.info("Add tag by name '{}' to users operation completed - Success: {}, Skip: {}, Error: {}", 
                tagName, result.getSuccessCount(), result.getSkipCount(), result.getErrorCount());
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * Deactivate user tags for specific users
     */
    @PostMapping("/institutes/{instituteId}/users/tags/deactivate")
    @Auditable(
            entityType = "TAG",
            action = "UNTAG_USERS",
            descriptionExpr = "'removed tags from ' + (#result?.body?.successCount ?: 0) + ' contact(s)'")
    public ResponseEntity<BulkUserTagOperationResultDTO> deactivateUserTags(
            @PathVariable String instituteId,
            @RequestParam List<String> userIds,
            @RequestParam List<String> tagIds,
            @RequestAttribute("user") CustomUserDetails user) {
        
        BulkUserTagOperationResultDTO result = tagService.deactivateUserTags(userIds, tagIds, instituteId);
        
        log.info("Bulk deactivate tags operation completed - Success: {}, Skip: {}, Error: {}", 
                result.getSuccessCount(), result.getSkipCount(), result.getErrorCount());
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * Get all user IDs that have a specific tag
     */
    @GetMapping("/institutes/{instituteId}/tags/{tagId}/users")
    public ResponseEntity<List<String>> getUsersByTag(
            @PathVariable String instituteId,
            @PathVariable String tagId,
            @RequestAttribute("user") CustomUserDetails user) {
        
        List<String> userIds = tagService.getUserIdsByTag(tagId, instituteId);
        
        log.info("Found {} users with tag {} in institute {}", userIds.size(), tagId, instituteId);
        
        return ResponseEntity.ok(userIds);
    }
    
    /**
     * Get all user IDs that have any of the specified tags
     */
    @PostMapping("/institutes/{instituteId}/tags/users")
    public ResponseEntity<List<String>> getUsersByTags(
            @PathVariable String instituteId,
            @RequestBody List<String> tagIds) {
        
        List<String> userIds = tagService.getUserIdsByTags(tagIds, instituteId);
        
        log.info("Found {} users with any of {} tags in institute {}", userIds.size(), tagIds.size(), instituteId);
        
        return ResponseEntity.ok(userIds);
    }
    
    /**
     * Get detailed user information for users that have any of the specified tags
     */
    @PostMapping("/institutes/{instituteId}/tags/users/details")
    public ResponseEntity<List<Map<String, Object>>> getUserDetailsByTags(
            @PathVariable String instituteId,
            @RequestBody List<String> tagIds,
            @RequestAttribute("user") CustomUserDetails user) {
        
        List<Map<String, Object>> userDetails = tagService.getUserDetailsByTags(tagIds, instituteId);
        
        log.info("Found {} users with detailed info for {} tags in institute {}", userDetails.size(), tagIds.size(), instituteId);
        
        return ResponseEntity.ok(userDetails);
    }
    
    /**
     * Get user counts for multiple tags
     */
    @PostMapping("/institutes/{instituteId}/tags/user-counts")
    public ResponseEntity<Map<String, Object>> getUserCountsByTags(
            @PathVariable String instituteId,
            @RequestBody List<String> tagIds,
            @RequestAttribute("user") CustomUserDetails user) {
        
        Map<String, Object> tagCounts = tagService.getUserCountsByTags(tagIds, instituteId);
        
        log.info("Retrieved user counts for {} tags in institute {}", tagIds.size(), instituteId);
        
        return ResponseEntity.ok(tagCounts);
    }
    
    // ========== CSV UPLOAD APIs ==========
    
    /**
     * Upload CSV file and add tag to all users in the file
     */
    @PostMapping("/institutes/{instituteId}/tags/{tagId}/users/csv-upload")
    public ResponseEntity<BulkUserTagOperationResultDTO> uploadCsvAndAddTag(
            @PathVariable String instituteId,
            @PathVariable String tagId,
            @RequestParam("file") MultipartFile csvFile,
            @RequestAttribute("user") CustomUserDetails user) {
        
        BulkUserTagOperationResultDTO result = csvTagService.processCsvAndAddTag(csvFile, tagId, instituteId, user.getUserId());
        
        log.info("CSV upload operation completed for tag {} - Success: {}, Skip: {}, Error: {}", 
                tagId, result.getSuccessCount(), result.getSkipCount(), result.getErrorCount());
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * Upload CSV file with user IDs and add tag by name to all users in the file
     */
    @PostMapping("/institutes/{instituteId}/tags/by-name/{tagName}/users/csv-upload")
    public ResponseEntity<BulkUserTagOperationResultDTO> uploadCsvAndAddTagByName(
            @PathVariable String instituteId,
            @PathVariable String tagName,
            @RequestParam("file") MultipartFile csvFile,
            @RequestAttribute("user") CustomUserDetails user) {
        
        BulkUserTagOperationResultDTO result = csvTagService.processCsvAndAddTagByName(csvFile, tagName, instituteId, user.getUserId());
        
        log.info("CSV upload operation completed for tag name '{}' - Success: {}, Skip: {}, Error: {}", 
                tagName, result.getSuccessCount(), result.getSkipCount(), result.getErrorCount());
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * Validate CSV file format
     */
    @PostMapping("/csv/validate")
    public ResponseEntity<String> validateCsvFile(
            @RequestParam("file") MultipartFile csvFile,
            @RequestAttribute("user") CustomUserDetails user) {
        
        csvTagService.validateCsvFormat(csvFile);
        return ResponseEntity.ok("CSV file format is valid");
    }
    
    /**
     * Upload CSV file with usernames and add tag to all users in the file
     */
    @PostMapping("/institutes/{instituteId}/tags/{tagId}/users/csv-upload-usernames")
    public ResponseEntity<BulkUserTagOperationResultDTO> uploadCsvWithUsernamesAndAddTag(
            @PathVariable String instituteId,
            @PathVariable String tagId,
            @RequestParam("file") MultipartFile csvFile,
            @RequestAttribute("user") CustomUserDetails user) {
        
        BulkUserTagOperationResultDTO result = csvTagService.processCsvWithUsernamesAndAddTag(csvFile, tagId, instituteId, user.getUserId());
        
        log.info("CSV upload with usernames operation completed for tag {} - Success: {}, Skip: {}, Error: {}", 
                tagId, result.getSuccessCount(), result.getSkipCount(), result.getErrorCount());
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * Upload CSV file with usernames and add tag by name to all users in the file
     */
    @PostMapping("/institutes/{instituteId}/tags/by-name/{tagName}/users/csv-upload-usernames")
    public ResponseEntity<BulkUserTagOperationResultDTO> uploadCsvWithUsernamesAndAddTagByName(
            @PathVariable String instituteId,
            @PathVariable String tagName,
            @RequestParam("file") MultipartFile csvFile,
            @RequestAttribute("user") CustomUserDetails user) {
        
        BulkUserTagOperationResultDTO result = csvTagService.processCsvWithUsernamesAndAddTagByName(csvFile, tagName, instituteId, user.getUserId());
        
        log.info("CSV upload with usernames operation completed for tag name '{}' - Success: {}, Skip: {}, Error: {}", 
                tagName, result.getSuccessCount(), result.getSkipCount(), result.getErrorCount());
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * Download CSV template for user IDs
     */
    @GetMapping("/csv/template")
    public ResponseEntity<String> downloadCsvTemplate(@RequestAttribute("user") CustomUserDetails user) {
        String template = csvTagService.generateCsvTemplate();
        
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"user_tags_template.csv\"")
                .contentType(MediaType.TEXT_PLAIN)
                .body(template);
    }
    
    /**
     * Download CSV template for usernames
     */
    @GetMapping("/csv/template-usernames")
    public ResponseEntity<String> downloadUsernamesCsvTemplate(@RequestAttribute("user") CustomUserDetails user) {
        String template = csvTagService.generateUsernamesCsvTemplate();
        
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"user_tags_usernames_template.csv\"")
                .contentType(MediaType.TEXT_PLAIN)
                .body(template);
    }
    
    // ========== HEALTH CHECK ==========
    
    /**
     * Health check endpoint
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "Tag Management Service",
                "timestamp", String.valueOf(System.currentTimeMillis())
        ));
    }
}
