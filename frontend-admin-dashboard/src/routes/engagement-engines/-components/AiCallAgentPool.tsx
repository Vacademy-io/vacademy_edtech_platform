import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { fetchAgents } from '@/routes/calling/ai-agents/-services/ai-agents';
import { CheckList, type CheckOption } from './CheckList';

/**
 * Pick the AI agents an engine may call with. The engine takes the next agent in turn for each
 * call, so a lead's calls are spread across the pool. Inbound-only and turned-off agents can't
 * place a call and are not listed.
 */
export function AiCallAgentPool({
    instituteId,
    selected,
    onChange,
}: {
    instituteId: string;
    selected: string[];
    onChange: (next: string[]) => void;
}) {
    const { t } = useTranslation('engagementEnginesCreateIndex');
    const {
        data: agents = [],
        isLoading,
        isError,
    } = useQuery({
        queryKey: ['engagement-ai-agents', instituteId],
        queryFn: () => fetchAgents(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    const options: CheckOption[] = agents
        .filter((a) => a.id && a.enabled !== false && a.direction !== 'INBOUND')
        .map((a) => ({
            value: a.id as string,
            label: a.name,
            sub: a.language || undefined,
        }));

    return (
        <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
            <span className="font-medium text-neutral-700">
                <span className="text-body">{t('aiCall.poolTitle')}</span>
            </span>
            <CheckList
                options={options}
                selected={selected}
                onChange={onChange}
                searchPlaceholder={t('aiCall.search')}
                emptyText={t('aiCall.empty')}
                loading={isLoading}
                note={t('aiCall.note')}
            />
            {!isLoading && options.length === 0 && (
                <Link
                    to="/calling/ai-agents"
                    target="_blank"
                    className="text-caption font-medium text-primary-600 hover:text-primary-700"
                >
                    {t('aiCall.create')}
                </Link>
            )}
            {isError && (
                <p className="text-caption text-danger-600" role="alert">
                    {t('aiCall.loadFailed')}
                </p>
            )}
        </div>
    );
}
