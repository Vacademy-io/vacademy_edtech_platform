/* eslint-disable */
// @ts-nocheck
'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
    X, 
    Lightbulb, 
    Plus, 
    ChevronLeft, 
    ChevronRight, 
    Clock,
    Wand2,
    Sparkles
} from 'lucide-react';
import { useSlideStore } from '@/stores/Slides/useSlideStore';
import type { Slide, RecommendationBatch } from '@/stores/Slides/useSlideStore';
import { DirectSlideRenderer } from './RecommendationUI';
import { SlideTypeEnum } from '../utils/types';

interface RecommendationsSidePanelProps {
    isOpen: boolean;
    onClose: () => void;
    onAddSlide?: (slide: Slide, insertionBehavior: 'next' | 'end') => void;
    topOffset?: string; // To account for the action bar height
}

export const RecommendationsSidePanel: React.FC<RecommendationsSidePanelProps> = ({
    isOpen,
    onClose,
    onAddSlide,
    topOffset = '4rem',
}) => {
    const { recommendationBatches, removeRecommendation, clearRecommendations } = useSlideStore(state => ({
        recommendationBatches: state.recommendationBatches,
        removeRecommendation: state.removeRecommendation,
        clearRecommendations: state.clearRecommendations,
    }));

    const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

    // Get current batch and slide
    const currentBatch = recommendationBatches[currentBatchIndex];
    const currentSlide = currentBatch?.slides[currentSlideIndex];

    // Count total recommendations
    const totalRecommendations = useMemo(() => {
        return recommendationBatches.reduce((sum, batch) => sum + batch.slides.length, 0);
    }, [recommendationBatches]);

    // Navigation functions
    const goToNextSlide = () => {
        if (!currentBatch) return;
        
        if (currentSlideIndex < currentBatch.slides.length - 1) {
            setCurrentSlideIndex(prev => prev + 1);
        } else if (currentBatchIndex < recommendationBatches.length - 1) {
            setCurrentBatchIndex(prev => prev + 1);
            setCurrentSlideIndex(0);
        }
    };

    const goToPreviousSlide = () => {
        if (currentSlideIndex > 0) {
            setCurrentSlideIndex(prev => prev - 1);
        } else if (currentBatchIndex > 0) {
            setCurrentBatchIndex(prev => prev - 1);
            const prevBatch = recommendationBatches[currentBatchIndex - 1];
            setCurrentSlideIndex(prevBatch.slides.length - 1);
        }
    };

    const getCurrentPosition = () => {
        let position = 0;
        for (let i = 0; i < currentBatchIndex; i++) {
            position += recommendationBatches[i].slides.length;
        }
        position += currentSlideIndex + 1;
        return position;
    };

    const handleAddSlide = (behavior: 'next' | 'end' = 'next') => {
        if (!currentSlide || !onAddSlide) return;
        
        onAddSlide(currentSlide, behavior);
        removeRecommendation(currentBatch.timestamp, currentSlide.id);
        
        // Navigate to next slide if current one was removed
        if (currentBatch.slides.length > 1) {
            if (currentSlideIndex >= currentBatch.slides.length - 1) {
                setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1));
            }
        } else {
            // If this was the last slide in the batch, move to next batch
            if (currentBatchIndex < recommendationBatches.length - 1) {
                setCurrentBatchIndex(prev => prev + 1);
                setCurrentSlideIndex(0);
            } else if (currentBatchIndex > 0) {
                setCurrentBatchIndex(prev => prev - 1);
                setCurrentSlideIndex(0);
            }
        }
    };

    const canGoNext = useMemo(() => {
        if (!currentBatch) return false;
        return currentSlideIndex < currentBatch.slides.length - 1 || 
               currentBatchIndex < recommendationBatches.length - 1;
    }, [currentBatch, currentSlideIndex, currentBatchIndex, recommendationBatches.length]);

    const canGoPrevious = useMemo(() => {
        return currentSlideIndex > 0 || currentBatchIndex > 0;
    }, [currentSlideIndex, currentBatchIndex]);

    if (!isOpen) return null;

    return (
        <div className={`fixed right-0 top-0 h-full w-[480px] lg:w-[520px] z-[1006] transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
             style={{ paddingTop: topOffset }}>
            <div className="h-full bg-slate-900/95 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-orange-900/20 to-purple-900/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl shadow-lg">
                            <Wand2 size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-lg">AI Recommendations</h3>
                            <p className="text-white/60 text-sm">
                                {totalRecommendations} smart suggestions available
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-all duration-200 hover:scale-105"
                    >
                        <X size={16} />
                    </Button>
                </div>

                {/* Content */}
                {totalRecommendations === 0 ? (
                    /* Empty State */
                    <div className="flex-1 flex items-center justify-center p-8">
                        <div className="text-center">
                            <div className="mb-6 p-6 rounded-full bg-orange-500/10 w-fit mx-auto">
                                <Lightbulb size={48} className="text-orange-400" />
                            </div>
                            <h4 className="text-white font-semibold text-lg mb-2">No Recommendations Yet</h4>
                            <p className="text-white/60 text-sm max-w-sm">
                                AI is listening to your presentation and will generate smart slide suggestions every 2 minutes.
                            </p>
                            <div className="mt-4 flex items-center justify-center gap-2 text-orange-300 text-sm">
                                <Sparkles size={16} className="animate-pulse" />
                                <span>Next batch coming soon...</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col">
                        {/* Batch Info */}
                        {currentBatch && (
                            <div className="p-3 bg-slate-800/50 border-b border-white/5">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Clock size={14} className="text-white/60" />
                                        <span className="text-white/80 text-sm font-medium">
                                            Generated from {currentBatch.timestamp}
                                        </span>
                                    </div>
                                    <Badge variant="secondary" className="bg-orange-500/20 text-orange-300 border-orange-400/30">
                                        {currentBatch.slides.length} slides
                                    </Badge>
                                </div>
                            </div>
                        )}

                        {/* Slide Preview */}
                        {currentSlide && (
                            <div className="flex-1 flex flex-col">
                                {/* Slide Navigation */}
                                <div className="p-3 border-b border-white/10 bg-slate-800/30">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={goToPreviousSlide}
                                                disabled={!canGoPrevious}
                                                className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white/60 hover:text-white disabled:text-white/30 transition-all duration-200 hover:scale-105 disabled:scale-100"
                                            >
                                                <ChevronLeft size={16} />
                                            </Button>
                                            <span className="text-white/80 text-sm font-medium px-3">
                                                {getCurrentPosition()} / {totalRecommendations}
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={goToNextSlide}
                                                disabled={!canGoNext}
                                                className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white/60 hover:text-white disabled:text-white/30 transition-all duration-200 hover:scale-105 disabled:scale-100"
                                            >
                                                <ChevronRight size={16} />
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-white/60 text-xs">
                                                {currentSlide.type === SlideTypeEnum.Quiz ? 'Quiz' : 
                                                 currentSlide.type === SlideTypeEnum.Feedback ? 'Feedback' : 
                                                 'Drawing'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Slide Content */}
                                <div className="flex-1 p-4 bg-gradient-to-b from-slate-800/20 to-slate-900/40">
                                    <div className="h-full bg-white rounded-xl overflow-hidden shadow-2xl border border-white/20">
                                        <div className="h-full p-2">
                                            {/* SlideRenderer looks the id up in the deck store, where a
                                                recommendation does not exist yet ("Slide data not found") */}
                                            <DirectSlideRenderer slide={currentSlide} />
                                        </div>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="p-4 border-t border-white/10 bg-slate-800/50">
                                    <div className="flex gap-3">
                                        <Button
                                            onClick={() => handleAddSlide('next')}
                                            className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-green-500/25"
                                        >
                                            <Plus size={16} className="mr-2" />
                                            Add Next
                                        </Button>
                                        <Button
                                            onClick={() => handleAddSlide('end')}
                                            variant="outline"
                                            className="flex-1 border-white/20 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl transition-all duration-300 hover:scale-105"
                                        >
                                            Add to End
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Footer Actions */}
                {totalRecommendations > 0 && (
                    <div className="p-4 border-t border-white/10 bg-slate-800/30">
                        <Button
                            onClick={clearRecommendations}
                            variant="outline"
                            className="w-full border-red-400/50 bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-200 font-medium rounded-xl transition-all duration-300 hover:scale-105"
                        >
                            Clear All Recommendations
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}; 