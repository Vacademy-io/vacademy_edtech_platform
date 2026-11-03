"""Live-turn prompts and deterministic templates (design §6.4–§6.6)."""
from __future__ import annotations

import json
import random
import re
from typing import Any, Dict, List, Optional, Tuple

from ..languages import PROMPT_NAMES as LANG_NAMES  # en, hi, bn, kn

# ── deterministic lines (no model call) ──────────────────────────────────────

T = {
    "greet": {
        "en": "Hi {name}! I'm {teacher}, and I'll be teaching you today. We're starting with {slide}. Let's begin.",
        "hi": "नमस्ते {name}! मैं {teacher} हूँ और आज मैं आपको पढ़ाऊँगी। हम {slide} से शुरू कर रहे हैं। चलिए शुरू करते हैं।",
    },
    "greet_interview": {
        "en": "Hi {name}, I'm {teacher}, and I'll be your interviewer today. Think aloud, take your time, and I'll give you feedback after each answer. Ready?",
        "hi": "नमस्ते {name}, मैं {teacher} हूँ, और आज मैं आपका interviewer हूँ। सोचते हुए बोलिए, समय लीजिए, और हर जवाब के बाद मैं feedback दूँगी। तैयार?",
    },
    "greet_practice": {
        "en": "Hi {name}, I'm {teacher}. This is a practice session: I'll set up a situation, you try it, and we improve it together. Let's start.",
        "hi": "नमस्ते {name}, मैं {teacher} हूँ। यह एक practice session है: मैं situation दूँगी, आप try करेंगे, और हम साथ में बेहतर करेंगे। शुरू करते हैं।",
    },
    "resume": {
        "en": "Welcome back, {name}! Last time we were in {slide}. {summary} Let's pick up from where we left off.",
        "hi": "वापस स्वागत है, {name}! पिछली बार हम {slide} पर थे। {summary} चलिए वहीं से आगे बढ़ते हैं।",
    },
    "resume_summary": {
        "en": "Welcome back, {name}! We had just finished {topic} in {slide}. {summary} Let's carry on from there.",
        "hi": "वापस स्वागत है, {name}! हमने {slide} में {topic} अभी पूरा किया था। {summary} चलिए वहीं से आगे बढ़ते हैं।",
    },
    "resume_done": {
        "en": "Welcome back, {name}! You already completed {slide}. {summary} Let's see what's next.",
        "hi": "वापस स्वागत है, {name}! आप {slide} पहले ही पूरा कर चुके हैं। {summary} चलिए देखते हैं आगे क्या है।",
    },
    "greet_returning": {
        "en": "Welcome back, {name}! Last time we worked on {previous}. {summary} Today we're starting {slide}. Let's begin.",
        "hi": "वापस स्वागत है, {name}! पिछली बार हमने {previous} पर काम किया था। {summary} आज हम {slide} शुरू कर रहे हैं। चलिए शुरू करते हैं।",
    },
    "topic_summary": {
        "en": "Good. That wraps up {topic}. Take a look at the board once more, then we'll move to the next part.",
        "hi": "बहुत अच्छे। {topic} यहीं पूरा होता है। बोर्ड को एक बार फिर देख लीजिए, फिर हम अगले हिस्से पर चलेंगे।",
    },
    "slide_done": {
        "en": "That completes {slide}. Well done, {name}. {weak}",
        "hi": "{slide} पूरा हुआ। शाबाश, {name}। {weak}",
    },
    "weak_note": {
        "en": "We'll come back to {n} point(s) that need a little more practice.",
        "hi": "हम {n} बिंदु(ओं) पर फिर से लौटेंगे जिन पर थोड़ा और अभ्यास चाहिए।",
    },
    "ask": {"en": "{prompt}", "hi": "{prompt}"},
    "media_task_video": {
        "en": "Please watch this video now. Take your time, and tell me when you're done.",
        "hi": "कृपया अभी यह वीडियो देखिए। आराम से देखिए, और जब हो जाए तो मुझे बताइए।",
    },
    "media_task_pdf": {
        "en": "Please read this document now. Take your time, and tell me when you're done.",
        "hi": "कृपया अभी यह दस्तावेज़ पढ़िए। आराम से पढ़िए, और जब हो जाए तो मुझे बताइए।",
    },
    "skipped": {"en": "Okay, let's move on.", "hi": "ठीक है, आगे बढ़ते हैं।"},
    "next_slide": {"en": "Now let's move on to {slide}.", "hi": "अब चलिए {slide} पर चलते हैं।"},
    "pause": {"en": "Okay, I'll wait. Say continue when you're ready.", "hi": "ठीक है, मैं रुकती हूँ। जब तैयार हों तो 'continue' कहिए।"},
    "credits_end": {"en": "Your institute's lesson credits have run out for now, so I'll stop here. Your place is saved; ask them to top up and we'll continue.",
                    "hi": "आपके संस्थान के पाठ क्रेडिट अभी समाप्त हो गए हैं, इसलिए मैं यहीं रुकती हूँ। आपकी जगह सुरक्षित है; टॉप-अप के बाद हम आगे बढ़ेंगे।"},
    "idle_end": {"en": "We've been quiet for a while, so I'll stop here. Come back any time and we'll pick up where we left off.",
                 "hi": "काफ़ी देर से कोई बात नहीं हुई, इसलिए मैं यहीं रुकती हूँ। जब चाहें वापस आइए, हम वहीं से आगे बढ़ेंगे।"},
    "away": {"en": "Looks like you stepped away. I'll wait right here.", "hi": "लगता है आप थोड़ी देर के लिए चले गए। मैं यहीं इंतज़ार कर रही हूँ।"},
    "welcome_back": {"en": "Welcome back! Let's pick up where we left off.", "hi": "वापसी पर स्वागत है! चलिए वहीं से आगे बढ़ते हैं।"},
    "slower": {"en": "Sure, I'll go slower.", "hi": "ज़रूर, मैं धीरे बोलूँगी।"},
    "faster": {"en": "Sure, I'll speed up a little.", "hi": "ज़रूर, थोड़ा तेज़ चलते हैं।"},
    "fallback_correct": {"en": "That's right. Let's continue.", "hi": "बिल्कुल सही। चलिए आगे बढ़ते हैं।"},
    "fallback_hint": {"en": "Not quite. Look at the board again: {hint}. Try once more.", "hi": "पूरी तरह नहीं। बोर्ड को फिर देखिए: {hint}। एक बार फिर कोशिश कीजिए।"},
    "fallback_move_on": {"en": "Let's note that for later and keep going. {expected}", "hi": "इसे बाद के लिए नोट कर लेते हैं और आगे बढ़ते हैं। {expected}"},
    # Weak-concept revisits (design §6.6)
    "revisit_intro_topic": {
        "en": "Before we move on, let's quickly go back to {n} point(s) that gave you trouble.",
        "hi": "आगे बढ़ने से पहले, चलिए जल्दी से {n} बिंदु(ओं) पर लौटते हैं जिनमें दिक्कत हुई थी।",
    },
    "revisit_intro_slide": {
        "en": "Before we finish, let's revisit {n} point(s) that need a little more practice.",
        "hi": "समाप्त करने से पहले, चलिए {n} बिंदु(ओं) को फिर से देखते हैं जिन पर थोड़ा और अभ्यास चाहिए।",
    },
    "revisit_ask": {"en": "About {concept}. {prompt}", "hi": "{concept} के बारे में। {prompt}"},
    "revisit_done_topic": {"en": "Good, that's the revisit done. Let's move to the next part.",
                           "hi": "बहुत अच्छे, दोहराव पूरा हुआ। चलिए अगले हिस्से पर चलते हैं।"},
    "revisit_done_slide": {"en": "That's the revisit done. Well done for sticking with it.",
                           "hi": "दोहराव पूरा हुआ। लगे रहने के लिए शाबाश।"},
    "revisit_skipped": {"en": "Okay, we'll leave that one for another day.", "hi": "ठीक है, इसे किसी और दिन के लिए छोड़ते हैं।"},
    # Silence recovery (a minute on an open question)
    "nudge_hint": {"en": "Take your time. Here's a hint: {hint}", "hi": "आराम से सोचिए। एक संकेत: {hint}"},
    # Voice lesson, no microphone audio since the question: explain how to answer first.
    "nudge_voice_hint": {"en": "To answer out loud, tap the Answer button and then speak — or type it below. Here's a hint: {hint}",
                         "hi": "बोलकर जवाब देने के लिए Answer button दबाइए और फिर बोलिए — या नीचे type कीजिए। एक संकेत: {hint}"},
    "nudge_voice_open": {"en": "To answer out loud, tap the Answer button and then speak — or type it below. You can also say 'skip'.",
                         "hi": "बोलकर जवाब देने के लिए Answer button दबाइए और फिर बोलिए — या नीचे type कीजिए। चाहें तो 'skip' भी कह सकते हैं।"},
    "nudge_open": {"en": "Take your time. If you'd like, say 'skip' and we'll come back to this later.",
                   "hi": "आराम से सोचिए। चाहें तो 'skip' कहिए, हम इस पर बाद में लौटेंगे।"},
    # Predict-then-reveal
    "predict_intro": {"en": "Before I show you, a quick guess: {question}", "hi": "दिखाने से पहले, एक अंदाज़ा लगाइए: {question}"},
    "predict_ack": {"en": "Good guess. Let's see.", "hi": "अच्छा अंदाज़ा। चलिए देखते हैं।"},
    # The right answer stays on the board when the teacher moves on.
    "answer_note": {"en": "Answer: {expected}", "hi": "उत्तर: {expected}"},
    # Natural teaching (course setting naturalTeaching): a short greeting with
    # no "let's begin", because a warm-up question follows it.
    "greet_short": {
        "en": "Hi {name}! I'm {teacher}, and today we're looking at {slide}.",
        "hi": "नमस्ते {name}! मैं {teacher} हूँ, और आज हम {slide} देखेंगे।",
    },
    "greet_returning_short": {
        "en": "Welcome back, {name}! Last time we worked on {previous}. {summary} Today it's {slide}.",
        "hi": "वापस स्वागत है, {name}! पिछली बार हमने {previous} पर काम किया था। {summary} आज हम {slide} देखेंगे।",
    },
    # The warm-up: one open question before the first board, never graded.
    "warmup_ask": {
        "en": "Before we start: when you hear {topic}, what comes to mind?",
        "hi": "शुरू करने से पहले: {topic} सुनकर आपके मन में क्या आता है?",
    },
    # Spoken when the model's acknowledgement is unavailable. No placeholders
    # (here and in warmup_move_on): prepared once, shared by every course.
    "warmup_ack": {
        "en": "Thanks for sharing that. Let's see how it connects.",
        "hi": "बताने के लिए शुक्रिया। चलिए देखते हैं यह कैसे जुड़ता है।",
    },
    # Skipped or silent warm-up.
    "warmup_move_on": {
        "en": "No problem. Let's dive in.",
        "hi": "कोई बात नहीं। चलिए शुरू करते हैं।",
    },
}

