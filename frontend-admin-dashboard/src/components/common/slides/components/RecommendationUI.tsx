/* eslint-disable */
// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { useSlideStore } from '@/stores/Slides/useSlideStore';
import type { RecommendationBatch, Slide as AppSlide, QuizSlideData, FeedbackSlideData, ExcalidrawSlideData } from '@/stores/Slides/useSlideStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SlideEditor } from '../SlideEditor';
import { QuizSlide } from '../slidesTypes/QuizSlides';
import { SlideTypeEnum } from '../utils/types';
import { Wand2, Sparkles, X, Plus, ChevronLeft, ChevronRight, Zap } from 'lucide-react';


// --- A self-contained renderer that takes slide data directly ---
// Recommended slides are not in the deck store yet, so previews must render the slide object itself.
export const DirectSlideRenderer = ({ slide }: { slide: AppSlide }) => {
    if (!slide) return null;

    switch (slide.type) {
        case SlideTypeEnum.Quiz:
        case SlideTypeEnum.Feedback:
            const quizOrFeedbackSlide = slide as QuizSlideData | FeedbackSlideData;
            return (
                <QuizSlide
                    formdata={quizOrFeedbackSlide.elements}
                    className={'flex h-full flex-col rounded-lg bg-white p-4 shadow-inner sm:p-6'}
                    questionType={slide.type}
                    currentSlideId={slide.id}
                    key={slide.id}
                    isPresentationMode={true} // Non-interactive preview
                />
            );
        default:
            const excalidrawSlide = slide as ExcalidrawSlideData;
            return (
                <SlideEditor
                    editMode={false} // Non-interactive preview
                    slide={excalidrawSlide}
                    onSlideChange={() => {}} // No-op for preview
                />
            );
    }
};


// --- Re-usable Slide Preview (Now using DirectSlideRenderer) ---
const SlidePreview = ({ slide }: { slide: AppSlide }) => (
    <div className="w-full aspect-[16/9] bg-white rounded-2xl border border-slate-200/50 overflow-hidden shadow-xl pointer-events-none backdrop-blur-sm">
        <div className="transform scale-[0.3] origin-top-left w-[333.33%] h-[333.33%]">
             <DirectSlideRenderer slide={slide} />
        </div>
    </div>
);


// --- Main Overlay Component ---
interface RecommendationOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    onAddSlide: (slide: AppSlide) => void;
}

