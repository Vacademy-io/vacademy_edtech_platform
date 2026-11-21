"""Scan Station build step (POST /copy-check/scan/build, contract C2): one PDF
per planned copy, pages turned upright, uploaded as an institute-owned file.

Kept import-light on purpose: the spawned worker processes import this package
to reach builder.build_copy. The async side lives in service.py."""
