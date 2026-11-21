import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Info } from '@phosphor-icons/react';

interface Props {
    nodeType: string;
}

const NODE_TYPES = [
    'TRIGGER', 'QUERY', 'TRANSFORM', 'FILTER', 'AGGREGATE', 'CONDITION', 'LOOP',
    'MERGE', 'DELAY', 'SEND_EMAIL', 'SEND_WHATSAPP', 'SEND_PUSH_NOTIFICATION',
    'HTTP_REQUEST', 'SCHEDULE_TASK', 'UPDATE_RECORD', 'SET_LEAD_STATUS',
] as const;

const buildNodeHelp = (
    t: TFunction
): Record<string, { description: string; example: string; required: string[] }> =>
    Object.fromEntries(
        NODE_TYPES.map((type) => [
            type,
            {
                description: t(`nodes.${type}.description`),
                example: t(`nodes.${type}.example`),
                required: t(`nodes.${type}.required`, { returnObjects: true }) as string[],
            },
        ])
    );

export function NodeHelpTooltip({ nodeType }: Props) {
    const { t } = useTranslation('workflowNodeHelpTooltip');
    const NODE_HELP = buildNodeHelp(t);
    const help = NODE_HELP[nodeType];
    if (!help) return null;

    return (
        <div className="group relative inline-flex">
            <Info size={14} className="text-muted-foreground cursor-help" />
            <div className="invisible group-hover:visible absolute start-6 top-0 z-50 w-64 bg-white border rounded-lg shadow-lg p-3 text-xs">
                <div className="font-medium mb-1">{nodeType.replace(/_/g, ' ')}</div>
                <p className="text-muted-foreground mb-2">{help.description}</p>
                <div className="bg-blue-50 rounded p-1.5 mb-2 text-blue-700">
                    <span className="font-medium">{t('exampleLabel')}</span>
                    {help.example}
                </div>
                {help.required.length > 0 && (
                    <div>
                        <span className="text-muted-foreground">{t('requiredLabel')}</span>
                        {help.required.join(', ')}
                    </div>
                )}
            </div>
        </div>
    );
}