# Bengali and Kannada lines, kept as their own tables so the en/hi entries
# above stay readable; merged into T below. Same placeholders as English
# (tests enforce it). Formal "আপনি" / "ನೀವು", matching the Hindi "आप".
# Placeholders stand alone (no case suffix glued to an English title).
T_BN = {
    "greet": "নমস্কার {name}! আমি {teacher}, আজ আমি আপনাকে পড়াব। আমরা {slide} দিয়ে শুরু করছি। চলুন শুরু করি।",
    "greet_interview": "নমস্কার {name}, আমি {teacher}, আজ আমি আপনার interviewer। ভাবতে ভাবতে বলুন, সময় নিন, আর প্রতিটা উত্তরের পরে আমি feedback দেব। তৈরি?",
    "greet_practice": "নমস্কার {name}, আমি {teacher}। এটা একটা practice session: আমি একটা পরিস্থিতি দেব, আপনি চেষ্টা করবেন, আর আমরা একসাথে সেটা আরও ভালো করব। শুরু করা যাক।",
    "resume": "আবার স্বাগত, {name}! গতবার আমরা {slide} পড়ছিলাম। {summary} চলুন, যেখানে থেমেছিলাম সেখান থেকেই শুরু করি।",
    "resume_summary": "আবার স্বাগত, {name}! আমরা সবে {slide} থেকে {topic} শেষ করেছিলাম। {summary} চলুন, সেখান থেকেই এগোই।",
    "resume_done": "আবার স্বাগত, {name}! আপনি {slide} আগেই শেষ করেছেন। {summary} চলুন দেখি এরপর কী আছে।",
    "greet_returning": "আবার স্বাগত, {name}! গতবার আমরা {previous} নিয়ে কাজ করেছিলাম। {summary} আজ আমরা {slide} শুরু করছি। চলুন শুরু করি।",
    "topic_summary": "বেশ ভালো। {topic} এখানেই শেষ। বোর্ডটা আর একবার দেখে নিন, তারপর আমরা পরের অংশে যাব।",
    "slide_done": "{slide} শেষ হলো। খুব ভালো, {name}। {weak}",
    "weak_note": "যে {n}টা বিষয়ে আর একটু অনুশীলন দরকার, সেগুলোতে আমরা আবার ফিরে আসব।",
    "ask": "{prompt}",
    "media_task_video": "এখন এই ভিডিওটা দেখুন। সময় নিয়ে দেখুন, আর হয়ে গেলে আমাকে বলবেন।",
    "media_task_pdf": "এখন এই ডকুমেন্টটা পড়ুন। সময় নিয়ে পড়ুন, আর হয়ে গেলে আমাকে বলবেন।",
    "skipped": "ঠিক আছে, এগিয়ে যাই।",
    "next_slide": "এবার চলুন {slide} শুরু করি।",
    "pause": "ঠিক আছে, আমি অপেক্ষা করছি। তৈরি হলে 'continue' বলবেন।",
    "credits_end": "আপনার প্রতিষ্ঠানের lesson credit আপাতত শেষ হয়ে গেছে, তাই আমি এখানেই থামছি। আপনার জায়গা save করা আছে; top-up হলে আমরা আবার এগোব।",
    "idle_end": "অনেকক্ষণ কোনো কথা হয়নি, তাই আমি এখানেই থামছি। যখন খুশি ফিরে আসুন, আমরা সেখান থেকেই শুরু করব।",
    "away": "মনে হচ্ছে আপনি একটু উঠে গেছেন। আমি এখানেই অপেক্ষা করছি।",
    "welcome_back": "আবার স্বাগত! চলুন, যেখানে থেমেছিলাম সেখান থেকেই শুরু করি।",
    "slower": "নিশ্চয়ই, আমি আস্তে বলব।",
    "faster": "নিশ্চয়ই, একটু তাড়াতাড়ি এগোই।",
    "fallback_correct": "একদম ঠিক। চলুন এগিয়ে যাই।",
    "fallback_hint": "পুরোপুরি নয়। বোর্ডটা আবার দেখুন: {hint}। আর একবার চেষ্টা করুন।",
    "fallback_move_on": "এটা পরের জন্য নোট করে রাখি, আর এগিয়ে যাই। {expected}",
    "revisit_intro_topic": "এগোনোর আগে, চলুন তাড়াতাড়ি সেই {n}টা বিষয়ে ফিরে যাই যেগুলোতে অসুবিধা হয়েছিল।",
    "revisit_intro_slide": "শেষ করার আগে, চলুন সেই {n}টা বিষয় আবার দেখি যেগুলোতে আর একটু অনুশীলন দরকার।",
    "revisit_ask": "{concept} নিয়ে। {prompt}",
    "revisit_done_topic": "বেশ, আবার ঝালিয়ে নেওয়া হয়ে গেল। চলুন পরের অংশে যাই।",
    "revisit_done_slide": "আবার ঝালিয়ে নেওয়া হয়ে গেল। লেগে থাকার জন্য খুব ভালো।",
    "revisit_skipped": "ঠিক আছে, এটা অন্য কোনো দিনের জন্য রেখে দিই।",
    "nudge_hint": "সময় নিয়ে ভাবুন। একটা ইঙ্গিত দিই: {hint}",
    "nudge_voice_hint": "বলে উত্তর দিতে Answer button টিপুন, তারপর বলুন — অথবা নিচে type করুন। একটা ইঙ্গিত দিই: {hint}",
    "nudge_voice_open": "বলে উত্তর দিতে Answer button টিপুন, তারপর বলুন — অথবা নিচে type করুন। চাইলে 'skip'-ও বলতে পারেন।",
    "nudge_open": "সময় নিয়ে ভাবুন। চাইলে 'skip' বলুন, আমরা পরে এটায় ফিরে আসব।",
    "predict_intro": "দেখানোর আগে, একটা আন্দাজ করুন: {question}",
    "predict_ack": "ভালো আন্দাজ। চলুন দেখি।",
    "answer_note": "উত্তর: {expected}",
    "greet_short": "নমস্কার {name}! আমি {teacher}, আজ আমরা {slide} দেখব।",
    "greet_returning_short": "আবার স্বাগত, {name}! গতবার আমরা {previous} নিয়ে কাজ করেছিলাম। {summary} আজ আমরা {slide} দেখব।",
    "warmup_ask": "শুরু করার আগে: {topic} শুনলে আপনার মনে কী আসে?",
    "warmup_ack": "বলার জন্য ধন্যবাদ। চলুন দেখি এটা কীভাবে মেলে।",
    "warmup_move_on": "কোনো অসুবিধা নেই। চলুন শুরু করি।",
}
T_KN = {
    "greet": "ನಮಸ್ಕಾರ {name}! ನಾನು {teacher}, ಇವತ್ತು ನಿಮಗೆ ನಾನು ಪಾಠ ಮಾಡುತ್ತೇನೆ. ಮೊದಲಿಗೆ {slide} ನೋಡೋಣ. ಶುರು ಮಾಡೋಣ.",
    "greet_interview": "ನಮಸ್ಕಾರ {name}, ನಾನು {teacher}, ಇವತ್ತು ನಾನು ನಿಮ್ಮ interviewer. ಯೋಚಿಸುತ್ತಾ ಮಾತಾಡಿ, ಸಮಯ ತೆಗೆದುಕೊಳ್ಳಿ, ಪ್ರತಿ ಉತ್ತರದ ನಂತರ ನಾನು feedback ಕೊಡುತ್ತೇನೆ. ರೆಡಿನಾ?",
    "greet_practice": "ನಮಸ್ಕಾರ {name}, ನಾನು {teacher}. ಇದು ಒಂದು practice session: ನಾನು ಒಂದು ಸನ್ನಿವೇಶ ಕೊಡುತ್ತೇನೆ, ನೀವು ಪ್ರಯತ್ನಿಸಿ, ಆಮೇಲೆ ನಾವು ಒಟ್ಟಿಗೆ ಅದನ್ನು ಇನ್ನೂ ಚೆನ್ನಾಗಿ ಮಾಡೋಣ. ಶುರು ಮಾಡೋಣ.",
    "resume": "ಮತ್ತೆ ಸ್ವಾಗತ, {name}! ಕಳೆದ ಸಲ ನಾವು {slide} ಓದುತ್ತಿದ್ದೆವು. {summary} ನಿಲ್ಲಿಸಿದ್ದಲ್ಲಿಂದಲೇ ಮುಂದುವರಿಸೋಣ.",
    "resume_summary": "ಮತ್ತೆ ಸ್ವಾಗತ, {name}! {slide} ಪಾಠದಲ್ಲಿ ನಾವು ಈಗಷ್ಟೇ {topic} ಮುಗಿಸಿದ್ದೆವು. {summary} ಅಲ್ಲಿಂದಲೇ ಮುಂದುವರಿಸೋಣ.",
    "resume_done": "ಮತ್ತೆ ಸ್ವಾಗತ, {name}! ನೀವು {slide} ಈಗಾಗಲೇ ಮುಗಿಸಿದ್ದೀರಿ. {summary} ಮುಂದೆ ಏನಿದೆ ನೋಡೋಣ.",
    "greet_returning": "ಮತ್ತೆ ಸ್ವಾಗತ, {name}! ಕಳೆದ ಸಲ ನಾವು {previous} ಬಗ್ಗೆ ಕೆಲಸ ಮಾಡಿದ್ದೆವು. {summary} ಇವತ್ತು {slide} ಶುರು ಮಾಡುತ್ತಿದ್ದೇವೆ. ಶುರು ಮಾಡೋಣ.",
    "topic_summary": "ಚೆನ್ನಾಗಿದೆ. {topic} ಇಲ್ಲಿಗೆ ಮುಗಿಯಿತು. ಬೋರ್ಡ್ ಅನ್ನು ಇನ್ನೊಮ್ಮೆ ನೋಡಿ, ಆಮೇಲೆ ಮುಂದಿನ ಭಾಗಕ್ಕೆ ಹೋಗೋಣ.",
    "slide_done": "{slide} ಮುಗಿಯಿತು. ತುಂಬಾ ಚೆನ್ನಾಗಿ ಮಾಡಿದಿರಿ, {name}. {weak}",
    "weak_note": "ಇನ್ನೂ ಸ್ವಲ್ಪ ಅಭ್ಯಾಸ ಬೇಕಿರುವ {n} ವಿಷಯಗಳಿಗೆ ನಾವು ಮತ್ತೆ ಬರೋಣ.",
    "ask": "{prompt}",
    "media_task_video": "ದಯವಿಟ್ಟು ಈಗ ಈ ವಿಡಿಯೋ ನೋಡಿ. ಆರಾಮವಾಗಿ ನೋಡಿ, ಮುಗಿದ ಮೇಲೆ ನನಗೆ ಹೇಳಿ.",
    "media_task_pdf": "ದಯವಿಟ್ಟು ಈಗ ಈ document ಓದಿ. ಆರಾಮವಾಗಿ ಓದಿ, ಮುಗಿದ ಮೇಲೆ ನನಗೆ ಹೇಳಿ.",
    "skipped": "ಸರಿ, ಮುಂದೆ ಹೋಗೋಣ.",
    "next_slide": "ಈಗ {slide} ಶುರು ಮಾಡೋಣ.",
    "pause": "ಸರಿ, ನಾನು ಕಾಯುತ್ತೇನೆ. ರೆಡಿ ಆದಾಗ 'continue' ಅಂತ ಹೇಳಿ.",
    "credits_end": "ನಿಮ್ಮ ಸಂಸ್ಥೆಯ lesson credits ಸದ್ಯಕ್ಕೆ ಮುಗಿದಿವೆ, ಹಾಗಾಗಿ ನಾನು ಇಲ್ಲಿಗೆ ನಿಲ್ಲಿಸುತ್ತೇನೆ. ನಿಮ್ಮ ಜಾಗ save ಆಗಿದೆ; top-up ಆದ ಮೇಲೆ ಮುಂದುವರಿಸೋಣ.",
    "idle_end": "ತುಂಬಾ ಹೊತ್ತಿನಿಂದ ಮಾತಿಲ್ಲ, ಹಾಗಾಗಿ ನಾನು ಇಲ್ಲಿಗೆ ನಿಲ್ಲಿಸುತ್ತೇನೆ. ಯಾವಾಗ ಬೇಕಾದರೂ ಮತ್ತೆ ಬನ್ನಿ, ನಿಲ್ಲಿಸಿದ್ದಲ್ಲಿಂದಲೇ ಮುಂದುವರಿಸೋಣ.",
    "away": "ನೀವು ಸ್ವಲ್ಪ ಹೊರಗೆ ಹೋದಂತಿದೆ. ನಾನು ಇಲ್ಲೇ ಕಾಯುತ್ತಿರುತ್ತೇನೆ.",
    "welcome_back": "ಮತ್ತೆ ಸ್ವಾಗತ! ನಿಲ್ಲಿಸಿದ್ದಲ್ಲಿಂದಲೇ ಮುಂದುವರಿಸೋಣ.",
    "slower": "ಖಂಡಿತ, ನಾನು ನಿಧಾನವಾಗಿ ಹೇಳುತ್ತೇನೆ.",
    "faster": "ಖಂಡಿತ, ಸ್ವಲ್ಪ ವೇಗವಾಗಿ ಹೋಗೋಣ.",
    "fallback_correct": "ಸರಿಯಾಗಿದೆ. ಮುಂದುವರಿಸೋಣ.",
    "fallback_hint": "ಪೂರ್ತಿ ಸರಿ ಇಲ್ಲ. ಬೋರ್ಡ್ ಅನ್ನು ಮತ್ತೆ ನೋಡಿ: {hint}. ಇನ್ನೊಮ್ಮೆ ಪ್ರಯತ್ನಿಸಿ.",
    "fallback_move_on": "ಇದನ್ನು ಆಮೇಲೆಗೆ ನೋಟ್ ಮಾಡಿಕೊಳ್ಳೋಣ, ಮುಂದೆ ಹೋಗೋಣ. {expected}",
    "revisit_intro_topic": "ಮುಂದೆ ಹೋಗುವ ಮೊದಲು, ಕಷ್ಟ ಆದ {n} ವಿಷಯಗಳಿಗೆ ಬೇಗ ಒಮ್ಮೆ ವಾಪಸ್ ಹೋಗೋಣ.",
    "revisit_intro_slide": "ಮುಗಿಸುವ ಮೊದಲು, ಇನ್ನೂ ಸ್ವಲ್ಪ ಅಭ್ಯಾಸ ಬೇಕಿರುವ {n} ವಿಷಯಗಳನ್ನು ಮತ್ತೆ ನೋಡೋಣ.",
    "revisit_ask": "{concept} ಬಗ್ಗೆ. {prompt}",
    "revisit_done_topic": "ಚೆನ್ನಾಗಿದೆ, ಪುನರಾವರ್ತನೆ ಮುಗಿಯಿತು. ಮುಂದಿನ ಭಾಗಕ್ಕೆ ಹೋಗೋಣ.",
    "revisit_done_slide": "ಪುನರಾವರ್ತನೆ ಮುಗಿಯಿತು. ಬಿಡದೆ ಪ್ರಯತ್ನಿಸಿದ್ದಕ್ಕೆ ಶಭಾಷ್.",
    "revisit_skipped": "ಸರಿ, ಇದನ್ನು ಇನ್ನೊಂದು ದಿನಕ್ಕೆ ಬಿಡೋಣ.",
    "nudge_hint": "ಆರಾಮವಾಗಿ ಯೋಚಿಸಿ. ಒಂದು ಸುಳಿವು: {hint}",
    "nudge_voice_hint": "ಮಾತಾಡಿ ಉತ್ತರಿಸಲು Answer button ಒತ್ತಿ, ಆಮೇಲೆ ಮಾತಾಡಿ — ಅಥವಾ ಕೆಳಗೆ type ಮಾಡಿ. ಒಂದು ಸುಳಿವು: {hint}",
    "nudge_voice_open": "ಮಾತಾಡಿ ಉತ್ತರಿಸಲು Answer button ಒತ್ತಿ, ಆಮೇಲೆ ಮಾತಾಡಿ — ಅಥವಾ ಕೆಳಗೆ type ಮಾಡಿ. ಬೇಕಾದರೆ 'skip' ಅಂತಲೂ ಹೇಳಬಹುದು.",
    "nudge_open": "ಆರಾಮವಾಗಿ ಯೋಚಿಸಿ. ಬೇಕಾದರೆ 'skip' ಅಂತ ಹೇಳಿ, ಇದಕ್ಕೆ ನಾವು ಆಮೇಲೆ ಬರೋಣ.",
    "predict_intro": "ತೋರಿಸುವ ಮೊದಲು, ಒಂದು ಊಹೆ ಮಾಡಿ: {question}",
    "predict_ack": "ಒಳ್ಳೆಯ ಊಹೆ. ನೋಡೋಣ.",
    "answer_note": "ಉತ್ತರ: {expected}",
    "greet_short": "ನಮಸ್ಕಾರ {name}! ನಾನು {teacher}, ಇವತ್ತು ನಾವು {slide} ನೋಡೋಣ.",
    "greet_returning_short": "ಮತ್ತೆ ಸ್ವಾಗತ, {name}! ಕಳೆದ ಸಲ ನಾವು {previous} ಬಗ್ಗೆ ಕೆಲಸ ಮಾಡಿದ್ದೆವು. {summary} ಇವತ್ತು {slide} ನೋಡೋಣ.",
    "warmup_ask": "ಶುರು ಮಾಡುವ ಮೊದಲು: {topic} ಅಂದ ತಕ್ಷಣ ನಿಮಗೆ ಏನು ನೆನಪಾಗುತ್ತದೆ?",
    "warmup_ack": "ಹೇಳಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ. ಇದು ಹೇಗೆ ಸೇರುತ್ತದೆ ನೋಡೋಣ.",
    "warmup_move_on": "ಪರವಾಗಿಲ್ಲ. ಶುರು ಮಾಡೋಣ.",
}
for _lang, _table in (("bn", T_BN), ("kn", T_KN)):
    for _key, _line in _table.items():
        T[_key][_lang] = _line


