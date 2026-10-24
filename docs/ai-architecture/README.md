# AI architecture

| Document | Covers |
|---|---|
| [AI_MODELS_AND_USAGE.md](AI_MODELS_AND_USAGE.md) | The model registry and how every feature picks its model; routing (OpenRouter, Isoquant, direct Anthropic with the Claude key pool); image models; how a call is priced in credits; usage tracking per user, role and feature (`ai_usage_event`); Usage History and Analytics; usage limits; where each thing is managed; recipes for adding models and AI features |
| [AI_SUBSCRIPTION_PLANS.md](AI_SUBSCRIPTION_PLANS.md) | Monthly AI plans: included / allowance / charged features, fair-use caps, the plan engine, subscription lifecycle, Razorpay payment links and UPI Autopay, GST invoices and credit notes, white-labelling and the self-serve storefront, switches and rollout state |

Related:

- [docs/billing/ai-plan-payments.md](../billing/ai-plan-payments.md): operator runbook for plan payments (Razorpay setup, rollout order, reconciliation, incidents).
- [docs/ai-tutor/COST_AND_CREDITS_REVIEW.md](../ai-tutor/COST_AND_CREDITS_REVIEW.md): AI tutor costs and credits.
