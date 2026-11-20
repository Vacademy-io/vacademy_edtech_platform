package vacademy.io.admin_core_service.features.commerce.stock.costimport;

import lombok.RequiredArgsConstructor;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * The item-costs import ({@code /commerce/v1/stock/standard-costs/import} and its template).
 * For the store manager and the accountant (an institute ADMIN always passes), with both the
 * inventory and the switch-over feature. Rows are institute-wide: no location.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/stock/standard-costs")
@RequiredArgsConstructor
public class ItemCostImportController {

    static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    private static final String CSV = "text/csv; charset=UTF-8";
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private final ItemCostImportService importService;
    private final CommerceAccessGuard accessGuard;

    /**
     * mode=validate checks every row and writes nothing; mode=commit needs the token validate
     * gave for the same file and sets the costs.
     */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> importCosts(@RequestAttribute("user") CustomUserDetails user,
                                         @RequestParam("instituteId") String instituteId,
                                         @RequestParam(value = "mode", defaultValue = "validate") String mode,
                                         @RequestParam(value = "token", required = false) String token,
                                         @RequestParam("file") MultipartFile file) {
        requireAccess(user, instituteId);
        if ("validate".equalsIgnoreCase(mode)) {
            return ResponseEntity.ok(importService.validate(instituteId, file == null ? null
                    : file.getOriginalFilename(), bytes(file)));
        }
        if ("commit".equalsIgnoreCase(mode)) {
            return ResponseEntity.ok(importService.commit(instituteId, user.getUserId(),
                    file == null ? null : file.getOriginalFilename(), bytes(file), token));
        }
        throw new InvalidRequestException("mode must be validate or commit");
    }

    @GetMapping("/template")
    public ResponseEntity<byte[]> template(@RequestAttribute("user") CustomUserDetails user,
                                           @RequestParam("instituteId") String instituteId,
                                           @RequestParam(value = "format", defaultValue = "xlsx") String format) {
        requireAccess(user, instituteId);
        boolean xlsx = !"csv".equalsIgnoreCase(format);
        if (xlsx && !"xlsx".equalsIgnoreCase(format)) {
            throw new InvalidRequestException("format must be csv or xlsx");
        }
        byte[] content = xlsx ? templateXlsx() : templateCsv();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, xlsx ? XLSX : CSV)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"item-costs-template."
                        + (xlsx ? "xlsx" : "csv") + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(content);
    }

    /** Both features, one per guard call; the role check is the same on each. */
    private void requireAccess(CustomUserDetails user, String instituteId) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, ROLES);
        accessGuard.require(user, instituteId, CommerceFeature.MIGRATION, ROLES);
    }

    private static byte[] bytes(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new InvalidRequestException("the file is empty");
        }
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

    // ─────────────────────────────────────────────────────────────── template

    static final String[][] GUIDE = {
            {"sku", "the item's SKU (or use variant_external_ref)", "TST-0001"},
            {"variant_external_ref", "the item's external ref; used before the SKU when both are filled", ""},
            {"purchase_price", "price paid per selling unit (per metre, kg or litre for goods sold by measure, "
                    + "else per piece), more than 0, at most 4 decimals", "1180"},
            {"includes_tax", "yes if the purchase price includes GST, no if not; required. GST is taken out of "
                    + "the cost only in regular GST mode", "yes"},
            {"gst_rate_percent", "GST rate in percent (0 to 40); required when includes_tax is yes", "18"},
            {"note", "anything; not read", ""},
    };

    static byte[] templateCsv() {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < GUIDE.length; i++) {
            out.append(i == 0 ? "" : ",").append(GUIDE[i][0]);
        }
        out.append("\r\n");
        return out.toString().getBytes(StandardCharsets.UTF_8);
    }

    static byte[] templateXlsx() {
        try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            CellStyle text = workbook.createCellStyle();
            text.setDataFormat(workbook.createDataFormat().getFormat("@"));
            CellStyle head = workbook.createCellStyle();
            Font bold = workbook.createFont();
            bold.setBold(true);
            head.setFont(bold);
            head.setDataFormat(workbook.createDataFormat().getFormat("@"));

            Sheet costs = workbook.createSheet("item_costs");
            Row header = costs.createRow(0);
            for (int i = 0; i < GUIDE.length; i++) {
                // SKU and ref columns as text so a SKU of digits stays as typed.
                if (i < 2) {
                    costs.setDefaultColumnStyle(i, text);
                }
                costs.setColumnWidth(i, 22 * 256);
                Cell cell = header.createCell(i);
                cell.setCellValue(GUIDE[i][0]);
                cell.setCellStyle(head);
            }
            costs.createFreezePane(0, 1);

            Sheet guide = workbook.createSheet("guide");
            String[] titles = {"column", "what to enter", "example"};
            Row guideHeader = guide.createRow(0);
            for (int i = 0; i < titles.length; i++) {
                Cell cell = guideHeader.createCell(i);
                cell.setCellValue(titles[i]);
                cell.setCellStyle(head);
            }
            for (int r = 0; r < GUIDE.length; r++) {
                Row row = guide.createRow(r + 1);
                for (int c = 0; c < GUIDE[r].length; c++) {
                    Cell cell = row.createCell(c);
                    cell.setCellValue(GUIDE[r][c]);
                    cell.setCellStyle(text);
                }
            }
            guide.setColumnWidth(0, 24 * 256);
            guide.setColumnWidth(1, 80 * 256);
            guide.setColumnWidth(2, 16 * 256);
            workbook.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("item-costs template could not be written", e);
        }
    }
}