# ── line variety (natural teaching) ──────────────────────────────────────────
# Extra wordings of the most-heard fixed lines, per language. Variant 0 is
# always T[key][lang] (the line every session hears today); tpl(..., vary=True)
# picks uniformly among [T[key][lang]] + TV[key][lang]. Same placeholders and
# register as T (tests enforce it). tpl_all() lists every wording, so the
# voice warm-up can prepare all of them.
TV: Dict[str, Dict[str, List[str]]] = {
    "predict_intro": {
        "en": ["Quick guess before we look at it: {question}", "Let's see what you think first: {question}"],
        "hi": ["पहले आप अंदाज़ा लगाइए: {question}", "चलिए पहले एक छोटा सा अंदाज़ा: {question}"],
        "bn": ["আগে আপনি একটা আন্দাজ করুন: {question}", "চলুন আগে একটা ছোট্ট আন্দাজ: {question}"],
        "kn": ["ಮೊದಲು ನೀವು ಒಂದು ಊಹೆ ಮಾಡಿ: {question}", "ನೋಡುವ ಮೊದಲು ಒಂದು ಸಣ್ಣ ಊಹೆ: {question}"],
    },
    "predict_ack": {
        "en": ["Nice thinking. Let's find out.", "Interesting. Let's take a look."],
        "hi": ["बढ़िया सोच। चलिए पता करते हैं।", "दिलचस्प। चलिए देखते हैं।"],
        "bn": ["ভালো ভেবেছেন। চলুন জেনে নিই।", "আকর্ষণীয় আন্দাজ। চলুন দেখা যাক।"],
        "kn": ["ಚೆನ್ನಾಗಿ ಯೋಚಿಸಿದ್ದೀರಿ. ತಿಳಿದುಕೊಳ್ಳೋಣ.", "ಆಸಕ್ತಿಕರವಾಗಿದೆ. ನೋಡೋಣ."],
    },
    "topic_summary": {
        "en": ["Nice work. That's {topic} done. Have one more look at the board before we go on.",
               "And that's {topic}. Glance over the board once more, then we'll carry on."],
        "hi": ["बढ़िया। {topic} पूरा हो गया। आगे बढ़ने से पहले बोर्ड को एक बार और देख लीजिए।",
               "तो यह था {topic}। बोर्ड पर एक नज़र और डाल लीजिए, फिर आगे चलते हैं।"],
        "bn": ["চমৎকার। {topic} শেষ হলো। এগোনোর আগে বোর্ডটা আর একবার দেখে নিন।",
               "তো এই হলো {topic}। বোর্ডে আর একবার চোখ বুলিয়ে নিন, তারপর এগোই।"],
        "kn": ["ಚೆನ್ನಾಗಿದೆ. {topic} ಮುಗಿಯಿತು. ಮುಂದೆ ಹೋಗುವ ಮೊದಲು ಬೋರ್ಡ್ ಅನ್ನು ಇನ್ನೊಮ್ಮೆ ನೋಡಿ.",
               "ಇದು {topic}. ಬೋರ್ಡ್ ಮೇಲೆ ಇನ್ನೊಮ್ಮೆ ಕಣ್ಣಾಡಿಸಿ, ಆಮೇಲೆ ಮುಂದುವರಿಸೋಣ."],
    },
    "skipped": {
        "en": ["No problem, let's keep going.", "Sure, on to the next one."],
        "hi": ["कोई बात नहीं, आगे चलते हैं।", "ठीक है, अगले पर चलते हैं।"],
        "bn": ["কোনো অসুবিধা নেই, এগিয়ে চলি।", "ঠিক আছে, পরেরটায় যাই।"],
        "kn": ["ಪರವಾಗಿಲ್ಲ, ಮುಂದುವರಿಸೋಣ.", "ಸರಿ, ಮುಂದಿನದಕ್ಕೆ ಹೋಗೋಣ."],
    },
    "next_slide": {
        "en": ["Next up: {slide}.", "Let's carry on with {slide}."],
        "hi": ["आगे है: {slide}।", "चलिए अब {slide} शुरू करते हैं।"],
        "bn": ["এরপর: {slide}।", "চলুন এবার {slide} নিয়ে এগোই।"],
        "kn": ["ಮುಂದಿನದು: {slide}.", "ಈಗ {slide} ಕಡೆಗೆ ಹೋಗೋಣ."],
    },
    "slower": {
        "en": ["Of course, I'll slow down.", "No problem, a little slower then."],
        "hi": ["बिल्कुल, मैं धीरे बोलती हूँ।", "ठीक है, थोड़ा धीरे चलते हैं।"],
        "bn": ["অবশ্যই, আমি একটু ধীরে বলছি।", "ঠিক আছে, একটু আস্তে এগোই।"],
        "kn": ["ಖಂಡಿತ, ನಾನು ನಿಧಾನ ಮಾಡುತ್ತೇನೆ.", "ಸರಿ, ಸ್ವಲ್ಪ ನಿಧಾನವಾಗಿ ಹೋಗೋಣ."],
    },
    "faster": {
        "en": ["Of course, let's pick up the pace.", "Okay, a bit quicker then."],
        "hi": ["बिल्कुल, थोड़ा तेज़ बोलती हूँ।", "ठीक है, रफ़्तार थोड़ी बढ़ाते हैं।"],
        "bn": ["অবশ্যই, একটু তাড়াতাড়ি বলছি।", "ঠিক আছে, গতিটা একটু বাড়াই।"],
        "kn": ["ಖಂಡಿತ, ಸ್ವಲ್ಪ ವೇಗವಾಗಿ ಹೇಳುತ್ತೇನೆ.", "ಸರಿ, ಸ್ವಲ್ಪ ಬೇಗ ಹೋಗೋಣ."],
    },
    "pause": {
        "en": ["Sure, take a moment. Say continue whenever you're ready.",
               "No rush. I'm right here; say continue when you want to go on."],
        "hi": ["ज़रूर, आराम से। जब तैयार हों, 'continue' कहिए।",
               "कोई जल्दी नहीं। मैं यहीं हूँ; आगे बढ़ना हो तो 'continue' कहिए।"],
        "bn": ["নিশ্চয়ই, একটু সময় নিন। তৈরি হলে 'continue' বলবেন।",
               "কোনো তাড়া নেই। আমি এখানেই আছি; এগোতে চাইলে 'continue' বলবেন।"],
        "kn": ["ಖಂಡಿತ, ಸ್ವಲ್ಪ ಸಮಯ ತೆಗೆದುಕೊಳ್ಳಿ. ರೆಡಿ ಆದಾಗ 'continue' ಅಂತ ಹೇಳಿ.",
               "ಅವಸರ ಇಲ್ಲ. ನಾನು ಇಲ್ಲೇ ಇದ್ದೇನೆ; ಮುಂದುವರಿಸಲು 'continue' ಅಂತ ಹೇಳಿ."],
    },
    "nudge_hint": {
        "en": ["No rush. Here's something to help: {hint}", "Think it over. A small hint: {hint}"],
        "hi": ["कोई जल्दी नहीं। यह मदद करेगा: {hint}", "सोचिए ज़रा। एक छोटा सा संकेत: {hint}"],
        "bn": ["কোনো তাড়া নেই। এটা একটু সাহায্য করবে: {hint}", "একটু ভেবে দেখুন। ছোট্ট একটা ইঙ্গিত: {hint}"],
        "kn": ["ಅವಸರ ಇಲ್ಲ. ಇದು ಸಹಾಯ ಮಾಡಬಹುದು: {hint}", "ಸ್ವಲ್ಪ ಯೋಚಿಸಿ. ಒಂದು ಸಣ್ಣ ಸುಳಿವು: {hint}"],
    },
    "nudge_open": {
        "en": ["No rush, think it through. You can also say 'skip' and we'll return to it later.",
               "Take a moment. If you're stuck, just say 'skip' and we'll come back to it."],
        "hi": ["कोई जल्दी नहीं, सोचकर बताइए। चाहें तो 'skip' कहिए, हम इस पर बाद में लौटेंगे।",
               "थोड़ा समय लीजिए। अटक गए हों तो 'skip' कहिए, हम बाद में इस पर आएँगे।"],
        "bn": ["কোনো তাড়া নেই, ভেবে বলুন। চাইলে 'skip' বলুন, আমরা পরে এটায় ফিরে আসব।",
               "একটু সময় নিন। আটকে গেলে 'skip' বলুন, পরে আমরা এটায় ফিরব।"],
        "kn": ["ಅವಸರ ಇಲ್ಲ, ಯೋಚಿಸಿ ಹೇಳಿ. ಬೇಕಾದರೆ 'skip' ಅಂತ ಹೇಳಿ, ಇದಕ್ಕೆ ಆಮೇಲೆ ಬರೋಣ.",
               "ಸ್ವಲ್ಪ ಸಮಯ ತೆಗೆದುಕೊಳ್ಳಿ. ಕಷ್ಟ ಆದರೆ 'skip' ಅಂತ ಹೇಳಿ, ಆಮೇಲೆ ಇದಕ್ಕೆ ವಾಪಸ್ ಬರೋಣ."],
    },
    "nudge_voice_hint": {
        "en": ["Tap the Answer button and say it out loud, or type it below. A hint: {hint}",
               "You can speak your answer: tap Answer first, then talk. Or type it below. Here's a hint: {hint}"],
        "hi": ["Answer button दबाकर बोलिए, या नीचे type कीजिए। एक संकेत: {hint}",
               "बोलकर जवाब देना हो तो पहले Answer button दबाइए, फिर बोलिए। या नीचे type कीजिए। एक संकेत: {hint}"],
        "bn": ["Answer button টিপে জোরে বলুন, অথবা নিচে type করুন। একটা ইঙ্গিত: {hint}",
               "বলে উত্তর দিতে চাইলে আগে Answer button টিপুন, তারপর বলুন। অথবা নিচে type করুন। একটা ইঙ্গিত: {hint}"],
        "kn": ["Answer button ಒತ್ತಿ ಜೋರಾಗಿ ಹೇಳಿ, ಅಥವಾ ಕೆಳಗೆ type ಮಾಡಿ. ಒಂದು ಸುಳಿವು: {hint}",
               "ಮಾತಾಡಿ ಉತ್ತರಿಸಬೇಕಾದರೆ ಮೊದಲು Answer button ಒತ್ತಿ, ಆಮೇಲೆ ಮಾತಾಡಿ. ಅಥವಾ ಕೆಳಗೆ type ಮಾಡಿ. ಒಂದು ಸುಳಿವು: {hint}"],
    },
    "nudge_voice_open": {
        "en": ["Tap the Answer button and say it out loud, or type it below. Or say 'skip' to move on.",
               "You can speak your answer: tap Answer first, then talk. Or type it below, or say 'skip'."],
        "hi": ["Answer button दबाकर बोलिए, या नीचे type कीजिए। आगे बढ़ना हो तो 'skip' कहिए।",
               "बोलकर जवाब देना हो तो पहले Answer button दबाइए, फिर बोलिए। या नीचे type कीजिए, या 'skip' कहिए।"],
        "bn": ["Answer button টিপে জোরে বলুন, অথবা নিচে type করুন। এগোতে চাইলে 'skip' বলুন।",
               "বলে উত্তর দিতে চাইলে আগে Answer button টিপুন, তারপর বলুন। অথবা নিচে type করুন, কিংবা 'skip' বলুন।"],
        "kn": ["Answer button ಒತ್ತಿ ಜೋರಾಗಿ ಹೇಳಿ, ಅಥವಾ ಕೆಳಗೆ type ಮಾಡಿ. ಮುಂದೆ ಹೋಗಲು 'skip' ಅಂತ ಹೇಳಿ.",
               "ಮಾತಾಡಿ ಉತ್ತರಿಸಬೇಕಾದರೆ ಮೊದಲು Answer button ಒತ್ತಿ, ಆಮೇಲೆ ಮಾತಾಡಿ. ಅಥವಾ ಕೆಳಗೆ type ಮಾಡಿ, ಇಲ್ಲವೇ 'skip' ಅಂತ ಹೇಳಿ."],
    },
    "revisit_done_topic": {
        "en": ["Nice, that's the review done. On to the next part.",
               "Good work going back over that. Let's continue with the next part."],
        "hi": ["बढ़िया, दोहराव हो गया। अब अगले हिस्से पर चलते हैं।",
               "उसे दोबारा देखने के लिए शाबाश। चलिए अगले हिस्से पर चलते हैं।"],
        "bn": ["চমৎকার, ঝালিয়ে নেওয়া হলো। এবার পরের অংশে যাই।",
               "আবার দেখে নেওয়ার জন্য খুব ভালো। চলুন পরের অংশে এগোই।"],
        "kn": ["ಚೆನ್ನಾಗಿದೆ, ಪುನರಾವರ್ತನೆ ಆಯ್ತು. ಈಗ ಮುಂದಿನ ಭಾಗಕ್ಕೆ ಹೋಗೋಣ.",
               "ಅದನ್ನು ಮತ್ತೆ ನೋಡಿದ್ದಕ್ಕೆ ಶಭಾಷ್. ಮುಂದಿನ ಭಾಗದೊಂದಿಗೆ ಮುಂದುವರಿಸೋಣ."],
    },
    "revisit_done_slide": {
        "en": ["That's the review finished. Thanks for sticking with it.", "And that's the revisit done. Great effort today."],
        "hi": ["दोहराव पूरा हो गया। धैर्य रखने के लिए शुक्रिया।", "तो दोहराव हो गया। आज आपने बहुत अच्छी मेहनत की।"],
        "bn": ["ঝালিয়ে নেওয়া শেষ। ধৈর্য ধরে থাকার জন্য ধন্যবাদ।", "তো, আবার দেখে নেওয়া হয়ে গেল। আজ আপনি খুব ভালো চেষ্টা করেছেন।"],
        "kn": ["ಪುನರಾವರ್ತನೆ ಮುಗಿಯಿತು. ತಾಳ್ಮೆಯಿಂದ ಇದ್ದದ್ದಕ್ಕೆ ಧನ್ಯವಾದ.", "ಪುನರಾವರ್ತನೆ ಆಯ್ತು. ಇವತ್ತು ನೀವು ತುಂಬಾ ಚೆನ್ನಾಗಿ ಪ್ರಯತ್ನಿಸಿದಿರಿ."],
    },
    "fallback_correct": {
        "en": ["Exactly. Let's keep going.", "Yes, that's it. On we go."],
        "hi": ["एकदम सही। चलिए आगे चलते हैं।", "हाँ, यही बात है। आगे बढ़ते हैं।"],
        "bn": ["ঠিক তাই। চলুন এগোই।", "হ্যাঁ, এটাই। চলুন সামনে যাই।"],
        "kn": ["ಹೌದು, ಸರಿಯಾಗಿದೆ. ಮುಂದುವರಿಸೋಣ.", "ಅದೇ ಸರಿ. ಮುಂದೆ ಹೋಗೋಣ."],
    },
    "welcome_back": {
        "en": ["There you are! Let's carry on from where we stopped.", "Good to have you back. Let's continue from where we were."],
        "hi": ["आप आ गए! चलिए जहाँ रुके थे वहीं से शुरू करते हैं।", "आपका फिर से स्वागत है। जहाँ थे वहीं से आगे चलते हैं।"],
        "bn": ["এই তো আপনি! চলুন, যেখানে থেমেছিলাম সেখান থেকে এগোই।", "ফিরে এসেছেন, ভালো লাগল। চলুন যেখানে ছিলাম সেখান থেকেই শুরু করি।"],
        "kn": ["ಮತ್ತೆ ಬಂದಿರಿ! ನಿಲ್ಲಿಸಿದ್ದಲ್ಲಿಂದ ಮುಂದುವರಿಸೋಣ.", "ಮತ್ತೆ ಬಂದದ್ದು ಖುಷಿ. ನಾವು ಇದ್ದಲ್ಲಿಂದಲೇ ಮುಂದುವರಿಸೋಣ."],
    },
    # The warm-up's own lines.
    "warmup_ask": {
        "en": ["Quick question first: what do you already know about {topic}?",
               "Before we begin, tell me: what does {topic} make you think of?"],
        "hi": ["पहले एक छोटा सा सवाल: {topic} के बारे में आप पहले से क्या जानते हैं?",
               "शुरू करने से पहले बताइए: {topic} से आपको क्या याद आता है?"],
        "bn": ["আগে একটা ছোট্ট প্রশ্ন: {topic} নিয়ে আপনি আগে থেকে কী জানেন?",
               "শুরুর আগে বলুন তো: {topic} বললে আপনার কী মনে পড়ে?"],
        "kn": ["ಮೊದಲು ಒಂದು ಸಣ್ಣ ಪ್ರಶ್ನೆ: {topic} ಬಗ್ಗೆ ನಿಮಗೆ ಈಗಾಗಲೇ ಏನು ಗೊತ್ತು?",
               "ಶುರು ಮಾಡುವ ಮೊದಲು ಹೇಳಿ: {topic} ಕೇಳಿದಾಗ ನಿಮಗೆ ಏನು ಅನಿಸುತ್ತದೆ?"],
    },
    "warmup_ack": {
        "en": ["Good, hold on to that thought.", "I like that. Let's build on it."],
        "hi": ["बढ़िया, इस बात को ध्यान में रखिए।", "अच्छी बात है। चलिए इसी पर आगे बढ़ते हैं।"],
        "bn": ["বেশ, কথাটা মনে রাখুন।", "ভালো বলেছেন। চলুন এর ওপর ভিত্তি করে এগোই।"],
        "kn": ["ಚೆನ್ನಾಗಿದೆ, ಈ ಯೋಚನೆಯನ್ನು ನೆನಪಿಟ್ಟುಕೊಳ್ಳಿ.", "ಒಳ್ಳೆಯ ಮಾತು. ಇದರ ಮೇಲೆಯೇ ಮುಂದುವರಿಸೋಣ."],
    },
    "warmup_move_on": {
        "en": ["That's fine, let's jump right in.", "Okay, let's get started."],
        "hi": ["ठीक है, सीधे शुरू करते हैं।", "चलिए, शुरुआत करते हैं।"],
        "bn": ["ঠিক আছে, সোজা শুরু করি।", "চলুন, শুরু করা যাক।"],
        "kn": ["ಸರಿ, ನೇರವಾಗಿ ಶುರು ಮಾಡೋಣ.", "ಬನ್ನಿ, ಶುರು ಮಾಡೋಣ."],
    },
}


