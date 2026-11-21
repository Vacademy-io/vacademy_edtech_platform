import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DownloadSimple, FileArrowUp } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { COMMERCE_FEATURE, COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { saveBlob } from '@/lib/save-blob';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceErrorState } from '@/routes/commerce/-components/CommerceStates';
import { blobErrorMessage } from '@/routes/commerce/-shared/catalogue-api';
import { IMPORT_MAX_FILE_BYTES } from '@/routes/commerce/-shared/catalogue-types';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import {
    type ItemCostCommit,
    type ItemCostIssue,
    type ItemCostValidation,
    commitItemCosts,
    downloadItemCostTemplate,
    validateItemCosts,
} from './item-cost-import-api';

const ACCEPT = '.csv,.xlsx';
/**
 * Own namespace (`public/locales/<lng>/commerceItemCosts.json`), not `commerce`;
 * the translator is named `tr` so the `commerce.json` key scan skips these keys.
 * ItemCostImportCard.test.tsx checks them against both languages instead.
 */
export const NS = 'commerceItemCosts';

type Busy = 'template-xlsx' | 'template-csv' | 'validate' | 'commit';

const formatCost = (value: string | null): string => {
    if (value === null) return '—';
    const n = Number(value);
    return Number.isFinite(n)
        ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
        : value;
};

/**
 * Item costs on the product import page: download the template, check a sheet
 * of purchase prices (nothing is written), see its errors, totals and 50 rows
 * to compare with recent bills, then load the costs. Shown only with the
 * switch-over feature on, to the store manager, the accountant and an admin.
 */
export function ItemCostImportCard() {
    const access = useCommerceAccess();
    const visible =
        access.isFeatureOn(COMMERCE_FEATURE.STOCK) &&
        access.isFeatureOn(COMMERCE_FEATURE.MIGRATION) &&
        access.hasAnyRole([COMMERCE_ROLE.STORE_MANAGER, COMMERCE_ROLE.ACCOUNTANT]);
    if (!visible) return null;
    return <ItemCostImportContent />;
}

