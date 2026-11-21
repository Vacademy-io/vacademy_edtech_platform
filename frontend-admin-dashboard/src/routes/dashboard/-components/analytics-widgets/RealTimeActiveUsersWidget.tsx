import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchAnalyticsActiveUsersRealtime } from '../../-services/dashboard-services';
import { useEffect, useState } from 'react';
import { Eye, ArrowUp } from '@phosphor-icons/react';
import { AnalyticsErrorDisplay } from './AnalyticsErrorDisplay';

// Animated number counter component
const AnimatedNumber = ({ value }: { value: number }) => {
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
        const duration = 1000; // 1 second animation
        const startTime = Date.now();
        const startValue = displayValue;

        const animate = () => {
            const now = Date.now();
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function for smooth animation
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const currentValue = Math.round(startValue + (value - startValue) * easeOutQuart);

            setDisplayValue(currentValue);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    }, [value, displayValue]);

    return <span>{displayValue}</span>;
};

interface RealTimeActiveUsersWidgetProps {
    instituteId: string;
}

export default function RealTimeActiveUsersWidget({ instituteId }: RealTimeActiveUsersWidgetProps) {
    const { t } = useTranslation('dashboardRealTimeActiveUsersWidget');
    const {
        data: activeUsersCount,
        isLoading,
        error,
        refetch,
    } = useQuery({
        queryKey: ['analytics-realtime-users', instituteId],
        queryFn: () => fetchAnalyticsActiveUsersRealtime(instituteId),
        refetchInterval: 10000, // Refetch every 10 seconds for real-time feel
        staleTime: 5000, // Data considered fresh for 5 seconds
        gcTime: 30000, // Keep in cache for 30 seconds after becoming unused
    });

    if (error) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="h-full"
            >
                <Card className="h-full">
                    <AnalyticsErrorDisplay
                        error={error}
                        widgetName={t('error.widgetName')}
                        onRetry={() => refetch()}
                        fallbackIcon={Eye}
                    />
                </Card>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            whileHover={{ scale: 1.02 }}
            className="h-full"
        >
            <Card className="relative h-full overflow-hidden border-2 border-primary-200 bg-gradient-to-br from-primary-50 to-primary-100 shadow-lg transition-all duration-300 hover:shadow-xl">
                {/* Animated background pulse */}
                <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-primary-400/10 to-primary-500/10"
                    animate={{
                        opacity: [0.3, 0.6, 0.3],
                    }}
                    transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: 'easeInOut',
                    }}
                />

                <CardHeader className="relative pb-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="rounded-full bg-primary-300/20 p-2">
                                <Eye size={20} className="text-primary-400" />
                            </div>
                            <CardTitle className="text-lg font-bold">{t('header.title')}</CardTitle>
                        </div>
                        <motion.div
                            animate={{ scale: [1, 1.1, 1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="size-3 rounded-full bg-green-500 shadow-lg"
                        />
                    </div>
                    <CardDescription className="text-sm text-gray-800/80">
                        {t('header.subtitle')}
                    </CardDescription>
                </CardHeader>

                <CardContent className="relative pt-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.2 }}
                                className="mb-1 text-4xl font-bold text-primary-500"
                            >
                                {isLoading ? (
                                    <motion.div
                                        animate={{ opacity: [0.5, 1, 0.5] }}
                                        transition={{ duration: 1.5, repeat: Infinity }}
                                        className="text-primary-500"
                                    >
                                        --
                                    </motion.div>
                                ) : (
                                    <AnimatedNumber
                                        value={
                                            activeUsersCount?.totalActiveUsers ||
                                            activeUsersCount ||
                                            0
                                        }
                                    />
                                )}
                            </motion.div>
                            <div className="flex items-center gap-1 text-xs">
                                <ArrowUp size={12} />
                                <span>{t('stats.liveUpdates')}</span>
                            </div>
                        </div>

                        {/* Animated pulse indicator */}
                        <motion.div
                            className="relative"
                            animate={{
                                scale: [1, 1.2, 1],
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: 'easeInOut',
                            }}
                        >
                            <div className="flex size-16 items-center justify-center rounded-full bg-primary-500/20">
                                <div className="flex size-8 items-center justify-center rounded-full bg-primary-500/40">
                                    <div className="size-4 rounded-full bg-primary-500" />
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}
