/**
 * Build API payload from course configuration
 */
export function buildApiPayload(courseConfig: any): any {
    // A knowledge base decides the course's shape (its topics are the chapters,
    // its sections the slides), so chapter / slide counts are never sent for a
    // KB-grounded course — the server ignores them too, but the prompt text
    // below must not mention them either.
    const kbBound = !!courseConfig.kbGrounding?.knowledge_base_id;
    const numChapters = kbBound ? undefined : courseConfig.durationFormatStructure?.numberOfSessions;
    const topicsPerSession = kbBound ? undefined : courseConfig.durationFormatStructure?.topicsPerSession;
    
    // Calculate total slides: slides per chapter * number of chapters
    const totalSlides = numChapters && topicsPerSession 
        ? parseInt(numChapters) * parseInt(topicsPerSession)
        : null;
    
    // Build user prompt from course configuration
    const userPromptParts: string[] = [];
    
    if (courseConfig.courseGoal) {
        userPromptParts.push(`Course Goal: ${courseConfig.courseGoal}`);
    }
    
    if (courseConfig.learningOutcome) {
        userPromptParts.push(`Learning Outcomes: ${courseConfig.learningOutcome}`);
    }
    
    if (courseConfig.learnerProfile) {
        const profile = courseConfig.learnerProfile;
        if (profile.ageRange) {
            userPromptParts.push(`Target Age Range: ${profile.ageRange}`);
        }
        if (profile.skillLevel) {
            userPromptParts.push(`Skill Level: ${profile.skillLevel}`);
        }
    }
    
    if (courseConfig.courseDepthOptions) {
        const depth = courseConfig.courseDepthOptions;
        const depthOptions: string[] = [];
        
        if (depth.includeDiagrams) depthOptions.push('Include Diagrams');
        if (depth.includeCodeSnippets) {
            depthOptions.push('Include Code Snippets');
            if (depth.programmingLanguage) {
                depthOptions.push(`Programming Language: ${depth.programmingLanguage}`);
            }
        }
        if (depth.includePracticeProblems) depthOptions.push('Include Practice Problems');
        if (depth.includeYouTubeVideo) depthOptions.push('Include YouTube Videos');
        if (depth.includeAIGeneratedVideo) depthOptions.push('Include AI Generated Videos');
        
        if (depthOptions.length > 0) {
            userPromptParts.push(`Course Depth Options: ${depthOptions.join(', ')}`);
        }
    }
    
    if (courseConfig.durationFormatStructure) {
        const duration = courseConfig.durationFormatStructure;
        const durationOptions: string[] = [];
        
        // Add number of subjects if provided (for depth > 4)
        if (duration.numberOfSubjects) {
            durationOptions.push(`Number of Subjects: ${duration.numberOfSubjects}`);
        }
        
        // Add number of modules if provided (for depth > 3)
        if (duration.numberOfModules) {
            durationOptions.push(`Number of Modules: ${duration.numberOfModules}`);
        }
        
        if (!kbBound && duration.numberOfSessions) {
            durationOptions.push(`Number of Sessions (Chapters): ${duration.numberOfSessions}`);
        }
        if (duration.sessionLength) {
            durationOptions.push(`Session Length: ${duration.sessionLength} minutes`);
        }
        if (!kbBound && duration.topicsPerSession) {
            durationOptions.push(`Topics per Session: ${duration.topicsPerSession}`);
        }
        if (duration.includeQuizzes) durationOptions.push('Include Quizzes');
        if (duration.includeHomework) durationOptions.push('Include Homework');
        if (duration.includeSolutions) durationOptions.push('Include Solutions');
        
        if (durationOptions.length > 0) {
            userPromptParts.push(`Duration & Structure: ${durationOptions.join(', ')}`);
        }
    }
    
    const userPrompt = userPromptParts.join('\n\n');
    
    // Get course depth from config, default to 3
    const courseDepth = courseConfig.courseDepth || 3;
    
    const payload: any = {
        user_prompt: userPrompt,
        course_tree: null,
        course_depth: courseDepth,
        generation_options: {
            generate_images: true,
            image_style: 'professional',
        },
    };

    // Add number of subjects if provided (for depth > 4)
    if (courseConfig.durationFormatStructure?.numberOfSubjects) {
        payload.generation_options.num_subjects = parseInt(courseConfig.durationFormatStructure.numberOfSubjects);
    }
    
    // Add number of modules if provided (for depth > 3)
    if (courseConfig.durationFormatStructure?.numberOfModules) {
        payload.generation_options.num_modules = parseInt(courseConfig.durationFormatStructure.numberOfModules);
    }
    
    if (numChapters) {
        payload.generation_options.num_chapters = parseInt(numChapters);
    }
    if (totalSlides) {
        payload.generation_options.num_slides = totalSlides;
    }

    return payload;
}
