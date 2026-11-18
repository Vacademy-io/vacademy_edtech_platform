import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import { endReceiptPrint, printReceipt, receiptRows } from '../-shared/pos-receipt';
import type { Receipt } from '../-shared/pos-types';
import { usePosLang } from './pos-ui';
import './pos-receipt.css';

/**
 * The 80 mm bill. `printable` puts it in the `.pos-receipt-print` block
 * (hidden on screen, the only thing printed while `body.pos-printing`);
 * without it the same layout is a preview on screen.
 */
export function PosReceipt80({ receipt, printable = false }: { receipt: Receipt; printable?: boolean }) {
    const { t } = useTranslation('commerce');
    const lang = usePosLang();
    const model = receiptRows(receipt, t, lang);
    return (
        <div
            data-testid={printable ? 'pos-receipt-print' : 'pos-receipt-preview'}
            className={cn(
                'flex flex-col gap-2 bg-white text-xs text-black',
                printable ? 'pos-receipt-print hidden print:flex' : 'w-72 rounded-md border border-border p-3'
            )}
        >
            {model.void && (
                <p className="border-2 border-black py-1 text-center text-sm font-medium">{t('pos.receipt.void')}</p>
            )}
            <div className="flex flex-col items-center text-center">
                <p className="text-sm font-medium">{model.shopName}</p>
                {model.shopLines.map((line, index) => (
                    <p key={index}>{line}</p>
                ))}
            </div>
            <div className="flex flex-col border-y border-dashed border-black py-1">
                <p className="text-center text-sm font-medium">{model.title}</p>
                <div className="flex justify-between gap-2">
                    <span>{model.number}</span>
                    <span>{model.when}</span>
                </div>
                {model.register && <p>{t('pos.receipt.counter', { counter: model.register })}</p>}
                {model.paper && <p>{t('pos.receipt.paper')}</p>}
                {model.customer.map((line, index) => (
                    <p key={index}>{line}</p>
                ))}
            </div>
            <div className="flex flex-col gap-1">
                {model.items.map((item, index) => (
                    <div key={index} className="flex flex-col">
                        <p className="font-medium">
                            {item.name}
                            {item.detail ? ` · ${item.detail}` : ''}
                        </p>
                        <div className="flex justify-between gap-2">
                            <span>
                                {item.quantity} × {item.rate}
                            </span>
                            <span className="tabular-nums">{item.amount}</span>
                        </div>
                        {item.discount && <p>{t('pos.receipt.lineDiscount', { amount: item.discount })}</p>}
                        {item.hsn && <p>{item.hsn}</p>}
                    </div>
                ))}
            </div>
            <div className="flex flex-col border-t border-dashed border-black pt-1">
                {[...model.totals.slice(0, -1), ...model.taxRows, ...model.totals.slice(-1)].map((row, index) => (
                    <div
                        key={index}
                        className={cn('flex justify-between gap-2', row.strong && 'text-sm font-medium')}
                    >
                        <span>{row.label}</span>
                        <span className="tabular-nums">{row.value}</span>
                    </div>
                ))}
            </div>
            {model.words && <p>{model.words}</p>}
            {model.tenders.length > 0 && (
                <div className="flex flex-col border-t border-dashed border-black pt-1">
                    {model.tenders.map((row, index) => (
                        <div key={index} className="flex justify-between gap-2">
                            <span>{row.label}</span>
                            <span className="tabular-nums">{row.value}</span>
                        </div>
                    ))}
                </div>
            )}
            {model.qr && (
                <div className="flex justify-center pt-1">
                    <QRCodeSVG value={model.qr} size={96} className="pos-receipt-qr size-24" />
                </div>
            )}
            <p className="text-center">{t('pos.receipt.thanks')}</p>
        </div>
    );
}

/** Renders print-only content straight under <body>, so it prints at the page's top-start. */
export function PrintPortal({ children }: { children: ReactNode }) {
    // Leaving the screen ends a print whose `afterprint` never came (some tablet browsers).
    useEffect(() => () => endReceiptPrint(), []);
    if (typeof document === 'undefined') return null;
    return createPortal(children, document.body);
}

/**
 * Print something on the 80 mm roll on demand (reprint, day report): render
 * it into the print portal, then print once it is on the page.
 */
export function usePrintOnDemand() {
    const [content, setContent] = useState<ReactNode>(null);
    const [ticket, setTicket] = useState(0);
    useEffect(() => {
        if (!ticket) return undefined;
        const timer = setTimeout(() => printReceipt(), 50);
        return () => clearTimeout(timer);
    }, [ticket]);
    const print = useCallback((node: ReactNode) => {
        setContent(node);
        setTicket((n) => n + 1);
    }, []);
    return { print, portal: content ? <PrintPortal>{content}</PrintPortal> : null };
}
