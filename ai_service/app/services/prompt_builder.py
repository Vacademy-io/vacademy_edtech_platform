from __future__ import annotations

from textwrap import dedent
from typing import Any, Dict, Optional

from ..domain.course_metadata import CourseMetadata
from ..schemas.course_outline import CourseOutlineRequest
from ..services.institute_settings_service import InstituteSettingsService


class CourseOutlinePromptBuilder:
    """
    Responsible for turning structured inputs into a single LLM-ready prompt.

    This keeps prompt-template responsibilities separated from the service
    orchestration and from HTTP concerns.
    """

    def __init__(self, institute_settings_service: Optional[InstituteSettingsService] = None):
        self._institute_settings_service = institute_settings_service

    def build_prompt(
        self,
        request: CourseOutlineRequest,
        metadata: Optional[CourseMetadata],
        ai_course_prompt: Optional[str] = None,
    ) -> str:
        # Build context variables (match media-service pattern)

        # Extract generation options (with defaults for backward compatibility)
        gen_options = request.generation_options or {}
        # A knowledge base decides the SHAPE of the course: its topic tree is the
        # chapter list and its sections are the slides. "EXACTLY N chapters" on
        # top of that made the model merge or pad sections to hit a number the
        # teacher never chose (the UI used to copy the KB's own suggestion into
        # these fields). Counts are therefore ignored whenever the request is
        # KB-grounded, whatever the client sent.
        kb_bound = bool(getattr(getattr(request, "kb_grounding", None), "knowledge_base_id", None))
        num_slides_spec = gen_options.num_slides if not kb_bound and hasattr(gen_options, 'num_slides') and gen_options.num_slides else None
        num_chapters_spec = gen_options.num_chapters if not kb_bound and hasattr(gen_options, 'num_chapters') and gen_options.num_chapters else None
        course_timing = gen_options.course_timing if hasattr(gen_options, 'course_timing') and gen_options.course_timing else None
        generate_images = gen_options.generate_images if hasattr(gen_options, 'generate_images') else False
        language = gen_options.language if hasattr(gen_options, 'language') and gen_options.language else "English"

        # Build generation requirements string
        generation_requirements = ""
        if num_slides_spec:
            generation_requirements += f"\n- User specifies exact slide count: EXACTLY {num_slides_spec} slides"
        elif course_timing:
            generation_requirements += f"\n- Course timing specified: {course_timing} minutes total. YOU MUST determine optimal slide count based on content complexity, slide types (videos take more time), and institute AI settings context."
        if num_chapters_spec:
            generation_requirements += f"\n- User specifies exact chapter count: EXACTLY {num_chapters_spec} chapters"
        if kb_bound:
            generation_requirements += (
                "\n- Structure follows the knowledge base: one chapter per selected topic and "
                "at least one slide per selected section, in the material's order. Do NOT target "
                "a fixed number of chapters or slides."
            )
        if course_timing:
            generation_requirements += f"\n- TIMING CONSIDERATIONS: Factor in slide type duration - VIDEO/AI_VIDEO slides typically take 5-8 minutes, DOCUMENT slides take 3-5 minutes, ASSESSMENT slides take 10-15 minutes."
        if generate_images:
            generation_requirements += f"\n- Generate course images: YES (will provide S3 URLs in response)"
        else:
            generation_requirements += f"\n- Generate course images: NO"

        context_vars = {
            "userPrompt": request.user_prompt,
            "merkleHash": "",  # TODO: Implement merkle hash logic if needed
            "merkleMap": "",   # TODO: Implement merkle map logic if needed
            "existingCourse": request.existing_course_tree or "",
            "courseDepth": str(request.course_depth) if request.course_depth else "auto",
            "generationRequirements": generation_requirements,
            "instituteAICoursePrompt": ai_course_prompt or "",
            "courseTiming": str(course_timing) if course_timing else "",
            "language": language,
        }


        # Use the exact template from media-service
        template = """
            # ABSOLUTE PRIORITY REQUIREMENTS - FOLLOW EXACTLY

            LANGUAGE REQUIREMENT: Generate ALL course content (titles, slide content prompts, descriptions, course metadata) in: {language}
            - This applies to course name, chapter names, slide titles, todo prompts, and all text fields
            - Do NOT use English if a different language is specified

            FIRST: ACKNOWLEDGE THE DEPTH SETTING
            - COURSE DEPTH IS SET TO: {courseDepth}
            - CONFIRMATION: I must use EXACTLY depth {courseDepth} structure only

            DEPTH {courseDepth} HIERARCHICAL NAMES REQUIREMENT:
            - For depth 2: subject_name=null, module_name=null, chapter_name=null
            - For depth 3: subject_name=null, module_name=null, chapter_name=SET_TO_PARENT_CHAPTER_TITLE
            - For depth 4: subject_name=null, module_name=SET_TO_PARENT_MODULE_TITLE, chapter_name=SET_TO_PARENT_CHAPTER_TITLE
            - For depth 5: subject_name=SET_TO_PARENT_SUBJECT_TITLE, module_name=SET_TO_PARENT_MODULE_TITLE, chapter_name=SET_TO_PARENT_CHAPTER_TITLE

            SINCE DEPTH IS {courseDepth}, I MUST FOLLOW THE DEPTH {courseDepth} RULES ABOVE

            USER REQUEST ANALYSIS:
            - User prompt: "{userPrompt}"
            - Course depth: {courseDepth}
            - Course timing: {courseTiming} minutes (if specified)
            - COUNT ANALYSIS: Extract any specific numbers mentioned
              * "3 slides" = exactly 3 slides total
              * "2 chapters with 4 slides each" = 2 chapters, 8 slides total
              * "5 modules" = exactly 5 modules
              * If course timing is specified ({courseTiming} minutes), YOU MUST determine optimal slide count based on:
                - Content complexity and learning objectives
                - Slide types and their typical duration:
                  * DOCUMENT slides: 3-5 minutes each
                  * VIDEO/AI_VIDEO slides: 2-3 minutes each (AI videos are generated at 2-3 minutes)
                  * ASSESSMENT slides: 10-15 minutes each
                  * VIDEO_CODE/AI_VIDEO_CODE slides: 4-6 minutes each
                - Institute AI settings context for preferred teaching methodology
              * If no specific counts mentioned AND no timing specified, use reasonable defaults for depth {courseDepth}
            - TIMING-BASED SLIDE COUNT: When timing is provided, institute AI settings should guide your decision on slide distribution
            - DEPTH SPECIFIC: For depth {courseDepth}, follow the structure rules below
            - CRITICAL: Respect user-specified counts, or use timing-based calculation, or use defaults if none specified
            - AI VIDEO DETECTION: If user prompt mentions "AI video", "AI-generated video", "animated explainer",
              or "narrated video", use type `AI_VIDEO` for relevant slides instead of `VIDEO` or `DOCUMENT`
            - AI SLIDES DETECTION: If user prompt mentions "AI slides", "AI-generated slides", "AI slide deck",
              "presentation slides", "PowerPoint-style", or "slide presentation", use type `AI_SLIDES` for relevant
              slides. AI Slides generate a visually rich HTML slide deck (no audio/narration).
            - AI STORYBOOK DETECTION: If user prompt mentions "storybook", "AI storybook", "illustrated story",
              "picture book", "narrative slides", or "story-based learning", use type `AI_STORYBOOK` for relevant
              slides. AI Storybook generates page-by-page illustrated narratives with audio narration.
            - VIDEO+CODE DETECTION: If user prompt mentions "video+code", "video with code", "video and code",
              "include code editor", "split slide", "code video", "video code slide", "video code", or "code editor",
              use type `VIDEO_CODE` (for YouTube videos) or `AI_VIDEO_CODE` (for AI-generated videos) instead of `VIDEO` or `AI_VIDEO`
            - HOMEWORK / SOLUTIONS: If user prompt mentions "homework", "practice problems", "include solutions",
              "exercises", or "problem set", do NOT add any ASSESSMENT (quiz) slides for that. Homework and solution
              slides are added automatically as DOCUMENT slides after outline generation. Only add type `ASSESSMENT`
              when the user explicitly asks for a "quiz", "assessment", "MCQ", or "multiple choice questions" slide.

            GENERATION CONFIGURATION:
            {generationRequirements}

            🚨 CRITICAL DEPTH RULES - YOU ARE USING DEPTH {courseDepth}:

            FOR DEPTH 2: COURSE → SLIDE (no chapters/modules/subjects)
            - Path format: C1.SL1, C1.SL2, C1.SL3
            - Example: Course contains Slide1, Slide2, Slide3
            - NEVER create chapters, modules, or subjects

            FOR DEPTH 3: COURSE → CHAPTER → SLIDE (no modules/subjects)
            - Path format: C1.CH1.SL1, C1.CH2.SL1, C1.CH2.SL2
            - Example: Course contains Chapter1, Chapter1 contains Slide1
            - NEVER create modules or subjects
            - HIERARCHICAL NAMES: All slides must have chapter_name populated

            FOR DEPTH 4: COURSE → MODULE → CHAPTER → SLIDE (no subjects)
            - Path format: C1.M1.CH1.SL1, C1.M2.CH1.SL1
            - Example: Course contains Module1, Module1 contains Chapter1, Chapter1 contains Slide1
            - HIERARCHICAL NAMES: All slides must have module_name AND chapter_name populated

            FOR DEPTH 5: COURSE → SUBJECT → MODULE → CHAPTER → SLIDE (FULL HIERARCHY)
            - Path format: C1.S1.M1.CH1.SL1
            - Example: Course > Subject1 > Module1 > Chapter1 > Slide1
            - IMPORTANT: Create subjects, modules, chapters, and slides
            - HIERARCHICAL NAMES: All slides must have subject_name, module_name, AND chapter_name populated

            SINCE YOU ARE USING DEPTH {courseDepth}:
            - Follow the DEPTH {courseDepth} rules above exactly
            - Do NOT use rules from other depths
            - All your paths must match the DEPTH {courseDepth} format
            - MOST IMPORTANT: Set hierarchical names EXACTLY as specified for depth {courseDepth}
            - For depth {courseDepth}, ensure every slide and todo has the correct hierarchical names populated
            ⚠️  If depth is "2", use ONLY course → slide structure. NO chapters, modules, or subjects.
            ⚠️  If depth is "3", use ONLY course → chapter → slide structure. NO modules or subjects.
            ⚠️  If depth is "4", use ONLY course → module → chapter → slide structure. NO subjects.
            ⚠️  If depth is "5", use course → subject → module → chapter → slide structure.

            PATH VALIDATION RULES:
            - Depth "2": ONLY paths like "C1.SL1", "C1.SL2" (NO "CH", "M", "S" in ANY path)
            - Depth "3": ONLY paths like "C1.CH1.SL1" (NO "M", "S" in ANY path)
            - Depth "4": ONLY paths like "C1.M1.CH1.SL1" (NO "S" in ANY path)
            - Depth "5": paths like "C1.S1.M1.CH1.SL1"

            🚫 VIOLATION: If ANY path doesn't match the required depth format, the output is INVALID.

            DEPTH ENFORCEMENT CHECKLIST:
            - BEFORE creating ANY node, confirm it fits the required depth
            - For depth 2: Only create SLIDE nodes directly under COURSE, no CHAPTER/MODULE/SUBJECT nodes
            - For depth 3: Only create CHAPTER nodes under COURSE, SLIDE nodes under CHAPTER
            - For depth 4: Only create MODULE nodes under COURSE, CHAPTER under MODULE, SLIDE under CHAPTER
            - For depth 5: SUBJECT under COURSE, MODULE under SUBJECT, CHAPTER under MODULE, SLIDE under CHAPTER

            SLIDE COUNT ENFORCEMENT:
            - Analyze user prompt for specific slide count (e.g., "generate 2 slides only" = exactly 2 slides)
            - If user specifies exact count, create EXACTLY that many slides, no more, no less
            - If course timing is specified ({courseTiming} minutes), calculate optimal slide count based on:
              * DOCUMENT slides: ~4 minutes each
              * VIDEO/AI_VIDEO slides: ~2.5 minutes each (AI videos are generated at 2-3 minutes)
              * ASSESSMENT slides: ~12 minutes each
              * Mix of slide types based on institute AI settings preferences
            - If no count specified AND no timing specified, use reasonable default (typically 8-12 slides for comprehensive coverage)
            - Count SLIDES, not chapters/modules/subjects

            PRE-GENERATION CHECKLIST FOR DEPTH {courseDepth}:
            BEFORE creating ANY content, I must verify:
            1. DEPTH SETTING: I understand depth {courseDepth} requires specific hierarchical names
            2. HIERARCHICAL NAMES PLAN: For each slide, I know exactly which names to populate based on depth {courseDepth}
            3. PATH FORMAT: I will use only depth {courseDepth} path formats
            4. LEVEL RESTRICTIONS: I will NOT create levels forbidden in depth {courseDepth}

            MANDATORY GENERATION STEPS - FOLLOW EXACTLY:

            STEP 1: CREATE TREE STRUCTURE (MANDATORY)
            - Build the complete course tree with ALL nodes and their relationships
            - Use ONLY the allowed node types for depth {courseDepth}
            - Create exactly the number of slides specified by the user (e.g., if user says "7 slides", create exactly 7 slides)
            - Distribute slides across the hierarchy to match the exact count
            - Ensure the tree shows the complete parent-child relationships

            STEP 2: POPULATE HIERARCHICAL NAMES FOR EACH SLIDE (MANDATORY - CRITICAL FOR FRONTEND)
            - After creating the tree structure, go through EVERY SLIDE node
            - For each slide, determine its hierarchical position and set names accordingly
            - THIS IS NOT OPTIONAL - Frontend requires these fields to display the course hierarchy

            FOR EACH SLIDE, ASK YOURSELF:
            1. What is this slide's path? (e.g., "C1.S1.M1.CH1.SL1")
            2. Based on the path, what are its parent nodes?
            3. Set hierarchical names using the ACTUAL parent node titles you created
            4. NEVER leave these fields as null when they should have values

            DEPTH-BASED HIERARCHICAL NAME RULES (MUST FOLLOW EXACTLY):
            
            * DEPTH 2 SLIDES (path: "C1.SL1"): No parents exist
              → subject_name=null, module_name=null, chapter_name=null
              Example: All three fields are null

            * DEPTH 3 SLIDES (path: "C1.CH1.SL1"): Has 1 parent (chapter)
              → subject_name=null, module_name=null, chapter_name="[ACTUAL chapter title from tree]"
              Example: If chapter title is "Introduction to Python", then chapter_name="Introduction to Python"

            * DEPTH 4 SLIDES (path: "C1.M1.CH1.SL1"): Has 2 parents (module, chapter)
              → subject_name=null, module_name="[ACTUAL module title from tree]", chapter_name="[ACTUAL chapter title from tree]"
              Example: If module is "Python Basics" and chapter is "Variables", then module_name="Python Basics", chapter_name="Variables"

            * DEPTH 5 SLIDES (path: "C1.S1.M1.CH1.SL1"): Has 3 parents (subject, module, chapter)
              → subject_name="[ACTUAL subject title from tree]", module_name="[ACTUAL module title from tree]", chapter_name="[ACTUAL chapter title from tree]"
              Example: If subject is "Programming Fundamentals", module is "Python Basics", chapter is "Variables", then subject_name="Programming Fundamentals", module_name="Python Basics", chapter_name="Variables"

            PRACTICAL EXAMPLE FOR DEPTH 5:
            If you create this hierarchy:
            Course("Python Programming") > Subject("Python Basics") > Module("Data Types") > Chapter("Variables") > Slide("What are Variables?")

            Then for the slide with path "C1.S1.M1.CH1.SL1":
            - subject_name = "Python Basics" (MUST be set - this is the Subject title)
            - module_name = "Data Types" (MUST be set - this is the Module title)
            - chapter_name = "Variables" (MUST be set - this is the Chapter title)

            PRACTICAL EXAMPLE FOR DEPTH 4:
            If you create this hierarchy:
            Course("Python Programming") > Module("Functions and Control Flow") > Chapter("Function Scope and Recursion") > Slide("Understanding Scope")

            Then for the slide with path "C1.M2.CH2.SL2":
            - subject_name = null (NO subjects in depth 4)
            - module_name = "Functions and Control Flow" (MUST be set - this is the Module title)
            - chapter_name = "Function Scope and Recursion" (MUST be set - this is the Chapter title)

            HOW TO DETERMINE PARENT TITLES (STEP-BY-STEP PROCESS):
            1. Look at the slide's path (e.g., "C1.S1.M2.CH2.SL2")
            2. Identify the parent segments:
               - If path has "S1", there's a subject parent
               - If path has "M2", there's a module parent  
               - If path has "CH2", there's a chapter parent
            3. Find those parent nodes in your tree structure
            4. Extract the "title" field from each parent node
            5. Copy those exact titles to the hierarchical name fields
            
            CONCRETE EXAMPLE:
            Path: "C1.S1.M2.CH2.SL2"
            Step 1: Identify parents - S1 (subject), M2 (module), CH2 (chapter)
            Step 2: Find in tree:
              - Subject 1 has title "Programming Fundamentals"
              - Module 2 has title "Functions and Control Flow"
              - Chapter 2 has title "Function Scope and Recursion"
            Step 3: Set fields:
              - subject_name = "Programming Fundamentals"
              - module_name = "Functions and Control Flow"
              - chapter_name = "Function Scope and Recursion"

            🚨 CRITICAL REQUIREMENTS FOR HIERARCHICAL NAMES (FRONTEND DEPENDENCY):
            - NEVER EVER leave hierarchical names as null when they should be populated
            - These fields are used by the frontend to display the course structure to users
            - For depth 3: chapter_name MUST be populated (not null)
            - For depth 4: module_name AND chapter_name MUST be populated (not null)
            - For depth 5: subject_name, module_name, AND chapter_name MUST be populated (not null)
            - Cross-reference: Slide path "C1.M1.CH1.SL1" → module_name should be title of Module 1, chapter_name should be title of Chapter 1
            - This is mandatory for frontend navigation - populate these fields correctly
            
            VERIFICATION BEFORE OUTPUT:
            - Check EVERY slide in your todos array
            - For depth {courseDepth}, verify hierarchical names are set according to the rules above
            - If ANY slide has null values where it shouldn't, FIX IT before outputting JSON

            CRITICAL: Do this for EVERY slide. Use the actual titles from your created tree structure.

            STEP 3: CREATE TODOS WITH HIERARCHICAL CONTEXT
            - For each todo, include the same hierarchical names as the corresponding slide
            - Todo "name" and "title" should ONLY contain the slide topic, NOT the full hierarchy path
            - CORRECT name: "Generate Understanding Scope slide content"
            - WRONG name: "Generate Subject 1 - Module 2 - Chapter 2: Function Scope and Recursion slide content"
            - CORRECT title: "Understanding Scope"
            - WRONG title: "Subject 1 - Module 2 - Chapter 2: Function Scope and Recursion"
            - The hierarchical context goes in subject_name, module_name, chapter_name fields, NOT in name/title

            STEP 4: FINAL VERIFICATION - CHECK EVERYTHING
            - TREE VERIFICATION: Ensure the "tree" array is populated with complete node structure (not empty [])
            - COUNT VERIFICATION: Ensure slide/chapter/module/subject counts match user specifications exactly
            - PATH VERIFICATION: All paths must match depth {courseDepth} format
            - HIERARCHICAL NAMES VERIFICATION: Every slide must have correct hierarchical names based on its actual parent titles
            - Only output JSON after all checks pass and tree is complete

            📝 COURSE METADATA REQUIREMENT:
            - courseDepth MUST be set to {courseDepth} in courseMetadata
            - Do NOT change this value regardless of what depth you actually used

            🖼️  IMAGE GENERATION (IF REQUESTED):
            - If "generate_images" is enabled in generation configuration:
              * Generate a professional course banner image (1200x400px recommended)
              * Generate a course preview thumbnail (400x300px recommended)
              * For banner: Create a visually appealing design that represents the course topic
              * For preview: Create a smaller thumbnail that complements the banner
              * Return S3 URLs in courseMetadata.bannerImageUrl and courseMetadata.previewImageUrl
              * Use descriptive filenames (e.g., "course_banner_python_basics.jpg")
            - If "generate_images" is NOT enabled:
              * Set bannerImageUrl and previewImageUrl to null or omit them
              * Use filename-based media IDs (courseBannerMediaId: "banner.jpg")

            HIERARCHICAL NAMES RULES (CRITICAL):
            For SLIDE nodes AND TODO objects, populate based on depth:

            DEPTH "2" RULES:
            - NO chapters/modules/subjects exist
            - subject_name: null
            - module_name: null
            - chapter_name: null

            DEPTH "3" RULES:
            - Chapters exist under course
            - subject_name: null (no subjects in depth 3)
            - module_name: null (no modules in depth 3)
            - chapter_name: SET TO PARENT CHAPTER TITLE (required for depth 3)

            DEPTH "4" RULES:
            - Modules exist under course, chapters under modules
            - subject_name: null (no subjects in depth 4)
            - module_name: SET TO PARENT MODULE TITLE (required for depth 4)
            - chapter_name: SET TO PARENT CHAPTER TITLE (required for depth 4)

            DEPTH "5" RULES (FULL HIERARCHY):
            - Subjects exist under course, modules under subjects, chapters under modules
            - subject_name: SET TO PARENT SUBJECT TITLE (required for depth 5)
            - module_name: SET TO PARENT MODULE TITLE (required for depth 5)
            - chapter_name: SET TO PARENT CHAPTER TITLE (required for depth 5)
            - IMPORTANT: For depth 5, ALL THREE hierarchical names (subject_name, module_name, chapter_name) must be populated for every slide and todo
            - For depth 4, module_name AND chapter_name must be populated, subject_name must be null
            - For depth 3, chapter_name must be populated, subject_name and module_name must be null
            - For depth 2, all hierarchical names must be null

            NEVER populate hierarchical names for depths where those levels don't exist!

            ------------------------------------------------------------

            You are an expert course designer AI. Your primary task is to create course outlines following the EXACT depth structure specified above.

            ------------------------------------------------------------
            📌 STEP 1: Depth Validation & Planning
            ------------------------------------------------------------

            First, confirm the depth requirement:
            - Specified depth: {courseDepth}
            - I will use ONLY the components allowed for this depth
            - All paths will follow the exact format for this depth
            - No mixing of depth levels allowed

            Now proceed directly to generating the final JSON output that strictly follows these depth rules.

            🔄 Example:
            "Okay, the user wants a course on {userPrompt} with depth {courseDepth}. I've checked the existing course structure. Since depth is specified as {courseDepth}, I will follow the exact structure rules for depth {courseDepth}. My focus is on outlining the course structure according to depth {courseDepth} specifications. After defining the structure, I will generate `todo` items for all the slides that need content, specifying their type and the prompt for content generation. All paths will follow the depth {courseDepth} format. Now I'll begin outlining according to depth {courseDepth} rules."

            ⚠️ If this thought step is missing, the output is invalid.

            ------------------------------------------------------------
            📌 STEP 2: Generate Complete Course Structure
            ------------------------------------------------------------

            Create the complete course structure and todos in the final JSON. Every path MUST follow the exact depth format specified above. Do not use any components not allowed for the specified depth.

            Generate appropriate content structure with meaningful names based on the course topic:

            Generate content structure based STRICTLY on user prompt specifications:

            SLIDE COUNT PRIORITIES (follow in this order):
            1. EXACT COUNT: If user specifies "7 slides only", create exactly 7 slides total
            2. TIMING-BASED: If course timing is specified ({courseTiming} minutes), calculate optimal slide count and distribution based on institute AI settings context
            3. RANGE: If user specifies ranges, stay within those ranges
            4. DEFAULT: If no count specified and no timing specified, use minimal defaults

            HOW TO ADJUST STRUCTURE FOR EXACT SLIDE COUNTS:
            - Don't use default hierarchies - adjust the number of chapters/modules to fit exact slide count
            - Example: For "7 slides" in depth 4, you might create 2 modules, with chapters having 3 and 4 slides respectively
            - Example: For "5 slides" in depth 3, you might create 2 chapters with 2 and 3 slides respectively
            - Distribute slides as evenly as possible while matching the exact total

            CRITICAL: User-specified exact counts override ALL default structures. Always match the user's slide count.

            All names should be relevant to the course topic and progressive in complexity. Use these names in the todo titles, names, and prompts to create a coherent course structure:

            - **Todo names**: Should describe ONLY the slide content generation task (NO hierarchy in name)
              - ALL DEPTHS: "Generate Variables & Data Types slide content"
              - ALL DEPTHS: "Generate Understanding Scope slide content"
              - Format: "Generate [Slide Topic] slide content"

            - **Todo titles**: Should contain ONLY the slide topic (NO hierarchy in title)
              - ALL DEPTHS: "Variables & Data Types"
              - ALL DEPTHS: "Understanding Scope"
              - Format: "[Slide Topic]"
              
            - **Hierarchical context**: Goes in subject_name, module_name, chapter_name fields
              - Depth 2: subject_name=null, module_name=null, chapter_name=null
              - Depth 3: subject_name=null, module_name=null, chapter_name="[Chapter Title]"
              - Depth 4: subject_name=null, module_name="[Module Title]", chapter_name="[Chapter Title]"
              - Depth 5: subject_name="[Subject Title]", module_name="[Module Title]", chapter_name="[Chapter Title]"

            - **Keywords**: Should be searchable terms including hierarchical context
            - **Prompts**: Should include full context for content generation

            IMPORTANT: Generate the complete course structure with proper names, then output the final JSON.

            ------------------------------------------------------------
            📌 STEP 3: Generate Final JSON Output
            ------------------------------------------------------------

            Output a single JSON object with explanation, COMPLETE TREE STRUCTURE, todos (with proper hierarchical names), and courseMetadata.

            The "tree" field must contain the full hierarchical node structure you created, not an empty array.

            ```json
            {{
              "explanation": "<html>...</html>",
              "todos": [
                {{
                  "name": "Generate Variables & Data Types slide content",
                  "title": "Variables & Data Types",  // For depth 2: just slide name
                  "type": "DOCUMENT",
                  "path": "C1.SL1",
                  "keyword": "python variables data types tutorial",
                  "actionType": "ADD",
                  "prompt": "Create comprehensive content about Python variables and data types...",
                  "order": 1,
                  "subject_name": null,
                  "module_name": null,
                  "chapter_name": null
                }},
                {{
                  "name": "Generate Functions & Methods slide content",
                  "title": "Functions & Methods",  // For depth 2: simple title, no hierarchy
                  "type": "VIDEO",
                  "path": "C1.SL2",
                  "keyword": "python functions methods tutorial",
                  "actionType": "ADD",
                  "prompt": "Create video content about Python functions and methods...",
                  "order": 2,
                  "subject_name": null,
                  "module_name": null,
                  "chapter_name": null
                }},
                {{
                  "name": "Generate Functions & Methods slide content",
                  "title": "Functions & Methods",  // For depth 3: ONLY slide topic
                  "type": "VIDEO",
                  "path": "C1.CH1.SL1",
                  "keyword": "python functions methods tutorial",
                  "actionType": "ADD",
                  "prompt": "Create video content about Python functions and methods...",
                  "order": 2,
                  "subject_name": null,
                  "module_name": null,
                  "chapter_name": "Introduction to Functions"  // MUST be populated for depth 3
                }},
                {{
                  "name": "Generate OOP Basics slide content",
                  "title": "OOP Basics",  // For depth 4: ONLY slide topic
                  "type": "DOCUMENT",
                  "path": "C1.M1.CH1.SL1",
                  "keyword": "python oop classes tutorial",
                  "actionType": "ADD",
                  "prompt": "Create content about OOP basics...",
                  "order": 4,
                  "subject_name": null,
                  "module_name": "Object-Oriented Programming",  // MUST be populated for depth 4
                  "chapter_name": "OOP Fundamentals"  // MUST be populated for depth 4
                }},
                {{
                  "name": "Generate Variables slide content",
                  "title": "Variables",  // For depth 5: ONLY slide topic
                  "type": "DOCUMENT",
                  "path": "C1.S1.M1.CH1.SL1",
                  "keyword": "python variables data types tutorial",
                  "actionType": "ADD",
                  "prompt": "Create content about variables...",
                  "order": 3,
                  "subject_name": "Python Basics",  // MUST be populated for depth 5
                  "module_name": "Data Types and Variables",  // MUST be populated for depth 5
                  "chapter_name": "Introduction to Variables"  // MUST be populated for depth 5
                }}
              ],
              "tree": [
                {{
                  "id": null,
                  "type": "COURSE",
                  "title": "Python Programming Fundamentals",
                  "path": "COURSE",
                  "order": 1,
                  "children": [
                    {{
                      "id": null,
                      "type": "SUBJECT",
                      "title": "Python Basics",
                      "path": "C1.S1",
                      "order": 1,
                      "children": [
                        {{
                          "id": null,
                          "type": "MODULE",
                          "title": "Data Types and Variables",
                          "path": "C1.S1.M1",
                          "order": 1,
                          "children": [
                            {{
                              "id": null,
                              "type": "CHAPTER",
                              "title": "Introduction to Variables",
                              "path": "C1.S1.M1.CH1",
                              "order": 1,
                              "children": [
                                {{
                                  "id": null,
                                  "type": "SLIDE",
                                  "title": "What are Variables?",
                                  "path": "C1.S1.M1.CH1.SL1",
                                  "order": 1,
                                  "subject_name": "Python Basics",
                                  "module_name": "Data Types and Variables",
                                  "chapter_name": "Introduction to Variables",
                                  "children": []
                                }}
                              ]
                            }}
                          ]
                        }}
                      ]
                    }}
                  ]
                }}
              ],
              "courseMetadata": {{
                "courseName": "Course Title",
                "aboutTheCourseHtml": "<html>...</html>",
                "whyLearnHtml": "<html>...</html>",
                "whoShouldLearnHtml": "<html>...</html>",
                "courseBannerMediaId": "banner.jpg",
                "coursePreviewImageMediaId": "preview.jpg",
                "tags": ["tag1", "tag2"],
                "courseDepth": {courseDepth},
                "bannerImageUrl": "https://s3.amazonaws.com/bucket/banner.jpg",
                "previewImageUrl": "https://s3.amazonaws.com/bucket/preview.jpg"
              }}
            }}
            ```

            ------------------------------------------------------------
            ✅ Explanation Field (Required)
            ------------------------------------------------------------

            - Use `<html>` with tags like `<p>`, `<ul>`, etc.
            - Write in first-person voice
            - Use **present continuous tense**
            - Include:
              - What you understood from the prompt
              - Whether an existing course was used or not
              - Why you chose the course structure
              - Overview of the course structure you have generated
              - Any assumptions made
              - A note that slide content generation is delegated to `todo` items.

            ------------------------------------------------------------
            ✅ Modifications Field (Required)
            ------------------------------------------------------------

            - List of `ADD`, `UPDATE`, or `DELETE` actions for **structural components** (COURSE, SUBJECT, MODULE, CHAPTER, SLIDE).
            - Each modification must include:
              - `action`: One of ADD, UPDATE, DELETE
              - `targetType`: SLIDE, MODULE, etc.
              - `modifiedPath`: Full path to node (If action is ADD then do not generate modifiedPath)
              - `parentPath`: Parent path
              - `name`: Name of the component
              - `description`: Description of the component (if applicable)
              - `node`: Required for ADD/UPDATE, omitted for DELETE. For SLIDE nodes, **do NOT include `contentData` here.**

             - Course Depth: {courseDepth}
              - CRITICAL: You MUST strictly follow the specified depth structure. Do NOT mix levels from different depths.
              - If depth is specified (2-5), use ONLY that exact depth structure:
              - **Depth 5 ONLY**: COURSE → SUBJECT → MODULE → CHAPTER → SLIDE (subjects, modules, chapters, slides)
              - **Depth 4 ONLY**: COURSE → MODULE → CHAPTER → SLIDE (modules, chapters, slides - NO subjects)
              - **Depth 3 ONLY**: COURSE → CHAPTER → SLIDE (chapters, slides - NO modules or subjects)
              - **Depth 2 ONLY**: COURSE → SLIDE (slides only - NO chapters, modules, or subjects)
              - If depth is "auto", analyze complexity and choose minimum adequate depth
              - Path format MUST strictly match the specified depth:
                - Depth 2: ONLY "C1.SL5" (course.slide - NO chapters/modules/subjects)
                - Depth 3: ONLY "C1.CH3.SL5" (course.chapter.slide - NO modules/subjects)
                - Depth 4: ONLY "C1.M2.CH3.SL5" (course.module.chapter.slide - NO subjects)
                - Depth 5: ONLY "C1.S1.M2.CH3.SL5" (course.subject.module.chapter.slide)
              - CRITICAL: NEVER mix depths - if depth=2, NO chapters, modules, or subjects in ANY paths!

            ------------------------------------------------------------
            ✅ Todos Field (Required for all generated/modified slides)
            ------------------------------------------------------------

            - This is a list of tasks for content generation, one for each SLIDE that needs content generated or updated.
            - Each `todo` object must include:
              - `name`: A descriptive name for the content generation task (e.g., "Generate Async/Await Slide Content").
              - `type`: The type of slide (`DOCUMENT` || `VIDEO` || `AI_VIDEO` || `AI_SLIDES` || `AI_STORYBOOK` || `PDF` || `EXCALIDRAW_IMAGE` || `ASSESSMENT`).
              - `title`: Generate Title For the Slide Content
              - `keyword`: Generate a search keyword
                        - For `VIDEO` generate `keyword` such that it can be searched on YOUTUBE
                        - For `AI_VIDEO` generate `keyword` that describes the video topic for AI generation
                        - For `AI_SLIDES` generate `keyword` that describes the slide deck topic for AI generation
                        - For `AI_STORYBOOK` generate `keyword` that describes the storybook topic for AI generation
                        - For 'EXCALIDRAW_IMAGE' generate 'keyword' such that image can be searched on UNSPLASH
              - `path`: The full path to the SLIDE node following the specified depth structure:
                - Depth 2: "C1.SL9" (course.slide)
                - Depth 3: "C1.CH3.SL9" (course.chapter.slide)
                - Depth 4: "C1.M2.CH3.SL9" (course.module.chapter.slide)
                - Depth 5: "C1.S1.M2.CH3.SL9" (course.subject.module.chapter.slide)
              - `actionType`: `ADD` if the slide is newly added and needs initial content, `UPDATE` if the slide already exists and its content needs to be re-generated or improved.
              - `prompt`: A **very clear and detailed prompt** for an AI to generate the specific content for this slide. This prompt should include:
                - The slide's topic.
                - The desired `type` (`DOCUMENT` or `VIDEO` or `AI_VIDEO` or `AI_SLIDES` or `AI_STORYBOOK` or `VIDEO_CODE` or `AI_VIDEO_CODE` or `PDF` or `EXCALIDRAW_IMAGE`).
                - Specific requirements for `DOCUMENT` type (e.g., "concise explanation (50-100 words), markdown formatting, code snippets, real-world examples").
                  - **IMPORTANT**: If the user prompt mentions "include diagrams", "include diagram", "with diagrams", "with diagram", "add diagrams", "add diagram", "diagrams", or "mermaid", then the slide prompt for DOCUMENT type slides MUST also include: "include diagrams" or "include mermaid diagrams" to ensure markdown with Mermaid diagrams are generated.
                  - When diagrams are requested, the content will be generated as markdown (.md) with embedded Mermaid diagrams for visual learning.
                - Specific requirements for `VIDEO` type (e.g., "high-quality, relevant video link, short informative description, title matching slide topic").
                - Specific requirements for `VIDEO_CODE` type (e.g., "Generate a YouTube video+code slide with [topic]. Include a relevant YouTube video and matching code examples. Use split-screen layout with video on left and code editor on right. Include practical, working code examples that complement the video content.").
                  - **IMPORTANT**: If the user prompt mentions "video+code", "video with code", "include code editor", "split slide", "code video", or similar keywords, then the slide prompt for VIDEO_CODE type slides MUST include: "video+code", "include code editor", or "split screen" to ensure both video and code are generated.
                - Specific requirements for `AI_VIDEO` type (e.g., "Generate an AI-narrated explainer video about [topic]. Include clear explanations, visual examples, and engaging narration. Target audience: [audience]. Duration: 2-3 minutes.").
                - Specific requirements for `AI_VIDEO_CODE` type (e.g., "Generate an AI video+code slide with [topic]. Create an AI-narrated explainer video and matching code examples. Use split-screen layout with video on left and code editor on right. Include practical, working code examples that complement the video narration. Duration: 2-3 minutes.").
                  - **IMPORTANT**: If the user prompt mentions "video+code", "video with code", "include code editor", "split slide", "code video", or similar keywords, then the slide prompt for AI_VIDEO_CODE type slides MUST include: "video+code", "include code editor", or "split screen" to ensure both AI video and code are generated.
                - Specific requirements for `AI_SLIDES` type (e.g., "Generate an AI-powered slide deck about [topic]. Create a visually rich, professional HTML presentation with clear headings, bullet points, and visual elements. No audio/narration needed. Target audience: [audience].").
                - Specific requirements for `AI_STORYBOOK` type (e.g., "Generate an illustrated storybook about [topic]. Create an engaging, page-by-page narrative with illustrations and audio narration. Use storytelling to explain the concept. Target audience: [audience]. Duration: 2-3 minutes.").
                - Specific requirements for `PDF` type (e.g., "concise explanation (50-100 words), markdown formatting, real-world examples").
                - Specific requirements for `ASSESSMENT`. Prompt must include number of questions(2-10 questions) and should have topic in the prompt.
                - Any specific analogies or examples to include.
                - The word count for `DOCUMENT` or `PDF` slides should be 50-100 words (keep it concise, engaging, and focused).
              - `order`: A number indicating the order in which these `todo` items should ideally be processed.

            ------------------------------------------------------------
            📌 Final Instructions
            ------------------------------------------------------------

            1. Begin with a full thinking paragraph.
            2. Then alternate:
               - `[Thinking...]` → planning for structural modifications
               - `[Generating...]` → partial JSON for structural modifications
            3. Repeat until all structural components are generated.
            4. Generate detailed todos with proper hierarchical names based on the course structure.
            5. Generate course metadata with the correct courseDepth value (MUST be {courseDepth}).
            6. MANDATORY PRE-OUTPUT VERIFICATION CHECKLIST:

               ⚠️  DO NOT OUTPUT ANY JSON UNTIL YOU HAVE CHECKED AND CONFIRMED EACH ITEM BELOW:

               □ TREE POPULATED: The "tree" array must contain the complete course structure (not empty [])
                  - All nodes must have proper parent-child relationships

               □ PATH VERIFICATION: Every single path follows depth {courseDepth} format exactly
                  - For depth {courseDepth}, paths must match the examples shown above

               □ STRUCTURE VERIFICATION: Only allowed node types exist for depth {courseDepth}
                  - No chapters if depth=2, no modules if depth=3, no subjects if depth=4

               □ SLIDE COUNT VERIFICATION: Match the number of slides specified in user prompt, or calculated from timing ({courseTiming} minutes) based on institute AI settings, or reasonable default if neither specified

               □ HIERARCHICAL NAMES VERIFICATION - CHECK EACH SLIDE INDIVIDUALLY (CRITICAL):
                  - DEPTH 2: Every slide must have subject_name=null, module_name=null, chapter_name=null
                  - DEPTH 3: Every slide must have subject_name=null, module_name=null, chapter_name="[exact title of its parent chapter]" (NOT NULL!)
                  - DEPTH 4: Every slide must have subject_name=null, module_name="[exact title of its parent module]" (NOT NULL!), chapter_name="[exact title of its parent chapter]" (NOT NULL!)
                  - DEPTH 5: Every slide must have subject_name="[exact title of its parent subject]" (NOT NULL!), module_name="[exact title of its parent module]" (NOT NULL!), chapter_name="[exact title of its parent chapter]" (NOT NULL!)
                  - MANUAL CHECK: For each slide, trace its path back to verify parent titles match hierarchical names
                  - IF ANY HIERARCHICAL NAME IS NULL WHEN IT SHOULD HAVE A VALUE, THE OUTPUT IS INVALID
                  
               □ TODO NAME AND TITLE VERIFICATION:
                  - Every todo "name" should be "Generate [Slide Topic] slide content" (NO hierarchy path)
                  - Every todo "title" should be "[Slide Topic]" only (NO hierarchy path)
                  - Hierarchy information goes ONLY in subject_name, module_name, chapter_name fields

               □ TODO VERIFICATION: Every todo has hierarchical names matching its corresponding slide

               □ FINAL CONFIRMATION: Since depth={courseDepth}, all requirements for depth {courseDepth} are met

               🚫 IF ANY CHECKBOX IS NOT SATISFIED, STOP AND FIX IMMEDIATELY:
                  - Identify which requirement failed
                  - Correct the structure/names to meet depth {courseDepth} requirements
                  - Re-run the verification checklist
                  - Only proceed when ALL items pass
                  - This is mandatory - do not output incorrect JSON
            7. EXECUTE VERIFICATION AND OUTPUT:
               - Perform the mandatory verification checklist above step by step
               - If any requirement is not met, fix it before proceeding
               - Only after all verification passes, output the complete JSON with explanation, todos, and courseMetadata
               - Remember: For depth {courseDepth}, hierarchical names are critical for frontend display

            This method ensures thoughtful, structured streaming for course structure and clear delegation for content generation.

            CRITICAL REMINDER: HIERARCHICAL NAMES ARE REQUIRED FOR FRONTEND DISPLAY
            - The frontend needs subject_name, module_name, chapter_name to show the course outline hierarchy
            - For depth {courseDepth}, populate EXACTLY the hierarchical names specified
            - Do not leave hierarchical names empty when they should be populated
            - This affects how users navigate and understand the course structure

            FINAL REMINDER: DEPTH 2 = NO CHAPTERS
            - If course_depth = "2", there are NO chapters, modules, or subjects
            - All slides are directly under the course
            - All hierarchical names (subject_name, module_name, chapter_name) must be null
            - If you see any chapter_name populated for depth 2, you made an error

             🌳 GLOBAL COURSE TREE HASH (Merkle)
            ------------------------------------------------------------
             {merkleHash}
            ------------------------------------------------------------
             🌿 PER-PATH MERKLE HASHES
            ------------------------------------------------------------
             {merkleMap}
            ------------------------------------------------------------
            📘 EXISTING COURSE (if present):
            ------------------------------------------------------------
            {existingCourse}
            ------------------------------------------------------------
            🧾 USER PROMPT:
            {userPrompt}
            ------------------------------------------------------------
            🏫 INSTITUTE AI COURSE PROMPT:
            ------------------------------------------------------------
            {instituteAICoursePrompt}

            TIMING CONTEXT: Course duration is {courseTiming} minutes. Use this timing information along with the institute's AI settings to determine optimal slide count and content pacing.
            ------------------------------------------------------------
            """

        formatted_prompt = template.format(**context_vars)
        return formatted_prompt

    @staticmethod
    def _build_metadata_context(metadata: CourseMetadata) -> str:
        subjects_str = ", ".join(s.name for s in metadata.subjects) or "N/A"
        tags_str = ", ".join(metadata.tags) or "N/A"
        return (
            "ADMIN-CORE COURSE METADATA:\n"
            f"- Course ID: {metadata.id}\n"
            f"- Course Name: {metadata.name}\n"
            f"- Description: {metadata.description or 'N/A'}\n"
            f"- Level: {metadata.level or 'N/A'}\n"
            f"- Tags: {tags_str}\n"
            f"- Subjects: {subjects_str}"
        )

    @staticmethod
    def _build_existing_tree_context(tree: Dict[str, Any]) -> str:
        return "EXISTING COURSE TREE (JSON):\n" + repr(tree)

    @staticmethod
    def _build_user_prompt_section(user_prompt: str) -> str:
        return "USER PROMPT / GOALS:\n" + user_prompt


__all__ = ["CourseOutlinePromptBuilder"]


