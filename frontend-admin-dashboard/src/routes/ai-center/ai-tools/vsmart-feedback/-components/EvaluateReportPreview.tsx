import { Separator } from '@/components/ui/separator';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AILectureFeedbackInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import { StarRatingComponent } from '@/components/common/star-rating-component';
import {
    getPerformanceColor,
    getScoreFromString,
} from '@/routes/ai-center/-utils/helper';
import { ScrollArea } from '@/components/ui/scroll-area';

// Import Phosphor Icons
import {
    FileText, // For Report Title
    DownloadSimple, // For Export Button
    Clock, // For Duration
    CalendarBlank, // For Evaluation Date
    ListChecks, // For Evaluation Criteria Header
    Microphone, // For Delivery & Presentation
    GraduationCap, // For Content Quality
    Users, // For Student Engagement
    ClipboardText, // For Assessment & Feedback
    Translate, // For Inclusivity & Language
    Timer, // For Classroom Management (Pacing)
    Paperclip, // For Teaching Aids
    SealCheck, // For Professionalism
    Lightbulb, // For Scope of Improvement
    Notebook, // For Summary
    Question, // Default/Fallback Icon
    type Icon,
} from '@phosphor-icons/react';

// Helper function to get the appropriate icon based on criterion name
const getCriteriaIcon = (name: string | undefined): Icon => {
    const lowerCaseName = name?.toLowerCase() || '';

    if (lowerCaseName.includes('delivery') || lowerCaseName.includes('presentation'))
        return Microphone;
    if (lowerCaseName.includes('content')) return GraduationCap;
    if (lowerCaseName.includes('engagement')) return Users;
    if (lowerCaseName.includes('assessment') || lowerCaseName.includes('feedback'))
        return ClipboardText;
    if (lowerCaseName.includes('inclusivity') || lowerCaseName.includes('language'))
        return Translate;
    if (lowerCaseName.includes('management') || lowerCaseName.includes('pacing')) return Timer; // Assuming pacing falls under management
    if (lowerCaseName.includes('teaching aids') || lowerCaseName.includes('resource'))
        return Paperclip;
    if (lowerCaseName.includes('professionalism')) return SealCheck;

    return Question; // Fallback icon
};

// Maps a numeric score to a translation key for the performance label
const getPerformanceLabelKey = (score: number): string => {
    if (score < 40) return 'needsImprovement';
    if (score >= 40 && score < 60) return 'average';
    if (score >= 60 && score < 80) return 'good';
    return 'excellent'; // score >= 80
};

