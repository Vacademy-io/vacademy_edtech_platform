import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Microphone, UploadSimple, PresentationChart } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

interface InLectureViewProps {
    onBack: () => void;
    onRecord: () => void;
    onUpload: () => void;
}

export function InLectureView({ onBack, onRecord, onUpload }: InLectureViewProps) {
    const { t } = useTranslation('instructorCopilotInLectureView');

    const actions = [
        {
            id: 'record',
            title: t('actions.record.title'),
            description: t('actions.record.description'),
            icon: Microphone,
            color: 'text-red-500',
            bgColor: 'bg-red-50 dark:bg-red-900/20',
            onClick: onRecord
        },
        {
            id: 'upload',
            title: t('actions.upload.title'),
            description: t('actions.upload.description'),
            icon: UploadSimple,
            color: 'text-blue-500',
            bgColor: 'bg-blue-50 dark:bg-blue-900/20',
            onClick: onUpload
        },
        {
            id: 'volt',
            title: t('actions.volt.title'),
            description: t('actions.volt.description'),
            icon: PresentationChart,
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
                {actions.map((action) => {
                    const CardComponent = (
                        <Card className="h-full cursor-pointer transition-all hover:border-primary-500 hover:shadow-md">
                            <CardHeader>
                                <div className={`mb-4 flex size-12 items-center justify-center rounded-lg ${action.bgColor}`}>
                                    <action.icon size={24} className={action.color} />
                                </div>
                                <CardTitle className="text-lg">{action.title}</CardTitle>
                                <CardDescription>{action.description}</CardDescription>
                            </CardHeader>
                        </Card>
                    );

                    if (action.to) {
                        return (
                            <Link key={action.id} to={action.to} className="block h-full">
                                {CardComponent}
                            </Link>
                        );
                    }

                    return (
                        <div key={action.id} onClick={action.onClick} className="block h-full">
                            {CardComponent}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
