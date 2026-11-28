"""Wire adapters for chat gateways that do not speak OpenAI's chat format.

Call sites keep building OpenRouter-shaped payloads; an adapter here turns one
into the vendor's request body and the vendor's reply back into OpenAI's
chat.completion / chat.completion.chunk JSON. Adapters are pure (no I/O) so the
router owns transport, keys and failover.
"""
from . import anthropic_adapter
# Transport (HTTP + key walk) and the budget-aware key pool used by llm_router.
from . import anthropic_transport, key_pool

__all__ = ["anthropic_adapter", "anthropic_transport", "key_pool"]
