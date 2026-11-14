import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Brain, UsersThree, Presentation } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

interface BeforeLectureViewProps {
    onBack: () => void;
}

export function BeforeLectureView({ onBack }: BeforeLectureViewProps) {
    const { t } = useTranslation('instructorCopilotBeforeLectureView');

    const cards = [
        {
            title: t('cards.planner.title'),
            description: t('cards.planner.description'),
            icon: Brain,
            color: 'text-purple-500',
            bgColor: 'bg-purple-50 dark:bg-purple-900/20',
            to: '/ai-center/ai-tools/vsmart-lecture'
        },
        {
            title: t('cards.attendance.title'),
            description: t('cards.attendance.description'),
            icon: UsersThree,
            color: 'text-blue-500',
            bgColor: 'bg-blue-50 dark:bg-blue-900/20',
            to: '/study-library/live-session'
        },
        {
            title: t('cards.presentation.title'),
            description: t('cards.presentation.description'),
            icon: Presentation,
            color: 'text-amber-500',
            bgColor: 'bg-amber-50 dark:bg-amber-900/20',
            to: '/study-library/volt'
        }
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
                    <ArrowLeft size={16} />
                    {t('backButton')}
                </Button>
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('heading')}</h2>
                    <p className="text-sm text-slate-500">{t('subtitle')}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {cards.map((card, index) => (
                    <Link key={index} to={card.to} className="block h-full">
                        <Card className="h-full cursor-pointer transition-all hover:border-primary-500 hover:shadow-md">
                            <CardHeader>
                                <div className={`mb-4 flex size-12 items-center justify-center rounded-lg ${card.bgColor}`}>
                                    <card.icon size={24} className={card.color} />
                                </div>
                                <CardTitle className="text-lg">{card.title}</CardTitle>
                                <CardDescription>{card.description}</CardDescription>
                            </CardHeader>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    );
}