# ── rolling summary shape ────────────────────────────────────────────────────
# A model-written summary is two paragraphs: what the teacher says to the
# learner on return, then her private notes. The deterministic fallback
# written at session end starts with "Session on" and is never spoken.

LEGACY_SUMMARY_PREFIX = "Session on "


def resume_line(summary: Optional[str]) -> Optional[str]:
    """The sentence(s) to say to a returning learner, or None for a legacy
    (deterministic) summary."""
    s = (summary or "").strip()
    if not s or s.startswith(LEGACY_SUMMARY_PREFIX) or "\n\n" not in s:
        return None
    first = s.split("\n\n", 1)[0].strip()
    return first[:400] or None


def summary_notes(summary: Optional[str]) -> str:
    """The teacher's notes part (everything but the spoken line)."""
    s = (summary or "").strip()
    if "\n\n" in s and not s.startswith(LEGACY_SUMMARY_PREFIX):
        return s.split("\n\n", 1)[1].strip()
    return s


# What the runtime has always stripped (the off arm keeps it byte for byte).
_LEADING_GREETING = re.compile(
    r"^\s*(?:hi|hello|hey|namaste|नमस्ते|welcome(?: back)?)[^.!?।]*[.!?।]\s*", re.IGNORECASE)
# Natural teaching: the Latin words must end there ("History is…" is not
# "Hi"), and the Bengali / Kannada / Hindi greetings count too; the Indic ones
# end in a vowel sign, which \b does not treat as a word character.
_LEADING_GREETING_EXTENDED = re.compile(
    r"^\s*(?:(?:hi|hello|hey|namaste|welcome(?: back)?)(?![a-z])|नमस्ते|नमस्कार|নমস্কার|হ্যালো|ನಮಸ್ಕಾರ)"
    r"[^.!?।]*[.!?।]\s*", re.IGNORECASE)


