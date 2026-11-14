import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, ChatCircle, User, Robot } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
    listFlowSessions,
    getSessionDetail,
    getFlowAnalytics,
    ChatbotFlowSession,
    FlowAnalytics,
} from '../-services/chatbot-flow-api';

interface SessionViewerProps {
    flowId: string;
    flowName: string;
    onBack: () => void;
}

export function SessionViewer({ flowId, flowName, onBack }: SessionViewerProps) {
    const { t, i18n } = useTranslation('automationSessionViewer');
    const [sessions, setSessions] = useState<ChatbotFlowSession[]>([]);
    const [selectedSession, setSelectedSession] = useState<ChatbotFlowSession | null>(null);
    const [analytics, setAnalytics] = useState<FlowAnalytics | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [sessionsData, analyticsData] = await Promise.all([
                listFlowSessions(flowId, statusFilter || undefined),
                getFlowAnalytics(flowId),
            ]);
            setSessions(sessionsData);
            setAnalytics(analyticsData);
        } catch (err) {
            console.error('Failed to load session data', err);
        } finally {
            setLoading(false);
        }
    }, [flowId, statusFilter]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSelectSession = async (sessionId: string) => {
        try {
            const detail = await getSessionDetail(sessionId);
            setSelectedSession(detail);
        } catch (err) {
            console.error('Failed to load session detail', err);
        }
    };

    const statusColor = (status: string) => {
        switch (status) {
            case 'ACTIVE': return 'bg-green-100 text-green-700';
            case 'COMPLETED': return 'bg-blue-100 text-blue-700';
            case 'ERROR': return 'bg-red-100 text-red-700';
            case 'TIMED_OUT': return 'bg-yellow-100 text-yellow-700';
            default: return 'bg-gray-100 text-gray-600';
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-1 rounded hover:bg-gray-100">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-lg font-semibold">{flowName}</h2>
                        <p className="text-xs text-gray-500">{t('sessionsAndAnalytics')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="text-xs border rounded px-2 py-1"
                    >
                        <option value="">{t('statusFilter.all')}</option>
                        <option value="ACTIVE">{t('statusFilter.active')}</option>
                        <option value="COMPLETED">{t('statusFilter.completed')}</option>
                        <option value="ERROR">{t('statusFilter.error')}</option>
                        <option value="TIMED_OUT">{t('statusFilter.timedOut')}</option>
                    </select>
                    <button onClick={loadData} className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">
                        {t('refresh')}
                    </button>
                </div>
            </div>

            {/* Analytics summary */}
            {analytics && (
                <div className="flex gap-3 px-4 py-3 border-b bg-gray-50">
                    <StatCard label={t('stats.total')} value={analytics.totalSessions} color="text-gray-800" />
                    <StatCard label={t('stats.active')} value={analytics.activeSessions} color="text-green-600" />
                    <StatCard label={t('stats.completed')} value={analytics.completedSessions} color="text-blue-600" />
                    <StatCard label={t('stats.errors')} value={analytics.errorSessions} color="text-red-600" />
                    <StatCard label={t('stats.timedOut')} value={analytics.timedOutSessions} color="text-yellow-600" />
                </div>
            )}

            {/* Content: session list + chat detail */}
            <div className="flex flex-1 overflow-hidden">
                {/* Session list */}
                <div className="w-80 border-r overflow-y-auto bg-white">
                    {loading ? (
                        <p className="p-4 text-sm text-gray-400">{t('loadingSessions')}</p>
                    ) : sessions.length === 0 ? (
                        <p className="p-4 text-sm text-gray-400">{t('noSessionsFound')}</p>
                    ) : (
                        sessions.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => handleSelectSession(s.id)}
                                className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition ${
                                    selectedSession?.id === s.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                                }`}
                            >
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-medium text-gray-800 truncate">
                                        {s.userPhone}
                                    </span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${statusColor(s.status)}`}>
                                        {s.status}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center mt-1">
                                    <span className="text-xs text-gray-500 truncate">
                                        {s.currentNodeName || s.currentNodeType || '—'}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        {s.lastActivityAt ? formatTime(s.lastActivityAt, i18n.language) : '—'}
                                    </span>
                                </div>
                            </button>
                        ))
                    )}
                </div>

                {/* Chat detail */}
                <div className="flex-1 flex flex-col bg-gray-100">
                    {selectedSession ? (
                        <>
                            {/* Session info bar */}
                            <div className="px-4 py-2 bg-white border-b flex items-center justify-between">
                                <div>
                                    <span className="text-sm font-medium">{selectedSession.userPhone}</span>
                                    {selectedSession.userId && (
                                        <span className="text-xs text-gray-400 ms-2">
                                            {t('userId', { id: selectedSession.userId })}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span>
                                        {t('nodeLabel')}{' '}
                                        <strong>{selectedSession.currentNodeName || '—'}</strong>
                                    </span>
                                    <span className={`px-1.5 py-0.5 rounded-full ${statusColor(selectedSession.status)}`}>
                                        {selectedSession.status}
                                    </span>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                {selectedSession.messages && selectedSession.messages.length > 0 ? (
                                    selectedSession.messages.map((msg, i) => (
                                        <div
                                            key={msg.id || i}
                                            className={`flex ${msg.direction === 'OUTGOING' ? 'justify-end' : 'justify-start'}`}
                                        >
                                            <div
                                                className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                                                    msg.direction === 'OUTGOING'
                                                        ? 'bg-blue-500 text-white rounded-br-none'
                                                        : 'bg-white text-gray-800 rounded-bl-none border'
                                                }`}
                                            >
                                                <div className="flex items-center gap-1 mb-1">
                                                    {msg.direction === 'OUTGOING' ? (
                                                        <Robot size={12} />
                                                    ) : (
                                                        <User size={12} />
                                                    )}
                                                    <span className="text-xs opacity-70">
                                                        {msg.direction === 'OUTGOING' ? t('bot') : t('user')}
                                                    </span>
                                                </div>
                                                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                                                <p className={`text-xs mt-1 ${msg.direction === 'OUTGOING' ? 'text-blue-200' : 'text-gray-400'}`}>
                                                    {msg.timestamp ? formatTime(msg.timestamp, i18n.language) : ''}
                                                    {msg.source ? ` · ${msg.source}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-center text-sm text-gray-400 py-8">
                                        {t('noMessages')}
                                    </p>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center text-gray-400">
                                <ChatCircle size={48} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">{t('selectSessionPrompt')}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="bg-white px-3 py-2 rounded border min-w-[80px]">
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
        </div>
    );
}

function formatTime(timestamp: string, lang: string): string {
    try {
        const d = new Date(timestamp);
        return d.toLocaleString(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return timestamp;
    }
}
