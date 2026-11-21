import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    BarChart,
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer, 
    Cell 
} from 'recharts';
import { formatCurrency } from '@/utils/finance-utils';

interface PipelineChartProps {
    data: any[];
}

const renderCustomAxisTick = ({ x, y, payload }: any) => {
    return (
        <g transform={`translate(${x},${y})`}>
            <text x={0} y={0} dy={16} textAnchor="middle" fill="#4b5563" fontSize={12} fontWeight={600}>
                {payload.value}
            </text>
        </g>
    );
};

export const CollectionPipelineChart: React.FC<PipelineChartProps> = ({ data }) => {
    const { t } = useTranslation('financialManagementCollectionPipelineChart');
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 h-full">
            <h2 className="text-sm font-bold text-gray-800 mb-6 border-b border-gray-100 pb-2 uppercase tracking-wide">
                {t('heading')}
            </h2>
            <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }} barSize={50}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={renderCustomAxisTick} />
                        <Tooltip 
                            cursor={{fill: '#f9fafb'}} 
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                            formatter={(value: number, name: string, props: any) => [formatCurrency(value), props.payload.tooltip]}
                        />
                        <Bar dataKey="val" radius={[6, 6, 0, 0]}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