_NAME_GREETING = re.compile(r"^\s*(?:hi|hello|hey|namaste|नमस्ते|welcome(?: back)?)[,!]?\s*\{student_name\}[,!]?\s*", re.IGNORECASE)
_NAME_INLINE = re.compile(r"\s*,?\s*\{student_name\}\s*,?\s*")


def neutralize_name(text_: str) -> str:
    """The same line without the learner's name (for prepared audio and
    learners whose name is unknown): "Hi {student_name}, a force is a push."
    → "A force is a push."; "Look, {student_name}, at the arrow" → "Look at the arrow"."""
    t = _NAME_GREETING.sub("", text_ or "", count=1)
    t = _NAME_INLINE.sub(" ", t)
    t = " ".join(t.split()).strip()
    return (t[0].upper() + t[1:]) if t else t


def strip_leading_greeting(narration: str, *, extended: bool = False) -> str:
    """Drop a compiled narration's own opening "Hi {name}, …" sentence when
    the teacher already greeted (welcome back / next slide). `extended`
    (natural teaching only): the stricter, multilingual pattern."""
    pattern = _LEADING_GREETING_EXTENDED if extended else _LEADING_GREETING
    out = pattern.sub("", narration or "", count=1)
    return out if out.strip() else narration


# Line variety picks with this (tests seed or replace it).
_rng = random.Random()


