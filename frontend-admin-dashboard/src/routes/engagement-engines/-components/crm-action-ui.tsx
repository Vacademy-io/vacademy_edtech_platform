import type { Icon } from '@phosphor-icons/react';
import { CalendarPlus, NotePencil, PhoneCall, Siren, Tag } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Chip } from './engine-ui';
import type { CrmActionType } from '../-types/actions';

export const CRM_ACTION_ICON: Record<CrmActionType, Icon> = {
    ADD_NOTE: NotePencil,
    CREATE_FOLLOWUP: CalendarPlus,
    ESCALATE: Siren,
    UPDATE_STATUS: Tag,
    SCHEDULE_AI_CALL: PhoneCall,
};

export const CRM_ACTION_TINT: Record<CrmActionType, string> = {
    ADD_NOTE: 'bg-neutral-100 text-neutral-700',
    CREATE_FOLLOWUP: 'bg-primary-50 text-primary-700',
    ESCALATE: 'bg-danger-50 text-danger-600',
    UPDATE_STATUS: 'bg-warning-50 text-warning-700',
    SCHEDULE_AI_CALL: 'bg-info-50 text-info-700',
};

/** The action a CRM task proposes, as a pill: "Follow-up", "Status change", ... */
export function CrmActionChip({ type }: { type: CrmActionType }) {
    const { t } = useTranslation('engagementEnginesActions');
    return <Chip icon={CRM_ACTION_ICON[type]} label={t(`types.${type}.label`)} className={CRM_ACTION_TINT[type]} />;
}
