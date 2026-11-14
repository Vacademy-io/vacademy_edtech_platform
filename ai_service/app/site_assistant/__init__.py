"""Site Assistant: the public AI chatbot on institute websites (hosted sites and
the embed snippet). See docs/site-assistant/SPEC.md §4.

Modules: settings (per-site config + platform switches), tokens (visitor
session tokens), internal_client (admin_core calls), repository (SQL),
guards (pre-model checks + answer post-checks), caps (DB-backed daily caps),
cards, tools (registry + executors), knowledge (page index, FAQs/notices,
linked KBs), prompt, billing, engine (one answer as SSE events), service
(sessions, contact, feedback) and router (visitor + staff APIs).
"""
