import React, { useState, useEffect } from 'react';
import {
    Bot,
    FileText,
    BrainCircuit,
    Sparkles,
    CheckCircle,
    FileUp,
    RefreshCw,
    Layers,
} from 'lucide-react';
import { StopCircle, Waveform, PaperPlaneTilt } from '@phosphor-icons/react';

export const aiSteps = [
    { text: 'Analyzing your topic...', icon: BrainCircuit },
    { text: 'Structuring the outline...', icon: FileText },
    { text: 'Drafting content for each slide...', icon: Bot },
    { text: 'Creating assessment questions...', icon: Sparkles },
    { text: 'Finalizing your Volt...', icon: CheckCircle },
];

export const pptSteps = [
    { text: 'Uploading your Volt...', icon: FileUp },
    { text: 'Converting file format...', icon: RefreshCw },
    { text: 'Extracting slides and content...', icon: Layers },
    { text: 'Processing images and text...', icon: Sparkles },
    { text: 'Finalizing your new slides...', icon: CheckCircle },
];

export const finishSessionSteps = [
    { text: 'Ending session on server...', icon: StopCircle },
    { text: 'Transcribing audio...', icon: Waveform },
    { text: 'Sending summary...', icon: PaperPlaneTilt },
];

interface Step {
    text: string;
    icon?: React.ElementType<{ className?: string }>;
}

interface AiGeneratingLoaderProps {
    title?: string;
    description?: string;
    steps: Step[];
}

export const AiGeneratingLoader = ({
    title = 'Generating your Volt',
    description = 'Our AI is crafting your content. This may take a moment.',
    steps,
}: AiGeneratingLoaderProps) => {
    const [currentStepIndex, setCurrentStepIndex] = useState(0);

    useEffect(() => {
        // This simulates progress. The total duration is roughly in line with the expected wait time.
        const stepDuration = Math.max(1000, 50000 / steps.length); // Aim for a ~50s total time
        const interval = setInterval(() => {
            setCurrentStepIndex((prev) => {
                if (prev < steps.length - 1) {
                    return prev + 1;
                }
                clearInterval(interval); // Stop interval on the last step
                return prev;
            });
        }, stepDuration);

        return () => clearInterval(interval);
    }, [steps.length]);

    return (
        <div className="flex min-h-[350px] flex-col items-center justify-center space-y-4 rounded-lg bg-white p-8">
            <div className="relative">
                <Bot className="size-12 animate-pulse text-orange-500" />
                <Sparkles className="absolute -right-2 -top-2 size-5 text-yellow-400" />
            </div>
            <h2 className="text-center text-xl font-bold text-neutral-800">{title}</h2>
            <p className="px-4 text-center text-sm text-neutral-600">{description}</p>

            <div className="w-full space-y-3 px-4 pt-2">
                {steps.map((step, index) => {
                    // A step without an icon must not crash the loader (React cannot render undefined)
                    const Icon = step.icon ?? Sparkles;
                    const isActive = index === currentStepIndex;
                    const isCompleted = index < currentStepIndex;

                    return (
                        <div
                            key={index}
                            className="flex items-center space-x-4 transition-all duration-300"
                        >
                            <div className="flex size-8 items-center justify-center">
                                {isCompleted ? (
                                    <CheckCircle className="size-6 text-green-500" />
                                ) : (
                                    <div className="relative flex size-6 items-center justify-center">
                                        {isActive && (
                                            <div className="absolute size-full animate-ping rounded-full bg-orange-200"></div>
                                        )}
                                        <Icon
                                            className={`size-4 transition-colors duration-300 ${isActive ? 'text-orange-600' : 'text-neutral-400'}`}
                                        />
                                    </div>
                                )}
                            </div>
                            <span
                                className={`text-sm transition-colors duration-300 ${isActive ? 'font-semibold text-orange-600' : isCompleted ? 'text-neutral-700 line-through' : 'text-neutral-500'}`}
                            >
                                {step.text}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
