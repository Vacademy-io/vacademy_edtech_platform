import { BASE_URL } from '@/constants/urls';

/**
 * Commerce admin endpoints. Every call sends
 * `instituteId` as a query parameter; the server checks it with
 * CommerceAccessGuard (membership, feature, role).
 */
export const COMMERCE_BASE = `${BASE_URL}/admin-core-service/commerce/v1`;

// Staff (CommerceStaffController)
export const COMMERCE_STAFF_LOCATIONS = `${COMMERCE_BASE}/staff/locations`;
export const COMMERCE_STAFF_PIN = `${COMMERCE_BASE}/staff/pin`;

// Catalogue (CommerceProductController, CommerceCollectionController)
export const COMMERCE_PRODUCTS = `${COMMERCE_BASE}/products`;
export const COMMERCE_COLLECTIONS = `${COMMERCE_BASE}/collections`;

// Setup
export const COMMERCE_SETTINGS = `${COMMERCE_BASE}/settings`;
export const COMMERCE_TAX_CLASSES = `${COMMERCE_BASE}/tax-classes`;
export const COMMERCE_TAX_CLASS_BY_ID = (id: string) =>
    `${COMMERCE_TAX_CLASSES}/${encodeURIComponent(id)}`;
export const COMMERCE_LOCATIONS = `${COMMERCE_BASE}/locations`;
export const COMMERCE_LOCATION_BY_ID = (id: string) =>
    `${COMMERCE_LOCATIONS}/${encodeURIComponent(id)}`;

// Catalogue detail (product, variant, attribute, collection and media controllers)
export const COMMERCE_PRODUCT_BY_ID = (id: string) =>
    `${COMMERCE_PRODUCTS}/${encodeURIComponent(id)}`;
export const COMMERCE_PRODUCT_STATUS = (id: string) => `${COMMERCE_PRODUCT_BY_ID(id)}/status`;
export const COMMERCE_ATTRIBUTES = `${COMMERCE_BASE}/attributes`;
export const COMMERCE_ATTRIBUTE_BY_ID = (id: string) =>
    `${COMMERCE_ATTRIBUTES}/${encodeURIComponent(id)}`;
export const COMMERCE_ATTRIBUTE_VALUES = (id: string) => `${COMMERCE_ATTRIBUTE_BY_ID(id)}/values`;
export const COMMERCE_ATTRIBUTE_VALUE_BY_ID = (id: string, valueId: string) =>
    `${COMMERCE_ATTRIBUTE_VALUES(id)}/${encodeURIComponent(valueId)}`;
export const COMMERCE_COLLECTION_TREE = `${COMMERCE_COLLECTIONS}/tree`;
export const COMMERCE_COLLECTION_BY_ID = (id: string) =>
    `${COMMERCE_COLLECTIONS}/${encodeURIComponent(id)}`;
export const COMMERCE_COLLECTION_PRODUCTS = (id: string) =>
    `${COMMERCE_COLLECTION_BY_ID(id)}/products`;
export const COMMERCE_MEDIA = `${COMMERCE_BASE}/media`;
export const COMMERCE_MEDIA_ORDER = `${COMMERCE_MEDIA}/order`;
export const COMMERCE_MEDIA_TAGS = `${COMMERCE_MEDIA}/tags`;
export const COMMERCE_MEDIA_BY_ID = (id: string) => `${COMMERCE_MEDIA}/${encodeURIComponent(id)}`;

// Renditions of gallery images (CommerceRenditionController)
export const COMMERCE_MEDIA_RENDITION_RETRY = (mediaRowId: string) =>
    `${COMMERCE_MEDIA}/renditions/${encodeURIComponent(mediaRowId)}/retry`;

// Import and export (CommerceImportController)
export const COMMERCE_IMPORT = `${COMMERCE_BASE}/import`;
export const COMMERCE_IMPORT_TEMPLATE = `${COMMERCE_IMPORT}/template`;
export const COMMERCE_IMPORT_COLUMNS = `${COMMERCE_IMPORT}/columns`;
export const COMMERCE_IMPORT_ERROR_ROWS = `${COMMERCE_IMPORT}/error-rows`;
export const COMMERCE_IMPORT_JOB = (jobId: string) =>
    `${COMMERCE_IMPORT}/${encodeURIComponent(jobId)}`;
export const COMMERCE_IMPORT_JOB_ERROR_ROWS = (jobId: string) =>
    `${COMMERCE_IMPORT_JOB(jobId)}/error-rows`;
export const COMMERCE_PRODUCTS_EXPORT = `${COMMERCE_PRODUCTS}/export`;

