import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { asRecord, instituteParams, normalizeLocation, num, str } from '@/routes/commerce/-shared/commerce-api';
import {
    COMMERCE_LABELS,
    COMMERCE_LABELS_CANCEL,
    COMMERCE_LABELS_MARK_PRINTED,
    COMMERCE_LABELS_PRINT_DATA,
    COMMERCE_LABELS_REQUESTS,
    COMMERCE_LABELS_TO_REPLACE,
    COMMERCE_LOCATIONS,
    COMMERCE_QUICK_ADD,
    COMMERCE_STOCK_ADJUSTMENTS,
    COMMERCE_STOCK_APPROVERS,
    COMMERCE_STOCK_CHALLAN_SERIES,
    COMMERCE_STOCK_COUNT_BY_ID,
    COMMERCE_STOCK_COUNT_CANCEL,
    COMMERCE_STOCK_COUNT_LINE,
    COMMERCE_STOCK_COUNT_LINE_ACCEPT,
    COMMERCE_STOCK_COUNT_LINES,
    COMMERCE_STOCK_COUNT_POST,
    COMMERCE_STOCK_COUNT_REVIEW,
    COMMERCE_STOCK_COUNTS,
    COMMERCE_STOCK_LOW,
    COMMERCE_STOCK_MOVEMENTS,
    COMMERCE_STOCK_MOVEMENTS_EXPORT,
    COMMERCE_STOCK_OVERVIEW,
    COMMERCE_STOCK_RECEIPT_BY_ID,
    COMMERCE_STOCK_RECEIPT_COST,
    COMMERCE_STOCK_RECEIPT_REVERSE,
    COMMERCE_STOCK_RECEIPTS,
    COMMERCE_STOCK_REORDER_LEVEL,
    COMMERCE_STOCK_TRANSFER_BY_ID,
    COMMERCE_STOCK_TRANSFER_CANCEL,
    COMMERCE_STOCK_TRANSFER_CHALLAN,
    COMMERCE_STOCK_TRANSFER_DISPATCH,
    COMMERCE_STOCK_TRANSFER_RECEIVE,
    COMMERCE_STOCK_TRANSFERS,
    COMMERCE_STOCK_VARIANTS,
} from '@/routes/commerce/-shared/commerce-urls';
import { REVIEW_PIECE_GROUPS } from './inventory-types';
import type {
    AdjustBody,
    Agreement,
    Approver,
    ChallanSeries,
    CountLine,
    CountLineBody,
    CountReview,
    CountRow,
    CountView,
    DispatchBody,
    InventoryLocation,
    ItemFacts,
    LabelPrintData,
    LabelPrintDataBody,
    PrintLabel,
    TextPair,
    LabelRequestBody,
    LabelRow,
    ListPage,
    LowKind,
    LowRow,
    MovementFilters,
    MovementRow,
    OverviewFilter,
    OverviewPage,
    OverviewRow,
    PlaceRef,
    QuickAddAnswer,
    QuickAddBody,
    ReceiptBody,
    ReceiptLine,
    ReceiptView,
    ReceiveTransferBody,
    ReviewPiece,
    ToReplaceRow,
    TransferCreateBody,
    TransferLine,
    TransferRow,
    TransferUpdateBody,
    TransferView,
    UncountedChoice,
    VariantPick,
} from './inventory-types';
import type { ManagerApproval } from '@/routes/commerce/-shared/commerce-types';

/**
 * Inventory services (contract §3–§4): one function per endpoint, no React.
 * Every answer is normalised here (numbers as numbers, lists never absent),
 * so a screen never meets `undefined` or `"12"`. Every call carries the
 * institute; the server guards feature, role and location.
 */

type Rec = Record<string, unknown>;

const get = async (url: string, params: Rec = {}): Promise<unknown> =>
    (await authenticatedAxiosInstance.get<unknown>(url, { params: { ...instituteParams(), ...clean(params) } })).data;
const post = async (url: string, body: unknown): Promise<unknown> =>
    (await authenticatedAxiosInstance.post<unknown>(url, body, { params: instituteParams() })).data;
const put = async (url: string, body: unknown): Promise<unknown> =>
    (await authenticatedAxiosInstance.put<unknown>(url, body, { params: instituteParams() })).data;

