import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkle as Sparkles, CaretDown as ChevronDown } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { buildContentTypes, ContentType } from '../../-services/video-generation';
import { cn } from '@/lib/utils';

interface IntentChipsProps {
    selected: ContentType;
    onSelect: (type: ContentType) => void;
    onSamplePromptSelect?: (prompt: string) => void;
}

// Popular content types shown directly as chips (Claude shows ~5 inline).
// Rest accessible via the "More" popover.
const POPULAR_TYPES: ContentType[] = [
    'VIDEO',
    'SLIDES',
    'QUIZ',
    'WORKSHEET',
    'FLASHCARDS',
    'STORYBOOK',
];

const SAMPLE_PROMPTS: Record<ContentType, string[]> = {
    VIDEO: [
        'Explain the water cycle to a 5th grader using simple analogies and bright visuals.',
        'Create a 2-minute video about the history of the Roman Empire, focusing on its rise and fall.',
        'Show how a car engine works with a step-by-step breakdown of the internal combustion process.',
        'A travel guide to Kyoto, highlighting its temples, food, and culture.',
    ],
    QUIZ: [
        'Create a 10-question math quiz for 3rd graders on multiplication and division word problems.',
        'Generate a science quiz about the solar system with multiple-choice questions and fun facts.',
        'Make a geography quiz on European capitals with increasing difficulty levels.',
        'Pop culture trivia quiz about 90s movies, music, and fashion trends.',
    ],
    STORYBOOK: [
        'Write a story about a brave little toaster who travels to Mars to find the perfect slice of bread.',
        'Create a bedtime story for toddlers about a group of forest animals preparing for a winter festival.',
        'A fairy tale about a lost dragon who learns to breathe bubbles instead of fire.',
        'The adventures of a space cat exploring different planets and making alien friends.',
    ],
    INTERACTIVE_GAME: [
        'Design a memory matching game featuring endangered animals and their habitats.',
        'Create a math adventure game where players solve equations to unlock treasure chests.',
        'Build a space shooter game where players answer science questions to power up their ship.',
        'An interactive typing game that teaches touch typing with fun themes.',
    ],
    PUZZLE_BOOK: [
        'Generate a crossword puzzle about space exploration terms and famous astronauts.',
        'Create a word search puzzle hidden with names of different dinosaur species.',
        'Design a Sudoku book for beginners with helpful tips and progressive difficulty.',
        'A logic puzzle collection challenging users to solve riddles and brain teasers.',
    ],
    SIMULATION: [
        'Build a physics simulation demonstrating gravity and orbital mechanics in our solar system.',
        'Create an ecosystem balance simulation where users manage predators, prey, and resources.',
        'Design a circuit builder playground for students to learn about electricity and components.',
        'A chemistry lab simulation allowing users to mix elements and observe reactions safely.',
    ],
    FLASHCARDS: [
        'Create a set of flashcards for learning the Periodic Table of Elements with symbols and atomic numbers.',
        'Generate French vocabulary flashcards for beginners covering greetings, numbers, and common phrases.',
        'Make history flashcards with key dates, events, and important figures from World War II.',
        'Biology flashcards explaining cell structures and their functions.',
    ],
    MAP_EXPLORATION: [
        'Create an interactive map of Ancient Greece showing major city-states and historical battles.',
        'Design a clickable map of South America highlighting physical geography and biodiversity.',
        'Build an interactive world map displaying different biomes and climate zones.',
        'A historical map tracking the voyages of explorers like Marco Polo.',
    ],
    WORKSHEET: [
        'Generate a math worksheet for practicing fraction addition and subtraction with word problems.',
        'Create a reading comprehension worksheet about photosynthesis with questions and vocabulary exercises.',
        'Design a grammar worksheet for ESL students focusing on past tense verbs and sentence structure.',
        'A science worksheet labeling the parts of a plant and explaining their functions.',
    ],
    CODE_PLAYGROUND: [
        'Create a Python coding challenge to write a function that calculates the Fibonacci sequence.',
        'Design a JavaScript exercise for manipulating the DOM to change background colors.',
        'Build an HTML/CSS challenge to create a responsive flexbox layout for a photo gallery.',
        'A React tutorial guiding users to build a simple to-do list application.',
    ],
    TIMELINE: [
        'Generate a scrollable timeline of World War II events from 1939 to 1945.',
        'Create a visual timeline showing the evolution of computers from the abacus to quantum computing.',
        'Design a history of space exploration timeline highlighting key missions and milestones.',
        'A timeline of art history movements from the Renaissance to Contemporary Art.',
    ],
    CONVERSATION: [
        'Simulate a conversation for ordering food at a Spanish restaurant with a waiter.',
        'Create a job interview practice scenario for a software engineering role.',
        'Roleplay a doctor appointment dialogue discussing symptoms and treatment options.',
        'Practice a negotiation conversation for buying a used car.',
    ],
    SLIDES: [
        'Create a presentation on the water cycle — cover evaporation, condensation, precipitation, and collection with clear diagrams.',
        'Make a slide deck explaining the key events and causes of World War I for high school students.',
        'Build a pitch deck for a startup idea: an AI-powered personal finance assistant for Gen Z.',
        'Design a presentation on machine learning basics — supervised vs unsupervised learning, neural networks, and real-world applications.',
    ],
};

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                active
                    ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
        >
            {label}
        </button>
    );
}

export function IntentChips({ selected, onSelect, onSamplePromptSelect }: IntentChipsProps) {
    const [showSamples, setShowSamples] = useState(false);
    // Named `translate` (not `t`) — the content-type list below already uses
    // `t` as its per-item loop variable in several places.
    const { t: translate } = useTranslation('videoApiStudioVideoGeneration');
    const contentTypes = buildContentTypes(translate);

    const popularChips = contentTypes.filter((t) => POPULAR_TYPES.includes(t.value as ContentType));
    const overflowChips = contentTypes.filter(
        (t) => !POPULAR_TYPES.includes(t.value as ContentType)
    );

    const samples = SAMPLE_PROMPTS[selected] ?? [];

    return (
        <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap items-center justify-center gap-1.5">
                {popularChips.map((t) => (
                    <Chip
                        key={t.value}
                        label={t.label}
                        active={selected === t.value}
                        onClick={() => onSelect(t.value as ContentType)}
                    />
                ))}

                {overflowChips.length > 0 && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground"
                            >
                                More
                                <ChevronDown className="size-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="center">
                            <div className="grid grid-cols-1 gap-0.5">
                                {overflowChips.map((t) => (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => onSelect(t.value as ContentType)}
                                        className={cn(
                                            'flex flex-col items-start rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                                            selected === t.value && 'bg-muted'
                                        )}
                                    >
                                        <span className="font-medium">{t.label}</span>
                                        <span className="text-2xs text-muted-foreground">
                                            {t.description}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                )}
            </div>

            {/* Sample prompt suggestion — subtle, only when type chosen and callback provided */}
            {onSamplePromptSelect && samples.length > 0 && (
                <Popover open={showSamples} onOpenChange={setShowSamples}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="group flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-violet-600"
                        >
                            <Sparkles className="size-3 transition-colors group-hover:text-violet-600" />
                            <span>Try a sample prompt</span>
                            <ChevronDown className="size-3" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        className="w-[calc(100vw-2rem)] max-w-md p-2" /* design-lint-ignore: mobile-viewport popover clamp, no token exists (same pattern as add-event-dialog.tsx) */
                        align="center"
                        collisionPadding={16}
                    >
                        <div className="space-y-1">
                            {samples.map((p, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                        onSamplePromptSelect(p);
                                        setShowSamples(false);
                                    }}
                                    className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}