export const RecommendationOverlay: React.FC<RecommendationOverlayProps> = ({ isOpen, onClose, onAddSlide }) => {
    const { recommendationBatches, removeRecommendation } = useSlideStore(state => ({
        recommendationBatches: state.recommendationBatches,
        removeRecommendation: state.removeRecommendation,
    }));

    const [currentIndex, setCurrentIndex] = useState(0);

    // Flatten the batches into a single array for easier navigation, while keeping the timestamp
    const allRecommendations = useMemo(() => {
        return recommendationBatches.flatMap(batch => 
            batch.slides.map(slide => ({ ...slide, timestamp: batch.timestamp }))
        );
    }, [recommendationBatches]);

    const currentSlide = allRecommendations[currentIndex];

    // Reset index when modal is closed or the list of recommendations changes
    useEffect(() => {
        if (!isOpen) {
            // Delay reset to allow closing animation
            setTimeout(() => setCurrentIndex(0), 300);
        }
    }, [isOpen]);

    // Effect to handle the current index if a slide is removed (e.g., added to presentation)
     useEffect(() => {
        if (allRecommendations.length > 0 && currentIndex >= allRecommendations.length) {
            setCurrentIndex(allRecommendations.length - 1);
        }
    }, [allRecommendations.length, currentIndex]);


    const handleAddClick = () => {
        if (!currentSlide) return;
        onAddSlide(currentSlide);
        // The state update from useSlideStore will trigger a re-render and the useEffect above
        // will adjust the index if necessary.
        removeRecommendation(currentSlide.timestamp, currentSlide.id);
    };

    const goToNext = () => {
        if (currentIndex < allRecommendations.length - 1) {
            setCurrentIndex(prev => prev + 1);
        }
    };

    const goToPrev = () => {
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[90vw] sm:w-[80vw] lg:w-[70vw] xl:w-[60vw] max-w-6xl h-[90vh] flex flex-col p-0 bg-white/95 backdrop-blur-xl border-white/20 shadow-2xl rounded-2xl overflow-hidden">
                {/* Enhanced background effects */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-white to-purple-50/50 pointer-events-none" />
                <div className="absolute top-0 right-1/4 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-1/4 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl" />
                
                <DialogHeader className="relative z-10 p-6 pb-4 border-b border-slate-200/50 bg-white/80 backdrop-blur-sm shrink-0">
                    <DialogTitle className="text-2xl lg:text-3xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl shadow-lg">
                            <Sparkles className="text-white" size={24} />
                        </div>
                        <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                            AI Slide Recommendations
                        </span>
                    </DialogTitle>
                </DialogHeader>
                
                <div className="relative z-10 flex-grow bg-gradient-to-b from-slate-50/50 to-white/50 flex flex-col items-center justify-center overflow-hidden">
                    {allRecommendations.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="mb-6">
                                <div className="w-16 h-16 bg-gradient-to-r from-slate-300 to-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                                    <Wand2 className="text-white" size={32} />
                                </div>
                            </div>
                            <p className="text-slate-500 text-lg font-medium mb-2">No recommendations available</p>
                            <p className="text-slate-400 text-sm">AI recommendations will appear here when available.</p>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center w-full h-full p-4 sm:p-6 lg:p-8 gap-3 sm:gap-4 lg:gap-6">
                            <Button 
                                variant="outline" 
                                size="icon" 
                                className="h-12 w-12 lg:h-14 lg:w-14 rounded-full shrink-0 bg-white/80 backdrop-blur-sm border-slate-300 hover:bg-white hover:border-purple-400 transition-all duration-200 hover:scale-105 shadow-lg" 
                                onClick={goToPrev} 
                                disabled={currentIndex === 0}
                            >
                                <ChevronLeft className="h-6 w-6 lg:h-7 lg:w-7" />
                            </Button>
                            
                            <div className="flex-grow flex flex-col items-center justify-center h-full w-full max-w-5xl">
                                <div className="w-full flex-grow relative flex items-center justify-center p-4">
                                    <SlidePreview slide={currentSlide} />
                                </div>
                                <div className="w-full pt-4 text-center shrink-0">
                                    {currentSlide.name && (
                                        <p className="text-lg lg:text-xl font-bold text-slate-800 truncate mb-2" title={currentSlide.name}>
                                            {currentSlide.name}
                                        </p>
                                    )}
                                    <div className="flex items-center justify-center gap-2 mb-3">
                                        <div className="px-3 py-1 bg-purple-100/80 backdrop-blur-sm rounded-lg border border-purple-200/50">
                                            <span className="text-sm font-medium text-purple-700">
                                                {currentIndex + 1} of {allRecommendations.length}
                                            </span>
                                        </div>
                                        <div className="px-3 py-1 bg-blue-100/80 backdrop-blur-sm rounded-lg border border-blue-200/50">
                                            <span className="text-sm font-medium text-blue-700">
                                                {currentSlide.timestamp}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <Button 
                                variant="outline" 
                                size="icon" 
                                className="h-12 w-12 lg:h-14 lg:w-14 rounded-full shrink-0 bg-white/80 backdrop-blur-sm border-slate-300 hover:bg-white hover:border-purple-400 transition-all duration-200 hover:scale-105 shadow-lg" 
                                onClick={goToNext} 
                                disabled={currentIndex >= allRecommendations.length - 1}
                            >
                                <ChevronRight className="h-6 w-6 lg:h-7 lg:w-7" />
                            </Button>
                        </div>
                    )}
                </div>
                {currentSlide && (
                     <div className="relative z-10 p-4 sm:p-6 border-t border-slate-200/50 bg-white/80 backdrop-blur-sm flex justify-center shrink-0">
                        <Button 
                            className="w-full sm:w-auto min-w-[200px] bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-purple-500/25 transition-all duration-300 hover:scale-105 border border-purple-500/30" 
                            size="lg"
                            onClick={handleAddClick}
                        >
                            <Plus className="mr-2 size-5" /> Add After Current Slide
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};


// --- Toast Notification Component ---
interface RecommendationToastProps {
  onShowRecommendations: () => void;
}

export const RecommendationToast: React.FC<RecommendationToastProps> = ({ onShowRecommendations }) => {
    const [isVisible, setIsVisible] = useState(false);
    const recommendationBatches = useSlideStore(state => state.recommendationBatches);

    useEffect(() => {
        if (recommendationBatches.length > 0) {
            setIsVisible(true);
        } else {
            setIsVisible(false);
        }
    }, [recommendationBatches]);

    if (!isVisible) return null;

    return (
        <div className="fixed top-24 right-5 z-[2000] animate-in slide-in-from-right-10 duration-500">
            <div className="p-4 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 flex items-center gap-4 min-w-[320px]">
                {/* Enhanced background effects */}
                <div className="absolute inset-0 bg-gradient-to-r from-purple-50/50 via-white to-blue-50/50 rounded-2xl pointer-events-none" />
                <div className="absolute top-0 right-0 w-16 h-16 bg-purple-500/10 rounded-full blur-xl" />
                
                <div className="relative z-10 p-3 bg-gradient-to-r from-purple-500 to-purple-600 rounded-2xl shadow-lg">
                    <Wand2 className="size-6 text-white" />
                </div>
                <div className="relative z-10 flex-1">
                    <p className="font-bold text-slate-800 mb-1">New AI Recommendations</p>
                    <p className="text-sm text-slate-600">Smart suggestions are ready for your presentation.</p>
                </div>
                <div className="relative z-10 flex items-center gap-2">
                    <Button 
                        size="sm" 
                        onClick={onShowRecommendations}
                        className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-semibold rounded-lg shadow-lg shadow-purple-500/25 transition-all duration-200 hover:scale-105"
                    >
                        <Zap className="mr-1" size={14} />
                        View
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="size-8 rounded-lg hover:bg-slate-100 transition-all duration-200 hover:scale-105" 
                        onClick={() => setIsVisible(false)}
                    >
                    <X className="size-4" />
                </Button>
                </div>
            </div>
        </div>
    );
}; 