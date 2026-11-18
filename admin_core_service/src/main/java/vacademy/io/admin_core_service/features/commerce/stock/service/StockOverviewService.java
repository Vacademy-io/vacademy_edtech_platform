package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentChannel;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesKind;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApproverDirectory;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Approver;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ApproversAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ChallanSeriesRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Elsewhere;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.LevelCell;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.LowAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.LowRow;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.OverviewAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.OverviewLocation;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.OverviewRow;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.VariantPick;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.VariantsAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ExportRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.LevelAt;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ReferenceLabel;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ReorderRow;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The stock reads of the inventory screens (WP-40): the overview of several locations, low stock,
 * the variant picker stock staff search with (product search is the manager's), the approvers of
 * a location, the challan series, and the movement export. Read-only transactions; no answer
 * carries a cost (the export's unit cost column is for cost viewers only).
 */
@Service
public class StockOverviewService {

    public static final int MAX_LOCATIONS = 8;
    public static final int MAX_PICKS = 30;
    public static final int MAX_EXPORT_ROWS = 10_000;
    public static final int MAX_EXPORT_DAYS = 366;
    private static final int MAX_PAGE_SIZE = 100;
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter EXPORT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final StockOpsReadRepository readRepository;
    private final StockLocationRepository locationRepository;
    private final CommerceApproverDirectory approverDirectory;
    private final CommerceDocumentSeriesRepository seriesRepository;
    private final CommerceDocumentSeriesService seriesService;
    private final TransactionTemplate readOnly;

    public StockOverviewService(StockOpsReadRepository readRepository, StockLocationRepository locationRepository,
                                CommerceApproverDirectory approverDirectory,
                                CommerceDocumentSeriesRepository seriesRepository,
                                CommerceDocumentSeriesService seriesService,
                                PlatformTransactionManager transactionManager) {
        this.readRepository = readRepository;
        this.locationRepository = locationRepository;
        this.approverDirectory = approverDirectory;
        this.seriesRepository = seriesRepository;
        this.seriesService = seriesService;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    // ================================================================== overview

    /**
     * @param locationIds the columns, each already guarded by the caller; empty means the caller's
     *                    visible locations ({@code visible}, null for every location), the first
     *                    eight by code
     */
    public OverviewAnswer overview(String instituteId, List<String> locationIds, Set<String> visible, String q,
                                   String filter, String collectionId, int page, int size) {
        String filterName = filter == null || filter.isBlank() ? "ALL" : filter.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("ALL", "LOW", "OUT").contains(filterName)) {
            throw new InvalidRequestException("VALIDATION: filter is ALL, LOW or OUT");
        }
        if (locationIds.size() > MAX_LOCATIONS) {
            throw new InvalidRequestException("VALIDATION: at most " + MAX_LOCATIONS + " locations at once");
        }
        String text = blankToNull(q);
        if (text != null && text.length() > 64) {
            throw new InvalidRequestException("VALIDATION: q is at most 64 characters");
        }
        String like = text == null ? null : "%" + StockOpsReadRepository.escapeLike(text.toLowerCase(Locale.ROOT)) + "%";
        int pageNo = Math.max(page, 0);
        int pageSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        return readOnly.execute(tx -> {
            List<StockLocation> all = locationRepository.findByInstituteIdOrderByCodeAsc(instituteId);
            List<StockLocation> columns = new ArrayList<>();
            if (locationIds.isEmpty()) {
                for (StockLocation location : all) {
                    if ((visible == null || visible.contains(location.getId())) && columns.size() < MAX_LOCATIONS) {
                        columns.add(location);
                    }
                }
            } else {
                Map<String, StockLocation> byId = new HashMap<>();
                all.forEach(location -> byId.put(location.getId(), location));
                for (String id : locationIds) {
                    StockLocation location = byId.get(id);
                    if (location == null) {
                        throw new InvalidRequestException("LOCATION_NOT_FOUND: a location does not belong to this "
                                + "institute");
                    }
                    columns.add(location);
                }
            }
            List<OverviewLocation> header = columns.stream()
                    .map(l -> new OverviewLocation(l.getId(), l.getCode(), l.getName())).toList();
            List<String> ids = columns.stream().map(StockLocation::getId).toList();
            if (ids.isEmpty()) {
                return new OverviewAnswer(header, List.of(), pageNo, pageSize, 0);
            }
            StockOpsReadRepository.OverviewPage rows = readRepository.overview(instituteId, ids, like, filterName,
                    blankToNull(collectionId), pageNo, pageSize);
            List<String> variants = rows.packageSessionIds();
            Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
            Map<String, Map<String, LevelAt>> levels = new HashMap<>();
            for (LevelAt level : readRepository.levels(instituteId, ids, variants)) {
                levels.computeIfAbsent(level.packageSessionId(), k -> new HashMap<>()).put(level.locationId(), level);
            }
            Map<String, Integer> transit = readRepository.inTransit(instituteId, ids, variants);
            Map<String, Integer> held = readRepository.heldOnline(instituteId, variants);
            boolean online = readRepository.onlineLocationId(instituteId) != null;
            Map<String, Integer> sellable = online ? readRepository.sellableOnline(instituteId, variants) : Map.of();
            List<OverviewRow> out = new ArrayList<>();
            for (String variant : variants) {
                ItemFacts item = facts.get(variant);
                if (item == null) {
                    continue;
                }
                List<LevelCell> cells = new ArrayList<>();
                for (String locationId : ids) {
                    LevelAt level = levels.getOrDefault(variant, Map.of()).get(locationId);
                    int onHand = level == null ? 0 : level.onHand();
                    Integer reorder = level == null ? null : level.reorderLevel();
                    cells.add(new LevelCell(locationId, onHand, reorder, reorder != null && onHand <= reorder));
                }
                out.add(new OverviewRow(variant, item.packageId(), item.sku(), item.productName(), item.variantName(),
                        item.stockMode(), item.unit(), item.qtyScale(), item.labelCode(), cells,
                        transit.getOrDefault(variant, 0), held.getOrDefault(variant, 0),
                        online ? sellable.getOrDefault(variant, 0) : null));
            }
            return new OverviewAnswer(header, out, pageNo, pageSize, rows.total());
        });
    }

    // ================================================================== low stock

    /**
     * REORDER: level rows at the location at or below their reorder level, with the last sale
     * there and up to three other visible places that have the item. OUT_ONLINE: ACTIVE items with
     * nothing left to sell on the website.
     */
    public LowAnswer low(String instituteId, String locationId, String kind, Set<String> visible, int page, int size) {
        String kindName = kind == null || kind.isBlank() ? "REORDER" : kind.trim().toUpperCase(Locale.ROOT);
        int pageNo = Math.max(page, 0);
        int pageSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        if ("OUT_ONLINE".equals(kindName)) {
            return readOnly.execute(tx -> outOnline(instituteId, pageNo, pageSize));
        }
        if (!"REORDER".equals(kindName)) {
            throw new InvalidRequestException("VALIDATION: kind is REORDER or OUT_ONLINE");
        }
        if (blankToNull(locationId) == null) {
            throw new InvalidRequestException("VALIDATION: locationId is required for the reorder list");
        }
        return readOnly.execute(tx -> {
            List<ReorderRow> rows = readRepository.reorderRows(instituteId, locationId, pageNo, pageSize);
            long total = readRepository.countReorderRows(instituteId, locationId);
            List<String> variants = rows.stream().map(ReorderRow::packageSessionId).toList();
            Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
            Map<String, LocalDateTime> lastSale = readRepository.lastSaleAt(instituteId, locationId, variants);
            Map<String, StockLocation> places = new HashMap<>();
            for (StockLocation location : locationRepository.findByInstituteIdOrderByCodeAsc(instituteId)) {
                places.put(location.getId(), location);
            }
            Map<String, List<Elsewhere>> elsewhere = new HashMap<>();
            for (LevelAt level : readRepository.levels(instituteId, visible, variants)) {
                if (level.onHand() > 0 && !locationId.equals(level.locationId()) && places.containsKey(level.locationId())) {
                    elsewhere.computeIfAbsent(level.packageSessionId(), k -> new ArrayList<>())
                            .add(new Elsewhere(level.locationId(), places.get(level.locationId()).getName(),
                                    level.onHand()));
                }
            }
            List<LowRow> out = new ArrayList<>();
            for (ReorderRow row : rows) {
                ItemFacts item = facts.get(row.packageSessionId());
                List<Elsewhere> others = new ArrayList<>(elsewhere.getOrDefault(row.packageSessionId(), List.of()));
                others.sort(Comparator.comparingInt(Elsewhere::onHand).reversed()
                        .thenComparing(Elsewhere::locationName, Comparator.nullsLast(Comparator.naturalOrder())));
                out.add(new LowRow(locationId, row.packageSessionId(), item == null ? null : item.sku(),
                        item == null ? null : item.productName(), item == null ? null : item.variantName(),
                        item == null ? null : item.unit(), item == null ? null : item.qtyScale(), row.onHand(),
                        row.reorderLevel(), row.reorderLevel() - row.onHand(),
                        lastSale.get(row.packageSessionId()) == null ? null
                                : lastSale.get(row.packageSessionId()).toString(),
                        others.size() > 3 ? others.subList(0, 3) : others, null, null, null));
            }
            return new LowAnswer("REORDER", out, pageNo, pageSize, total);
        });
    }

    private LowAnswer outOnline(String instituteId, int page, int size) {
        String online = readRepository.onlineLocationId(instituteId);
        if (online == null) {
            return new LowAnswer("OUT_ONLINE", List.of(), page, size, 0);
        }
        List<String> variants = readRepository.outOnline(instituteId, page, size);
        long total = readRepository.countOutOnline(instituteId);
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
        Map<String, Integer> onHand = readRepository.onHandAt(instituteId, online, variants);
        Map<String, Integer> held = readRepository.heldOnline(instituteId, variants);
        Map<String, Integer> sellable = readRepository.sellableOnline(instituteId, variants);
        List<LowRow> out = new ArrayList<>();
        for (String variant : variants) {
            ItemFacts item = facts.get(variant);
            out.add(new LowRow(online, variant, item == null ? null : item.sku(),
                    item == null ? null : item.productName(), item == null ? null : item.variantName(),
                    item == null ? null : item.unit(), item == null ? null : item.qtyScale(), null, null, null, null,
                    null, onHand.getOrDefault(variant, 0), held.getOrDefault(variant, 0),
                    sellable.getOrDefault(variant, 0)));
        }
        return new LowAnswer("OUT_ONLINE", out, page, size, total);
    }

    // ================================================================== picker, approvers

    public VariantsAnswer variants(String instituteId, String q, String locationId, boolean includeUntracked) {
        String text = blankToNull(q);
        if (text != null && text.length() > 64) {
            throw new InvalidRequestException("VALIDATION: q is 1 to 64 characters");
        }
        return readOnly.execute(tx -> {
            List<String> ids = readRepository.pickVariants(instituteId, text, includeUntracked, MAX_PICKS);
            Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, ids);
            String location = blankToNull(locationId);
            Map<String, Integer> onHand = location == null ? Map.of()
                    : readRepository.onHandAt(instituteId, location, ids);
            List<VariantPick> out = new ArrayList<>();
            for (String id : ids) {
                ItemFacts item = facts.get(id);
                if (item == null) {
                    continue;
                }
                out.add(new VariantPick(id, item.packageId(), item.sku(), item.productName(), item.names(),
                        item.variantName(), item.variantStatus(), item.stockMode(), item.stockPolicy(), item.unit(),
                        item.qtyScale(), item.qtyStep(), item.labelCode(), item.barcode(),
                        location == null ? null : onHand.getOrDefault(id, 0)));
            }
            return new VariantsAnswer(out);
        });
    }

    public ApproversAnswer approvers(String instituteId, String locationId) {
        List<Approver> out = new ArrayList<>();
        for (CommerceApproverDirectory.Approver approver : approverDirectory.approvers(instituteId, locationId)) {
            out.add(new Approver(approver.userId(), approver.fullName()));
        }
        return new ApproversAnswer(out);
    }

    // ================================================================== challan series

    public List<DocumentSeriesDTO> challanSeries(String instituteId) {
        List<String> ids = readOnly.execute(tx -> seriesRepository
                .findByInstituteIdAndDocumentType(instituteId, DocumentType.DELIVERY_CHALLAN.name()).stream()
                .sorted(Comparator.comparing(CommerceDocumentSeries::getFinancialYear).reversed()
                        .thenComparing(CommerceDocumentSeries::getPrefix))
                .map(CommerceDocumentSeries::getId).toList());
        List<DocumentSeriesDTO> out = new ArrayList<>();
        for (String id : ids) {
            out.add(seriesService.get(instituteId, id));
        }
        return out;
    }

    /** A SYSTEM delivery-challan series for every channel; the seller GSTIN is matched by the place. */
    public DocumentSeriesDTO createChallanSeries(String instituteId, String actorUserId, ChallanSeriesRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        DocumentSeriesDTO series = DocumentSeriesDTO.builder()
                .documentType(DocumentType.DELIVERY_CHALLAN.name())
                .kind(SeriesKind.SYSTEM.name())
                .channel(DocumentChannel.ALL.name())
                .prefix(request.prefix())
                .locationId(blankToNull(request.locationId()))
                .nextValue(request.nextValue())
                .financialYear(blankToNull(request.financialYear()))
                .build();
        return seriesService.create(instituteId, actorUserId, series);
    }

    // ================================================================== movement export

    /** The CSV and its file name. */
    public record Export(byte[] csv, String fileName) {
    }

    /**
     * Movements of a date range (India dates, both required, at most 366 days apart), oldest first,
     * at most 10,000 rows. A text cell that starts with {@code = + - @} is prefixed with {@code '}.
     */
    public Export exportMovements(String instituteId, Collection<String> locationIds, String packageSessionId,
                                  String type, LocalDate from, LocalDate to, boolean withCost) {
        if (from == null || to == null) {
            throw new InvalidRequestException("VALIDATION: from and to are required");
        }
        if (to.isBefore(from) || ChronoUnit.DAYS.between(from, to) > MAX_EXPORT_DAYS) {
            throw new InvalidRequestException("VALIDATION: the range is from <= to, at most " + MAX_EXPORT_DAYS
                    + " days");
        }
        String typeName = null;
        if (blankToNull(type) != null) {
            try {
                typeName = StockMovementType.valueOf(type.trim().toUpperCase(Locale.ROOT)).name();
            } catch (IllegalArgumentException e) {
                throw new InvalidRequestException("VALIDATION: type is not a stock movement type");
            }
        }
        // India dates to the stored (JVM-zone) times.
        LocalDateTime fromTime = from.atStartOfDay(INDIA).withZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
        LocalDateTime toTime = to.plusDays(1).atStartOfDay(INDIA).withZoneSameInstant(ZoneId.systemDefault())
                .toLocalDateTime();
        String filterType = typeName;
        String csv = readOnly.execute(tx -> {
            List<ExportRow> rows = readRepository.exportRows(instituteId, locationIds, blankToNull(packageSessionId),
                    filterType, fromTime, toTime, MAX_EXPORT_ROWS + 1);
            if (rows.size() > MAX_EXPORT_ROWS) {
                throw new InvalidRequestException("EXPORT_TOO_LARGE: more than " + MAX_EXPORT_ROWS
                        + " movements; narrow the dates");
            }
            return csv(instituteId, rows, withCost);
        });
        return new Export(csv.getBytes(StandardCharsets.UTF_8), "stock-movements-" + from + "-" + to + ".csv");
    }

    private String csv(String instituteId, List<ExportRow> rows, boolean withCost) {
        Set<String> variants = new HashSet<>();
        Set<String> pieces = new HashSet<>();
        Map<String, Set<String>> references = new HashMap<>();
        for (ExportRow row : rows) {
            variants.add(row.packageSessionId());
            if (row.pieceId() != null) {
                pieces.add(row.pieceId());
            }
            if (row.referenceType() != null && row.referenceId() != null) {
                references.computeIfAbsent(row.referenceType(), k -> new LinkedHashSet<>()).add(row.referenceId());
            }
        }
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId, variants);
        Map<String, ReferenceLabel> labels = readRepository.referenceLabels(instituteId, references, pieces);
        StringBuilder out = new StringBuilder();
        out.append("date_time,location_code,sku,item,piece_code,type,qty_in,qty_out,balance_after,reference,reason,"
                + "note,actor_user_id");
        if (withCost) {
            out.append(",unit_cost");
        }
        out.append("\r\n");
        for (ExportRow row : rows) {
            ItemFacts item = facts.get(row.packageSessionId());
            ReferenceLabel piece = row.pieceId() == null ? null : labels.get("PIECE:" + row.pieceId());
            ReferenceLabel reference = row.referenceType() == null ? null
                    : labels.get(row.referenceType() + ":" + row.referenceId());
            String time = row.createdAt() == null ? "" : row.createdAt().atZone(ZoneId.systemDefault())
                    .withZoneSameInstant(INDIA).format(EXPORT_TIME);
            List<String> cells = new ArrayList<>(List.of(time, nz(row.locationCode()),
                    item == null ? "" : nz(item.sku()), item == null ? "" : nz(item.productName()),
                    piece == null ? "" : nz(piece.label()), nz(row.type()),
                    row.quantityDelta() > 0 ? String.valueOf(row.quantityDelta()) : "",
                    row.quantityDelta() < 0 ? String.valueOf(-row.quantityDelta()) : "",
                    String.valueOf(row.balanceAfter()),
                    reference != null && reference.label() != null ? reference.label() : nz(row.referenceId()),
                    nz(row.reason()), nz(row.note()), nz(row.actorUserId())));
            if (withCost) {
                BigDecimal cost = row.unitCost();
                cells.add(cost == null ? "" : cost.toPlainString());
            }
            for (int i = 0; i < cells.size(); i++) {
                if (i > 0) {
                    out.append(',');
                }
                // Numbers and times are written by this code; only text cells can carry a formula.
                boolean text = i == 1 || i == 2 || i == 3 || i == 4 || i == 9 || i == 10 || i == 11 || i == 12;
                out.append(cell(cells.get(i), text));
            }
            out.append("\r\n");
        }
        return out.toString();
    }

    /**
     * What a spreadsheet may read as the start of a formula (OWASP CSV injection): = + - @, tab and
     * carriage return, and their full-width forms.
     */
    private static final String FORMULA_LEADERS = "=+-@\t\r\uFF1D\uFF0B\uFF0D\uFF20";

    /** A CSV cell: a text that starts like a formula gets a leading quote; quotes doubled. */
    static String cell(String value, boolean text) {
        String v = value == null ? "" : value;
        if (text && !v.isEmpty() && FORMULA_LEADERS.indexOf(v.charAt(0)) >= 0) {
            v = "'" + v;
        }
        if (v.contains(",") || v.contains("\"") || v.contains("\n") || v.contains("\r")) {
            v = "\"" + v.replace("\"", "\"\"") + "\"";
        }
        return v;
    }

    private static String nz(String value) {
        return value == null ? "" : value;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
