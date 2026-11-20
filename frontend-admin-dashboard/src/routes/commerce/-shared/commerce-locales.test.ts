/**
 * Acceptance: "every string on these screens exists in Hindi".
 *
 * Three checks over the real files:
 *  1. `commerce.json` has the same keys in English and Hindi, none empty, with
 *     the same {{placeholders}}, and the Hindi is Hindi (Devanagari), not a copy.
 *  2. Every key the commerce code asks for (`t('…')`, with or without a
 *     `commerce:` / `sidebar:` prefix) exists in both languages.
 *  3. The keys built at run time (status labels, checklist items, settings
 *     cards, state names, role labels) exist for every value the code can pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMERCE_NAV } from '@/lib/commerce/commerce-access';
import { RETURN_WARNINGS } from '../orders/-components/dialogs/ReturnCreateDialog';
import { BULK_SHIP_CSV_ERRORS } from '../orders/-shared/bulk-ship-csv';
import { NEW_ORDER_PROBLEM_KEYS } from '../orders/-shared/new-order';
import { CLIENT_ACTION_IDS } from '../orders/-shared/order-actions';
import { ORDER_ERROR_CODES, ORDER_ERROR_FALLBACK_KEYS } from '../orders/-shared/order-errors';
import { QUEUE_DEFINITIONS } from '../orders/-shared/order-queues';
import {
    CONDITIONS,
    ORDER_ACTION_CODES,
    ORDER_CHANNELS,
    ORDER_QUEUES,
    PAYMENT_METHODS,
    REFUND_METHODS,
    RETURN_REASONS,
    RETURN_VIA,
    RTO_REASONS,
    TENDER_MODES,
} from '../orders/-shared/order-types';
import { PACK_REFUSALS } from '../orders/-shared/pack-session';
import { CART_REFUSALS } from '../pos/-shared/pos-cart';
import { POS_ERROR_CODES } from '../pos/-shared/pos-errors';
import { RECEIPT_DOCUMENT_TYPES } from '../pos/-shared/pos-receipt';
import * as catalogue from '../reports/-shared/report-catalogue';
import { REPORT_ERROR_CODES, REPORT_ERROR_FALLBACKS } from '../reports/-shared/report-errors';
import { RANGE_PROBLEMS } from '../reports/-shared/report-search';
import {
    APPROVAL_ACTION_LABELS,
    AUDIT_CHANGE_KEYS,
    AUDIT_KIND_LABELS,
    AUDIT_TABS,
    CHECK_FIGURES,
    CHECK_RULE_REPORTS,
    COUNT_TOTALS,
    GSTR1_TABS,
    MONEY_TOTALS,
    REPORT_VALUE_CODES,
    REPORT_WARNING_CODES,
    VALIDATION_REASONS,
} from '../reports/-shared/report-keys';
import { TENDER_PROBLEMS } from '../pos/-shared/pos-tenders';
import {
    POS_APPROVAL_ACTIONS,
    POS_RETURN_REASONS,
    POS_RETURN_SETTLE,
    REGISTER_SETUP_WARNINGS,
    TENDER_MODES_POS,
} from '../pos/-shared/pos-types';
import { COUNT_REFUSALS } from '../inventory/-shared/count-sheet';
import { INVENTORY_ERROR_CODES } from '../inventory/-shared/inventory-errors';
import {
    ADJUSTMENT_REASONS,
    COUNT_KINDS,
    DAMAGE_REASONS,
    INVENTORY_TABS,
    LABEL_LANGUAGES,
    LABEL_REASONS,
    LABEL_SOURCES,
    LABEL_TEMPLATES,
    MOVEMENT_REASONS,
    MOVEMENT_TYPES,
    QUICK_ADD_KINDS,
    REPRINT_REASONS,
    REVIEW_PIECE_GROUPS,
    SHORTFALL_REASONS,
    TRANSFER_DIRECTIONS,
    TRANSFER_STATUSES,
    TRANSFER_WARNINGS,
    UNCOUNTED_CHOICES,
} from '../inventory/-shared/inventory-types';
import { RECEIVE_REFUSALS } from '../inventory/-shared/receive-lines';
import { TRANSFER_REFUSALS } from '../inventory/-shared/transfer-lines';
import { NAMED_MEDIA_TAGS } from '../products/-components/media-tags';
import {
    DELIVERY_CODES,
    NOTIFICATION_LOCALES,
    NOTIFICATION_TRIGGERS,
    TEMPLATE_SUBMIT_CODES,
    TEST_SEND_CODES,
} from '../settings/-components/notifications-logic';
import { PRODUCT_LOCALES } from './catalogue-types';
import { GST_STATE_CODES } from './gstin';
import { PRODUCT_SERVER_ERROR_KEYS } from './product-errors';
import { BLOCKER_FIELD } from './product-form';
import { COMMERCE_STATUS_MAPS } from './status-maps';

const APP_ROOT = path.resolve(__dirname, '../../../..');
const LOCALES = path.join(APP_ROOT, 'public/locales');
const SCAN_DIRS = [
    path.join(APP_ROOT, 'src/routes/commerce'),
    path.join(APP_ROOT, 'src/lib/commerce'),
];

type Tree = { [key: string]: Tree | string };

const load = (lng: string, ns: string): Tree =>
    JSON.parse(fs.readFileSync(path.join(LOCALES, lng, `${ns}.json`), 'utf8')) as Tree;

const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
    Object.entries(tree).reduce<Record<string, string>>((out, [key, value]) => {
        const full = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') out[full] = value;
        else Object.assign(out, flatten(value, full));
        return out;
    }, {});

const en = flatten(load('en', 'commerce'));
const hi = flatten(load('hi', 'commerce'));
const sidebar = { en: flatten(load('en', 'sidebar')), hi: flatten(load('hi', 'sidebar')) };

const placeholders = (text: string) => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort();
const DEVANAGARI = /[ऀ-ॿ]/;
/** Values that are the same in both languages on purpose: names of things. */
const SAME_IN_BOTH = new Set(['GSTIN', 'PIN', 'HSN', 'GSTR-1']);

const sourceFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });

describe('commerce strings: Hindi is complete', () => {
    it('English and Hindi have exactly the same keys', () => {
        expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
        expect(Object.keys(en).length).toBeGreaterThan(300);
    });

    it('no string is empty and placeholders match', () => {
        Object.keys(en).forEach((key) => {
            expect(en[key]?.trim(), `en ${key}`).toBeTruthy();
            expect(hi[key]?.trim(), `hi ${key}`).toBeTruthy();
            expect(placeholders(hi[key] ?? ''), `placeholders of ${key}`).toEqual(
                placeholders(en[key] ?? '')
            );
        });
    });

    it('every Hindi string is written in Hindi', () => {
        const notHindi = Object.keys(hi).filter(
            (key) => !DEVANAGARI.test(hi[key] ?? '') && !SAME_IN_BOTH.has(hi[key] ?? '')
        );
        expect(notHindi).toEqual([]);
    });

    it('the ten sidebar names and the rail name exist in both languages', () => {
        COMMERCE_NAV.forEach((rule) => {
            expect(sidebar.en[rule.labelKey], `en sidebar ${rule.labelKey}`).toBeTruthy();
            expect(sidebar.hi[rule.labelKey], `hi sidebar ${rule.labelKey}`).toMatch(DEVANAGARI);
        });
        (['en', 'hi', 'fr', 'ar'] as const).forEach((lng) => {
            expect(flatten(load(lng, 'categoryRail'))['categories.commerce']).toBeTruthy();
            expect(
                flatten(load(lng, 'collapsedCategoryFlyout'))['categoryLabels.commerce']
            ).toBeTruthy();
            expect(flatten(load(lng, 'sidebarSearch')).categoryCommerce).toBeTruthy();
            COMMERCE_NAV.forEach((rule) =>
                expect(
                    flatten(load(lng, 'sidebar'))[rule.labelKey],
                    `${lng} ${rule.labelKey}`
                ).toBeTruthy()
            );
        });
    });
});

