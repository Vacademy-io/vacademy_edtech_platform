import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { PlainSelect, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import type { CommerceLocation, TaxMode } from '@/routes/commerce/-shared/commerce-types';
import { useTaxSettings } from '@/routes/commerce/-shared/commerce-hooks';
import { Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { PosErrorNotice } from '@/routes/commerce/pos/-components/pos-ui';
import { useBillBookSeries, useCreateBillBook } from '@/routes/commerce/pos/-shared/pos-hooks';

/** The bill's document type follows the shop's tax mode (§3.5). */
export const DOCUMENT_TYPE_BY_TAX_MODE: Record<TaxMode, string> = {
    REGULAR: 'TAX_INVOICE',
    COMPOSITION: 'BILL_OF_SUPPLY',
    UNREGISTERED: 'INVOICE',
};

const PREFIX = /^[A-Z0-9][A-Z0-9/-]{0,5}$/;
const FY = /^\d{4}(-\d{2})?$/;

export interface BillBookForm {
    prefix: string;
    financial_year: string;
    from: string;
    to: string;
}

export function billBookProblem(form: BillBookForm): keyof BillBookForm | null {
    if (!PREFIX.test(form.prefix)) return 'prefix';
    if (form.financial_year && !FY.test(form.financial_year)) return 'financial_year';
    const from = Number(form.from);
    const to = Number(form.to);
    if (!Number.isInteger(from) || from < 1) return 'from';
    if (!Number.isInteger(to) || to < from || to > 999_999_999) return 'to';
    return null;
}

/**
 * Paper bill books of a location (MANUAL_BOOK series): the number ranges a
 * paper bill keyed at the counter must fall in. Uses the existing
 * `/document-series` route (store manager).
 */
export function BillBooksCard({ locations }: { locations: CommerceLocation[] }) {
    const { t } = useTranslation('commerce');
    const posLocations = locations.filter((l) => l.is_pos_enabled);
    const [locationId, setLocationId] = useState('');
    const [adding, setAdding] = useState(false);
    const series = useBillBookSeries();
    const tax = useTaxSettings();

    useEffect(() => {
        if (!locationId && posLocations[0]) setLocationId(posLocations[0].id);
    }, [locationId, posLocations]);

    const books = (series.data ?? []).filter((s) => s.kind === 'MANUAL_BOOK' && s.location_id === locationId);
    const docType = tax.data?.tax_mode ? DOCUMENT_TYPE_BY_TAX_MODE[tax.data.tax_mode] : null;

    return (
        <SectionCard
            title={t('pos.billBooks.title')}
            description={t('pos.billBooks.description')}
            actions={
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable={!locationId || !docType}
                    onClick={() => setAdding(true)}
                >
                    <Plus size={16} />
                    {t('pos.billBooks.add')}
                </MyButton>
            }
        >
            <PlainSelect
                label={t('pos.registers.location')}
                value={locationId}
                onChange={setLocationId}
                placeholder={t('pos.registers.locationPick')}
                options={posLocations.map((l) => ({ value: l.id, label: l.name }))}
                className="max-w-sm"
            />
            {!docType && tax.isSuccess && <p className="text-caption text-warning-600">{t('pos.billBooks.taxFirst')}</p>}
            {series.isLoading && <CommerceLoadingRows rows={1} />}
            {series.isError && <PosErrorNotice error={series.error} />}
            {series.isSuccess && books.length === 0 && (
                <p className="text-body text-muted-foreground">{t('pos.billBooks.empty')}</p>
            )}
            {books.length > 0 && (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {books.map((book) => (
                        <li key={book.id} className="flex items-center justify-between gap-3 p-3">
                            <span className="flex flex-col">
                                <span className="text-body font-medium text-foreground">
                                    {book.prefix} · {book.financial_year}
                                </span>
                                <span className="text-caption text-muted-foreground">
                                    {t('pos.billBooks.range', { from: book.book_from ?? '—', to: book.book_to ?? '—' })}
                                </span>
                            </span>
                            <CommerceStatusChip kind="location" value={book.status === 'CLOSED' ? 'INACTIVE' : 'ACTIVE'} />
                        </li>
                    ))}
                </ul>
            )}
            {docType && (
                <BillBookDialog
                    open={adding}
                    onOpenChange={setAdding}
                    locationId={locationId}
                    documentType={docType}
                />
            )}
        </SectionCard>
    );
}

function BillBookDialog({
    open,
    onOpenChange,
    locationId,
    documentType,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: string;
    documentType: string;
}) {
    const { t } = useTranslation('commerce');
    const create = useCreateBillBook();
    const [form, setForm] = useState<BillBookForm>({ prefix: '', financial_year: '', from: '', to: '' });
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        if (!open) return;
        setForm({ prefix: '', financial_year: '', from: '', to: '' });
        setTouched(false);
        setError(null);
    }, [open]);

    const problem = billBookProblem(form);
    const save = async () => {
        setTouched(true);
        if (problem) return;
        setError(null);
        try {
            await create.mutateAsync([
                {
                    kind: 'MANUAL_BOOK',
                    document_type: documentType,
                    location_id: locationId,
                    prefix: form.prefix,
                    ...(form.financial_year ? { financial_year: form.financial_year } : {}),
                    book_from: Number(form.from),
                    book_to: Number(form.to),
                },
            ]);
            toast.success(t('pos.billBooks.saved'));
            onOpenChange(false);
        } catch (raw) {
            setError(raw);
        }
    };
    const err = (key: keyof BillBookForm) => (touched && problem === key ? t(`pos.billBooks.problems.${key}`) : null);
    const set = (key: keyof BillBookForm, value: string) => setForm((f) => ({ ...f, [key]: value }));

    return (
        <MyDialog
            heading={t('pos.billBooks.add')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="w-dialog-md"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={save} loadingText={t('common.saving')}>
                        {t('common.save')}
                    </MyButton>
                </div>
            }
        >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('pos.billBooks.prefix')} htmlFor="book-prefix" required error={err('prefix')}>
                    <input
                        id="book-prefix"
                        maxLength={6}
                        className={inputClass}
                        value={form.prefix}
                        onChange={(event) => set('prefix', event.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, ''))}
                    />
                </Field>
                <Field
                    label={t('pos.billBooks.year')}
                    htmlFor="book-year"
                    hint={t('pos.billBooks.yearHint')}
                    error={err('financial_year')}
                >
                    <input
                        id="book-year"
                        maxLength={7}
                        className={inputClass}
                        value={form.financial_year}
                        onChange={(event) => set('financial_year', event.target.value.replace(/[^\d-]/g, ''))}
                    />
                </Field>
                <Field label={t('pos.billBooks.from')} htmlFor="book-from" required error={err('from')}>
                    <input
                        id="book-from"
                        inputMode="numeric"
                        maxLength={9}
                        className={inputClass}
                        value={form.from}
                        onChange={(event) => set('from', event.target.value.replace(/\D/g, ''))}
                    />
                </Field>
                <Field label={t('pos.billBooks.to')} htmlFor="book-to" required error={err('to')}>
                    <input
                        id="book-to"
                        inputMode="numeric"
                        maxLength={9}
                        className={inputClass}
                        value={form.to}
                        onChange={(event) => set('to', event.target.value.replace(/\D/g, ''))}
                    />
                </Field>
            </div>
            <PosErrorNotice error={error} className="mt-3" />
        </MyDialog>
    );
}
