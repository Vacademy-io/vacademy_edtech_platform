"""Exceptions the engine understands from the callables it is given."""

from __future__ import annotations


class InvalidOutput(Exception):
    """The model's reply could not be used (not valid JSON for the schema, cut off, refused).

    An injected ``ask`` raises this for an unusable reply. Discovery skips that batch (with a note)
    and the contact lookup keeps the lead's website contacts; anything else an ``ask`` raises (keys,
    credits, outages) propagates to the caller unchanged."""
