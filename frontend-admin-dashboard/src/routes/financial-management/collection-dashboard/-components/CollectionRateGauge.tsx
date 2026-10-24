import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    PieChart,
    Pie, 
    Cell, 
    ResponsiveContainer 
} from 'recharts';

interface GaugeProps {
    collectionRate: number;
    gaugeData: any[];
}

export const CollectionRateGauge: React.FC<GaugeProps> = ({ collectionRate, gaugeData }) => {
    const { t } = useTranslation('financialManagementCollectionRateGauge');
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center relative h-full">
            <h2 className="text-sm font-bold text-gray-800 w-full mb-4 border-b border-gray-100 pb-2 uppercase tracking-wide">
                {t('heading')}
            </h2>
            <div className="w-full h-[220px] relative">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={gaugeData}
                            cx="50%"
                            cy="85%"
                            startAngle={180}
                            endAngle={0}
                            innerRadius="70%"
                            outerRadius="95%"
                            dataKey="value"
                            stroke="none"
                        >
                            {gaugeData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute top-[65%] left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                    <div className="text-5xl font-black text-gray-900">{collectionRate.toFixed(1)}%</div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1 italic opacity-80">{t('collectedLabel')}</div>
                </div>
            </div>
        </div>
    );
};