// Order desk (CommerceOrderController, CommerceOrderDeskController, notify controllers)
const id$ = (id: string) => encodeURIComponent(id);
export const COMMERCE_ORDERS = `${COMMERCE_BASE}/orders`;
export const COMMERCE_ORDER_BY_ID = (id: string) => `${COMMERCE_ORDERS}/${id$(id)}`;
export const COMMERCE_ORDER_TRANSITION = (id: string) => `${COMMERCE_ORDER_BY_ID(id)}/transition`;
export const COMMERCE_ORDER_LINE_CANCEL = (id: string, lineId: string) =>
    `${COMMERCE_ORDER_BY_ID(id)}/lines/${id$(lineId)}/cancel`;
export const COMMERCE_ORDER_RECEIPTS = (id: string) => `${COMMERCE_ORDER_BY_ID(id)}/receipts`;
export const COMMERCE_ORDER_STOCK_SHORT_CLEAR = (id: string) =>
    `${COMMERCE_ORDER_BY_ID(id)}/stock-short/clear`;
export const COMMERCE_ORDERS_BULK = `${COMMERCE_ORDERS}/bulk`;
export const COMMERCE_ORDER_NOTIFICATIONS = (id: string) =>
    `${COMMERCE_ORDER_BY_ID(id)}/notifications`;
export const COMMERCE_ORDER_LINKS_REVOKE = (id: string) => `${COMMERCE_ORDER_BY_ID(id)}/links/revoke`;

// Shipments (CommerceShipmentController)
export const COMMERCE_SHIPMENTS = `${COMMERCE_BASE}/shipments`;
export const COMMERCE_SHIPMENT_BY_ID = (id: string) => `${COMMERCE_SHIPMENTS}/${id$(id)}`;
export const COMMERCE_SHIPMENT_SHIP = (id: string) => `${COMMERCE_SHIPMENT_BY_ID(id)}/ship`;
export const COMMERCE_SHIPMENT_STATUS = (id: string) => `${COMMERCE_SHIPMENT_BY_ID(id)}/status`;

// COD remittances (CommerceCodRemittanceController)
export const COMMERCE_COD_REMITTANCES = `${COMMERCE_BASE}/cod/remittances`;
export const COMMERCE_COD_REMITTANCE_BY_ID = (id: string) =>
    `${COMMERCE_COD_REMITTANCES}/${id$(id)}`;

// Returns and refunds (CommerceReturnController, CommerceRefundController)
export const COMMERCE_RETURNS = `${COMMERCE_BASE}/returns`;
export const COMMERCE_RETURN_PREVIEW = `${COMMERCE_RETURNS}/preview`;
export const COMMERCE_RETURN_BY_ID = (id: string) => `${COMMERCE_RETURNS}/${id$(id)}`;
export const COMMERCE_RETURN_APPROVE = (id: string) => `${COMMERCE_RETURN_BY_ID(id)}/approve`;
export const COMMERCE_RETURN_REJECT = (id: string) => `${COMMERCE_RETURN_BY_ID(id)}/reject`;
export const COMMERCE_RETURN_RECEIVE = (id: string) => `${COMMERCE_RETURN_BY_ID(id)}/receive`;
export const COMMERCE_REFUNDS = `${COMMERCE_BASE}/refunds`;
export const COMMERCE_REFUND_BY_ID = (id: string) => `${COMMERCE_REFUNDS}/${id$(id)}`;
export const COMMERCE_REFUND_PAYOUT = (id: string) => `${COMMERCE_REFUND_BY_ID(id)}/record-payout`;
export const COMMERCE_REFUND_CANCEL = (id: string) => `${COMMERCE_REFUND_BY_ID(id)}/cancel`;
export const COMMERCE_REFUND_CHECK = (id: string) => `${COMMERCE_REFUND_BY_ID(id)}/check`;

// Documents (CommerceDocumentController)
export const COMMERCE_INVOICE_PDF = (id: string) => `${COMMERCE_BASE}/invoices/${id$(id)}/pdf`;
export const COMMERCE_INVOICE_REISSUE_B2B = (id: string) =>
    `${COMMERCE_BASE}/invoices/${id$(id)}/reissue-b2b`;
export const COMMERCE_CREDIT_NOTES = `${COMMERCE_BASE}/credit-notes`;
export const COMMERCE_CREDIT_NOTE_PDF = (id: string) => `${COMMERCE_CREDIT_NOTES}/${id$(id)}/pdf`;

// Scan lookup (StockPieceController)
export const COMMERCE_SCAN = (code: string) => `${COMMERCE_BASE}/scan/${id$(code)}`;