const EvaluateReportPreview = ({
    openDialog = false,
    evaluateLectureData,
}: {
    openDialog: boolean;
    evaluateLectureData: AILectureFeedbackInterface;
}) => {
    const { t } = useTranslation('aiCenterEvaluateReportPreview');
    const [open, setOpen] = useState(openDialog);

    if (!evaluateLectureData) {
        return null;
    }

    const totalScoreNum = Number(evaluateLectureData?.totalScore);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {/* Using 5xl width, adjust as needed */}
            <DialogContent className="flex max-h-dialog-tall w-full flex-col p-0 sm:max-w-5xl">
                <DialogHeader className="border-b bg-muted/30 p-4 px-6">
                    <DialogTitle className="text-primary flex items-center gap-2 text-lg font-semibold">
                        <FileText className="size-5" /> {/* Icon Added */}
                        {evaluateLectureData.reportTitle || t('dialog.defaultReportTitle')}
                    </DialogTitle>
                </DialogHeader>

                <ScrollArea className="grow overflow-y-auto">
                    <div className="space-y-6 p-6">
                        <div className="flex items-center justify-between">
                            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                                {/* Optional: Icon for main title */}
                                {/* <Info className="h-6 w-6 text-muted-foreground" /> */}
                                {evaluateLectureData.title || t('header.defaultTitle')}
                            </h2>
                            {/* Added Icon to Button */}
                            <MyButton type="button" size="sm">
                                <DownloadSimple className="me-2 size-4" /> {t('header.export')}
                            </MyButton>
                        </div>

                        <div className="flex flex-col items-start justify-between gap-4 rounded-lg border bg-card p-4 text-card-foreground shadow-sm sm:flex-row sm:items-center">
                            <div className="space-y-1.5 text-sm">
                                <div className="flex items-center">
                                    <span className="flex w-28 items-center gap-1.5 font-medium text-muted-foreground">
                                        {/* Optional: Icon for Lecture Title */}
                                        {/* <Info className="h-4 w-4" /> Lecture Title: */}
                                        {t('info.lectureTitle')}
                                    </span>
                                    <span className="text-foreground">
                                        {evaluateLectureData.lectureInfo?.lectureTitle ||
                                            t('info.notAvailable')}
                                    </span>
                                </div>
                                <div className="flex items-center">
                                    <span className="flex w-28 items-center gap-1.5 font-medium text-muted-foreground">
                                        <Clock className="size-4" /> {/* Icon Added */}
                                        {t('info.duration')}
                                    </span>
                                    <span className="text-foreground">
                                        {evaluateLectureData.lectureInfo?.duration ||
                                            t('info.notAvailable')}
                                    </span>
                                </div>
                                <div className="flex items-center">
                                    <span className="flex w-28 items-center gap-1.5 font-medium text-muted-foreground">
                                        <CalendarBlank className="size-4" /> {/* Icon Added */}
                                        {t('info.evaluationDate')}
                                    </span>
                                    <span className="text-foreground">
                                        {evaluateLectureData.lectureInfo?.evaluationDate ||
                                            t('info.notAvailable')}
                                    </span>
                                </div>
                            </div>

                            {/* Score section remains the same - Star rating is already visually strong */}
                            <div className="mt-4 flex items-center gap-4 sm:mt-0 sm:gap-6">
                                <div className="text-center">
                                    <span className="block text-xs uppercase text-muted-foreground">
                                        {t('score.totalScore')}
                                    </span>
                                    <span className="text-primary text-2xl font-bold">
                                        {evaluateLectureData.totalScore ?? t('info.notAvailable')}
                                    </span>
                                </div>
                                <div className="text-center">
                                    <StarRatingComponent score={totalScoreNum} />
                                    <span
                                        className={`mt-1 block text-xs font-medium ${getPerformanceColor(
                                            totalScoreNum
                                        )}`}
                                    >
                                        {t(`performance.${getPerformanceLabelKey(totalScoreNum)}`)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-6">
                            <h3 className="flex items-center gap-2 text-xl font-semibold">
                                <ListChecks className="text-primary size-5" /> {/* Icon Added */}
                                {t('criteria.heading')}
                            </h3>
                            {evaluateLectureData.criteria?.map((criterion, index) => {
                                const IconComponent = getCriteriaIcon(criterion?.name); // Get specific icon
                                
                                // Validate that criterion score doesn't exceed max
                                const getValidatedScore = () => {
                                    if (!criterion?.score) return t('info.notAvailable');
                                    const match = criterion.score.match(/(\d+)\/(\d+)/);
                                    if (match && match[1] && match[2]) {
                                        const achieved = parseInt(match[1], 10);
                                        const max = parseInt(match[2], 10);
                                        const validAchieved = Math.min(achieved, max);
                                        return `${validAchieved}/${max}`;
                                    }
                                    return criterion.score;
                                };
                                
                                return (
                                    <div
                                        key={index}
                                        className="border-primary/30 space-y-3 rounded-r-md border-l-4 bg-muted/20 py-2 pl-4"
                                    >
                                        <div className="flex items-baseline gap-3">
                                            {/* Icon Added next to criterion name */}
                                            <h4 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                                                <IconComponent className="size-5 text-muted-foreground" />
                                                {index + 1}. {criterion?.name}
                                            </h4>
                                            <span className="text-sm font-medium text-muted-foreground">
                                                {t('score.criterionScore', {
                                                    score: getValidatedScore(),
                                                })}
                                            </span>
                                        </div>

                                        {criterion?.points && criterion.points.length > 0 && (
                                            <ul className="space-y-2 pl-2">
                                                {criterion.points.map((point, pointIndex) => (
                                                    <li key={pointIndex} className="text-sm">
                                                        <span className="font-medium text-foreground">
                                                            {point?.title}:
                                                        </span>
                                                        {point?.description?.map(
                                                            (desc, descIndex) => (
                                                                <p
                                                                    key={descIndex}
                                                                    className="ml-4 list-item list-outside list-disc pl-4 text-muted-foreground"
                                                                >
                                                                    {desc}
                                                                </p>
                                                            )
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}

                                        {criterion?.scopeOfImprovement &&
                                            criterion.scopeOfImprovement.length > 0 && (
                                                <div className="mt-3 space-y-1">
                                                    <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                                                        <Lightbulb className="size-4 text-yellow-500" />{' '}
                                                        {/* Icon Added */}
                                                        {t('criteria.scopeOfImprovement')}
                                                    </span>
                                                    <ul className="list-outside list-disc space-y-1 pl-6">
                                                        {criterion.scopeOfImprovement.map(
                                                            (improvement, impIndex) => (
                                                                <li
                                                                    key={impIndex}
                                                                    className="text-sm text-muted-foreground"
                                                                >
                                                                    {improvement}
                                                                </li>
                                                            )
                                                        )}
                                                    </ul>
                                                </div>
                                            )}
                                    </div>
                                );
                            })}
                        </div>

                        {evaluateLectureData.summary && evaluateLectureData.summary.length > 0 && (
                            <>
                                <Separator />
                                <div className="space-y-2 pb-4">
                                    <h3 className="flex items-center gap-2 text-xl font-semibold">
                                        <Notebook className="text-primary size-5" />{' '}
                                        {/* Icon Added */}
                                        {t('summary.heading')}
                                    </h3>
                                    <ul className="list-outside list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                                        {evaluateLectureData.summary.map((summaryPoint, index) => (
                                            <li key={index}>{summaryPoint}</li>
                                        ))}
                                    </ul>
                                </div>
                            </>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};

export default EvaluateReportPreview;
