import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/utils/finance-utils';

interface TableProps {
    classWiseDetails: Array<{
        className: string;
        projectedRevenue: number;
        expectedToDate: number;
        collectedToDate: number;
        collectionRate: number;
        totalOverdue: number;
    }> | undefined;
}

export const ClassWiseCollectionTable: React.FC<TableProps> = ({ classWiseDetails }) => {
    const { t } = useTranslation('financialManagementClassWiseCollectionTable');
    return (
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 h-full overflow-hidden flex flex-col">
            <h2 className="text-sm font-bold text-gray-800 mb-4 border-b border-gray-100 pb-3 flex items-center gap-2 uppercase tracking-wide">
                {t('heading')}
            </h2>
            <div className="overflow-x-auto flex-1 custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                        <tr className="bg-gray-50/50">
                            <th className="py-4 px-5 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">{t('columns.className')}</th>
                            <th className="py-4 px-5 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 text-end">{t('columns.projected')}</th>
                            <th className="py-4 px-5 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 text-end">{t('columns.expected')}</th>
                            <th className="py-4 px-5 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 text-end">{t('columns.collected')}</th>
                            <th className="py-4 px-5 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 text-end">{t('columns.collectionRate')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-sm font-medium">
                        {classWiseDetails?.map((row, i) => (
                            <tr key={i} className="hover:bg-blue-50/30 transition-colors group">
                                <td className="py-4 px-5 text-gray-900 font-bold">{row.className}</td>
                                <td className="py-4 px-5 text-gray-600 text-right">{formatCurrency(row.projectedRevenue)}</td>
                                <td className="py-4 px-5 text-gray-600 text-right">{formatCurrency(row.expectedToDate)}</td>
                                <td className="py-4 px-5 text-green-600 font-bold text-right">{formatCurrency(row.collectedToDate)}</td>
                                <td className="py-4 px-5">
                                    <div className="flex items-center justify-end gap-4">
                                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden shadow-inner hidden sm:flex">
                                            <div 
                                                className={`h-full transition-all duration-700 ease-out ${
                                                    row.collectionRate >= 90 ? 'bg-emerald-500' : 
                                                    row.collectionRate >= 75 ? 'bg-blue-500' : 
                                                    row.collectionRate >= 50 ? 'bg-amber-500' : 
                                                    'bg-rose-500'
                                                }`} 
                                                style={{ width: `${row.collectionRate}%` }}
                                            />
                                        </div>
                                        <span className={`text-xs font-black min-w-[3rem] text-right ${
                                             row.collectionRate >= 90 ? 'text-emerald-600' : 
                                             row.collectionRate >= 75 ? 'text-blue-600' : 
                                             row.collectionRate >= 50 ? 'text-amber-600' : 
                                             'text-rose-600'
                                        }`}>
                                            {row.collectionRate.toFixed(1)}%
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
