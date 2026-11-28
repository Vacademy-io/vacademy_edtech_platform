import { useEffect, useState } from 'react';
import { Lightning, Warning, ArrowClockwise } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
    fetchChatbotFlowAiUsage,
    fetchChatbotFlowAiLogs,
    FlowAiUsageSummary,
    FlowAiUsageLogRow,
} from '../-services/chatbot-flow-api';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [7, 30, 90];

const fmtCredits = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');
const fmtWhen = (ms: number | null, lang: string, fallback: string) =>
    ms ? new Date(ms).toLocaleString(lang) : fallback;

/**
 * AI credit consumption of the chatbot flows' AI_RESPONSE nodes.
 *
 * Every AI reply is charged to the institute's AI credits, the same wallet the rest
 * of the platform's AI features draw on, so this reads the shared credit ledger
 * rather than anything chatbot-specific. When the balance runs out the engine stops
 * calling the model and hands those conversations to a human — the banner says so,
 * because from the admin's side the bot simply going quiet is otherwise a mystery.
 */
export function FlowAiUsagePanel({ flowId }: { flowId?: string }) {
    const { t, i18n } = useTranslation('automationFlowAiUsagePanel');
    const [days, setDays] = useState(30);
    const [summary, setSummary] = useState<FlowAiUsageSummary | null>(null);
    const [logs, setLogs] = useState<FlowAiUsageLogRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const load = async (windowDays: number) => {
        setLoading(true);
        setFailed(false);
        const startDate = Date.now() - windowDays * DAY_MS;
        try {
            const [usage, page] = await Promise.all([
                fetchChatbotFlowAiUsage(startDate),
                fetchChatbotFlowAiLogs(flowId, 0, 20, startDate),
            ]);
            setSummary(usage);
            setLogs(page.content ?? []);
        } catch {
            // Usage reporting is never worth breaking the flows screen over.
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load(days);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days, flowId]);

    if (loading && !summary) {
        return <div className="py-8 text-center text-sm text-gray-400">{t('loading')}</div>;
    }

    if (failed) {
        return (
            <div className="py-8 text-center text-sm text-gray-400">
                {t('loadFailed')}
                <button onClick={() => load(days)} className="ms-2 text-blue-600 hover:underline">
                    {t('retry')}
                </button>
            </div>
        );
    }

    const rows = flowId ? (summary?.byFlow ?? []).filter((r) => r.flowId === flowId) : (summary?.byFlow ?? []);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Lightning size={16} className="text-amber-500" />
                    {t('heading')}
                </div>
                <div className="flex items-center gap-1">
                    {WINDOWS.map((w) => (
                        <button
                            key={w}
                            onClick={() => setDays(w)}
                            className={`rounded px-2 py-1 text-xs ${
                                days === w
                                    ? 'bg-blue-50 font-medium text-blue-700'
                                    : 'text-gray-500 hover:bg-gray-100'
                            }`}
                        >
                            {t('windows.days', { count: w })}
                        </button>
                    ))}
                    <button
                        onClick={() => load(days)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100"
                        title={t('refresh')}
                    >
                        <ArrowClockwise size={14} />
                    </button>
                </div>
            </div>

            {summary && !summary.aiEnabled && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <Warning size={18} className="mt-0.5 shrink-0 text-amber-600" />
                    <div className="text-sm text-amber-800">
                        <p className="font-medium">{t('aiPaused.title')}</p>
                        <p className="mt-0.5 text-amber-700">
                            {t('aiPaused.body')}
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={t('stats.creditsUsed')} value={fmtCredits(summary?.totalCredits ?? 0)} />
                <Stat label={t('stats.aiReplies')} value={String(summary?.turnCount ?? 0)} />
                <Stat label={t('stats.peopleRepliedTo')} value={String(summary?.userCount ?? 0)} />
                <Stat
                    label={t('stats.balance')}
                    value={
                        summary?.currentBalance != null ? fmtCredits(summary.currentBalance) : t('notAvailable')
                    }
                    warn={summary != null && !summary.aiEnabled}
                />
            </div>

            {!flowId && rows.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">{t('table.flow')}</th>
                                <th className="px-3 py-2 text-right font-medium">{t('table.credits')}</th>
                                <th className="px-3 py-2 text-right font-medium">{t('table.replies')}</th>
                                <th className="px-3 py-2 text-right font-medium">{t('table.people')}</th>
                                <th className="px-3 py-2 text-right font-medium">{t('table.lastUsed')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {rows.map((r) => (
                                <tr key={r.flowId ?? 'unattributed'}>
                                    <td className="px-3 py-2 text-gray-800">
                                        {r.flowName ?? r.flowId ?? t('table.unattributed')}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                                        {fmtCredits(r.totalCredits)}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                                        {r.turnCount}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                                        {r.userCount}
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs text-gray-500">
                                        {fmtWhen(r.lastUsedAt, i18n.language, t('notAvailable'))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div>
                <p className="mb-2 text-xs font-medium uppercase text-gray-500">{t('recentReplies.heading')}</p>
                {logs.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-400">
                        {t('recentReplies.empty')}
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-lg border">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">{t('recentReplies.when')}</th>
                                    <th className="px-3 py-2 text-left font-medium">{t('recentReplies.repliedTo')}</th>
                                    <th className="px-3 py-2 text-left font-medium">{t('recentReplies.model')}</th>
                                    <th className="px-3 py-2 text-right font-medium">{t('recentReplies.credits')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {logs.map((l) => (
                                    <tr key={l.id}>
                                        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                                            {fmtWhen(l.createdAt, i18n.language, t('notAvailable'))}
                                        </td>
                                        <td className="px-3 py-2 text-gray-800">
                                            {l.name ?? l.email ?? (
                                                <span className="text-gray-400">{t('recentReplies.unidentifiedContact')}</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-500">
                                            {l.model ?? t('notAvailable')}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                                            {fmtCredits(l.credits)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
    return (
        <div className="rounded-lg border bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p
                className={`mt-1 text-lg font-semibold tabular-nums ${
                    warn ? 'text-amber-600' : 'text-gray-800'
                }`}
            >
                {value}
            </p>
        </div>
    );
}
