/**
 * The bulk "Mark shipped" dialog with a courier CSV: a large export lists only
 * the first problems plus "+N more", an oversized file is refused unread, and a
 * file the parser cannot read says so.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useTranslation: () => ({
        t: (key: string, options?: { count?: number; line?: number }) =>
            options?.count !== undefined
                ? `${key}|${options.count}`
                : options?.line !== undefined
                  ? `${key}|${options.line}`
                  : key,
        i18n: { language: 'en' },
    }),
}));

import { normalizeRow } from '@/routes/commerce/orders/-shared/order-api';
import { BulkShipDialog } from './BulkShipDialog';

const rows = [1, 2].map((n) =>
    normalizeRow({ id: `o-${n}`, order_number: `SO-${n}`, status: 'PACKED', currency: 'INR', total: '100.00' })
);

const renderDialog = () =>
    render(<BulkShipDialog rows={rows} open onOpenChange={() => undefined} onSubmit={async () => undefined} error={null} />);

const upload = (file: File) => {
    const input = screen.getByLabelText('orders.bulkShip.uploadCsv', { selector: 'input' });
    fireEvent.change(input, { target: { files: [file] } });
};

describe('BulkShipDialog CSV', () => {
    it('a courier export of many other orders lists 20 problems and "+N more"', async () => {
        renderDialog();
        const lines = Array.from({ length: 120 }, (_, i) => `SO-X${i},Fast Courier,AWB${i}`);
        upload(new File([`order_number,courier,tracking_number\n${lines.join('\n')}\n`], 'courier.csv'));
        const list = await screen.findByTestId('bulk-ship-csv-problems');
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(21);
        expect(items[0]?.textContent).toBe('orders.bulkShip.csvErrors.notSelected|2');
        expect(items[20]?.textContent).toBe('orders.bulkShip.csvMore|100');
    });

    it('a file over 1 MB is refused without reading it', async () => {
        renderDialog();
        const file = new File(['x'], 'huge.csv');
        Object.defineProperty(file, 'size', { value: 5_000_000 });
        const read = vi.spyOn(file, 'text');
        upload(file);
        await waitFor(() => expect(screen.getByText('orders.bulkShip.csvErrors.tooLarge|0')).toBeTruthy());
        expect(read).not.toHaveBeenCalled();
    });

    it('a file with a broken quote shows "could not be read"', async () => {
        renderDialog();
        upload(new File(['order_number,courier,tracking_number\n"SO-1,Fast Courier,AWB1\n'], 'broken.csv'));
        expect(await screen.findByText('orders.bulkShip.csvErrors.unreadable|2')).toBeTruthy();
    });
});
