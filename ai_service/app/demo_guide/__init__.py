"""Demo guide: the AI guide beside the framed demo app (docs/demo-stage/SPEC.md section 2).

A public page (demo.vacademy.io) shows the real admin app signed in to a demo
institute. This module is the guide's backend: it talks with the visitor,
decides which product tour to play, speaks its own replies, listens to the
microphone and takes the visitor's contact details into the CRM.

Modelled on app/site_assistant (same patterns, some shared helpers) but a
separate module with its own tables, token secret, caps and use case.
"""
