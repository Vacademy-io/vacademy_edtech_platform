"""Course knowledge: an institute's course lessons, indexed per institute into
one hidden ``course_content`` knowledge base, so learner chat, voice and the
tutor can answer from the lessons each learner may open.

Only ``course_knowledge/store.py`` may read or write course chunks
(``kb_chunk`` rows of the course_content knowledge base). Every other module
goes through it, so access rules and the scoped vector column stay in one place.
"""
