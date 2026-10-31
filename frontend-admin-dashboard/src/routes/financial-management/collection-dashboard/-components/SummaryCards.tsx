import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconProps } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

interface SummaryCardProps {
    title: string;
    value: string;
    icon: React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>>;
    iconColor: string;
    bgColor: string;
    borderColor: string;
    delay?: number;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ 
    title, 
    value, 
    icon: Icon, 
    iconColor, 
    bgColor, 
    borderColor,
    delay = 0
}) => {
    const { t } = useTranslation('financialManagementSummaryCards');
    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay }}
            className={`group bg-white border ${borderColor} rounded-2xl p-5 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col relative overflow-hidden h-full`}
        >
            {/* Subtle Gradient Background */}
            <div className={`absolute -right-4 -top-4 w-24 h-24 bg-gradient-to-br from-gray-50 to-transparent opacity-50 group-hover:scale-110 transition-transform duration-500 rounded-full`} />
            
            <div className="flex justify-between items-start mb-3 relative z-10">
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">{title}</span>
                <div className={`p-2.5 rounded-xl ${bgColor} ${iconColor} shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                    <Icon size={20} weight="duotone" />
                </div>
            </div>
            
            <div className="mt-auto relative z-10">
                <div className="text-2xl font-black text-gray-900 tracking-tight">{value}</div>
                <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">{t('liveStatus')}</span>
                </div>
            </div>
        </motion.div>
    );
};

export const CollectionSummaryCards: React.FC<{ cards: any[] }> = ({ cards }) => {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {cards.map((card, idx) => (
                <SummaryCard 
                    key={idx} 
                    {...card} 
                    delay={idx * 0.08}
                />
            ))}
        </div>
    );
};
