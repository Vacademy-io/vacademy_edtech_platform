import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { answerColumns } from '../-shared/report-columns';
import { GSTR1_SUB_SECTIONS, GSTR1_TABS } from '../-shared/report-keys';
import type { ReportAnswer, ReportCheck, ReportColumn, ReportSection } from '../-shared/report-types';
import { hasGap } from './DocumentsIssuedView';
import { ReportCheckBlock } from './ReportCheckBlock';
import { ReportTabs } from './ReportTabs';
import { SectionBlock } from './ReportTable';

export { checkAddsUp } from './ReportCheckBlock';

export type Gstr1Tab = (typeof GSTR1_TABS)[number];

const emptySection = (key: string): ReportSection => ({
    key,
    labelEn: null,
    labelHi: null,
    columns: [],
    rows: [],
    totals: null,
});

const isTab = (value: string | undefined): value is Gstr1Tab => !!value && (GSTR1_TABS as readonly string[]).includes(value);

/**
 * GSTR-1 for one GSTIN and month (contract §7.2 `Gstr1View`): one tab per
 * sheet and the check block ("sections = documents"), both from the server.
 * B2C small also shows `b2cs_credit_notes`; Documents also shows
 * `docs_bill_books` (the paper bill books). The page keeps the sheet in the
 * address (`tab`, N6) when it passes `onTab`; on its own the view keeps it.
 */
export function Gstr1View({
    answer,
    tab: tabProp,
    onTab,
}: {
    answer: ReportAnswer;
    tab?: string;
    onTab?: (tab: Gstr1Tab) => void;
}) {
    const { t } = useTranslation('commerce');
    const [ownTab, setOwnTab] = useState<Gstr1Tab>('b2b');
    const tab: Gstr1Tab = onTab ? (isTab(tabProp) ? tabProp : 'b2b') : ownTab;
    const setTab = onTab ?? setOwnTab;
    const byKey = new Map(answer.sections.map((s) => [s.key, s]));
    const section = byKey.get(tab) ?? emptySection(tab);
    const subKey = GSTR1_SUB_SECTIONS[tab];
    const sub = subKey ? byKey.get(subKey) : undefined;
    const all = answerColumns(answer);

    return (
        <div className="flex flex-col gap-4" data-testid="gstr1-view">
            {answer.check && <Gstr1Check check={answer.check} columns={all} />}
            <ReportTabs
                idPrefix="gstr1"
                label={t('reports.catalogue.gstr1.title')}
                active={tab}
                onChange={setTab}
                tabs={GSTR1_TABS.map((id) => ({ id, label: t(`reports.gstr1.tabs.${id}`) }))}
            />
            <div role="tabpanel" id="gstr1-panel" aria-labelledby={`gstr1-tab-${tab}`} className="flex flex-col gap-4">
                <SectionBlock
                    section={section}
                    allColumns={all}
                    rowFlag={tab === 'docs' ? (row) => (hasGap(row) ? t('reports.table.gapRow') : null) : undefined}
                />
                {sub && <SectionBlock section={sub} allColumns={all} />}
            </div>
        </div>
    );
}

/** The GSTR-1 check block (one line per column the server checked); the same block as every report's. */
export function Gstr1Check({ check, columns = [] }: { check: ReportCheck; columns?: ReportColumn[] }) {
    return <ReportCheckBlock check={check} columns={columns} report="gstr1" testId="gstr1-check" />;
}
