package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportColumnResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportJobResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

/**
 * Product import and export.
 *
 * <p>Every endpoint is for the store manager (an institute ADMIN always passes) with the
 * catalogue feature. The institute comes from the guard; a job id is looked up inside it.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1")
@RequiredArgsConstructor
public class CommerceImportController {

    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER);
    private static final String CSV = "text/csv; charset=UTF-8";
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private final CommerceImportService importService;
    private final CommerceCatalogueExportService exportService;
    private final CommerceAccessGuard commerceAccessGuard;

    /**
     * mode=validate checks every row and writes nothing (200, the validation result).
     * mode=commit stores the file and starts the background job (202, the job).
     */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> importProducts(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "mode", defaultValue = "validate") String mode,
            @RequestParam("file") MultipartFile file,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        if ("validate".equalsIgnoreCase(mode)) {
            return ResponseEntity.ok(importService.validate(instituteId, file.getOriginalFilename(), bytes(file)));
        }
        if ("commit".equalsIgnoreCase(mode)) {
            ImportJobResponse job = importService.start(instituteId, user.getUserId(),
                    file.getOriginalFilename(), bytes(file));
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(job);
        }
        throw new InvalidRequestException("mode must be validate or commit");
    }

    /** The rows a commit of this file would leave out, to fix and upload again. Writes nothing. */
    @PostMapping(value = "/import/error-rows", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<byte[]> validationErrorRows(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("file") MultipartFile file,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return download(importService.validationErrorRows(instituteId, file.getOriginalFilename(), bytes(file)),
                "product-import-error-rows.csv", CSV);
    }

    @GetMapping("/import")
    public ResponseEntity<Page<ImportJobResponse>> listJobs(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(importService.list(instituteId, page, size));
    }

    @GetMapping("/import/columns")
    public ResponseEntity<List<ImportColumnResponse>> columns(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(importService.columns());
    }

    @GetMapping("/import/template")
    public ResponseEntity<byte[]> template(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "format", defaultValue = "xlsx") String format,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        boolean xlsx = "xlsx".equalsIgnoreCase(format);
        return download(importService.template(format),
                xlsx ? "product-import-template.xlsx" : "product-import-template.csv", xlsx ? XLSX : CSV);
    }

    @GetMapping("/import/{jobId}")
    public ResponseEntity<ImportJobResponse> job(
            @PathVariable("jobId") String jobId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(importService.get(instituteId, jobId));
    }

    @GetMapping("/import/{jobId}/error-rows")
    public ResponseEntity<byte[]> jobErrorRows(
            @PathVariable("jobId") String jobId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return download(importService.jobErrorRows(instituteId, jobId), "product-import-error-rows.csv", CSV);
    }

    /**
     * The catalogue in the import template, as CSV. Optional filters: status, or packageIds
     * for "export selected". Refused before the first byte when it would pass the row cap.
     */
    @GetMapping("/products/export")
    public void export(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "packageIds", required = false) List<String> packageIds,
            @RequestAttribute("user") CustomUserDetails user,
            HttpServletResponse response) throws IOException {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        CommerceCatalogueExportService.Selection selection = exportService.select(instituteId, status, packageIds);
        exportService.audit(selection, user.getUserId(), status);

        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType(CSV);
        response.setHeader(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"products-" + LocalDate.now() + ".csv\"");
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        exportService.write(selection, response.getOutputStream());
        response.flushBuffer();
    }

    private static byte[] bytes(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new InvalidRequestException("the file is empty");
        }
        // Checked on the declared size first, so an oversized upload is never read into memory.
        if (file.getSize() > ImportLimits.MAX_FILE_BYTES) {
            throw new InvalidRequestException("the file is larger than "
                    + (ImportLimits.MAX_FILE_BYTES / (1024 * 1024)) + " MB; split it into smaller files");
        }
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new InvalidRequestException("the file could not be read");
        }
    }

    private static ResponseEntity<byte[]> download(byte[] content, String fileName, String contentType) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, contentType)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(content);
    }
}
