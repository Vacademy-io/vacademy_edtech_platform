import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Card } from '@/components/ui/card';
import {
    ArrowRight,
    CalendarCheck,
    GraduationCap,
    MagicWand,
    Robot,
    SquaresFour,
    StarFour,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const Route = createLazyFileRoute('/explore-ai')({
    component: ExploreAIPage,
});

function ExploreAIPage() {
    const navigate = useNavigate();

    const features = [
        {
            title: 'Create Educational Content',
            description: 'Videos, Storybooks, Quizzes, Timeline',
            path: '/video-api-studio/console',
            icon: MagicWand,
            gradient:
                'from-blue-500/10 to-indigo-500/10 hover:from-blue-500/20 hover:to-indigo-500/20',
            border: 'hover:border-blue-500/50',
            textAccent: 'text-blue-600',
            iconColor: 'text-blue-500',
            accentColor: 'bg-blue-500',
        },
        {
            title: `Create End to End ${getTerminology(ContentTerms.Course, SystemTerms.Course)}`,
            description: 'PPT, Diagrams, Videos, Quizzes, Assignments',
            path: '/study-library/ai-copilot',
            icon: GraduationCap,
            gradient:
                'from-purple-500/10 to-violet-500/10 hover:from-purple-500/20 hover:to-violet-500/20',
            border: 'hover:border-purple-500/50',
            textAccent: 'text-purple-600',
            iconColor: 'text-purple-500',
            accentColor: 'bg-purple-500',
        },
        {
            title: 'Lecture Assistant',
            description: 'Notes, Quizzes, Flashcards from Live Lecture',
            path: '/instructor-copilot',
            icon: Robot,
            gradient:
                'from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20',
            border: 'hover:border-amber-500/50',
            textAccent: 'text-amber-600',
            iconColor: 'text-amber-500',
            accentColor: 'bg-amber-500',
        },
        {
            title: 'Lecture Planner',
            description: 'Plan your lecture before you start class',
            path: '/ai-center/ai-tools/vsmart-lecture',
            icon: CalendarCheck,
            gradient:
                'from-emerald-500/10 to-teal-500/10 hover:from-emerald-500/20 hover:to-teal-500/20',
            border: 'hover:border-emerald-500/50',
            textAccent: 'text-emerald-600',
            iconColor: 'text-emerald-500',
            accentColor: 'bg-emerald-500',
        },
        {
            title: 'Other AI Learning Tools',
            description: 'Explore all available AI tools',
            path: '/ai-center/ai-tools',
            icon: SquaresFour,
            gradient: 'from-pink-500/10 to-rose-500/10 hover:from-pink-500/20 hover:to-rose-500/20',
            border: 'hover:border-pink-500/50',
            textAccent: 'text-pink-600',
            iconColor: 'text-pink-500',
            accentColor: 'bg-pink-500',
        },
    ];

    return (
        <LayoutContainer showMobileBackButton={true}>
            <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 p-3 sm:gap-4 sm:p-4 md:gap-6 md:p-6">
                {/* Header - Compact on mobile */}
                <div className="flex items-center gap-2.5 sm:gap-3">
                    <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 p-1.5 shadow-sm sm:p-2">
                        <StarFour weight="fill" className="size-4 text-white sm:size-5" />
                    </div>
                    <div>
                        <h1 className="text-base font-bold leading-tight text-gray-900 sm:text-xl">
                            Explore AI Features
                        </h1>
                        <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                            Power up your teaching with next-gen tools
                        </p>
                    </div>
                </div>

                {/* Cards Grid - List layout on mobile, grid on desktop */}
                <div className="flex flex-col gap-2.5 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                    {features.map((feature, index) => (
                        <Card
                            key={index}
                            className={cn(
                                'group relative cursor-pointer overflow-hidden border border-transparent bg-white/50 backdrop-blur-sm transition-all duration-300',
                                'active:scale-[0.98] sm:hover:-translate-y-0.5 sm:hover:shadow-md',
                                feature.border
                            )}
                            onClick={() => navigate({ to: feature.path })}
                        >
                            {/* Colorful Gradient Background */}
                            <div
                                className={cn(
                                    'absolute inset-0 bg-gradient-to-br opacity-50 transition-opacity',
                                    feature.gradient
                                )}
                            />

                            <div className="relative flex h-full flex-row items-center gap-3 p-3 sm:gap-4 sm:p-4">
                                {/* Text Content */}
                                <div className="z-10 flex min-w-0 flex-1 flex-col gap-0.5 sm:gap-1.5">
                                    <div className="flex items-center gap-2">
                                        {/* Small color indicator dot on mobile */}
                                        <div
                                            className={cn(
                                                'size-1.5 shrink-0 rounded-full sm:hidden',
                                                feature.accentColor
                                            )}
                                        />
                                        <h3
                                            className={cn(
                                                'line-clamp-1 text-sm font-bold sm:text-base',
                                                feature.textAccent
                                            )}
                                        >
                                            {feature.title}
                                        </h3>
                                    </div>
                                    <p className="line-clamp-1 text-[11px] font-medium leading-snug text-gray-500 sm:line-clamp-2 sm:text-xs sm:leading-relaxed">
                                        {feature.description}
                                    </p>

                                    {/* "Get Started" visible on mobile as a subtle arrow, animated on desktop */}
                                    <div
                                        className={cn(
                                            'mt-1 inline-flex items-center text-[11px] font-semibold sm:mt-2 sm:text-xs',
                                            'sm:-translate-x-2 sm:opacity-0 sm:transition-all sm:duration-300 sm:group-hover:translate-x-0 sm:group-hover:opacity-100',
                                            feature.textAccent
                                        )}
                                    >
                                        <span className="hidden sm:inline">Get Started</span>
                                        <ArrowRight className="size-3 sm:ml-1" />
                                    </div>
                                </div>

                                {/* Icon - Replaces ImageKey */}
                                <div className="relative flex size-14 shrink-0 items-center justify-center sm:size-24">
                                    <div className="absolute inset-0 hidden scale-75 rounded-full bg-white/50 blur-xl transition-transform duration-500 group-hover:scale-100 sm:block" />
                                    <div className="relative z-10 flex size-full items-center justify-center drop-shadow-sm transition-transform duration-300 sm:group-hover:scale-110">
                                        <feature.icon
                                            weight="duotone"
                                            className={cn('size-8 sm:size-12', feature.iconColor)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>
        </LayoutContainer>
    );
}