// Customers (CommerceCustomerController)
export const COMMERCE_CUSTOMERS = `${COMMERCE_BASE}/customers`;
export const COMMERCE_CUSTOMER_BY_ID = (id: string) => `${COMMERCE_CUSTOMERS}/${id$(id)}`;

// Notification settings (CommerceNotificationSettingsController)
export const COMMERCE_NOTIFICATION_SETTINGS = `${COMMERCE_BASE}/notification-settings`;
export const COMMERCE_NOTIFICATION_TRIGGER = (code: string) =>
    `${COMMERCE_NOTIFICATION_SETTINGS}/triggers/${id$(code)}`;
export const COMMERCE_NOTIFICATION_SHOP = `${COMMERCE_NOTIFICATION_SETTINGS}/shop`;
export const COMMERCE_NOTIFICATION_TEST_SEND = `${COMMERCE_NOTIFICATION_SETTINGS}/test-send`;
export const COMMERCE_NOTIFICATION_WHATSAPP_TEMPLATES = `${COMMERCE_NOTIFICATION_SETTINGS}/whatsapp-templates`;

// Billing counter (PosRegisterController, PosSessionController, PosSaleController,
// PosLookupController, PosSettingsController)
export const COMMERCE_POS = `${COMMERCE_BASE}/pos`;
export const COMMERCE_POS_REGISTERS = `${COMMERCE_POS}/registers`;
export const COMMERCE_POS_REGISTER_BY_ID = (id: string) => `${COMMERCE_POS_REGISTERS}/${id$(id)}`;
export const COMMERCE_POS_REGISTER_SESSION = (id: string) => `${COMMERCE_POS_REGISTER_BY_ID(id)}/session`;
export const COMMERCE_POS_REGISTER_CATALOGUE = (id: string) =>
    `${COMMERCE_POS_REGISTER_BY_ID(id)}/catalogue`;
export const COMMERCE_POS_REGISTER_SCAN = (id: string, code: string) =>
    `${COMMERCE_POS_REGISTER_BY_ID(id)}/scan/${id$(code)}`;
export const COMMERCE_POS_REGISTER_APPROVERS = (id: string) =>
    `${COMMERCE_POS_REGISTER_BY_ID(id)}/approvers`;
export const COMMERCE_POS_SESSIONS = `${COMMERCE_POS}/sessions`;
export const COMMERCE_POS_SESSION_BY_ID = (id: string) => `${COMMERCE_POS_SESSIONS}/${id$(id)}`;
export const COMMERCE_POS_SESSION_SALES = (id: string) => `${COMMERCE_POS_SESSION_BY_ID(id)}/sales`;
export const COMMERCE_POS_SESSION_CASH = (id: string) =>
    `${COMMERCE_POS_SESSION_BY_ID(id)}/cash-movements`;
export const COMMERCE_POS_SESSION_CLOSE = (id: string) => `${COMMERCE_POS_SESSION_BY_ID(id)}/close`;
export const COMMERCE_POS_CUSTOMER_LOOKUP = `${COMMERCE_POS}/customers/lookup`;
export const COMMERCE_POS_QUOTE = `${COMMERCE_POS}/quote`;
export const COMMERCE_POS_SALES = `${COMMERCE_POS}/sales`;
export const COMMERCE_POS_SALES_LOOKUP = `${COMMERCE_POS_SALES}/lookup`;
export const COMMERCE_POS_SALE_BY_ID = (id: string) => `${COMMERCE_POS_SALES}/${id$(id)}`;
export const COMMERCE_POS_SALE_RECEIPT = (id: string) => `${COMMERCE_POS_SALE_BY_ID(id)}/receipt`;
export const COMMERCE_POS_SALE_VOID = (id: string) => `${COMMERCE_POS_SALE_BY_ID(id)}/void`;
export const COMMERCE_POS_TENDER_CHANGE = (orderId: string, tenderId: string) =>
    `${COMMERCE_POS_SALE_BY_ID(orderId)}/tenders/${id$(tenderId)}/change`;
export const COMMERCE_POS_BILL_BOOK = `${COMMERCE_POS}/bill-book-entries`;
export const COMMERCE_POS_RETURNS = `${COMMERCE_POS}/returns`;
export const COMMERCE_POS_RETURN_PREVIEW = `${COMMERCE_POS_RETURNS}/preview`;
export const COMMERCE_POS_SETTINGS = `${COMMERCE_POS}/settings`;

// Document series (CommerceDocumentSeriesController): bill books on the registers page
export const COMMERCE_DOCUMENT_SERIES = `${COMMERCE_BASE}/document-series`;

