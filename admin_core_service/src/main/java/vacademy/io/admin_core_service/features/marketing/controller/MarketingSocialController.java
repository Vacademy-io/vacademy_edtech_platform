package vacademy.io.admin_core_service.features.marketing.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.marketing.dto.AiDraftRequest;
import vacademy.io.admin_core_service.features.marketing.dto.AiDraftResponse;
import vacademy.io.admin_core_service.features.marketing.dto.SocialAccountDTO;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostDTO;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostRequest;
import vacademy.io.admin_core_service.features.marketing.service.SocialAccountService;
import vacademy.io.admin_core_service.features.marketing.service.SocialAiDraftService;
import vacademy.io.admin_core_service.features.marketing.service.SocialPostService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Social accounts and posts (Facebook, Instagram, Google Business Profile, YouTube).
 * Staff may read, write drafts and submit for approval; scheduling, posting, approving,
 * retrying and disconnecting need the institute ADMIN role (never a root-user bypass).
 */
@RestController
@RequestMapping("/admin-core-service/v1/marketing/social")
@RequiredArgsConstructor
public class MarketingSocialController {

    private final InstituteAccessValidator instituteAccessValidator;
    private final SocialAccountService accountService;
    private final SocialPostService postService;
    private final SocialAiDraftService aiDraftService;

    // ── Accounts ─────────────────────────────────────────────────────────────

    @GetMapping("/accounts")
    public ResponseEntity<List<SocialAccountDTO>> listAccounts(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(accountService.listAccounts(instituteId));
    }

    @DeleteMapping("/accounts/{id}")
    public ResponseEntity<Void> disconnectAccount(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        accountService.disconnect(instituteId, id);
        return ResponseEntity.noContent().build();
    }

    // ── Posts ────────────────────────────────────────────────────────────────

    @GetMapping("/posts")
    public ResponseEntity<List<SocialPostDTO>> listPosts(
            @RequestParam String instituteId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String status,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(postService.listPosts(instituteId, from, to, status));
    }

    @GetMapping("/posts/{id}")
    public ResponseEntity<SocialPostDTO> getPost(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(postService.getPost(instituteId, id));
    }

    @PostMapping("/posts")
    public ResponseEntity<SocialPostDTO> createPost(
            @RequestParam String instituteId,
            @RequestBody SocialPostRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        boolean admin = staffAndIsAdmin(user, instituteId);
        return ResponseEntity.ok(postService.create(instituteId, user.getUserId(), admin, request));
    }

    @PutMapping("/posts/{id}")
    public ResponseEntity<SocialPostDTO> updatePost(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestBody SocialPostRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        boolean admin = staffAndIsAdmin(user, instituteId);
        return ResponseEntity.ok(postService.update(instituteId, id, user.getUserId(), admin, request));
    }

    @PostMapping("/posts/ai-draft")
    public ResponseEntity<AiDraftResponse> aiDraft(
            @RequestParam String instituteId,
            @RequestBody AiDraftRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(aiDraftService.draft(instituteId, user.getUserId(), request));
    }

    @PostMapping("/posts/{id}/approve")
    public ResponseEntity<SocialPostDTO> approve(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(postService.approve(instituteId, id, user.getUserId()));
    }

    @PostMapping("/posts/{id}/post-now")
    public ResponseEntity<SocialPostDTO> postNow(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(postService.postNow(instituteId, id, user.getUserId()));
    }

    @PostMapping("/posts/{id}/cancel")
    public ResponseEntity<SocialPostDTO> cancel(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        boolean admin = staffAndIsAdmin(user, instituteId);
        return ResponseEntity.ok(postService.cancel(instituteId, id, user.getUserId(), admin));
    }

    @PostMapping("/posts/{id}/retry")
    public ResponseEntity<SocialPostDTO> retry(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(postService.retry(instituteId, id));
    }

    @DeleteMapping("/posts/{id}")
    public ResponseEntity<Void> deletePost(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        boolean admin = staffAndIsAdmin(user, instituteId);
        postService.delete(instituteId, id, user.getUserId(), admin);
        return ResponseEntity.noContent().build();
    }

    /**
     * Requires institute staff, then reports whether the caller is also an institute ADMIN.
     * Uses requireInstituteAdmin (no root bypass) rather than isInstituteAdmin, whose root-user
     * shortcut would treat every learner as an admin.
     */
    private boolean staffAndIsAdmin(CustomUserDetails user, String instituteId) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        try {
            instituteAccessValidator.requireInstituteAdmin(user, instituteId);
            return true;
        } catch (ForbiddenException | VacademyException e) {
            return false;
        }
    }
}