describe('commerce strings: every key the code asks for exists', () => {
    const literal = /\bt\(\s*'([^'\n]+)'/g;
    const template = /\bt\(\s*`([^`\n]*?)\$\{/g;
    const files = SCAN_DIRS.flatMap(sourceFiles);

    const lookup = (rawKey: string) => {
        if (rawKey.startsWith('sidebar:'))
            return { key: rawKey.slice(8), maps: [sidebar.en, sidebar.hi] };
        if (rawKey.startsWith('categoryRail:')) return null; // checked with the rail above
        // A screen with its own namespace file names it: `commerceParallelRun:title`.
        const own = /^(commerce[A-Z]\w*):/.exec(rawKey)?.[1];
        if (own) {
            return { key: rawKey.slice(own.length + 1), maps: [flatten(load('en', own)), flatten(load('hi', own))] };
        }
        return { key: rawKey.replace(/^commerce:/, ''), maps: [en, hi] };
    };

    it('scans the commerce sources', () => {
        expect(files.length).toBeGreaterThan(25);
    });

    it('literal keys', () => {
        const missing: string[] = [];
        let seen = 0;
        files.forEach((file) => {
            const text = fs.readFileSync(file, 'utf8');
            for (const match of text.matchAll(literal)) {
                const target = lookup(match[1] ?? '');
                if (!target) continue;
                seen += 1;
                if (!target.maps.every((map) => typeof map[target.key] === 'string')) {
                    missing.push(`${path.relative(APP_ROOT, file)}: ${match[1]}`);
                }
            }
        });
        expect(missing).toEqual([]);
        expect(seen).toBeGreaterThan(200);
    });

    it('template keys have their static part', () => {
        const missing: string[] = [];
        files.forEach((file) => {
            const text = fs.readFileSync(file, 'utf8');
            for (const match of text.matchAll(template)) {
                const target = lookup(match[1] ?? '');
                if (!target || target.key === '') continue;
                const prefix = target.key;
                if (
                    !target.maps.every((map) => Object.keys(map).some((k) => k.startsWith(prefix)))
                ) {
                    missing.push(`${path.relative(APP_ROOT, file)}: ${match[1]}…`);
                }
            }
        });
        expect(missing).toEqual([]);
    });

    it('keys built at run time exist for every value', () => {
        const need: string[] = [];
        Object.values(COMMERCE_STATUS_MAPS).forEach((map) =>
            Object.values(map).forEach((meta) => need.push(meta.labelKey))
        );
        GST_STATE_CODES.forEach((code) => need.push(`states.${code}`));
        [
            'business',
            'locations',
            'onlineFulfilment',
            'taxClasses',
            'shipping',
            'payments',
            'documentSeries',
            'labels',
            'staff',
        ].forEach((id) =>
            need.push(`checklist.items.${id}.title`, `checklist.items.${id}.description`)
        );
        [
            'business',
            'taxClasses',
            'locations',
            'staff',
            'registers',
            'shipping',
            'payments',
            'documents',
            'returns',
            'labels',
            'notifications',
            'storefront',
        ].forEach((id) =>
            need.push(`settings.cards.${id}.title`, `settings.cards.${id}.description`)
        );
        COMMERCE_NAV.filter((rule) => rule.id !== 'commerce-home').forEach((rule) =>
            need.push(`home.screens.${rule.id}`)
        );
        ['storeManager', 'warehouseStaff', 'posCashier', 'accountant', 'admin'].forEach((role) =>
            need.push(`roles.${role}`)
        );
        ['REGULAR', 'COMPOSITION', 'UNREGISTERED'].forEach((mode) =>
            need.push(`business.taxModeHelp.${mode}`)
        );
        ['length', 'shape', 'state', 'checksum'].forEach((problem) =>
            need.push(`business.validation.gstin.${problem}`)
        );
        ['NET_UNIT_PRICE', 'LIST_UNIT_PRICE'].forEach((v) => need.push(`business.slabBasis.${v}`));
        ['TAX_EXCLUSIVE', 'TAX_INCLUSIVE'].forEach((v) => need.push(`business.slabCompare.${v}`));
        ['NONE', 'RUPEE'].forEach((v) => need.push(`business.roundTotalTo.${v}`));
        expect(need.filter((key) => !en[key] || !hi[key])).toEqual([]);
    });

    it('catalogue keys built at run time exist for every value', () => {
        const need: string[] = [];
        const each = (prefix: string, values: readonly string[]) =>
            values.forEach((value) => need.push(`${prefix}.${value}`));
        const statuses = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
        each('products.languages', PRODUCT_LOCALES);
        each('products.setStatus', statuses);
        each('products.toast.status', statuses);
        each('products.toast.statusChanged', statuses);
        each('products.editor.statusHelp', statuses);
        each('products.bulk.done', ['ACTIVE', 'ARCHIVED']);
        each('products.stockState', ['OUT_OF_STOCK', 'LOW_STOCK', 'IN_STOCK']);
        each('products.warnings', ['missingHindi', 'missingEnglish', 'missingTaxClass']);
        each('products.blockers', Object.keys(BLOCKER_FIELD));
        each('products.serverErrors', PRODUCT_SERVER_ERROR_KEYS);
        each('products.media.tags', ['none', ...NAMED_MEDIA_TAGS]);
        each('products.variants.policy', ['TRACKED', 'UNTRACKED']);
        ['QUANTITY', 'PIECE', 'MEASURED'].forEach((value) =>
            each(`products.selling.options.${value}`, ['title', 'description'])
        );
        each('attributes.kinds', ['TEXT', 'SWATCH', 'SIZE']);
        each('collections.kinds', ['CATEGORY', 'COLLECTION']);
        each('import.columns', ['row', 'handle', 'field', 'severity', 'message']);
        each('import.guide', ['column', 'level', 'required', 'description', 'example']);
        each('import.guide.levels', ['KEY', 'PRODUCT', 'VARIANT']);
        expect(need.length).toBeGreaterThan(60);
        expect(need.filter((key) => !en[key] || !hi[key])).toEqual([]);
    });

    it('order desk keys built at run time exist for every value', () => {
        const need: string[] = [];
        const each = (prefix: string, values: readonly string[]) =>
            values.forEach((value) => need.push(`${prefix}.${value}`));
        each('orders.queues', ORDER_QUEUES);
        each('orders.empty', ORDER_QUEUES);
        each('orders.actions', [...ORDER_ACTION_CODES, ...CLIENT_ACTION_IDS]);
        each('orders.rto.reasons', RTO_REASONS);
        each('orders.condition', CONDITIONS);
        each('orders.tender', TENDER_MODES);
        each('orders.channel', ORDER_CHANNELS);
        each('orders.paymentMethod', PAYMENT_METHODS);
        each('orders.errors', [...ORDER_ERROR_CODES, ...ORDER_ERROR_FALLBACK_KEYS]);
        each('orders.pack.scan', PACK_REFUSALS);
        each('orders.bulkShip.csvErrors', BULK_SHIP_CSV_ERRORS);
        each(
            'orders.list.columns',
            QUEUE_DEFINITIONS.flatMap((queue) => (queue.extraColumn ? [queue.extraColumn] : []))
        );
        expect(need.length).toBeGreaterThan(120);
        expect(need.filter((key) => !en[key] || !hi[key])).toEqual([]);
    });

    it('returns, refunds, new order and notification keys built at run time exist', () => {
        const need: string[] = [];
        const each = (prefix: string, values: readonly string[]) =>
            values.forEach((value) => need.push(`${prefix}.${value}`));
        each('orders.refund.methods', [...REFUND_METHODS, 'EXCHANGE_CREDIT']);
        each('orders.returns.reasons', RETURN_REASONS);
        each('orders.returns.via', RETURN_VIA);
        each('orders.returns.warnings', RETURN_WARNINGS);
        each('orders.new.problems', NEW_ORDER_PROBLEM_KEYS);
        NOTIFICATION_TRIGGERS.forEach((code) =>
            need.push(`notifications.triggers.${code}.title`, `notifications.triggers.${code}.description`)
        );
        each('notifications.testCodes', TEST_SEND_CODES);
        each('notifications.deliveryCodes', DELIVERY_CODES);
        each('notifications.templates.codes', TEMPLATE_SUBMIT_CODES);
        each('notifications.languages', NOTIFICATION_LOCALES);
        each('notifications.shop.shopName', NOTIFICATION_LOCALES);
        expect(NOTIFICATION_TRIGGERS).toHaveLength(9);
        expect(need.length).toBeGreaterThan(90);
        expect(need.filter((key) => !en[key] || !hi[key])).toEqual([]);
    });

    it('billing counter keys built at run time exist for every value', () => {
        const need: string[] = [];
        const each = (prefix: string, values: readonly string[]) =>
            values.forEach((value) => need.push(`${prefix}.${value}`));
        each('pos.errors', POS_ERROR_CODES);
        // Tender labels reuse the order desk's; "Other" and the exchange credit are the counter's.
        each('orders.tender', TENDER_MODES_POS);
        each('pos.tender', ['OTHER', 'CREDIT_NOTE']);
        each('pos.approval', [...POS_APPROVAL_ACTIONS, 'title', 'generic', 'managersFailed']);
        each('pos.cart', CART_REFUSALS);
        each('pos.pay.problems', TENDER_PROBLEMS);
        each('pos.registers.warnings', REGISTER_SETUP_WARNINGS);
        each('pos.receipt.types', RECEIPT_DOCUMENT_TYPES);
        each('pos.returns.settleOptions', POS_RETURN_SETTLE);
        each('orders.returns.reasons', POS_RETURN_REASONS);
        each('pos.discount.kinds', ['AMOUNT', 'PERCENT']);
        each('pos.length.problems', ['format', 'quantityStep', 'quantityRange']);
        each('pos.registers.problems', ['location', 'code', 'name', 'prefix', 'nextValue']);
        each('pos.billBooks.problems', ['prefix', 'financial_year', 'from', 'to']);
        each('pos.lineMarks', ['PRICE_CHANGED', 'UNAVAILABLE']);
        // Z-report labels.
        each('pos.z', [
            'title', 'opened', 'closed', 'stillOpen', 'sales', 'bills', 'voided', 'billBook', 'discounts',
            'numbers', 'byMode', 'none', 'tax', 'taxRate', 'returns', 'returnCount', 'refund', 'cash', 'openingCash',
        ]);
        expect(need.length).toBeGreaterThan(90);
        expect(need.filter((key) => !en[key] || !hi[key])).toEqual([]);
    });

    it('inventory keys built at run time exist for every value', () => {
        const need: string[] = [];
        const each = (prefix: string, values: readonly string[]) =>
            values.forEach((value) => need.push(`${prefix}.${value}`));
        each('inventory.tabs', INVENTORY_TABS);
        each('inventory.errors', [...INVENTORY_ERROR_CODES, 'uncertain']);
        each('inventory.shortfall', SHORTFALL_REASONS);
        each('inventory.labels.reprintReason', REPRINT_REASONS);
        LABEL_TEMPLATES.forEach((value) => need.push(`inventory.labels.template${value}`));
        each('inventory.labels.languages', LABEL_LANGUAGES);
        each('inventory.labels.reasons', LABEL_REASONS);
        each('inventory.labels.sources', LABEL_SOURCES);
        each('inventory.labels.problems', ['nothing', 'startPosition']);
        UNCOUNTED_CHOICES.forEach((value) => need.push(`inventory.counts.uncounted${value}`));
        each('inventory.reasons', [...ADJUSTMENT_REASONS, ...DAMAGE_REASONS, ...MOVEMENT_REASONS]);
        each('status.movementType', MOVEMENT_TYPES);
        each('status.transfer', TRANSFER_STATUSES);
        each('inventory.transfers.warnings', TRANSFER_WARNINGS);
        each('inventory.transfers.directions', TRANSFER_DIRECTIONS);
        each('inventory.transferLines', TRANSFER_REFUSALS);
        each('inventory.countSheet', COUNT_REFUSALS);
        each('inventory.receive.refusals', RECEIVE_REFUSALS);
        each('inventory.receive.problems', ['source', 'sourcePlace', 'note', 'lines', 'quantities']);
        each('inventory.reprint.problems', ['lines', 'reason', 'note']);
        each('inventory.counts.kinds', COUNT_KINDS);
        each('inventory.review.groups', ['differences', 'agreeing', 'uncounted', ...REVIEW_PIECE_GROUPS]);
        each('inventory.counts.summaryKeys', [
            'lines', 'lines_with_difference', 'units_up', 'units_down', 'missing', 'found', 'misplaced', 'uncounted',
        ]);
        each('inventory.stock.filter', ['ALL', 'LOW', 'OUT']);
        each('inventory.receipt.sources', ['OWN_SOURCE', 'SUPPLIER', 'OPENING', 'OTHER']);
        QUICK_ADD_KINDS.forEach((value) =>
            need.push(`products.selling.options.${value}.title`, `products.selling.options.${value}.description`)
        );
        expect(need.length).toBeGreaterThan(150);
        expect(need.filter((key) => !en[key] || !hi[key])).toEqual([]);
    });

    it('the settings cards in the code are the ones with strings', async () => {
        const { SETTINGS_CARDS } = await import('../settings/-components/settings-cards');
        SETTINGS_CARDS.forEach((card) => {
            expect(en[`settings.cards.${card.id}.title`], card.id).toBeTruthy();
            expect(hi[`settings.cards.${card.id}.title`], card.id).toBeTruthy();
        });
        expect(SETTINGS_CARDS.filter((card) => card.to).map((card) => card.id)).toEqual([
            'business',
            'taxClasses',
            'locations',
            'staff',
            'notifications',
            'registers',
        ]);
        expect(SETTINGS_CARDS.filter((card) => !card.to).map((card) => card.id)).toEqual([
            'shipping',
            'payments',
            'documents',
            'returns',
            'labels',
            'storefront',
        ]);
    });
    it('report and audit log keys built at run time exist for every value (WP-51)', () => {
        const need: string[] = [];
        const each = (prefix: string, values: readonly string[]) =>
            values.forEach((value) => need.push(`${prefix}.${value}`));
        catalogue.REPORT_IDS.forEach((id) =>
            need.push(catalogue.reportTitleKey(id), catalogue.reportHelpKey(id))
        );
        each('reports.groups', catalogue.REPORT_GROUPS);
        each('reports.groupBy', [...catalogue.SALES_GROUP_BY, ...catalogue.PRODUCT_GROUP_BY]);
        each('reports.errors', [...REPORT_ERROR_CODES, ...REPORT_ERROR_FALLBACKS]);
        each('reports.warnings', REPORT_WARNING_CODES);
        each('reports.gstr1.tabs', GSTR1_TABS);
        // Totals beyond the columns: the server's own keys (section headings and column labels are the server's).
        each('reports.totals', [...MONEY_TOTALS, ...COUNT_TOTALS]);
        each('reports.filters.problems', ['order', 'tooLong', 'future', 'futureMonth']);
        each('reports.audit.kinds', AUDIT_KIND_LABELS);
        each('reports.audit.actions', APPROVAL_ACTION_LABELS);
        each('reports.audit.tabs', AUDIT_TABS);
        each('orders.channel', catalogue.REPORT_CHANNELS);
        // Reports fix round: codes in the admin's words, check rules and figures, change keys,
        // the refused-filter sentences, the bill status filter and every filter problem.
        each('reports.values', [...REPORT_VALUE_CODES, ...catalogue.REPORT_STATUSES]);
        each('reports.check.rules', CHECK_RULE_REPORTS);
        each('reports.check.figures', CHECK_FIGURES);
        each('reports.audit.changeKeys', AUDIT_CHANGE_KEYS);
        each('reports.errors.validation', VALIDATION_REASONS);
        each('reports.filters.problems', RANGE_PROBLEMS);
        expect(need.length).toBeGreaterThan(150);
        expect(need.filter((key) => !en[key] || !hi[key])).toEqual([]);
        // Report names as the contract words them (§7.2), Hindi first.
        expect(hi['reports.catalogue.dayBook.title']).toBe('रोज़नामचा');
        expect(en['reports.errors.REPORT_BUSY']).toBe('Another download is running. Try again in a minute.');
    });
});
