"""Flashcards / Poll / Game slides store JSON: only lesson text is indexed."""
import json

from app.services.course_knowledge.extract import documents


def test_flashcards_index_front_and_back():
    raw = json.dumps({"schema": "flashcards/v1", "cards": [
        {"id": "a", "front": "H2O", "back": "Water"}, {"id": "b", "front": " ", "back": "skip"}]})
    seg = documents.activity_segments(raw, "FLASHCARDS")
    assert len(seg) == 1 and "H2O — Water" in seg[0].text and "skip" not in seg[0].text


def test_poll_indexes_question_and_choices_only():
    raw = json.dumps({"question": "Best time to study?", "options": [{"id": "a", "text": "Morning"}],
                      "settings": {"results": "ALWAYS"}})
    text = documents.activity_segments(raw, "POLL")[0].text
    assert "Best time to study?" in text and "- Morning" in text and "ALWAYS" not in text


def test_game_never_indexes_the_page():
    raw = json.dumps({"html": "<script>secretAnswer()</script>", "instructions": "Match the pairs", "maxScore": 10})
    seg = documents.activity_segments(raw, "GAME")
    assert seg[0].text == "Game: Match the pairs"
    assert documents.activity_segments(json.dumps({"html": "<p>x</p>"}), "GAME") == []
    assert documents.activity_segments("{bad", "POLL") == []
