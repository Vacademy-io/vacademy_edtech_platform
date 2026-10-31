import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useState } from 'react';
import { PlanLectureDataInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import { useTranslation } from 'react-i18next';

const PlanLecturePreview = ({
    openDialog = false,
    planLectureData,
}: {
    openDialog?: boolean;
    planLectureData: PlanLectureDataInterface;
}) => {
    const { t } = useTranslation('aiCenterPlanLecturePreview');
    const [open, setOpen] = useState(openDialog);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="no-scrollbar !m-0 h-full !w-full !max-w-full !gap-0 overflow-y-auto !rounded-none p-0">
                <h1 className="bg-primary-50 p-4 font-semibold text-primary-500">
                    {t('header.title')}
                </h1>
                <div className="flex h-screen w-full flex-col gap-4 p-6">
                    <h1 className="text-xl font-semibold">
                        {t('labels.lectureTitle', { title: planLectureData?.heading })}
                    </h1>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center">
                            <span className="text-sm font-semibold">
                                {t('labels.level')}&nbsp;
                            </span>
                            <span className="text-sm font-thin">{planLectureData?.level}</span>
                        </div>
                        <div className="flex items-center">
                            <span className="text-sm font-semibold">
                                {t('labels.modeOfTeaching')}&nbsp;
                            </span>
                            <span className="text-sm font-thin">{planLectureData?.mode}</span>
                        </div>
                        <div className="flex items-center">
                            <span className="text-sm font-semibold">
                                {t('labels.lectureLanguage')}&nbsp;
                            </span>
                            <span className="text-sm font-thin">{planLectureData?.language}</span>
                        </div>
                        <div className="flex items-center">
                            <span className="text-sm font-semibold">
                                {t('labels.lectureDuration')}&nbsp;
                            </span>
                            <span className="text-sm font-thin">{planLectureData?.duration}</span>
                        </div>
                    </div>
                    <Separator />
                    <div className="flex flex-col gap-4">
                        {planLectureData?.timeWiseSplit?.map((lectureData, idx) => {
                            return (
                                <>
                                    <div key={idx} className="flex flex-col gap-3">
                                        <div className="flex items-center gap-4">
                                            <h1 className="font-semibold">
                                                {lectureData?.sectionHeading}
                                            </h1>
                                            <span className="text-primary-300">
                                                ({lectureData?.timeSplit})
                                            </span>
                                        </div>
                                        <div className="flex items-center">
                                            <span className="text-sm font-semibold">
                                                {t('labels.topicCovered')}&nbsp;
                                            </span>
                                            <div className="flex items-center gap-2">
                                                {lectureData?.topicCovered?.map((topic, idx) => {
                                                    return (
                                                        <span
                                                            key={idx}
                                                            className="text-sm font-thin"
                                                        >
                                                            {topic}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div>
                                            <span>{t('labels.content')}</span>
                                            <p className="text-sm font-thin">
                                                {lectureData?.content}
                                            </p>
                                        </div>
                                        <div>
                                            <span>{t('labels.inLectureQuestion')}</span>
                                            <div className="flex flex-col">
                                                {lectureData?.questionToStudents?.map(
                                                    (activity, idx) => {
                                                        return (
                                                            <p
                                                                key={idx}
                                                                className="text-sm font-thin"
                                                            >
                                                                {activity}
                                                            </p>
                                                        );
                                                    }
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <span>{t('labels.activity')}</span>
                                            <div className="flex flex-col">
                                                {lectureData?.activity?.map((activity, idx) => {
                                                    return (
                                                        <p key={idx} className="text-sm font-thin">
                                                            {activity}
                                                        </p>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                    <Separator />
                                </>
                            );
                        })}
                    </div>
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-4">
                            <h1 className="font-semibold">{t('labels.assignment')}</h1>
                            <span className="text-primary-300">
                                ({t('labels.notApplicable')})
                            </span>
                        </div>
                        <div className="flex items-center">
                            <span className="text-sm font-semibold">
                                {t('labels.topicCovered')}&nbsp;
                            </span>
                            <div className="flex items-center gap-2">
                                {planLectureData?.assignment?.topicCovered?.map((topic, idx) => {
                                    return (
                                        <span key={idx} className="text-sm font-thin">
                                            {topic}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="mb-4 flex flex-col">
                            <span>{t('labels.task')}</span>
                            <div className="-mb-1 flex flex-col">
                                {planLectureData?.assignment?.tasks?.map((activity, idx) => {
                                    return (
                                        <p key={idx} className="text-sm font-thin">
                                            {idx + 1}. {activity}
                                        </p>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PlanLecturePreview;
