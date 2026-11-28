import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ClockCounterClockwise, ChartBar } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

interface AfterLectureViewProps {
    onBack: () => void;
    onViewLogs: () => void;
}

export function AfterLectureView({ onBack, onViewLogs }: AfterLectureViewProps) {
    const { t } = useTranslation('instructorCopilotAfterLectureView');

    const cards = [
        {
            title: t('cards.logs.title'),
            description: t('cards.logs.description'),
            icon: ClockCounterClockwise,
            color: 'text-blue-500',
            bgColor: 'bg-blue-50 dark:bg-blue-900/20',
            onClick: onViewLogs,
        },
        {
            title: t('cards.analyse.title'),
            description: t('cards.analyse.description'),
            icon: ChartBar,
            color: 'text-green-500',
            bgColor: 'bg-green-50 dark:bg-green-900/20',
            to: '/ai-center/ai-tools/vsmart-feedback',
        },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
                    <ArrowLeft size={16} />
                    {t('backButton')}
                </Button>
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        {t('heading')}
                    </h2>
                    <p className="text-sm text-slate-500">{t('subtitle')}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {cards.map((card, index) => {
                    const Inner = (
                        <Card className="h-full cursor-pointer transition-all hover:border-primary-500 hover:shadow-md">
                            <CardHeader>
                                <div
                                    className={`mb-4 flex size-12 items-center justify-center rounded-lg ${card.bgColor}`}
                                >
                                    <card.icon size={24} className={card.color} />
                                </div>
                                <CardTitle className="text-lg">{card.title}</CardTitle>
                                <CardDescription>{card.description}</CardDescription>
                            </CardHeader>
                        </Card>
                    );

                    if (card.to) {
                        return (
                            <Link key={index} to={card.to} className="block h-full">
                                {Inner}
                            </Link>
                        );
                    }

                    return (
                        <div key={index} onClick={card.onClick} className="block h-full">
                            {Inner}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
