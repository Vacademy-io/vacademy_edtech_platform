"""The per-copy token cap must grow with the paper: a fixed 250k zeroed
questions 38-64 of a 64-question sheet ("needs manual review") on 2026-09-20
while the institute was still charged for all 64."""
import asyncio

import pytest

from app.services.copy_check import grader as g


def test_budget_is_the_floor_for_small_papers_and_grows_with_questions():
    assert g.token_budget_for(0) == g.FAIL_TOKENS_PER_COPY
    assert g.token_budget_for(8) == g.FAIL_TOKENS_PER_COPY
    assert g.token_budget_for(64) == 64 * g.TOKENS_PER_QUESTION_ALLOWANCE > g.FAIL_TOKENS_PER_COPY


def test_grader_refuses_only_past_its_own_budget():
    small = g.CopyCheckGrader(llm=None, token_budget=1)  # floor still applies
    assert small.token_budget == g.FAIL_TOKENS_PER_COPY
    big = g.CopyCheckGrader(llm=None, token_budget=g.token_budget_for(64))
    big._tokens_used = g.FAIL_TOKENS_PER_COPY + 1
    # under its own (larger) cap: the guard at the top of _call does not fire
    assert big._tokens_used < big.token_budget
    big._tokens_used = big.token_budget
    with pytest.raises(RuntimeError, match="token budget exhausted"):
        asyncio.run(big._call({}, {}, {}, "m"))
