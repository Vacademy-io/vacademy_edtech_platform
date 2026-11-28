import type { ReactNode } from 'react';
import { Lightning, Tray } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { CrmLink } from '@/routes/dashboard/-components/crm/crm-cards';

const LINK_BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-600';

/** The header actions of the daily and weekly pages: the view switch and the links to the inbox and the engines. */
export function DashboardActions({ viewSwitch }: { viewSwitch: ReactNode }) {
    const { t: tCrm } = useTranslation('crmPages');
    return (
        <>
            {viewSwitch}
            <CrmLink href="/engagement-engines/inbox" className={LINK_BTN}>
                <Tray size={14} />
                <span className="text-caption">{tCrm('engageDash.inbox')}</span>
            </CrmLink>
            <CrmLink href="/engagement-engines" className={LINK_BTN}>
                <Lightning size={14} />
                <span className="text-caption">{tCrm('engageDash.engines.all')}</span>
            </CrmLink>
        </>
    );
}
