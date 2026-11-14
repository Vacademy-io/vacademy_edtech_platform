import type { TFunction } from 'i18next';
import type { SlideType } from '../../../shared/types';
import { buildDefaultQuizQuestions, DEFAULT_SOLUTION_CODE } from '../../../shared/constants';
import i18n from '@/i18n';

// This module builds content strings outside any React render tree (called
// from a plain generator function, not a component/hook), so useTranslation()
// isn't available. Use the shared i18next singleton directly with a fixed
// namespace — same pattern as studyLibraryAssessmentToHtml.
const NAMESPACE = 'studyLibraryMockSlideContent';
const t: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

/**
 * Generate mock/sample content for a slide based on session and slide info
 * This is used to pre-populate slides with example content
 */
export const generateSlideContent = (
    sessionId: string,
    sessionTitle: string,
    slideTitle: string,
    slideType: SlideType,
    topicIndex?: number
): string => {
    // Content mapping based on the provided Python course data
    const contentMap: Record<string, Record<string, string>> = {
        '1': {
            // Session 1: Introduction to Python
            'Learning objective': `<h2>Learning Objectives</h2>
<p>By the end of this session, students will:</p>
<ul>
<li>Understand what Python is and its key features.</li>
<li>Set up Python on their computer.</li>
<li>Write their first Python program.</li>
</ul>

<h3>Python Usage Diagram:</h3>
<pre><code class="language-mermaid">
graph TD
    A[Python] --> B[Web Development]
    A --> C[Data Science]
    A --> D[Automation]
    A --> E[AI & Machine Learning]
    A --> F[Game Development]
    B --> B1[Django, Flask]
    C --> C1[Pandas, NumPy]
    D --> D1[Scripting]
    E --> E1[TensorFlow, PyTorch]
</code></pre>

<p><em>Image source: https://www.98thpercentile.com/blog/what-is-python-used-for/</em></p>`,
            'Topic 1: What is Python?': `<h2>What is Python?</h2>
<p>Python is a high-level, interpreted programming language known for its simplicity and readability. It was created by Guido van Rossum and first released in 1991.</p>

<h3>Key Features:</h3>
<ul>
<li><strong>Simplicity:</strong> Python's syntax is clean and easy to read, making it perfect for beginners.</li>
<li><strong>Versatility:</strong> Python can be used for web development, data science, automation, artificial intelligence, and more.</li>
<li><strong>Open-source:</strong> Python is free to use and has a large community of developers contributing to its growth.</li>
</ul>

<h3>Your First Python Program</h3>
<p>Let's see Python in action with a simple example:</p>

<pre><code class="language-python">
# This is a comment in Python
print("Hello, Python!")
print("Python is simple and powerful!")
</code></pre>

<p>This simple program demonstrates Python's clean syntax. Just two lines of code to display messages!</p>

<h3>Video Script:</h3>
<p>Welcome to Python! Python is a powerful, beginner-friendly programming language created in 1991. It's known for its simple syntax - no complex symbols needed. Python is versatile, used in web development, data science, AI, and more. It's also open-source and free. Let's see it in action with a simple 'Hello, Python!' program. Notice how clean and readable the code is - that's Python's strength!</p>`,
            // ... rest of session 1 content would go here, but I'll abbreviate for brevity
            'Wrap-Up Quiz': `<h2>Sample Quiz Content</h2><p>Quiz questions would appear here.</p>`,
            'Assignment': 'Write a Python program that prints a short introduction about yourself.',
            'Assignment Solution': DEFAULT_SOLUTION_CODE
        },
        // Add more sessions as needed
    };

    // Try to find content for this specific slide
    const sessionContent = contentMap[sessionId];
    if (sessionContent) {
        // Try exact match first
        const exactMatch = sessionContent[slideTitle];
        if (exactMatch) {
            return exactMatch;
        }
        // Try matching by extracting topic title
        for (const key in sessionContent) {
            if (key.toLowerCase().includes(slideTitle.toLowerCase()) || slideTitle.toLowerCase().includes(key.toLowerCase())) {
                const matchedContent = sessionContent[key];
                if (matchedContent !== undefined) {
                    return matchedContent;
                }
            }
        }
    }

    // Default content based on slide type
    if (slideType === 'objectives') {
        return t('defaultObjectives', { sessionTitle });
    } else if (slideType === 'topic') {
        return t('defaultTopic', { slideTitle, sessionTitle });
    } else if (slideType === 'quiz') {
        return JSON.stringify({ questions: buildDefaultQuizQuestions(t) });
    } else if (slideType === 'homework' || slideType === 'assignment') {
        return t('defaultAssignment', { sessionTitle });
    } else if (slideType === 'solution') {
        return DEFAULT_SOLUTION_CODE;
    }

    return '';
};
