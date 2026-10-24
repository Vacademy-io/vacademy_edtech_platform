import { StudentReportData } from '@/types/student-analysis';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { MyDialog } from '@/components/design-system/dialog';

interface StudentReportDetailsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    report: StudentReportData | null;
    title?: string;
}

const markdownComponents = {
    h3: ({ ...props }) => (
        <h3 className="mb-5 mt-0 text-base font-bold text-neutral-800" {...props} />
    ),
    table: ({ ...props }) => (
        <div className="my-6 overflow-x-auto">
            <table
                className="w-full border-collapse border border-neutral-200 text-sm"
                {...props}
            />
        </div>
    ),
    thead: ({ ...props }) => <thead className="bg-neutral-50" {...props} />,
    th: ({ ...props }) => (
        <th
            className="border border-neutral-200 px-4 py-2.5 text-left font-bold text-neutral-800"
            {...props}
        />
    ),
    td: ({ ...props }) => (
        <td className="border border-neutral-200 px-4 py-2.5 text-neutral-700" {...props} />
    ),
};

export const StudentReportDetailsDialog = ({
    open,
    onOpenChange,
    report,
    title,
}: StudentReportDetailsDialogProps) => {
    const { t } = useTranslation('manageStudentsReportDetailsDialog');

    if (!report) return null;

    const resolvedTitle = title ?? t('dialog.defaultTitle');

    const KEYS = {
        STRENGTHS: 'strengths' as keyof StudentReportData,
        WEAKNESSES: 'weaknesses' as keyof StudentReportData,
        PROGRESS: 'progress' as keyof StudentReportData,
        LEARNING_FREQUENCY: 'learning_frequency' as keyof StudentReportData,
        STUDENT_EFFORTS: 'student_efforts' as keyof StudentReportData,
        TOPICS_IMPROVEMENT: 'topics_of_improvement' as keyof StudentReportData,
        TOPICS_DEGRADATION: 'topics_of_degradation' as keyof StudentReportData,
        REMEDIAL_POINTS: 'remedial_points' as keyof StudentReportData,
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={resolvedTitle}
            dialogWidth="max-w-4xl"
            content={
                <div className="flex flex-col gap-4">
                    {/* MyDialog's content wrapper is already flex-1 overflow-y-auto — no height constraint needed here */}
                    <div>
                        <Tabs defaultValue="efforts" className="w-full">
                                <TabsList className="mb-4 grid w-full grid-cols-4">
                                    <TabsTrigger value="efforts">{t('tabs.efforts')}</TabsTrigger>
                                    <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
                                    <TabsTrigger value="topics">{t('tabs.topics')}</TabsTrigger>
                                    <TabsTrigger value="remedial">{t('tabs.remedial')}</TabsTrigger>
                                </TabsList>

                                <TabsContent value="efforts" className="space-y-6">
                                    <div className="space-y-2">
                                        <Card>
                                            <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-4">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkBreaks, remarkGfm]}
                                                    components={markdownComponents}
                                                >
                                                    {report[KEYS.STUDENT_EFFORTS] as string}
                                                </ReactMarkdown>
                                            </CardContent>
                                        </Card>
                                        <Card>
                                            <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-4">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkBreaks, remarkGfm]}
                                                    components={markdownComponents}
                                                >
                                                    {report[KEYS.LEARNING_FREQUENCY] as string}
                                                </ReactMarkdown>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </TabsContent>

                                <TabsContent value="overview" className="space-y-6">
                                    <Card>
                                        <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-4">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkBreaks, remarkGfm]}
                                                components={markdownComponents}
                                            >
                                                {report[KEYS.PROGRESS] as string}
                                            </ReactMarkdown>
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="topics" className="space-y-6">
                                    <div className="grid gap-6 md:grid-cols-2">
                                        <Card>
                                            <CardHeader>
                                                <CardTitle className="text-lg">
                                                    {t('sections.strengths')}
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                {Object.entries(
                                                    (report[KEYS.STRENGTHS] as Record<
                                                        string,
                                                        number
                                                    >) || {}
                                                ).map(([topic, score]) => (
                                                    <div key={topic} className="space-y-1">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="font-medium">
                                                                {topic}
                                                            </span>
                                                            <span className="text-success-600">
                                                                {score}%
                                                            </span>
                                                        </div>
                                                        <Progress
                                                            value={score}
                                                            className="h-2 !bg-neutral-200 [&>div]:bg-success-500"
                                                        />
                                                    </div>
                                                ))}
                                            </CardContent>
                                        </Card>
                                        <Card>
                                            <CardHeader>
                                                <CardTitle className="text-lg">
                                                    {t('sections.weaknesses')}
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                {Object.entries(
                                                    (report[KEYS.WEAKNESSES] as Record<
                                                        string,
                                                        number
                                                    >) || {}
                                                ).map(([topic, score]) => (
                                                    <div key={topic} className="space-y-1">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="font-medium">
                                                                {topic}
                                                            </span>
                                                            <span className="text-danger-600">
                                                                {score}%
                                                            </span>
                                                        </div>
                                                        <Progress
                                                            value={score}
                                                            className="h-2 !bg-neutral-200 [&>div]:bg-danger-500"
                                                        />
                                                    </div>
                                                ))}
                                            </CardContent>
                                        </Card>
                                    </div>
                                    <Card>
                                        <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-4">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkBreaks, remarkGfm]}
                                                components={markdownComponents}
                                            >
                                                {report[KEYS.TOPICS_IMPROVEMENT] as string}
                                            </ReactMarkdown>
                                        </CardContent>
                                    </Card>
                                    <Card>
                                        <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-4">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkBreaks, remarkGfm]}
                                                components={markdownComponents}
                                            >
                                                {report[KEYS.TOPICS_DEGRADATION] as string}
                                            </ReactMarkdown>
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="remedial" className="space-y-6">
                                    <Card>
                                        <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-4">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkBreaks, remarkGfm]}
                                                components={markdownComponents}
                                            >
                                                {report[KEYS.REMEDIAL_POINTS] as string}
                                            </ReactMarkdown>
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                            </Tabs>
                    </div>
                </div>
            }
        />
    );
};