function ItemCostImportContent() {
    const { t: tr } = useTranslation(NS);
    const fileInput = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState<Busy | null>(null);
    const [validation, setValidation] = useState<ItemCostValidation | null>(null);
    const [result, setResult] = useState<ItemCostCommit | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fail = async (cause: unknown, fallback: string) => {
        const fromBlob = await blobErrorMessage(cause);
        const message = fromBlob ?? readCommerceError(cause, fallback).message;
        setError(message);
        toast.error(message);
    };

    const pick = (picked: File | undefined) => {
        if (!picked) return;
        if (picked.size > IMPORT_MAX_FILE_BYTES) {
            toast.error(tr('errors.tooLarge'));
            return;
        }
        setFile(picked);
        setValidation(null);
        setResult(null);
        setError(null);
    };

    const template = async (format: 'xlsx' | 'csv') => {
        setBusy(format === 'xlsx' ? 'template-xlsx' : 'template-csv');
        setError(null);
        try {
            const downloaded = await downloadItemCostTemplate(format);
            await saveBlob(downloaded.blob, downloaded.filename ?? `item-costs-template.${format}`);
        } catch (cause) {
            await fail(cause, tr('errors.template'));
        } finally {
            setBusy(null);
        }
    };

    const validate = async () => {
        if (!file) return;
        setBusy('validate');
        setError(null);
        setResult(null);
        try {
            setValidation(await validateItemCosts(file));
        } catch (cause) {
            setValidation(null);
            await fail(cause, tr('errors.validate'));
        } finally {
            setBusy(null);
        }
    };

    const load = async () => {
        if (!file || !validation) return;
        setBusy('commit');
        setError(null);
        try {
            const done = await commitItemCosts(file, validation.token);
            setResult(done);
            toast.success(tr('result.toast', { count: done.changed }));
        } catch (cause) {
            await fail(cause, tr('errors.commit'));
        } finally {
            setBusy(null);
        }
    };

    const canLoad =
        !!validation && validation.error_count === 0 && validation.ok > 0 && !result && busy === null;

    return (
        <SectionCard
            title={tr('title')}
            description={tr('description')}
            actions={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        disable={busy !== null}
                        onClick={() => void template('xlsx')}
                    >
                        <DownloadSimple size={14} />
                        {tr('templateXlsx')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        disable={busy !== null}
                        onClick={() => void template('csv')}
                    >
                        <DownloadSimple size={14} />
                        {tr('templateCsv')}
                    </MyButton>
                </>
            }
        >
            <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="hidden"
                data-testid="item-costs-file"
                onChange={(event) => {
                    pick(event.target.files?.[0]);
                    event.target.value = '';
                }}
            />
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4 sm:flex-row sm:items-center">
                <FileArrowUp size={28} className="shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body text-foreground">
                        {file ? file.name : tr('noFile')}
                    </span>
                    <span className="text-caption text-muted-foreground">{tr('fileHint')}</span>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    type="button"
                    disable={busy !== null}
                    onClick={() => fileInput.current?.click()}
                >
                    {file ? tr('changeFile') : tr('chooseFile')}
                </MyButton>
                <MyButton
                    buttonType={validation ? 'secondary' : 'primary'}
                    scale="medium"
                    type="button"
                    disable={!file || busy !== null}
                    onClick={() => void validate()}
                >
                    {busy === 'validate' ? tr('validating') : tr('validate')}
                </MyButton>
            </div>
            <ul className="flex list-disc flex-col gap-1 ps-5 text-caption text-muted-foreground">
                <li>{tr('rules.includesTax')}</li>
                <li>{tr('rules.unit')}</li>
                <li>{tr('rules.match')}</li>
                <li>{tr('rules.repeat')}</li>
            </ul>

            {validation && (
                <div className="flex flex-col gap-4" data-testid="item-costs-validation">
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Tile label={tr('totals.toChange')} value={String(validation.to_change)} />
                        <Tile label={tr('totals.unchanged')} value={String(validation.unchanged)} />
                        <Tile label={tr('totals.sumOld')} value={formatCost(validation.sum_old)} />
                        <Tile label={tr('totals.sumNew')} value={formatCost(validation.sum_new)} />
                    </dl>
                    <p className="text-caption text-muted-foreground">
                        {tr('summary', {
                            rows: validation.rows,
                            ok: validation.ok,
                            errors: validation.error_count,
                            warnings: validation.warning_count,
                        })}
                    </p>
                    {validation.tax_rule && (
                        <p className="text-caption text-foreground" data-testid="item-costs-tax-rule">
                            {tr(`taxRule.${validation.tax_rule}`)}
                        </p>
                    )}
                    {validation.missing_after.count > 0 && (
                        <p className="text-caption text-muted-foreground">
                            {tr('missingAfter', {
                                count: validation.missing_after.count,
                                skus: validation.missing_after.skus.slice(0, 10).join(', '),
                            })}
                        </p>
                    )}
                    <Issues
                        title={tr('errorsTitle', { count: validation.error_count })}
                        issues={validation.errors}
                        more={validation.error_count > validation.errors.length}
                        testId="item-costs-errors"
                    />
                    <Issues
                        title={tr('warningsTitle', { count: validation.warning_count })}
                        issues={validation.warnings}
                        more={validation.warning_count > validation.warnings.length}
                        testId="item-costs-warnings"
                    />
                    <SpotCheck validation={validation} />
                    <div className="flex flex-wrap items-center gap-3">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            type="button"
                            disable={!canLoad}
                            onClick={() => void load()}
                            data-testid="item-costs-load"
                        >
                            {busy === 'commit' ? tr('loading') : tr('load')}
                        </MyButton>
                        {validation.error_count > 0 && (
                            <span className="text-caption text-danger-600">{tr('fixErrorsFirst')}</span>
                        )}
                    </div>
                </div>
            )}

            {result && (
                <p className="text-body text-foreground" data-testid="item-costs-result">
                    {tr('result.summary', {
                        changed: result.changed,
                        alreadyDone: result.already_done,
                        unchanged: result.unchanged,
                    })}
                </p>
            )}

            {error && <CommerceErrorState message={error} />}
        </SectionCard>
    );
}

function Tile({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col rounded-lg border border-border p-3">
            <dt className="text-caption text-muted-foreground">{label}</dt>
            <dd className="text-h3 font-medium tabular-nums text-foreground">{value}</dd>
        </div>
    );
}

function Issues({
    title,
    issues,
    more,
    testId,
}: {
    title: string;
    issues: ItemCostIssue[];
    more: boolean;
    testId: string;
}) {
    const { t: tr } = useTranslation(NS);
    if (issues.length === 0) return null;
    return (
        <div className="flex flex-col gap-2" data-testid={testId}>
            <p className="text-body font-medium text-foreground">{title}</p>
            <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-start text-caption">
                    <thead className="bg-muted text-muted-foreground">
                        <tr>
                            {(['row', 'item', 'column', 'code', 'message'] as const).map((column) => (
                                <th
                                    key={column}
                                    scope="col"
                                    className="whitespace-nowrap p-2 text-start font-medium"
                                >
                                    {tr(`columns.${column}`)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {issues.map((issue, index) => (
                            <tr key={index} className="border-t border-border align-top">
                                <td className="p-2 tabular-nums text-foreground">{issue.row}</td>
                                <td className="p-2 font-mono text-foreground">{issue.sku ?? '—'}</td>
                                <td className="p-2 font-mono text-foreground">{issue.column ?? '—'}</td>
                                <td className="p-2 font-mono text-foreground">{issue.code}</td>
                                {/* The server's own text: English until it sends Hindi. */}
                                <td className="p-2 text-foreground" lang="en">
                                    {issue.message}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {more && (
                <p className="text-caption text-muted-foreground">
                    {tr('moreIssues', { shown: issues.length })}
                </p>
            )}
        </div>
    );
}

function SpotCheck({ validation }: { validation: ItemCostValidation }) {
    const { t: tr } = useTranslation(NS);
    if (validation.spot_check.length === 0) return null;
    return (
        <details className="rounded-lg border border-border" open>
            <summary className="cursor-pointer p-3 text-body text-foreground">
                {tr('spotCheck.title', { count: validation.spot_check.length })}
            </summary>
            <p className="px-3 pb-2 text-caption text-muted-foreground">{tr('spotCheck.hint')}</p>
            <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-start text-caption" data-testid="item-costs-spot-check">
                    <thead className="bg-muted text-muted-foreground">
                        <tr>
                            {(
                                [
                                    'row',
                                    'sku',
                                    'name',
                                    'price',
                                    'includesTax',
                                    'rate',
                                    'costPerUnit',
                                    'cost',
                                    'current',
                                ] as const
                            ).map((column) => (
                                <th
                                    key={column}
                                    scope="col"
                                    className="whitespace-nowrap p-2 text-start font-medium"
                                >
                                    {tr(`spotCheck.columns.${column}`)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {validation.spot_check.map((row) => (
                            <tr key={row.row} className="border-t border-border align-top">
                                <td className="p-2 tabular-nums text-foreground">{row.row}</td>
                                <td className="p-2 font-mono text-foreground">{row.sku}</td>
                                <td className="p-2 text-foreground">{row.name}</td>
                                <td className="p-2 tabular-nums text-foreground">{formatCost(row.price)}</td>
                                <td className="p-2 text-foreground">
                                    {row.includes_tax ? tr('yes') : tr('no')}
                                </td>
                                <td className="p-2 tabular-nums text-foreground">
                                    {row.rate === null ? '—' : `${row.rate}%`}
                                </td>
                                <td className="p-2 tabular-nums text-foreground">
                                    {formatCost(row.cost_per_unit)}
                                </td>
                                <td className="p-2 tabular-nums font-medium text-foreground">
                                    {formatCost(row.cost)}
                                    {row.qty_scale > 1 && (
                                        <span className="block text-muted-foreground">
                                            {tr('spotCheck.perBaseUnit', {
                                                scale: row.qty_scale,
                                                unit: row.unit ?? '',
                                            })}
                                        </span>
                                    )}
                                </td>
                                <td className="p-2 tabular-nums text-muted-foreground">
                                    {formatCost(row.current_cost)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    );
}
