"""crm_geo: placing typed PIN codes, states and cities."""
import pytest

from app.services import crm_geo as geo


@pytest.mark.parametrize("text, state, city", [
    ("pune", "Maharashtra", "Pune"),
    ("Pune ", "Maharashtra", "Pune"),
    ("Nashik Maharashtra", "Maharashtra", "Nashik"),
    ("Ahmdnagar", "Maharashtra", "Ahmednagar"),
    ("Ahilyanagar", "Maharashtra", "Ahmednagar"),
    ("PCMC", "Maharashtra", "Pimpri Chinchwad"),
    ("Chhatrapati Sambhajinagar", "Maharashtra", "Aurangabad"),
    ("Bangalore", "Karnataka", "Bengaluru"),
    ("kolhapur, maharashtra", "Maharashtra", "Kolhapur"),
    ("MH", "Maharashtra", None),
    ("Tamilnadu", "Tamil Nadu", None),
    ("somewhere", None, None),
    ("", None, None),
])
def test_city_text(text, state, city):
    assert geo.resolve(None, None, text) == (state, city)


def test_short_state_codes_only_count_on_their_own():
    assert geo.text_state("up") == "Uttar Pradesh"
    assert geo.text_state("pick up point") is None          # 'up' inside other words is not a state


def test_pin_codes():
    assert geo.pin_state("411001") == "Maharashtra"
    assert geo.pin_state("411 038") == "Maharashtra"
    assert geo.pin_state("403001") == "Goa"
    assert geo.pin_state("160017") == "Chandigarh"
    assert geo.pin_state("248001") == "Uttarakhand"
    assert geo.pin_state("244713") is None                   # shared between two states: use the text
    assert geo.pin_state("98765 43210") is None              # a phone number is not a PIN
    assert geo.pin_state("12345") is None


def test_resolve_order_pin_then_region_then_city():
    assert geo.resolve("560001", "Maharashtra", "Pune") == ("Karnataka", None)   # city kept only in its state
    assert geo.resolve(None, "Gujarat", "Pune") == ("Gujarat", None)
    assert geo.resolve(None, "Maharashtra", "Pune") == ("Maharashtra", "Pune")
    assert geo.resolve(None, None, None) == (None, None)


def test_field_roles():
    assert geo.field_role("pin_code", "PIN") == "pin"
    assert geo.field_role("pincode_inst_x") == "pin"
    assert geo.field_role("state", "State") == "region"
    assert geo.field_role("city", "Your city") == "city"
    assert geo.field_role("district", None) == "city"
    assert geo.field_role("course", "Course interest") is None
    fids = geo.field_ids([("city", "City", ["f1"]), ("state", "State", ["f2"]), ("phone", "Phone", ["f3"])])
    assert (fids.city, fids.region, fids.pin) == (["f1"], ["f2"], [])


def test_bind_texts_keeps_only_placed_values_and_the_pin_tables():
    params = {}
    stats = geo.bind_texts(["pune", "somewhere", "gujarat", None], params)
    assert stats == {"texts": 3, "placed": 2}
    assert params["geo_k"] == ["pune", "gujarat"]
    assert params["geo_ts"] == [None, "Gujarat"] and params["geo_c"] == ["Pune", None]
    assert "403" in params["geo_p3k"] and len(params["geo_p3k"]) == len(params["geo_p3v"])


def test_location_sql_is_parameterised():
    params = {}
    joins, cols = geo.person_location_sql("gl1", "r.payer_id", "r.lead_id", geo.FieldIds(city=["f1"]), params)
    loc, state, city = geo.location_sql("geo1", cols)
    assert params == {"gl1_city_ids": ["f1"]}
    assert "s.user_id = r.payer_id" in joins and "fv.source_id = r.lead_id" in joins
    assert state == "geo1.st" and city == "geo1.ct"
    assert ":geo_k" in loc and ":geo_p3k" in loc and "left(geo1d.d, 3)" in loc   # maps travel as bind parameters