def _line(key: str, lang: str) -> Tuple[str, str]:
    """(the language actually used, variant 0) — English when the key has no
    line in `lang`."""
    table = T[key]
    use = lang if lang in table else "en"
    return use, (table.get(use) or table["en"])


def _render(text: str, kw: Dict[str, Any]) -> str:
    try:
        return text.format(**{k: (v if v is not None else "") for k, v in kw.items()})
    except Exception:  # noqa: BLE001
        return text


def _variants(key: str, lang: str) -> List[str]:
    use, base = _line(key, lang)
    return [base] + list((TV.get(key) or {}).get(use) or [])


def tpl(key: str, lang: str, *, vary: bool = False, **kw: Any) -> str:
    """A fixed line. `vary` (natural teaching) picks uniformly among its
    wordings; off, it is always variant 0 — today's line."""
    text = _line(key, lang)[1]
    if vary:
        text = _rng.choice(_variants(key, lang))
    return _render(text, kw)


def tpl_all(key: str, lang: str, **kw: Any) -> List[str]:
    """Every wording of a fixed line, rendered (variant 0 first)."""
    return [_render(t, kw) for t in _variants(key, lang)]


# ── decision turn ────────────────────────────────────────────────────────────

DECISION_SCHEMA = """Return ONE JSON object and nothing else:
{
  "action": "advance" | "remediate" | "answer_doubt" | "wait",
  "say": "what you say next, 1-4 spoken sentences, in the session language, addressing the learner directly",
  "board_ops": [ {"op":"highlight","target":"<element id on the board>","style":"pulse"} | {"op":"annotate","id":"s-1","target":"<element id>","text":"<=8 words","position":"right"} | {"op":"callout","id":"note-1","kind":"example","text":"<=30 words: a worked example or the key line, ONLY with action remediate or answer_doubt"} ],
  "assessment": {"score": 0.0-1.0, "misconception": "<short label or null>", "evidence": "<what in the answer shows it>"},
  "learner_state_delta": {"note": "<one line about this learner, or null>"}
}
Rules: "advance" only when score >= the pass threshold. "remediate" = the answer misses the point: `say` gives ONE
concrete hint anchored on the board and re-asks in fewer words (never reveal the full answer on the first remediation).
"answer_doubt" = the learner asked something instead of answering: answer briefly from the concept material, then
invite them to answer the check. "wait" = the learner said something that is neither (small talk): respond in one
sentence and re-ask. Ops: highlight/annotate on targets that exist on the board, plus at most ONE callout note when you
remediate or answer a doubt (a worked example or the one line to remember — it stays on the board). ECHOES: an answer
that repeats the teacher's own hint or words nearly verbatim is NOT understanding: score it at most 0.6 and, the first
time, use action "wait" to ask for it in their own words or for the reason why. SPOKEN ANSWERS: a voice answer
is a speech-to-text transcript — ignore fillers ("um", "like", "you know", "ma'am"), false starts, repetition, loose
grammar and misheard words, and grade the idea the learner expressed. An answer that states the key idea in its own
informal words is correct: give it full credit even if it is phrased nothing like the expected answer. When it is
partly right, credit what is right and name the one missing piece. (The exception is a check whose rubric grades
the wording itself — e.g. removing hedge or filler words — there the words are the answer.) No markdown."""

