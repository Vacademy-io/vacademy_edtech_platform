import React from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface PaymentModeProps {
    pieData: any[];
}

export const PaymentModeInsights: React.FC<PaymentModeProps> = ({ pieData }) => {
    const { t } = useTranslation('financialManagementPaymentModeInsights');
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col h-full">
            <h2 className="text-sm font-bold text-gray-800 mb-2 border-b border-gray-100 pb-2 uppercase tracking-wide">
                {t('heading')}
            </h2>
            {pieData.length === 0 ? (
                 <div className="flex-1 flex items-center justify-center text-gray-400 text-sm italic font-medium">
                    {t('noData')}
                 </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 overflow-hidden">
                    <div className="w-full h-[180px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius="45%"
                                    outerRadius="70%"
                                    paddingAngle={4}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }}
                                    formatter={(value: number) => [`${value.toFixed(1)}%`]}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap justify-center gap-3 w-full border-t border-gray-100 pt-3 border-dashed">
                        {pieData.map((entry, index) => (
                            <div key={index} className="flex items-center gap-2 text-xs font-bold text-gray-700">
                                <div className="w-3 h-3 rounded-full shadow-sm ring-2 ring-inset shrink-0" style={{ backgroundColor: entry.color }}></div>
                                <span className="text-gray-500 uppercase tracking-tighter">{entry.name}</span>
                                <span className="text-gray-900">{entry.value}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
