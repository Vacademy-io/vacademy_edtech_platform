package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * A shop's old-site redirects ({@code site_redirect}), for staff:
 * <pre>
 * GET    /commerce/v1/redirects?instituteId=&amp;q=&amp;matchType=&amp;statusCode=&amp;page=0&amp;size=50   a page (size at most 200)
 * POST   /commerce/v1/redirects/import?instituteId=&amp;mode=validate             multipart "file": checks, writes nothing
 * POST   /commerce/v1/redirects/import?instituteId=&amp;mode=commit&amp;commitToken=  writes the validated file in one go
 * POST   /commerce/v1/redirects/commits/{commitId}/undo?instituteId=           takes one commit back in one go
 * DELETE /commerce/v1/redirects/{id}?instituteId=                              removes one row
 * GET    /commerce/v1/redirects/export?instituteId=                            every row as the import's CSV
 * </pre>
 * The file is UTF-8 CSV with the columns {@code from_path,to_path,status_code,match_type}, at
 * most 2 MB and 20,000 rows. Every endpoint is for the store manager (an institute ADMIN always
 * passes) with the catalogue feature, as the product import.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/redirects")
@RequiredArgsConstructor
public class SiteRedirectAdminController {

    static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER);
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SiteRedirectAdminController.class);
    private static final String CSV = "text/csv; charset=UTF-8";

    private final SiteRedirectAdminService service;
    private final CommerceAccessGuard commerceAccessGuard;

    @GetMapping
    public ResponseEntity<SiteRedirectDtos.RedirectPage> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "matchType", required = false) String matchType,
            @RequestParam(value = "statusCode", required = false) Integer statusCode,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(service.list(instituteId, q, matchType, statusCode, page, size));
    }

    /**
     * mode=validate: the plan (rows to create, update, unchanged; errors and warnings by row) and,
     * when there is no error, a commit_token. mode=commit with that token: writes every row or none.
     */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<SiteRedirectDtos.RedirectImportResult> importRedirects(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "mode", defaultValue = "validate") String mode,
            @RequestParam(value = "commitToken", required = false) String commitToken,
            @RequestParam("file") MultipartFile file,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        if ("validate".equalsIgnoreCase(mode)) {
            return ResponseEntity.ok(service.validate(instituteId, file.getOriginalFilename(), bytes(file)));
        }
        if ("commit".equalsIgnoreCase(mode)) {
            return ResponseEntity.ok(service.commit(instituteId, user.getUserId(), file.getOriginalFilename(),
                    bytes(file), commitToken));
        }
        throw new InvalidRequestException("mode must be validate or commit");
    }

    /**
     * Takes back the commit whose {@code commit_id} the commit answered: the rows it created are
     * removed and the rows it changed get their old target and status, every row or none.
     */
    @PostMapping("/commits/{commitId}/undo")
    public ResponseEntity<SiteRedirectDtos.RedirectUndoResult> undo(
            @PathVariable("commitId") String commitId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(service.undo(instituteId, user.getUserId(), commitId));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<SiteRedirectDtos.RedirectRow> delete(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(service.delete(instituteId, user.getUserId(), id));
    }

    /**
     * Every row in the import's columns: the undo baseline before a commit. The export is audited
     * once the file has been sent, with the number of rows it held; a download that fails on the
     * way is not recorded as an export.
     */
    @GetMapping("/export")
    public void export(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user,
            HttpServletResponse response) throws IOException {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        List<SiteRedirectCsv.ExportRow> rows = service.exportRows(instituteId);
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType(CSV);
        response.setHeader(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"redirects-" + LocalDate.now() + ".csv\"");
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        SiteRedirectCsv.write(response.getOutputStream(), rows);
        response.flushBuffer();
        try {
            service.auditExport(instituteId, user.getUserId(), rows.size());
        } catch (RuntimeException e) {
            // The file has been sent and the answer is committed; the failure is logged, not shown.
            log.error("Redirect export sent but its audit row failed", e);
        }
    }

    private static byte[] bytes(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new InvalidRequestException("the file is empty");
        }
        // Checked on the declared size first, so an oversized upload is never read into memory.
        if (file.getSize() > SiteRedirectCsv.MAX_FILE_BYTES) {
            throw SiteRedirectCsv.tooLarge();
        }
        String name = file.getOriginalFilename();
        if (name != null && !name.isBlank() && !name.trim().toLowerCase(Locale.ROOT).endsWith(".csv")) {
            throw new InvalidRequestException("only .csv (UTF-8) files are accepted");
        }
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new InvalidRequestException("the file could not be read");
        }
    }
}