# Natural teaching: an optional "bridge" field, requested only when the turn
# prompt names the NEXT CONCEPT. The server speaks it after `say`, and only
# when the answer advanced into a new concept.
BRIDGE_MAX_WORDS = 15
BRIDGE_SCHEMA = f"""Optional extra field, ONLY with action "advance" and ONLY when a NEXT CONCEPT is given:
  "bridge": "one short spoken sentence (at most {BRIDGE_MAX_WORDS} words, the session language, no question mark) that leads from what the learner just got right into the NEXT CONCEPT — do not teach it, do not greet, do not repeat `say`"
Keep `say` as the verdict alone; the bridge is spoken right after it. Leave "bridge" out for every other action."""


LIVE_PERSONA = {
    "lesson": "You are {teacher}, a one-to-one teacher speaking to a learner over a shared whiteboard.",
    "interview": ("You are {teacher}, a professional interviewer running a mock interview over a shared whiteboard. "
                  "You are evaluating a CANDIDATE, not teaching a student: react like an interviewer (brief, fair, "
                  "specific), give the model answer and the method only after their attempt, never say 'let's learn' "
                  "or 'look at the board again' as a lesson would, and move to the next question cleanly."),
    "practice": ("You are {teacher}, a coach running a practice session over a shared whiteboard. The learner "
                 "attempts, you give short concrete feedback and a better version, then the next attempt."),
}


def greet_key(style: str) -> str:
    return {"interview": "greet_interview", "practice": "greet_practice"}.get(style or "lesson", "greet")


def system_prompt(teacher: str, lang: str, strictness: str, style: str = "lesson", *, bridge: bool = False) -> str:
    tone = {
        "gentle": "Very encouraging; accept partial answers generously; never make the learner feel wrong.",
        "strict": "Precise; award credit only for correct, complete answers; correct terminology firmly but kindly.",
    }.get(strictness, "Warm and clear; give credit for the right idea in the learner's own words.")
    persona = LIVE_PERSONA.get(style or "lesson", LIVE_PERSONA["lesson"]).format(teacher=teacher)
    return (
        f"{persona} "
        f"Session language: {LANG_NAMES.get(lang, lang)}. {tone}\n"
        "You evaluate the learner's answer to the check for the CURRENT concept using its rubric and the listed "
        "misconceptions, and decide what happens next. Keep every spoken line short; the learner is listening, not reading.\n\n"
        + DECISION_SCHEMA
        + ("\n" + BRIDGE_SCHEMA if bridge else "")
    )


_TRAILING_Q = re.compile(r"[?？]\s*[\"'”’)]*\s*$")


def narration_asks(say: str) -> bool:
    """The narration already ended on a question: speaking the check prompt
    too would ask the learner twice (older plans; new ones are validated)."""
    return bool(_TRAILING_Q.search((say or "").strip()))


def _ops_as_text(ops: List[Dict[str, Any]]) -> str:
    lines = []
    for op in ops:
        k = op.get("op")
        if k in ("heading", "text", "callout", "annotate"):
            lines.append(f"[{k} #{op.get('id')}] {op.get('text')}")
        elif k == "bullet":
            lines.append(f"[bullet #{op.get('id')}] " + " | ".join(op.get("items") or []))
        elif k == "formula":
            lines.append(f"[formula #{op.get('id')}] {op.get('latex')}")
        elif k in ("svg", "image", "video", "media_task"):
            parts = ", ".join(f"{p.get('label')} (#{p.get('id')})" for p in (op.get("parts") or []))
            lines.append(f"[{k} #{op.get('id')}] {op.get('description')}" + (f" — parts: {parts}" if parts else ""))
        elif k == "table":
            lines.append(f"[table #{op.get('id')}] " + " / ".join(" | ".join(r) for r in (op.get("rows") or [])[:4]))
        elif k == "arrow":
            lines.append(f"[arrow #{op.get('id')}] {op.get('from')} -> {op.get('to')} {op.get('text') or ''}")
    return "\n".join(lines)


def turn_prompt(
    *,
    learner_name: Optional[str],
    learner_block: str,
    slide_title: str,
    objectives: List[str],
    board_ops: List[Dict[str, Any]],
    concept_title: str,
    concept_say: str,
    teach_notes: Optional[str],
    check: Dict[str, Any],
    transcript: List[Dict[str, str]],
    learner_message: str,
    remediation_no: int,
    mode: str,
    final_attempt: bool = False,
    source_block: Optional[str] = None,
    revisit: bool = False,
    next_concept: Optional[str] = None,
) -> str:
    parts = [
        f"LEARNER: {learner_name or 'the learner'}\n{learner_block}".strip(),
        f"SLIDE: {slide_title}\nOBJECTIVES: " + "; ".join(objectives[:5]),
        "BOARD (what the learner sees now; ids in #):\n" + (_ops_as_text(board_ops) or "(empty)"),
        f"CURRENT CONCEPT: {concept_title}\nTEACHER JUST SAID: {concept_say}"
        + (f"\nTEACHING NOTES: {teach_notes}" if teach_notes else ""),
        "CHECK:\n" + json.dumps({
            "type": check.get("type"), "prompt": check.get("prompt"), "options": check.get("options") or [],
            "expected": check.get("expected"), "rubric": check.get("rubric"),
            "misconceptions": check.get("misconceptions") or [], "pass_threshold": check.get("pass_threshold", 0.7),
        }, ensure_ascii=False),
        ("SOURCE MATERIAL (the course's own material for this concept; ground your hint in it):\n" + source_block[:6000])
        if source_block else "",
        "RECENT TRANSCRIPT:\n" + "\n".join(f"{m['role']}: {m['text']}" for m in transcript[-6:]),
        ("THIS IS A REVISIT: the learner found this concept hard earlier in the lesson; the check above is a fresh "
         "question on the same idea and this is their ONE attempt at it."
         if revisit else (f"THIS IS REMEDIATION #{remediation_no} FOR THIS CONCEPT." if remediation_no else "FIRST ANSWER FOR THIS CONCEPT.")),
        ("THIS IS THE LEARNER'S FINAL ATTEMPT ON THIS CHECK. Do NOT re-ask. If the answer is still wrong, use action "
         "\"remediate\" and in `say` give the correct answer in one clear sentence, then say you will move on."
         if final_attempt else ""),
        (f"NEXT CONCEPT (taught right after an advance; only for the optional \"bridge\"): {next_concept}"
         if next_concept else ""),
        f"LEARNER NOW SAYS ({mode}): {learner_message.strip()}",
        "Decide. JSON only.",
    ]
    return "\n\n".join(p for p in parts if p)


