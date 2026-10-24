import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    FileText,
    Video,
    FileType,
    ChevronRight,
    ChevronDown,
    Folder,
    FolderOpen,
    CheckCircle2,
} from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { Step2Data } from './add-course-step2';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { CourseSettingsData } from '@/types/course-settings';

// Types and mockCourses remain the same as in your previous version
// ... (Slide, Chapter, Module, Subject, Course, mockCourses types) ...
type Slide = {
    id: string;
    name: string;
    type: 'video' | 'pdf' | 'doc';
};

type Chapter = {
    id: string;
    name: string;
    slides: Slide[];
    isOpen?: boolean;
};

type Module = {
    id: string;
    name: string;
    chapters?: Chapter[]; // For 4 and 5 level
    slides?: Slide[]; // For 2 and 3 level
    isOpen?: boolean;
};

type Subject = {
    id: string;
    name: string;
    modules: Module[];
    isOpen?: boolean;
};

interface Course {
    id: string;
    title: string;
    level: 2 | 3 | 4 | 5;
    structure: {
        courseName: string;
        items: Subject[] | Module[] | Slide[];
    };
}

// A function (not a module-scope array) so the titles pick up the institute's
// naming settings at render time rather than freezing them at import.
const getMockCourses = (): Course[] => [
    {
        id: '1',
        title: `2-Level ${getTerminology(ContentTerms.Course, SystemTerms.Course)} Structure`,
        level: 2,
        structure: {
            courseName: 'Introduction to Web Development',
            items: [
                {
                    id: 's1-1',
                    name: 'Welcome Video: Getting Started with HTML, CSS, and JavaScript Fundamentals',
                    type: 'video',
                },
                {
                    id: 's1-2',
                    name: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Overview: Syllabus and Learning Objectives`,
                    type: 'pdf',
                },
                {
                    id: 's1-3',
                    name: 'Setting up your development environment: Tools and Configurations',
                    type: 'doc',
                },
            ] as Slide[],
        },
    },
    {
        id: '2',
        title: `3-Level ${getTerminology(ContentTerms.Course, SystemTerms.Course)} Structure`,
        level: 3,
        structure: {
            courseName: 'Frontend Fundamentals',
            items: [
                {
                    id: 'm2-1',
                    name: 'Module 1: HTML Basics and Advanced Tags',
                    isOpen: true,
                    slides: [
                        { id: 's2-1-1', name: 'Introduction to HTML Structure', type: 'video' },
                        { id: 's2-1-2', name: 'Common HTML Tags and Attributes', type: 'pdf' },
                    ],
                },
                {
                    id: 'm2-2',
                    name: 'Module 2: CSS Styling and Layout Techniques',
                    isOpen: false,
                    slides: [
                        { id: 's2-2-1', name: 'Introduction to CSS Selectors', type: 'video' },
                        {
                            id: 's2-2-2',
                            name: 'Selectors, Properties, and The Box Model',
                            type: 'doc',
                        },
                    ],
                },
            ] as Module[],
        },
    },
    {
        id: '3',
        title: `4-Level ${getTerminology(ContentTerms.Course, SystemTerms.Course)} Structure`,
        level: 4,
        structure: {
            courseName: 'Full-Stack JavaScript Development Mastery',
            items: [
                {
                    id: 'm3-1',
                    name: 'Module 1: Backend Development with Node.js and Express',
                    isOpen: true,
                    chapters: [
                        {
                            id: 'c3-1-1',
                            name: `${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} 1.1: Express.js Fundamentals and Middleware`,
                            isOpen: true,
                            slides: [
                                {
                                    id: 's3-1-1-1',
                                    name: 'Introduction to Express Framework',
                                    type: 'video',
                                },
                                {
                                    id: 's3-1-1-2',
                                    name: 'Understanding Routing and Middleware',
                                    type: 'pdf',
                                },
                            ],
                        },
                        {
                            id: 'c3-1-2',
                            name: `${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} 1.2: Databases and ORM/ODM Integration`,
                            isOpen: false,
                            slides: [
                                {
                                    id: 's3-1-2-1',
                                    name: 'MongoDB Introduction and Setup',
                                    type: 'video',
                                },
                                { id: 's3-1-2-2', name: 'Working with Mongoose ODM', type: 'doc' },
                            ],
                        },
                    ],
                },
            ] as Module[],
        },
    },
    {
        id: '4',
        title: `5-Level ${getTerminology(ContentTerms.Course, SystemTerms.Course)} Structure`,
        level: 5,
        structure: {
            courseName: 'Advanced Software Engineering Principles',
            items: [
                {
                    id: 'sub4-1',
                    name: 'Subject 1: Advanced System Design Patterns',
                    isOpen: true,
                    modules: [
                        {
                            id: 'm4-1-1',
                            name: 'Module 1.1: Scalability and Distributed Systems',
                            isOpen: true,
                            chapters: [
                                {
                                    id: 'c4-1-1-1',
                                    name: `${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} 1.1.1: Horizontal and Vertical Scaling Strategies`,
                                    isOpen: true,
                                    slides: [
                                        {
                                            id: 's4-1-1-1-1',
                                            name: 'Detailed Scaling Techniques and Trade-offs',
                                            type: 'video',
                                        },
                                    ],
                                },
                                {
                                    id: 'c4-1-1-2',
                                    name: `${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} 1.1.2: Microservices Architecture Considerations`,
                                    isOpen: false,
                                    slides: [
                                        {
                                            id: 's4-1-1-2-1',
                                            name: 'Design Principles for Microservices',
                                            type: 'pdf',
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: 'sub4-2',
                    name: 'Subject 2: DevOps Practices and CI/CD Pipelines',
                    isOpen: false,
                    modules: [
                        {
                            id: 'm4-2-1',
                            name: 'Module 2.1: Continuous Integration and Deployment',
                            isOpen: true,
                            chapters: [
                                {
                                    id: 'c4-2-1-1',
                                    name: `${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} 2.1.1: Implementing CI/CD with Jenkins and Docker`,
                                    isOpen: true,
                                    slides: [
                                        {
                                            id: 's4-2-1-1-1',
                                            name: 'Building Automated Jenkins Pipelines',
                                            type: 'doc',
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ] as Subject[],
        },
    },
];

const getIconForType = (type: Slide['type']) => {
    switch (type) {
        case 'video':
            return <Video className="mr-1.5 size-4 shrink-0 text-sky-500" />;
        case 'pdf':
            return <FileText className="mr-1.5 size-4 shrink-0 text-rose-500" />;
        case 'doc':
            return <FileType className="mr-1.5 size-4 shrink-0 text-emerald-500" />;
        default:
            return <FileText className="mr-1.5 size-4 shrink-0 text-gray-400" />;
    }
};

type TreeItem = Subject | Module | Chapter | Slide;

interface RecursiveStructureProps {
    items: TreeItem[];
    level: number;
    onToggle: (itemId: string) => void;
    parentIsLast?: boolean[]; // Tracks if parent containers were last items
}

const RecursiveStructure: React.FC<RecursiveStructureProps> = ({
    items,
    level,
    onToggle,
    parentIsLast = [],
}) => {
    const indentSize = 16; // Compact indentation
    return (
        <>
            {items.map((item, index) => {
                const isLast = index === items.length - 1;
                const currentLineageIsLast = [...parentIsLast];

                const isSlide = (i: TreeItem): i is Slide => 'type' in i;
                const isContainer = (i: TreeItem): i is Subject | Module | Chapter =>
                    'isOpen' in i &&
                    ('modules' in i || 'chapters' in i || ('slides' in i && !('type' in i)));

                const itemRowPaddingLeft = '16px'; // Padding for the content part (icon + text), matches indent for lines

                return (
                    <div
                        key={item.id}
                        className="tree-item-wrapper relative"
                        style={{ paddingLeft: `${level * indentSize}px` }}
                    >
                        {currentLineageIsLast.map(
                            (wasParentLast, i) =>
                                !wasParentLast && (
                                    <span
                                        key={`line-guide-${i}`}
                                        className="absolute inset-y-0 w-px bg-gray-200 dark:bg-gray-700"
                                        style={{
                                            left: `${i * indentSize + (indentSize / 2 - 1)}px`,
                                        }}
                                    />
                                )
                        )}
                        {level > 0 && (
                            <>
                                <span
                                    className="absolute top-0 w-px bg-gray-200 dark:bg-gray-700"
                                    style={{
                                        left: `${(level - 1) * indentSize + (indentSize / 2 - 1)}px`,
                                        height:
                                            isLast && !isContainer(item)
                                                ? '14px'
                                                : // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                                  isContainer(item) && !item.isOpen && isLast
                                                  ? '14px'
                                                  : '100%',
                                    }}
                                />
                                <span
                                    className="absolute h-px bg-gray-200 dark:bg-gray-700"
                                    style={{
                                        left: `${(level - 1) * indentSize + (indentSize / 2 - 1)}px`,
                                        top: '14px', // Adjusted to align with py-1 and text-xs/sm
                                        width: `${indentSize / 2 + 1}px`,
                                    }}
                                />
                            </>
                        )}

                        {isSlide(item) ? (
                            <div
                                style={{ paddingLeft: itemRowPaddingLeft }}
                                className="group flex w-full cursor-pointer items-center rounded-sm py-1 text-left text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                                title={item.name}
                            >
                                {getIconForType(item.type)}
                                <span className="truncate transition-colors duration-150 group-hover:text-gray-800 dark:group-hover:text-gray-200">
                                    {item.name}
                                </span>
                            </div>
                        ) : (
                            (() => {
                                let childrenToRecurse: TreeItem[] | undefined;
                                const isSubject = (i: TreeItem): i is Subject => 'modules' in i;
                                if (isSubject(item)) {
                                    childrenToRecurse = item.modules;
                                } else if (
                                    'chapters' in item &&
                                    item.chapters &&
                                    !('type' in item)
                                ) {
                                    childrenToRecurse = item.chapters as TreeItem[];
                                } else if ('slides' in item && item.slides && !('type' in item)) {
                                    childrenToRecurse = item.slides as TreeItem[];
                                }

                                if (childrenToRecurse && isContainer(item)) {
                                    const isOpen = item.isOpen;
                                    return (
                                        <Collapsible
                                            open={isOpen}
                                            onOpenChange={() => onToggle(item.id)}
                                            className="w-full"
                                        >
                                            <CollapsibleTrigger asChild>
                                                <button
                                                    style={{ paddingLeft: itemRowPaddingLeft }}
                                                    className="group flex w-full items-center rounded-sm py-1 pr-1.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
                                                    title={item.name}
                                                >
                                                    {isOpen ? (
                                                        <ChevronDown className="mr-0.5 size-3.5 shrink-0 text-gray-400" />
                                                    ) : (
                                                        <ChevronRight className="mr-0.5 size-3.5 shrink-0 text-gray-400" />
                                                    )}
                                                    {isOpen ? (
                                                        <FolderOpen className="mr-1.5 size-4 shrink-0 text-sky-500" />
                                                    ) : (
                                                        <Folder className="mr-1.5 size-4 shrink-0 text-sky-500" />
                                                    )}
                                                    <span className="truncate text-sm font-medium text-gray-700 transition-colors duration-150 group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-gray-100">
                                                        {item.name}
                                                    </span>
                                                </button>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent className="tree-collapsible-content data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up relative overflow-hidden pb-0.5 pt-0 transition-all duration-300 ease-in-out">
                                                <RecursiveStructure
                                                    items={childrenToRecurse}
                                                    level={level + 1}
                                                    onToggle={onToggle}
                                                    parentIsLast={[...currentLineageIsLast, isLast]}
                                                />
                                            </CollapsibleContent>
                                        </Collapsible>
                                    );
                                }
                                return null;
                            })()
                        )}
                    </div>
                );
            })}
        </>
    );
};

// Updated CourseCard Props
interface CourseCardProps {
    course: Course;
    isSelected: boolean;
    onSelect: (courseId: string) => void;
    delay?: number; // For staggered animation
}

const CourseCard: React.FC<CourseCardProps> = ({
    course: initialCourse,
    isSelected,
    onSelect,
    delay = 0,
}) => {
    const [course, setCourse] = useState(initialCourse);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), delay);
        return () => clearTimeout(timer);
    }, [delay]);

    const handleToggle = (itemId: string) => {
        setCourse((currentCourse) => {
            const newItems = JSON.parse(
                JSON.stringify(currentCourse.structure.items)
            ) as TreeItem[];
            const toggleRecursively = (itemsToSearch: TreeItem[]): boolean => {
                for (const currentItem of itemsToSearch) {
                    if (currentItem.id === itemId) {
                        if ('isOpen' in currentItem && typeof currentItem.isOpen === 'boolean') {
                            (currentItem as Subject | Module | Chapter).isOpen = !(
                                currentItem as Subject | Module | Chapter
                            ).isOpen;
                            return true;
                        }
                    }
                    let children: TreeItem[] | undefined;
                    if ('modules' in currentItem && currentItem.modules)
                        children = (currentItem as Subject).modules;
                    else if ('chapters' in currentItem && currentItem.chapters)
                        children = (currentItem as Module).chapters;
                    else if (
                        'slides' in currentItem &&
                        currentItem.slides &&
                        !('type' in currentItem)
                    )
                        children = (currentItem as Module | Chapter).slides;

                    if (children && toggleRecursively(children)) return true;
                }
                return false;
            };
            toggleRecursively(newItems);
            return { ...currentCourse, structure: { ...currentCourse.structure, items: newItems } };
        });
    };

    return (
        <Card
            className={`relative w-full cursor-pointer border bg-card shadow-sm transition-all duration-300 ease-in-out
                  hover:scale-[1.02] hover:shadow-lg
                  ${isSelected ? 'border-primary ring-primary scale-[1.02] shadow-xl ring-2' : 'border-gray-200 dark:border-gray-700'}
                  ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
            onClick={() => onSelect(course.id)}
            style={{ transitionDelay: `${delay}ms` }} // Staggered delay also for CSS transitions
        >
            {isSelected && (
                <div
                    className="text-primary absolute right-2 top-2 opacity-0 transition-opacity duration-300 data-[selected=true]:opacity-100"
                    data-selected={isSelected}
                >
                    <CheckCircle2 className="size-5" />
                </div>
            )}
            <CardHeader className="p-3">
                <CardTitle
                    className="group-hover:text-primary truncate text-base font-semibold text-gray-800 transition-colors duration-300 dark:text-gray-100"
                    title={course.title}
                >
                    {course.title}
                </CardTitle>
                <CardDescription
                    className="truncate text-xs text-gray-500 dark:text-gray-400"
                    title={course.structure.courseName}
                >
                    {course.structure.courseName} (
                    {getTerminology(ContentTerms.Level, SystemTerms.Level)} {course.level})
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <div className="px-2 py-1.5">
                    <RecursiveStructure
                        items={course.structure.items}
                        level={0}
                        onToggle={handleToggle}
                        parentIsLast={[]}
                    />
                </div>
            </CardContent>
        </Card>
    );
};

function AddCourseStep2StructureTypes({
    form,
    courseSettings,
}: {
    form: UseFormReturn<Step2Data>;
    courseSettings?: CourseSettingsData;
}) {
    // Get default depth from settings or fallback to 3
    const defaultDepth = courseSettings?.courseStructure?.defaultDepth || 3;
    const fixCourseDepth = courseSettings?.courseStructure?.fixCourseDepth || false;

    const [selectedCourseId, setSelectedCourseId] = useState<number | null>(
        form.getValues('levelStructure') || defaultDepth
    ); // Default to settings or first course selected

    const handleCourseSelect = (courseId: number) => {
        setSelectedCourseId(courseId);
        form.setValue('levelStructure', courseId);
    };

    // Filter courses based on settings
    const availableCourses = fixCourseDepth
        ? getMockCourses().filter((course) => course.level === defaultDepth)
        : getMockCourses();

    return (
        <div className="overflow-x-hidden  text-gray-800 dark:bg-neutral-950 dark:text-gray-200">
            <div className="container mx-auto px-3 py-4  ">
                <main className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-2">
                    {availableCourses.map((course, index) => (
                        <CourseCard
                            key={course.id}
                            course={course}
                            isSelected={selectedCourseId === course.level}
                            onSelect={() => handleCourseSelect(course.level)}
                            delay={100 * (index + 1) + 300} // Staggered delay for cards after header
                        />
                    ))}
                </main>
            </div>
        </div>
    );
}

export default AddCourseStep2StructureTypes;
