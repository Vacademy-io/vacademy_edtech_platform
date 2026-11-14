"""sim.replay's run-level invariants and sim.corpus's comparison (2026-10-01).

The shapes are the live failures that motivated them: calls c05f6c83 and
1d28af3a (two model runs for one moment, the same reply twice, cue storms)
and 1f2b97ab (the cached opening started again after the caller heard it)."""
import json

from sim import corpus
from sim.replay import invariants


def _res(gens, finals=(), bot=(), **kw):
    return {"transcript": [], "finals": list(finals), "bot": list(bot), "caller": [],
            "llm_gens": gens, **kw}


def _g(req, trigger="हाँ जी", reply="जी सर, बच्चे का नाम क्या है?", cancelled=None):
    g = {"requested": req, "started": req, "ended": req + 1.0, "trigger": trigger, "reply": reply}
    if cancelled is not None:
        g["cancelled"] = cancelled
    return g


def test_two_runs_for_one_moment_are_flagged():
    # c05f6c83 at 33.95 / 34.01: the caller's turn and a "continue" cue.
    f = invariants(_res([_g(33.95, "तो किस बात की बात?", "सर, आपने inquiry की थी।"),
                         _g(34.01, "[You have not moved the call forward yet…]", "जी सर, Shiksha Nation…")]))
    assert any(x.startswith("two replies for one moment") for x in f), f


def test_new_caller_words_or_an_interruption_between_runs_are_legitimate():
    gens = [_g(10.0, "हाँ", "पहला जवाब है ये सर।"), _g(10.8, "नहीं नहीं", "दूसरा जवाब है ये सर।")]
    assert not any(x.startswith("two replies") for x in invariants(_res(gens, finals=[(10.5, "नहीं नहीं")])))
    gens = [_g(10.0, cancelled=10.4), _g(10.6)]
    assert not any(x.startswith("two replies") for x in invariants(_res(gens)))
    assert not any(x.startswith("two replies") for x in invariants(_res([_g(10.0), _g(11.5)])))


def test_the_same_reply_generated_twice_is_flagged_but_short_acks_are_not():
    q = "अंदाज़े से लगभग कितने percent आए थे सर?"
    f = invariants(_res([_g(79.7, "ठीक है", q), _g(85.4, "[cue]", q)]))
    assert any(x.startswith("the same reply generated twice") for x in f), f
    f = invariants(_res([_g(10.0, reply="जी सर।"), _g(14.0, reply="जी सर।")]))
    assert not any(x.startswith("the same reply") for x in f)


def test_a_cue_storm_is_flagged():
    gens = [_g(t, "[They acknowledged…]") for t in (22.8, 30.9, 34.0, 50.0)]
    f = invariants(_res(gens))
    assert any("steering-cue runs within 30 s" in x for x in f), f
    assert not any("steering-cue" in x for x in invariants(_res(gens[:3])))


def test_opening_resaid_after_it_was_heard_is_flagged():
    opening = ("नमस्ते जी, मैं श्रेया बोल रही हूँ Shiksha Nation से । आपने अपने बच्चे के लिए live classes "
               "की inquiry की थी, उसी के बारे में दो मिनट बात करनी थी। क्या मैं जान सकती हूँ कि मैं "
               "बच्चे के माता-पिता में से किससे बात कर रही हूँ?")
    heard = _res([], bot=[[1.26, 11.62], [12.23, 13.39]], opening_resaid=1, opening_text=opening)
    assert any(x.startswith("opening re-said after") for x in invariants(heard))
    early = _res([], bot=[[1.84, 3.14], [3.16, 4.38]], opening_resaid=1, opening_text=opening)
    assert not any(x.startswith("opening re-said after") for x in invariants(early))


def test_corpus_kinds_cover_every_invariant_message():
    for msg, kind in [
        ("two replies for one moment: runs 0.06s apart at 33.9s ('a' / 'b')", "two-replies-one-moment"),
        ("the same reply generated twice 5.7s apart: 'x'", "same-reply-twice"),
        ("5 steering-cue runs within 30 s from 22.8s", "cue-storm"),
        ("opening re-said after 10.4s of ~14.0s had played", "opening-resaid-heard"),
        ("said twice: 'क्या मैं बच्चे के बारे में'", "said-twice"),
        ("caller turn at 22.7s got no reply within 5 s", "unanswered-turn"),
        ("reply latency over 4 s: [9.57]", "slow-reply"),
        ("bot started talking at 3.1s over the caller (2.9–4.0s)", "talk-over"),
    ]:
        assert corpus.kind_of(msg) == kind, msg


