import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Plus, Eye, ChartBar } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

interface AssessmentCenterWidgetProps {
    assessmentCount?: number;
    questionPaperCount?: number;
    isLoading?: boolean;
}

export default function AssessmentCenterWidget({
    assessmentCount = 0,
    questionPaperCount = 0,
    isLoading = false,
}: AssessmentCenterWidgetProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboardAssessmentCenterWidget');

    const handleCreateAssessment = () => {
        navigate({ to: '/assessment' });
    };

    const handleViewAssessments = () => {
        navigate({ to: '/assessment/assessment-list' });
    };

    const handleQuestionPapers = () => {
        navigate({ to: '/assessment/question-papers' });
    };

    const handleEvaluationCenter = () => {
        navigate({ to: '/evaluation/evaluations' });
    };

    const assessmentFeatures = [
        {
            id: 'createAssessment',
            icon: Plus,
            title: t('features.createAssessment'),
            action: handleCreateAssessment,
            primary: true,
        },
        {
            id: 'viewAssessments',
            icon: Eye,
            title: t('features.viewAssessments'),
            action: handleViewAssessments,
        },
        {
            id: 'questionPapers',
            icon: FileText,
            title: t('features.questionPapers'),
            action: handleQuestionPapers,
        },
        {
            id: 'evaluationCenter',
            icon: ChartBar,
            title: t('features.evaluationCenter'),
            action: handleEvaluationCenter,
        },
    ];

    return (
        <Card className="flex h-full grow flex-col bg-neutral-50 shadow-none">
            <CardHeader className="p-4">
                <div className="flex flex-col items-start justify-between gap-y-2">
                    <div className="flex items-center gap-2">
                        <FileText size={18} className="text-primary-500" weight="duotone" />
                        <div>
                            <CardTitle className="text-sm font-semibold">
                                {t('heading.title')}
                            </CardTitle>
                            <CardDescription className="mt-1 text-xs text-neutral-600">
                                {t('heading.description')}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Badge variant="secondary" className="text-xs">
                            {isLoading ? (
                                <span className="inline-block h-3 w-6 animate-pulse rounded bg-neutral-200"></span>
                            ) : (
                                assessmentCount
                            )}{' '}
                            {t('badges.tests')}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                            {isLoading ? (
                                <span className="inline-block h-3 w-6 animate-pulse rounded bg-neutral-200"></span>
                            ) : (
                                questionPaperCount
                            )}{' '}
                            {t('badges.papers')}
                        </Badge>
                    </div>
                </div>
            </CardHeader>
            <div className="flex-1 space-y-3 px-4 pb-4">
                <div className="grid grid-cols-1 gap-3">
                    {assessmentFeatures.map((feature) => (
                        <MyButton
                            key={feature.id}
                            type="button"
                            scale="medium"
                            buttonType={feature.primary ? 'primary' : 'secondary'}
                            layoutVariant="default"
                            className="w-full justify-start gap-2 text-sm"
                            onClick={feature.action}
                        >
                            <feature.icon size={16} />
                            {feature.title}
                        </MyButton>
                    ))}
                </div>
            </div>
        </Card>
    );
}
