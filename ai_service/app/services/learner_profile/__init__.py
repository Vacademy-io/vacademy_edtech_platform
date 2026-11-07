"""Learner profile, phase 1: what Student AI chats show about a learner.

extract.py turns one idle chat into evidence rows (prompt + strict validation);
poller.py finds idle chats of allowlisted institutes and runs it. Rows land in
learner_profile_signal (admin_core V608); admins read them on the Reports tab.
"""