/**
 * A file answer (PDF, CSV). When the server refuses, axios hands the error
 * body over as a Blob; it is read back into JSON so the refusal's sentence
 * (`LABEL_NO_PRICE: …`) reaches the screen like any other error.
 */
async function fileRequest(run: () => Promise<{ data: Blob }>): Promise<Blob> {
    try {
        return (await run()).data;
    } catch (error) {
        const response = (error as { response?: { data?: unknown } })?.response;
        if (response && typeof Blob !== 'undefined' && response.data instanceof Blob) {
            try {
                response.data = JSON.parse(await response.data.text()) as unknown;
            } catch {
                // Not JSON: the status alone tells the screen what happened.
            }
        }
        throw error;
    }
}

/** Query parameters without empty values (the server reads "" as a filter). */
function clean(params: Rec): Rec {
    return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

const rec = (value: unknown): Rec => asRecord(value) ?? {};

/**
 * A server time. The stock views send the stored timestamp (UTC, the JVM and
 * database clock) as ISO text without an offset (`2026-11-18T10:15:30.123`);
 * read as is, a browser would take it for local time. `Z` is added when no
 * offset is given; a date alone (`2026-11-18`) is left as it is.
 */
export function utcTime(value: unknown): string | null {
    const text = str(value);
    if (!text) return null;
    return /T\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? `${text}Z` : text;
}
const records = (value: unknown): Rec[] =>
    (Array.isArray(value) ? value : []).map(asRecord).filter((r): r is Rec => !!r);
const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
const int = (value: unknown, fallback = 0): number => num(value) ?? fallback;
const scale = (value: unknown): number => Math.max(1, int(value, 1));

/** A page answered as `{<key>: [...], page, size, total}` or as a Spring page. */
function readPage<T>(data: unknown, key: string, map: (r: Rec) => T | null): ListPage<T> {
    const r = rec(data);
    const list = Array.isArray(data) ? data : (r[key] ?? r.rows ?? r.content);
    const rows = records(list)
        .map(map)
        .filter((row): row is T => row !== null);
    return {
        rows,
        page: num(r.page) ?? num(r.number) ?? 0,
        size: num(r.size) ?? num(r.page_size) ?? rows.length,
        total: num(r.total) ?? num(r.totalElements) ?? num(r.total_elements) ?? rows.length,
    };
}

const item = (r: Rec, id = str(r.package_session_id) ?? ''): ItemFacts => ({
    package_session_id: id,
    sku: str(r.sku),
    product_name: str(r.product_name) ?? str(r.item_name),
    variant_name: str(r.variant_name),
    stock_mode: str(r.stock_mode),
    unit: str(r.unit),
    qty_scale: scale(r.qty_scale),
});

const place = (value: unknown): PlaceRef | null => {
    const r = asRecord(value);
    const id = r && str(r.id);
    if (!r || !id) return null;
    return { id, code: str(r.code), name: str(r.name), gstin: str(r.gstin) };
};

// ─── Places and people ───────────────────────────────────────────────────────

/** Every location with `assigned` for the caller (an admin is assigned to all). */
export async function fetchInventoryLocations(): Promise<InventoryLocation[]> {
    const data = await get(COMMERCE_LOCATIONS);
    const list = Array.isArray(data) ? data : records(rec(data).content);
    return list.flatMap((raw) => {
        const location = normalizeLocation(raw);
        if (!location) return [];
        return [{ ...location, assigned: rec(raw).assigned !== false }];
    });
}

export async function fetchStockApprovers(locationId: string): Promise<Approver[]> {
    const data = await get(COMMERCE_STOCK_APPROVERS, { locationId });
    return records(rec(data).approvers)
        .map((r) => ({ user_id: str(r.user_id) ?? '', full_name: str(r.full_name) ?? '' }))
        .filter((a) => a.user_id);
}

// ─── Items ───────────────────────────────────────────────────────────────────

export function normalizeVariantPick(r: Rec): VariantPick | null {
    const id = str(r.package_session_id);
    if (!id) return null;
    const names = rec(r.names);
    return {
        ...item(r, id),
        product_id: str(r.product_id),
        names: { hi: str(names.hi), en: str(names.en) },
        status: str(r.status),
        stock_policy: str(r.stock_policy),
        qty_step: Math.max(1, int(r.qty_step, 1)),
        label_code: str(r.label_code),
        barcode: str(r.barcode),
        on_hand: num(r.on_hand),
    };
}

export async function searchVariants(params: { q: string; locationId?: string }): Promise<VariantPick[]> {
    const data = await get(COMMERCE_STOCK_VARIANTS, { q: params.q, locationId: params.locationId });
    return records(Array.isArray(data) ? data : rec(data).items)
        .map(normalizeVariantPick)
        .filter((v): v is VariantPick => v !== null);
}

export async function quickAddItem(body: QuickAddBody): Promise<QuickAddAnswer> {
    const r = rec(await post(COMMERCE_QUICK_ADD, body));
    return {
        product_id: str(r.product_id),
        package_session_id: str(r.package_session_id) ?? '',
        sku: str(r.sku),
        // The answer's `name` is the {en?, hi?} map that was sent.
        name: str(r.name) ?? textPair(r.name).en ?? textPair(r.name).hi,
        stock_mode: str(r.stock_mode),
        unit: str(r.unit),
        qty_scale: scale(r.qty_scale),
        status: str(r.status),
    };
}

// ─── Stock ───────────────────────────────────────────────────────────────────

function normalizeOverviewRow(r: Rec): OverviewRow | null {
    const id = str(r.package_session_id);
    if (!id) return null;
    return {
        ...item(r, id),
        product_id: str(r.product_id),
        label_code: str(r.label_code),
        levels: records(r.levels).map((l) => ({
            location_id: str(l.location_id) ?? '',
            on_hand: int(l.on_hand),
            reorder_level: num(l.reorder_level),
            low: l.low === true,
        })),
        in_transit: int(r.in_transit),
        held_online: int(r.held_online),
        sellable_online: num(r.sellable_online),
    };
}

export async function fetchOverview(params: {
    locationIds: string[];
    q?: string;
    filter: OverviewFilter;
    collectionId?: string;
    page: number;
    size: number;
}): Promise<OverviewPage> {
    const data = await get(COMMERCE_STOCK_OVERVIEW, {
        locationIds: params.locationIds.join(','),
        q: params.q,
        filter: params.filter,
        collectionId: params.collectionId,
        page: params.page,
        size: params.size,
    });
    const page = readPage(data, 'rows', normalizeOverviewRow);
    return {
        locations: records(rec(data).locations)
            .map(place)
            .filter((p): p is PlaceRef => p !== null),
        ...page,
    };
}

function normalizeLowRow(r: Rec): LowRow | null {
    const id = str(r.package_session_id);
    if (!id) return null;
    return {
        ...item(r, id),
        location_id: str(r.location_id),
        on_hand: int(r.on_hand ?? r.online_on_hand),
        reorder_level: num(r.reorder_level),
        shortage: int(r.shortage),
        last_sale_at: utcTime(r.last_sale_at),
        elsewhere: records(r.elsewhere).map((e) => ({
            location_id: str(e.location_id) ?? '',
            location_name: str(e.location_name),
            on_hand: int(e.on_hand),
        })),
        online_on_hand: num(r.online_on_hand),
        held_online: num(r.held_online),
        sellable_online: num(r.sellable_online),
    };
}

export async function fetchLowStock(params: {
    locationId: string;
    kind: LowKind;
    page: number;
    size: number;
}): Promise<ListPage<LowRow>> {
    const data = await get(COMMERCE_STOCK_LOW, params);
    return readPage(data, 'rows', normalizeLowRow);
}

export async function adjustStock(body: AdjustBody): Promise<void> {
    await post(COMMERCE_STOCK_ADJUSTMENTS, body);
}

export async function setReorderLevel(body: {
    location_id: string;
    package_session_id: string;
    reorder_level: number | null;
}): Promise<void> {
    await put(COMMERCE_STOCK_REORDER_LEVEL, body);
}

// ─── Movements ───────────────────────────────────────────────────────────────

function normalizeMovement(r: Rec): MovementRow | null {
    const id = str(r.id);
    if (!id) return null;
    const ref = asRecord(r.reference);
    return {
        ...item(r),
        id,
        location_id: str(r.location_id),
        piece_id: str(r.piece_id),
        piece_code: str(r.piece_code),
        type: str(r.type) ?? '',
        quantity_delta: int(r.quantity_delta),
        balance_after: num(r.balance_after),
        reference_type: str(r.reference_type),
        reference_id: str(r.reference_id),
        transfer_id: str(r.transfer_id),
        reference: ref
            ? { type: str(ref.type), id: str(ref.id), label: str(ref.label), order_id: str(ref.order_id) }
            : null,
        reason: str(r.reason),
        note: str(r.note),
        actor_user_id: str(r.actor_user_id),
        created_at: utcTime(r.created_at),
        unit_cost: num(r.unit_cost),
    };
}

export async function fetchMovements(filters: MovementFilters): Promise<ListPage<MovementRow>> {
    const data = await get(COMMERCE_STOCK_MOVEMENTS, { ...filters });
    return readPage(data, 'movements', normalizeMovement);
}

/** The ledger as CSV (`from` and `to` required, at most 366 days). */
export async function exportMovements(filters: Omit<MovementFilters, 'page' | 'size'>): Promise<Blob> {
    return fileRequest(() =>
        authenticatedAxiosInstance.get<Blob>(COMMERCE_STOCK_MOVEMENTS_EXPORT, {
            params: { ...instituteParams(), ...clean({ ...filters }) },
            responseType: 'blob',
        })
    );
}

// ─── Receipts ────────────────────────────────────────────────────────────────

function normalizeReceiptLine(r: Rec): ReceiptLine | null {
    const id = str(r.id);
    if (!id) return null;
    return {
        ...item(r),
        id,
        qty_received: int(r.qty_received),
        note: str(r.note),
        unit_cost: num(r.unit_cost),
        cost_source: str(r.cost_source),
        pieces: records(r.pieces).flatMap((p) => {
            const pieceId = str(p.id);
            const code = str(p.code);
            return pieceId && code ? [{ id: pieceId, code, status: str(p.status), unit_cost: num(p.unit_cost) }] : [];
        }),
    };
}

export function normalizeReceipt(data: unknown): ReceiptView {
    const r = rec(data);
    return {
        id: str(r.id) ?? '',
        receipt_number: str(r.receipt_number),
        location_id: str(r.location_id),
        source_kind: str(r.source_kind),
        source_location_id: str(r.source_location_id),
        received_date: str(r.received_date),
        status: str(r.status),
        bill_status: str(r.bill_status),
        note: str(r.note),
        received_by: str(r.received_by),
        posted_at: utcTime(r.posted_at),
        reversed_at: utcTime(r.reversed_at),
        lines: records(r.lines)
            .map(normalizeReceiptLine)
            .filter((l): l is ReceiptLine => l !== null),
    };
}

export async function fetchReceipts(params: { locationId?: string; page: number; size: number }) {
    const data = await get(COMMERCE_STOCK_RECEIPTS, params);
    return readPage(data, 'receipts', (r) => (str(r.id) ? normalizeReceipt(r) : null));
}

export const fetchReceipt = async (id: string) => normalizeReceipt(await get(COMMERCE_STOCK_RECEIPT_BY_ID(id)));
export const createReceipt = async (body: ReceiptBody) => normalizeReceipt(await post(COMMERCE_STOCK_RECEIPTS, body));
export const reverseReceipt = async (id: string, reason: string) =>
    normalizeReceipt(await post(COMMERCE_STOCK_RECEIPT_REVERSE(id), { reason }));
export async function typeReceiptCost(
    id: string,
    body: { client_request_id: string; lines: { line_id: string; piece_id?: string; unit_cost: string }[] }
): Promise<ReceiptView> {
    const res = await authenticatedAxiosInstance.patch<unknown>(COMMERCE_STOCK_RECEIPT_COST(id), body, {
        params: instituteParams(),
    });
    return normalizeReceipt(res.data);
}

// ─── Transfers ───────────────────────────────────────────────────────────────

function normalizeTransferRow(r: Rec): TransferRow | null {
    const id = str(r.id);
    if (!id) return null;
    return {
        id,
        transfer_number: str(r.transfer_number),
        status: str(r.status) ?? 'DRAFT',
        from: place(r.from),
        to: place(r.to),
        document_number: str(r.document_number),
        line_count: int(r.line_count),
        qty_sent: int(r.qty_sent),
        created_at: utcTime(r.created_at),
        dispatched_at: utcTime(r.dispatched_at),
        received_at: utcTime(r.received_at),
        overdue: r.overdue === true,
    };
}

function normalizeTransferLine(r: Rec): TransferLine | null {
    const id = str(r.id);
    if (!id) return null;
    return {
        ...item(r),
        id,
        item_name: str(r.item_name) ?? str(r.product_name),
        piece_id: str(r.piece_id),
        piece_code: str(r.piece_code),
        qty_sent: int(r.qty_sent),
        qty_received: num(r.qty_received),
        shortfall_reason: str(r.shortfall_reason),
        unit_value: num(r.unit_value),
        line_value: num(r.line_value),
        hsn_code: str(r.hsn_code),
    };
}

export function normalizeTransfer(data: unknown): TransferView {
    const r = rec(data);
    const row = normalizeTransferRow(r);
    const totals = rec(r.totals);
    return {
        id: row?.id ?? '',
        transfer_number: row?.transfer_number ?? null,
        status: row?.status ?? 'DRAFT',
        from: row?.from ?? null,
        to: row?.to ?? null,
        gstin_differs: r.gstin_differs === true,
        document_type: str(r.document_type),
        document_number: str(r.document_number),
        document_date: str(r.document_date),
        eway_bill_no: str(r.eway_bill_no),
        note: str(r.note),
        receive_note: str(r.receive_note),
        created_at: utcTime(r.created_at),
        dispatched_at: utcTime(r.dispatched_at),
        received_at: utcTime(r.received_at),
        cancelled_at: utcTime(r.cancelled_at),
        lines: records(r.lines)
            .map(normalizeTransferLine)
            .filter((l): l is TransferLine => l !== null),
        totals: { qty_sent: int(totals.qty_sent), qty_received: int(totals.qty_received), value: num(totals.value) },
        overdue: r.overdue === true,
        warnings: strings(r.warnings),
        next_actions: strings(r.next_actions),
        sellable_shortfall: records(r.sellable_shortfall).map((s) => ({
            package_session_id: str(s.package_session_id) ?? '',
            units: int(s.units),
        })),
        replayed: r.replayed === true,
    };
}

export async function fetchTransfers(params: {
    status?: string;
    direction?: string;
    locationId?: string;
    page: number;
    size: number;
}): Promise<ListPage<TransferRow>> {
    return readPage(await get(COMMERCE_STOCK_TRANSFERS, params), 'transfers', normalizeTransferRow);
}

export const fetchTransfer = async (id: string) => normalizeTransfer(await get(COMMERCE_STOCK_TRANSFER_BY_ID(id)));
export const createTransfer = async (body: TransferCreateBody) =>
    normalizeTransfer(await post(COMMERCE_STOCK_TRANSFERS, body));
export const updateTransfer = async (id: string, body: TransferUpdateBody) =>
    normalizeTransfer(await put(COMMERCE_STOCK_TRANSFER_BY_ID(id), body));
export const cancelTransfer = async (id: string, body: { client_request_id: string; reason?: string }) =>
    normalizeTransfer(await post(COMMERCE_STOCK_TRANSFER_CANCEL(id), body));
export const dispatchTransfer = async (id: string, body: DispatchBody) =>
    normalizeTransfer(await post(COMMERCE_STOCK_TRANSFER_DISPATCH(id), body));
export const receiveTransfer = async (id: string, body: ReceiveTransferBody) =>
    normalizeTransfer(await post(COMMERCE_STOCK_TRANSFER_RECEIVE(id), body));

export async function fetchChallanPdf(id: string): Promise<Blob> {
    return fileRequest(() =>
        authenticatedAxiosInstance.get<Blob>(COMMERCE_STOCK_TRANSFER_CHALLAN(id), {
            params: instituteParams(),
            responseType: 'blob',
        })
    );
}

function normalizeSeries(r: Rec): ChallanSeries | null {
    const id = str(r.id);
    if (!id) return null;
    return {
        id,
        prefix: str(r.prefix),
        location_id: str(r.location_id),
        financial_year: str(r.financial_year),
        status: str(r.status),
        next_number_preview: str(r.next_number_preview),
    };
}

export async function fetchChallanSeries(): Promise<ChallanSeries[]> {
    const data = await get(COMMERCE_STOCK_CHALLAN_SERIES);
    return records(Array.isArray(data) ? data : (rec(data).series ?? rec(data).content))
        .map(normalizeSeries)
        .filter((s): s is ChallanSeries => s !== null);
}

export async function addChallanSeries(body: { prefix: string; location_id?: string }): Promise<void> {
    await post(COMMERCE_STOCK_CHALLAN_SERIES, body);
}

// ─── Counts ──────────────────────────────────────────────────────────────────

function normalizeCountRow(r: Rec): CountRow | null {
    const id = str(r.id);
    if (!id) return null;
    const location = asRecord(r.location);
    const scope = asRecord(r.scope_collection);
    return {
        id,
        count_number: str(r.count_number),
        kind: str(r.kind) ?? 'COUNT',
        status: str(r.status) ?? 'OPEN',
        location: location && str(location.id) ? { id: str(location.id) as string, name: str(location.name) } : null,
        scope_collection: scope && str(scope.id) ? { id: str(scope.id) as string, name: str(scope.name) } : null,
        started_by: str(r.started_by),
        started_at: utcTime(r.started_at),
        posted_at: utcTime(r.posted_at),
        line_count: int(r.line_count),
        recount_of_count_id: str(r.recount_of_count_id),
    };
}

export function normalizeCountLine(r: Rec): CountLine | null {
    const id = str(r.id);
    if (!id) return null;
    return {
        ...item(r),
        id,
        item_name: str(r.item_name) ?? str(r.product_name),
        piece_id: str(r.piece_id),
        piece_code: str(r.piece_code),
        counted_qty: int(r.counted_qty),
        counted_at: utcTime(r.counted_at),
        counted_by: str(r.counted_by),
    };
}

function normalizeAgreement(value: unknown): Agreement | null {
    const r = asRecord(value);
    if (!r) return null;
    return {
        compared: int(r.compared),
        agreeing: int(r.agreeing),
        percent: num(r.percent) ?? 0,
        passes: r.passes === true,
    };
}

export function normalizeCount(data: unknown): CountView {
    const r = rec(data);
    const row = normalizeCountRow({ ...r, id: str(r.id) ?? '-' }) as CountRow;
    const recount = asRecord(r.recount);
    const lines = records(r.lines)
        .map(normalizeCountLine)
        .filter((l): l is CountLine => l !== null);
    return {
        ...row,
        id: str(r.id) ?? '',
        line_count: num(r.line_count) ?? lines.length,
        recount:
            recount && str(recount.id)
                ? {
                      id: str(recount.id) as string,
                      status: str(recount.status) ?? 'OPEN',
                      agreement: normalizeAgreement(recount.agreement),
                  }
                : null,
        note: str(r.note),
        posted_by: str(r.posted_by),
        uncounted_choice: str(r.uncounted_choice),
        summary: asRecord(r.summary) ?? asRecord(r.summary_json),
        lines,
        next_actions: Array.isArray(r.next_actions) ? strings(r.next_actions) : null,
    };
}

export async function fetchCounts(params: {
    locationId?: string;
    status?: string;
    kind?: string;
    page: number;
    size: number;
}): Promise<ListPage<CountRow>> {
    return readPage(await get(COMMERCE_STOCK_COUNTS, params), 'counts', normalizeCountRow);
}

export const fetchCount = async (id: string) => normalizeCount(await get(COMMERCE_STOCK_COUNT_BY_ID(id)));
export const openCount = async (body: {
    client_request_id: string;
    location_id: string;
    kind?: 'COUNT' | 'RECOUNT';
    scope_collection_id?: string;
    recount_of_count_id?: string;
    note?: string;
}) => normalizeCount(await post(COMMERCE_STOCK_COUNTS, body));

export async function saveCountLines(
    id: string,
    body: { client_request_id: string; lines: CountLineBody[] }
): Promise<{ lines: CountLine[]; line_count: number }> {
    const r = rec(await put(COMMERCE_STOCK_COUNT_LINES(id), body));
    const lines = records(r.lines)
        .map(normalizeCountLine)
        .filter((l): l is CountLine => l !== null);
    return { lines, line_count: num(r.line_count) ?? lines.length };
}

export async function deleteCountLine(id: string, lineId: string): Promise<{ line_count: number }> {
    const res = await authenticatedAxiosInstance.delete<unknown>(COMMERCE_STOCK_COUNT_LINE(id, lineId), {
        params: instituteParams(),
    });
    return { line_count: int(rec(res.data).line_count) };
}

const reviewPiece = (r: Rec): ReviewPiece | null => {
    const id = str(r.piece_id) ?? str(r.id);
    if (!id) return null;
    return {
        piece_id: id,
        code: str(r.code) ?? str(r.piece_code),
        sku: str(r.sku),
        item_name: str(r.item_name),
        status: str(r.status),
        location_name: str(r.location_name),
    };
};

export function normalizeReview(data: unknown): CountReview {
    const r = rec(data);
    const totals = rec(r.totals);
    const pieces = Object.fromEntries(
        REVIEW_PIECE_GROUPS.map((group) => [
            group,
            records(r[group])
                .map(reviewPiece)
                .filter((p): p is ReviewPiece => p !== null),
        ])
    ) as CountReview['pieces'];
    return {
        count_id: str(r.count_id) ?? '',
        as_of: utcTime(r.as_of),
        lines: records(r.lines).flatMap((l) => {
            const lineId = str(l.line_id);
            if (!lineId) return [];
            return [
                {
                    line_id: lineId,
                    package_session_id: str(l.package_session_id) ?? '',
                    sku: str(l.sku),
                    item_name: str(l.item_name) ?? str(l.product_name),
                    variant_name: str(l.variant_name),
                    stock_mode: str(l.stock_mode),
                    piece_code: str(l.piece_code),
                    counted_qty: int(l.counted_qty),
                    counted_at: utcTime(l.counted_at),
                    on_hand_now: int(l.on_hand_now),
                    moved_since: int(l.moved_since),
                    expected_at_count: int(l.expected_at_count),
                    adjustment: int(l.adjustment),
                    value: num(l.value),
                    unit: str(l.unit),
                    qty_scale: scale(l.qty_scale),
                    first_counted_at: utcTime(l.first_counted_at),
                    moved_while_counting: int(l.moved_while_counting),
                    packed_unshipped: int(l.packed_unshipped),
                    flags: strings(l.flags),
                    accepted_by: str(l.accepted_by),
                },
            ];
        }),
        uncounted: records(r.uncounted).map((u) => ({
            package_session_id: str(u.package_session_id) ?? '',
            sku: str(u.sku),
            item_name: str(u.item_name) ?? str(u.product_name),
            variant_name: str(u.variant_name),
            unit: str(u.unit),
            qty_scale: scale(u.qty_scale),
            on_hand_now: int(u.on_hand_now),
        })),
        pieces,
        totals: {
            lines_with_difference: int(totals.lines_with_difference),
            units_up: int(totals.units_up),
            units_down: int(totals.units_down),
            value_up: num(totals.value_up),
            value_down: num(totals.value_down),
        },
        needs_approval: r.needs_approval === true,
        needs_recount: int(r.needs_recount),
        measured_confirm: r.measured_confirm === true,
        fingerprint: str(r.fingerprint),
    };
}

export const fetchCountReview = async (id: string) => normalizeReview(await get(COMMERCE_STOCK_COUNT_REVIEW(id)));
export const postCount = async (
    id: string,
    body: {
        client_request_id: string;
        uncounted?: UncountedChoice;
        approval?: ManagerApproval;
        /** A manager's explicit yes to a large measured difference (left out of the request hash). */
        confirm_measured?: boolean;
        /** The `fingerprint` of the review the person looked at (part of the request hash). */
        review_fingerprint?: string;
    }
) => normalizeCount(await post(COMMERCE_STOCK_COUNT_POST(id), body));

/** A manager accepts a line that changed while it was counted (`counted_qty` = what the manager saw). */
export async function acceptCountLine(
    id: string,
    lineId: string,
    countedQty: number
): Promise<{ lines: CountLine[]; line_count: number }> {
    const r = rec(await post(COMMERCE_STOCK_COUNT_LINE_ACCEPT(id, lineId), { counted_qty: countedQty }));
    const lines = records(r.lines)
        .map(normalizeCountLine)
        .filter((l): l is CountLine => l !== null);
    return { lines, line_count: num(r.line_count) ?? lines.length };
}
export const cancelCount = async (id: string, body: { client_request_id: string; reason?: string }) =>
    normalizeCount(await post(COMMERCE_STOCK_COUNT_CANCEL(id), body));

// ─── Labels ──────────────────────────────────────────────────────────────────

function normalizeLabel(r: Rec): LabelRow | null {
    const id = str(r.id);
    if (!id) return null;
    return {
        id,
        location_id: str(r.location_id),
        package_session_id: str(r.package_session_id) ?? '',
        sku: str(r.sku),
        item_name: str(r.item_name),
        variant_name: str(r.variant_name),
        piece_id: str(r.piece_id),
        piece_code: str(r.piece_code),
        label_code: str(r.label_code),
        quantity: Math.max(1, int(r.quantity, 1)),
        reason: str(r.reason),
        reprint_reason: str(r.reprint_reason),
        note: str(r.note),
        source_type: str(r.source_type),
        source_id: str(r.source_id),
        source_label: str(r.source_label),
        status: str(r.status) ?? 'PENDING',
        created_at: utcTime(r.created_at),
        printed_at: utcTime(r.printed_at),
        has_price: r.has_price !== false,
        stock_mode: str(r.stock_mode),
        unit: str(r.unit),
        qty_scale: scale(r.qty_scale),
    };
}

export async function fetchLabels(params: {
    locationId?: string;
    status?: string;
    sourceType?: string;
    sourceId?: string;
    page: number;
    size: number;
}): Promise<ListPage<LabelRow>> {
    return readPage(await get(COMMERCE_LABELS, params), 'requests', normalizeLabel);
}

export async function requestLabels(body: LabelRequestBody): Promise<LabelRow[]> {
    return records(rec(await post(COMMERCE_LABELS_REQUESTS, body)).requests)
        .map(normalizeLabel)
        .filter((l): l is LabelRow => l !== null);
}

export async function cancelLabels(body: { client_request_id: string; request_ids: string[] }): Promise<number> {
    return int(rec(await post(COMMERCE_LABELS_CANCEL, body)).cancelled);
}

export async function markLabelsPrinted(body: {
    client_request_id: string;
    request_ids: string[];
}): Promise<{ printed: number; skipped: string[] }> {
    const r = rec(await post(COMMERCE_LABELS_MARK_PRINTED, body));
    return { printed: int(r.printed), skipped: strings(r.skipped) };
}

const textPair = (value: unknown): TextPair => {
    if (typeof value === 'string') return { en: str(value), hi: null };
    const r = rec(value);
    return { en: str(r.en), hi: str(r.hi) };
};

function normalizePrintLabel(r: Rec): PrintLabel | null {
    const code = str(r.code);
    if (!code) return null;
    return {
        request_id: str(r.request_id) ?? str(r.id),
        code,
        qr_value: str(r.qr_value) ?? code,
        product_name: textPair(r.product_name ?? r.name),
        variant_name: textPair(r.variant_name),
        // The label shows the MRP (the variant's MRP, else its price), per display unit, tax included.
        price: num(r.mrp) ?? num(r.price),
        currency: str(r.currency) ?? 'INR',
        unit: str(r.unit),
        sku: str(r.sku),
        copies: Math.max(1, int(r.copies ?? r.quantity, 1)),
    };
}

/** What the browser draws for the chosen labels (changes no row). */
export async function fetchLabelPrintData(body: LabelPrintDataBody): Promise<LabelPrintData> {
    const r = rec(await post(COMMERCE_LABELS_PRINT_DATA, body));
    const shop = textPair(r.shop_name);

    const labels = records(r.labels ?? r.items)
        .map(normalizePrintLabel)
        .filter((l): l is PrintLabel => l !== null);
    return {
        shop_name: shop.en ?? shop.hi,
        labels,
        skipped: records(r.skipped).flatMap((x) => {
            const requestId = str(x.request_id);
            return requestId ? [{ request_id: requestId, sku: str(x.sku), reason: str(x.reason) ?? 'NO_PRICE' }] : [];
        }),
        total_copies: num(r.total_copies) ?? labels.reduce((sum, l) => sum + l.copies, 0),
    };
}

export async function fetchLabelsToReplace(locationId: string): Promise<ToReplaceRow[]> {
    return records(rec(await get(COMMERCE_LABELS_TO_REPLACE, { locationId })).rows).flatMap((r) => {
        const id = str(r.package_session_id);
        if (!id) return [];
        return [
            {
                package_session_id: id,
                sku: str(r.sku),
                item_name: str(r.item_name),
                printed_mrp: num(r.printed_mrp),
                current_mrp: num(r.current_mrp),
                on_hand: int(r.on_hand),
                stock_mode: str(r.stock_mode),
                unit: str(r.unit),
                qty_scale: scale(r.qty_scale),
                has_price: r.has_price !== false,
                labels: Math.max(0, int(r.labels, int(r.on_hand))),
                capped: r.capped === true,
            },
        ];
    });
}