def doubt_prompt(
    *,
    learner_name: Optional[str],
    learner_block: str,
    slide_title: str,
    board_ops: List[Dict[str, Any]],
    concept_title: str,
    concept_say: str,
    teach_notes: Optional[str],
    transcript: List[Dict[str, str]],
    question: str,
    source_block: Optional[str],
) -> str:
    parts = [
        f"LEARNER: {learner_name or 'the learner'}\n{learner_block}".strip(),
        f"SLIDE: {slide_title}",
        "BOARD (ids in #):\n" + (_ops_as_text(board_ops) or "(empty)"),
        f"CURRENT CONCEPT: {concept_title}\nTEACHER JUST SAID: {concept_say}"
        + (f"\nTEACHING NOTES: {teach_notes}" if teach_notes else ""),
    ]
    if source_block:
        parts.append("SOURCE MATERIAL (answer from this; say so if it does not cover the question):\n" + source_block[:6000])
    parts += [
        "RECENT TRANSCRIPT:\n" + "\n".join(f"{m['role']}: {m['text']}" for m in transcript[-6:]),
        f"LEARNER ASKS: {question.strip()}",
        'Answer in 1-4 spoken sentences, then bring them back to the lesson. Use action "answer_doubt". JSON only.',
    ]
    return "\n\n".join(parts)


def learner_block(state: Dict[str, Any], tags: List[str]) -> str:
    mastery = state.get("mastery_json") or {}
    relevant = {t: mastery[t] for t in tags if t in mastery}
    lines = []
    if state.get("rolling_summary"):
        lines.append("Previous sessions: " + summary_notes(str(state["rolling_summary"]))[:600])
    if relevant:
        lines.append("Mastery on this concept's tags: " + ", ".join(f"{t}={round(float(v.get('score', 0)), 2)}" for t, v in relevant.items()))
    mis = state.get("misconceptions_json") or []
    if mis:
        lines.append("Known misconceptions: " + "; ".join(str(m.get("note") or m.get("tag")) for m in mis[-4:]))
    if state.get("pace"):
        lines.append(f"Pace preference: {state['pace']}")
    return "\n".join(lines)


# ── revisit question (design §6.6) ───────────────────────────────────────────

REVISIT_QUESTION_SCHEMA = """Return ONE JSON object and nothing else:
{"prompt": "<the new question, 1-2 spoken sentences>", "expected": "<the answer you expect, one line>", "rubric": "<what earns credit, one line>"}"""


def revisit_question_prompt(
    *, lang: str, concept_title: str, concept_say: str, teach_notes: Optional[str], check: Dict[str, Any],
    previous_answer: Optional[str], misconception: Optional[str],
) -> str:
    parts = [
        f"CONCEPT: {concept_title}\nWHAT WAS TAUGHT: {concept_say}" + (f"\nTEACHING NOTES: {teach_notes}" if teach_notes else ""),
        "ORIGINAL CHECK (do not reuse its wording):\n" + json.dumps({
            "prompt": check.get("prompt"), "expected": check.get("expected"), "rubric": check.get("rubric"),
            "misconceptions": check.get("misconceptions") or []}, ensure_ascii=False),
        (f"THE LEARNER'S EARLIER ANSWER: {previous_answer[:300]}" if previous_answer else "")
        + (f"\nMISCONCEPTION HEARD: {misconception}" if misconception else ""),
        f"Write ONE fresh question on the same idea, approached from a different angle (an example, a why, a what-if), "
        f"answerable in one or two spoken sentences, in {LANG_NAMES.get(lang, lang)}. No options, no markdown.",
        REVISIT_QUESTION_SCHEMA,
    ]
    return "\n\n".join(p for p in parts if p)


# ── rolling summary rewrite (design §6.6, §6.9) ─────────────────────────────

SUMMARY_SCHEMA = """Return ONE JSON object and nothing else:
{"say_next_time": "<1-2 sentences you will say to the learner when they return: what went well and what to revisit; warm, specific, no lists>",
 "notes": "<60-120 words of private notes: what they know, which concepts are weak (name them), misconceptions heard, how they answer, pace>"}"""


def summary_prompt(*, teacher: str, learner_name: Optional[str], lang: str, digest: Dict[str, Any]) -> str:
    attempts = digest.get("attempts") or []
    lines = [
        f"You are {teacher}, a one-to-one teacher. Rewrite your notes about {learner_name or 'the learner'} after today's lesson.",
        f"TODAY ({digest.get('date')}, {digest.get('duration_minutes', 0)} min): "
        + "; ".join(f"{s.get('title')} — {s.get('done_today', s.get('done', 0))} concept(s) today, "
                    f"{s.get('done', 0)}/{s.get('total', 0)} overall" for s in (digest.get("slides") or [])),
        "ANSWERS TODAY:\n" + ("\n".join(
            f"- {a.get('concept')}: score {a.get('score') if a.get('score') is not None else 'n/a'}, {a.get('action')}"
            + (f", misconception: {a.get('misconception')}" if a.get("misconception") else "")
            + (f", said: \"{a.get('answer')}\"" if a.get("answer") else "")
            for a in attempts[:40]) or "(no checks answered)"),
        ("STILL WEAK: " + ", ".join(digest.get("weak_titles") or [])) if digest.get("weak_titles") else "",
        ("PREVIOUS NOTES:\n" + str(digest.get("previous_summary"))[:900]) if digest.get("previous_summary") else "",
        f"Pace preference: {digest.get('pace')}" if digest.get("pace") else "",
        f"`say_next_time` must be in {LANG_NAMES.get(lang, lang)} and address the learner directly, but it must NOT greet "
        "or say the learner's name (the teacher has already said \"welcome back\" before it); `notes` in English. "
        "Merge with the previous notes and drop what is no longer true.",
        SUMMARY_SCHEMA,
    ]
    return "\n\n".join(p for p in lines if p)


# ── predict-then-reveal turn ─────────────────────────────────────────────────

PREDICT_SCHEMA = """Return ONE JSON object and nothing else:
{"say": "1-2 spoken sentences reacting to the guess (warm; if it is close say what was right; if not, do not reveal the answer — say what to watch for), in the session language", "close": true|false}"""


def predict_prompt(*, learner_name: Optional[str], question: str, concept_title: str, concept_say: str,
                   answer: str, lang: str) -> str:
    return "\n\n".join([
        f"LEARNER: {learner_name or 'the learner'}",
        f"You asked them to GUESS before teaching '{concept_title}': {question}",
        f"WHAT YOU ARE ABOUT TO TEACH (do not reveal it yet): {concept_say}",
        f"THEIR GUESS ({LANG_NAMES.get(lang, lang)}): {answer.strip()}",
        "React in 1-2 sentences and hand over to the explanation. Any guess is fine; never grade it. JSON only.",
        PREDICT_SCHEMA,
    ])


# ── warm-up acknowledgement (natural teaching) ───────────────────────────────

WARMUP_SCHEMA = """Return ONE JSON object and nothing else:
{"say": "1-2 short spoken sentences, no question"}"""


def warmup_ack_prompt(*, learner_name: Optional[str], question: str, answer: str, topic: str,
                      first_concept: Optional[str], lang: str) -> str:
    return "\n\n".join(p for p in [
        f"LEARNER: {learner_name or 'the learner'}",
        f"Before the lesson on '{topic}' starts, you asked a warm-up question (never graded): {question}",
        f"THEIR ANSWER (may be a speech-to-text transcript): {answer.strip()[:300]}",
        f"THE FIRST BOARD IS ABOUT: {first_concept}" if first_concept else "",
        f"Reply in {LANG_NAMES.get(lang, lang)}. In 1-2 short spoken sentences: acknowledge their idea warmly by "
        "paraphrasing it in your own words — do not quote their words back (a spoken answer may be garbled or "
        "transliterated) — then lead into the first board's topic. If the answer is unclear or off-topic, simply "
        "thank them and lead in. Never grade or correct it, do not teach the topic yet, do not greet (you already "
        "did), and do not ask any question. JSON only.",
        WARMUP_SCHEMA,
    ] if p)
