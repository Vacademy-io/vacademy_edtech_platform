import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { AccessPassStatus } from '@/services/access-pass';

const STYLE: Record<AccessPassStatus, string> = {
    DRAFT: 'bg-neutral-100 text-neutral-700',
    ACTIVE: 'bg-green-100 text-green-800',
    ARCHIVED: 'bg-amber-100 text-amber-800',
    DELETED: 'bg-red-100 text-red-800',
};

export function AccessPassStatusBadge({ status }: { status: AccessPassStatus }) {
    const { t } = useTranslation('manageAccessPasses');
    const label: Record<AccessPassStatus, string> = {
        DRAFT: t('status.draft', 'Draft'),
        ACTIVE: t('status.active', 'Selling'),
        ARCHIVED: t('status.archived', 'Not selling'),
        DELETED: t('status.deleted', 'Deleted'),
    };
    return (
        <Badge variant="outline" className={STYLE[status] ?? ''}>
            {label[status] ?? status}
        </Badge>
    );
}