// Inventory (stock controllers, StockTransferController, StockCountController, StockOverviewController,
// LabelController, CommerceQuickAddController)
export const COMMERCE_STOCK = `${COMMERCE_BASE}/stock`;
export const COMMERCE_STOCK_OVERVIEW = `${COMMERCE_STOCK}/overview`;
export const COMMERCE_STOCK_LOW = `${COMMERCE_STOCK}/low`;
export const COMMERCE_STOCK_VARIANTS = `${COMMERCE_STOCK}/variants`;
export const COMMERCE_STOCK_APPROVERS = `${COMMERCE_STOCK}/approvers`;
export const COMMERCE_STOCK_LEVELS = `${COMMERCE_STOCK}/levels`;
export const COMMERCE_STOCK_REORDER_LEVEL = `${COMMERCE_STOCK_LEVELS}/reorder-level`;
export const COMMERCE_STOCK_ADJUSTMENTS = `${COMMERCE_STOCK}/adjustments`;
export const COMMERCE_STOCK_MOVEMENTS = `${COMMERCE_STOCK}/movements`;
export const COMMERCE_STOCK_MOVEMENTS_EXPORT = `${COMMERCE_STOCK_MOVEMENTS}/export`;
export const COMMERCE_STOCK_RECEIPTS = `${COMMERCE_STOCK}/receipts`;
export const COMMERCE_STOCK_RECEIPT_BY_ID = (id: string) => `${COMMERCE_STOCK_RECEIPTS}/${id$(id)}`;
export const COMMERCE_STOCK_RECEIPT_REVERSE = (id: string) => `${COMMERCE_STOCK_RECEIPT_BY_ID(id)}/reverse`;
export const COMMERCE_STOCK_RECEIPT_COST = (id: string) => `${COMMERCE_STOCK_RECEIPT_BY_ID(id)}/cost`;
export const COMMERCE_STOCK_CHALLAN_SERIES = `${COMMERCE_STOCK}/challan-series`;
export const COMMERCE_STOCK_TRANSFERS = `${COMMERCE_STOCK}/transfers`;
export const COMMERCE_STOCK_TRANSFER_BY_ID = (id: string) => `${COMMERCE_STOCK_TRANSFERS}/${id$(id)}`;
export const COMMERCE_STOCK_TRANSFER_CANCEL = (id: string) => `${COMMERCE_STOCK_TRANSFER_BY_ID(id)}/cancel`;
export const COMMERCE_STOCK_TRANSFER_DISPATCH = (id: string) => `${COMMERCE_STOCK_TRANSFER_BY_ID(id)}/dispatch`;
export const COMMERCE_STOCK_TRANSFER_RECEIVE = (id: string) => `${COMMERCE_STOCK_TRANSFER_BY_ID(id)}/receive`;
export const COMMERCE_STOCK_TRANSFER_CHALLAN = (id: string) =>
    `${COMMERCE_STOCK_TRANSFER_BY_ID(id)}/challan.pdf`;
export const COMMERCE_STOCK_COUNTS = `${COMMERCE_STOCK}/counts`;
export const COMMERCE_STOCK_COUNT_BY_ID = (id: string) => `${COMMERCE_STOCK_COUNTS}/${id$(id)}`;
export const COMMERCE_STOCK_COUNT_LINES = (id: string) => `${COMMERCE_STOCK_COUNT_BY_ID(id)}/lines`;
export const COMMERCE_STOCK_COUNT_LINE = (id: string, lineId: string) =>
    `${COMMERCE_STOCK_COUNT_LINES(id)}/${id$(lineId)}`;
export const COMMERCE_STOCK_COUNT_REVIEW = (id: string) => `${COMMERCE_STOCK_COUNT_BY_ID(id)}/review`;
export const COMMERCE_STOCK_COUNT_POST = (id: string) => `${COMMERCE_STOCK_COUNT_BY_ID(id)}/post`;
export const COMMERCE_STOCK_COUNT_CANCEL = (id: string) => `${COMMERCE_STOCK_COUNT_BY_ID(id)}/cancel`;
export const COMMERCE_LABELS = `${COMMERCE_BASE}/labels`;
export const COMMERCE_LABELS_REQUESTS = `${COMMERCE_LABELS}/requests`;
export const COMMERCE_LABELS_CANCEL = `${COMMERCE_LABELS}/cancel`;
export const COMMERCE_LABELS_PRINT_DATA = `${COMMERCE_LABELS}/print-data`;
export const COMMERCE_LABELS_MARK_PRINTED = `${COMMERCE_LABELS}/mark-printed`;
export const COMMERCE_LABELS_TO_REPLACE = `${COMMERCE_LABELS}/to-replace`;
export const COMMERCE_QUICK_ADD = `${COMMERCE_PRODUCTS}/quick-add`;
