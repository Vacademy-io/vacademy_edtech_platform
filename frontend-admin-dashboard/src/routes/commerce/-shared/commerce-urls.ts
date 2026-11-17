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
