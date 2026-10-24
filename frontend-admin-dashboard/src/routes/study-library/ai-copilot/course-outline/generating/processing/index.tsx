import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles, ArrowLeft, Image, Video, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

export const Route = createFileRoute('/study-library/ai-copilot/course-outline/generating/processing/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryProcessing');
    const navigate = useNavigate();
    const [backToLibraryDialogOpen, setBackToLibraryDialogOpen] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);

    useEffect(() => {
        // Update elapsed time every second
        const timeInterval = setInterval(() => {
            setElapsedTime((prev) => prev + 1);
        }, 1000);

        // Redirect to viewer after 5 seconds
        const timer = setTimeout(() => {
            navigate({ to: '/study-library/ai-copilot/course-outline/generating/viewer' });
        }, 5000);

        return () => {
            clearTimeout(timer);
            clearInterval(timeInterval);
        };
    }, [navigate]);

    // Calculate estimated time remaining (example: 2-5 minutes)
    const estimatedMinutes = 3;
    const estimatedSeconds = estimatedMinutes * 60;
    const timeRemaining = Math.max(0, estimatedSeconds - elapsedTime);
    const minutesRemaining = Math.floor(timeRemaining / 60);
    const secondsRemaining = timeRemaining % 60;

    const handleBackToLibrary = () => {
        setBackToLibraryDialogOpen(true);
    };

    const handleDiscardCourse = () => {
        setBackToLibraryDialogOpen(false);
        navigate({ to: '/study-library/ai-copilot' });
    };

    const handleSaveToDrafts = () => {
        // Load current course data from localStorage
        try {
            const storedSlides = localStorage.getItem('generatedSlides');
            if (storedSlides) {
                const parsedSlides = JSON.parse(storedSlides);
                const courseData = {
                    slides: parsedSlides,
                    timestamp: new Date().toISOString()
                };
                // Get existing drafts or initialize empty array
                const existingDrafts = JSON.parse(localStorage.getItem('courseDrafts') || '[]');
                existingDrafts.push(courseData);
                localStorage.setItem('courseDrafts', JSON.stringify(existingDrafts));
            }
        } catch (e) {
            console.error('Error saving to drafts:', e);
        }
        setBackToLibraryDialogOpen(false);
        navigate({ to: '/study-library' });
    };

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>

            <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-purple-50 flex items-center justify-center">
                <div className="text-center px-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5 }}
                        className="mb-8"
                    >
                        <div className="flex justify-center mb-6">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{
                                    duration: 2,
                                    repeat: Infinity,
                                    ease: 'linear',
                                }}
                                className="relative"
                            >
                                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                                    <Sparkles className="h-12 w-12 text-white" />
                                </div>
                                <motion.div
                                    animate={{ rotate: -360 }}
                                    transition={{
                                        duration: 1.5,
                                        repeat: Infinity,
                                        ease: 'linear',
                                    }}
                                    className="absolute inset-0 border-4 border-transparent border-t-indigo-300 border-r-purple-300 rounded-full"
                                />
                            </motion.div>
                        </div>

                        <motion.h1
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.2 }}
                            className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4"
                        >
                            {t('heading')}
                        </motion.h1>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.4 }}
                            className="text-xl md:text-2xl text-neutral-600 mb-6 space-y-3"
                        >
                            <p className="font-semibold">{t('generatingSubtitle')}</p>
                            <div className="flex items-center justify-center gap-6 mt-4">
                                <div className="flex items-center gap-2 text-indigo-600">
                                    <Image className="h-5 w-5" />
                                    <span className="text-lg">{t('images')}</span>
                                </div>
                                <div className="flex items-center gap-2 text-purple-600">
                                    <Video className="h-5 w-5" />
                                    <span className="text-lg">{t('videos')}</span>
                                </div>
                            </div>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.6, delay: 0.6 }}
                            className="flex flex-col items-center justify-center gap-3 mb-6"
                        >
                            <div className="flex items-center justify-center gap-2 text-indigo-600">
                                <Loader2 className="h-6 w-6 animate-spin" />
                                <span className="text-sm font-medium">{t('processingStatus')}</span>
                            </div>

                            {/* Estimated Time Display */}
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.4, delay: 0.8 }}
                                className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2 mt-2"
                            >
                                <Clock className="h-4 w-4 text-indigo-600" />
                                <span className="text-sm font-medium text-indigo-900">
                                    {t('estimatedTimeRemaining')}{' '}
                                    {minutesRemaining > 0
                                        ? t('minutesShort', { count: minutesRemaining }) + ' '
                                        : ''}
                                    {t('secondsShort', { count: secondsRemaining })}
                                </span>
                            </motion.div>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.8 }}
                            className="text-base text-neutral-500 mb-8"
                        >
                            <p>{t('processDurationNote')}</p>
                        </motion.div>
                    </motion.div>

                    {/* Animated dots */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.8 }}
                        className="flex justify-center gap-2 mt-8"
                    >
                        {[0, 1, 2].map((index) => (
                            <motion.div
                                key={index}
                                className="w-3 h-3 rounded-full bg-indigo-500"
                                animate={{
                                    scale: [1, 1.2, 1],
                                    opacity: [0.5, 1, 0.5],
                                }}
                                transition={{
                                    duration: 1.5,
                                    repeat: Infinity,
                                    delay: index * 0.2,
                                    ease: 'easeInOut',
                                }}
                            />
                        ))}
                    </motion.div>

                    {/* Back to course library button */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 1.0 }}
                        className="mt-8 flex justify-center"
                    >
                        <MyButton
                            buttonType="secondary"
                            onClick={handleBackToLibrary}
                            className="flex items-center gap-2"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            {t('backToCourseLibrary')}
                        </MyButton>
                    </motion.div>
                </div>
            </div>

            {/* Back to study Library Prompt Confirmation Dialog */}
            <Dialog
                open={backToLibraryDialogOpen}
                onOpenChange={setBackToLibraryDialogOpen}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('dialog.title')}</DialogTitle>
                        <DialogDescription className="text-neutral-600">
                            {t('dialog.description')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-neutral-200">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setBackToLibraryDialogOpen(false)}
                            className="min-w-[100px]"
                        >
                            {t('dialog.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            onClick={handleDiscardCourse}
                            className="min-w-[120px] border-red-300 text-red-600 hover:text-red-700 hover:bg-red-50 hover:border-red-400"
                        >
                            {t('dialog.discardCourse')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleSaveToDrafts}
                            className="min-w-[130px]"
                        >
                            {t('dialog.saveToDrafts')}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>
        </LayoutContainer>
    );
}
