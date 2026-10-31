import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, ChatText, WarningCircle, UserList } from '@phosphor-icons/react';
import type { LiveSessionReport } from '../../-services/utils';

interface FeedbackStatsProps {
    data: LiveSessionReport[];
    feedbackConfig: any;
}

export function FeedbackStats({ data, feedbackConfig }: FeedbackStatsProps) {
    const { t } = useTranslation('studyLibraryFeedbackStats');
    const stats = useMemo(() => {
        if (!feedbackConfig?.enabled || !feedbackConfig?.questions?.length) {
            return null;
        }

        const questions = feedbackConfig.questions;
        const totalSubmissions = data.filter((s) => s.feedbackDetails).length;
        
        const questionStats = questions.map((q: any) => {
            const isStarRating = q.type === 'star_rating';
            let sum = 0;
            let count = 0;
            let lowRatingsCount = 0; // rating < 3
            const textResponses: Array<{ name: string; response: string }> = [];

            data.forEach((student) => {
                if (student.feedbackDetails) {
                    try {
                        const parsed = JSON.parse(student.feedbackDetails);
                        const value = parsed[q.id];
                        if (value !== undefined) {
                            if (isStarRating) {
                                const num = parseFloat(value);
                                if (!isNaN(num)) {
                                    sum += num;
                                    count++;
                                    if (num < 3) lowRatingsCount++;
                                }
                            } else {
                                if (String(value).trim().length > 0) {
                                    textResponses.push({
                                        name: student.fullName,
                                        response: String(value),
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            });

            return {
                ...q,
                average: count > 0 ? (sum / count).toFixed(1) : '0.0',
                count,
                lowRatingsCount,
                textResponses,
            };
        });

        return {
            totalSubmissions,
            questionStats,
        };
    }, [data, feedbackConfig]);

    if (!stats || stats.totalSubmissions === 0) {
        return null;
    }

    return (
        <div className="mb-6 space-y-4 rounded-xl border border-purple-100 bg-gradient-to-br from-purple-50 to-white p-5 shadow-sm">
            <div className="flex items-center gap-2 border-b border-purple-100 pb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                    <ChatText weight="fill" size={18} />
                </div>
                <div>
                    <h3 className="font-semibold text-purple-900">{t('learnerFeedbackStats')}</h3>
                    <p className="text-xs text-purple-600">
                        {t('totalResponsesCollected', { count: stats.totalSubmissions })}
                    </p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {stats.questionStats.map((qStat: any) => {
                    if (qStat.type === 'star_rating') {
                        return (
                            <div key={qStat.id} className="rounded-lg border border-purple-100 bg-white p-4">
                                <p className="mb-2 text-sm font-medium text-gray-700 line-clamp-2" title={qStat.label}>
                                    {qStat.label}
                                </p>
                                <div className="flex items-end gap-3">
                                    <div className="flex items-center gap-1.5 text-2xl font-bold text-gray-900">
                                        <Star weight="fill" className="text-yellow-400" />
                                        <span>{qStat.average}</span>
                                        <span className="text-sm font-normal text-gray-400">/ {qStat.max_stars || 5}</span>
                                    </div>
                                    <div className="flex flex-col text-xs text-gray-500">
                                        <span>{t('ratingsCount', { count: qStat.count })}</span>
                                        {qStat.lowRatingsCount > 0 && (
                                            <span className="flex items-center gap-1 text-red-500 font-medium mt-0.5">
                                                <WarningCircle weight="fill" size={12} />
                                                {t('lowRatingsCount', {
                                                    count: qStat.lowRatingsCount,
                                                })}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    if (qStat.type === 'text') {
                        return (
                            <div key={qStat.id} className="col-span-full rounded-lg border border-purple-100 bg-white p-4">
                                <p className="mb-3 text-sm font-medium text-gray-700">
                                    {qStat.label}
                                </p>
                                {qStat.textResponses.length > 0 ? (
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                                        {qStat.textResponses.map((tr: any, idx: number) => (
                                            <div key={idx} className="rounded border border-gray-100 bg-gray-50 p-2.5 text-sm">
                                                <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-purple-700">
                                                    <UserList size={12} />
                                                    {tr.name}
                                                </div>
                                                <p className="text-gray-600 line-clamp-3" title={tr.response}>"{tr.response}"</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm italic text-gray-400">{t('noWrittenResponsesYet')}</p>
                                )}
                            </div>
                        );
                    }

                    return null;
                })}
            </div>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #E9D5FF;
                    border-radius: 20px;
                }
            `}</style>
        </div>
    );
}