def test_compare_flags_only_what_got_worse(tmp_path, capsys):
    def rep(build, rows):
        return {"build": build, "rows": [{"corr": c, "fails": [], "kinds": k} for c, k in rows]}
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text(json.dumps(rep("main", [("c1", {"said-twice": 1}), ("c2", {})])))
    b.write_text(json.dumps(rep("cand", [("c1", {}), ("c2", {})])))
    args = type("A", (), {"base": str(a), "cand": str(b), "show": 5, "worse_list": None,
                          "report_only": False})
    assert corpus.cmd_compare(args) == 0, "a pure improvement passes"
    b.write_text(json.dumps(rep("cand", [("c1", {}), ("c2", {"two-replies-one-moment": 2})])))
    assert corpus.cmd_compare(args) == 1, "anything worse fails"
    assert "two-replies-one-moment" in capsys.readouterr().out


def test_a_cut_ends_the_bot_utterance_on_the_simulated_line():
    """Replay of 953d5366: the opening cut at ~1 s and the re-said opening were
    recorded as ONE 14 s stretch — "no reply to the caller", "opening heard
    for 14 s". A cut must end the stretch; the next audio is a new utterance."""
    import time
    from sim.timing import Line
    line = Line()
    line.bot_wrote(10.0)                 # an opening queued: 10 s of audio
    time.sleep(0.05)
    line.bot_cut()                       # the caller barged in
    cut_at = line.bot[-1][1]
    assert cut_at - line.bot[-1][0] < 0.5, "the dropped audio must not count"
    line.bot_wrote(5.0)                  # the re-said opening, right away
    assert len(line.bot) == 2, line.bot
    assert line.bot[1][0] >= cut_at


def test_a_reply_that_talks_on_through_an_absorbed_haan_answered_it():
    # bot speaking 10-30 s; the caller's "हाँ" at 15-15.5 s is absorbed.
    res = _res([], finals=[(15.4, "हाँ।")], bot=[[10.0, 30.0]])
    res["caller"] = [[15.0, 15.5]]
    f = invariants(res)
    assert not any(x.startswith("caller turn at") for x in f), f
    assert not any(x.startswith("backchannel") for x in f), f
    # …but a barge-in that cut the bot and then got nothing is unanswered
    res = _res([], finals=[(16.0, "नहीं नहीं मुझे नहीं चाहिए")], bot=[[10.0, 15.2], [40.0, 41.0]])
    res["caller"] = [[15.0, 16.2]]
    res["ended_at"] = 45.0
    assert any(x.startswith("caller turn at") for x in invariants(res))


def test_two_generations_at_once_are_flagged():
    gens = [{"requested": 5.0, "started": 5.0, "ended": 9.0, "trigger": "a", "reply": "x y z w"},
            {"requested": 6.0, "started": 6.5, "ended": 7.5, "trigger": "b", "reply": "p q r s"}]
    assert any(x.startswith("two generations at once") for x in invariants(_res(gens)))
    gens[1]["started"] = 9.2
    assert not any(x.startswith("two generations at once") for x in invariants(_res(gens)))


def test_caller_words_that_never_reach_the_model_are_flagged():
    gens = [{"requested": 21.0, "started": 21.0, "ended": 22.0, "trigger": "x", "reply": "a b c d"}]
    res = _res(gens, finals=[(20.0, "बच्चा नौवीं में है")])
    res["ended_at"] = 60.0
    res["contexts"] = [[("user", "हाँ जी")]]
    assert any(x.startswith("caller words never reached the model") for x in invariants(res))
    res["contexts"] = [[("user", "बच्चा नौवीं में है")]]
    assert not any(x.startswith("caller words never") for x in invariants(res))
    # a bare backchannel is not expected to reach the model
    res = _res(gens, finals=[(20.0, "हाँ जी।")])
    res["ended_at"] = 60.0
    res["contexts"] = [[("user", "something else")]]
    assert not any(x.startswith("caller words never") for x in invariants(res))
