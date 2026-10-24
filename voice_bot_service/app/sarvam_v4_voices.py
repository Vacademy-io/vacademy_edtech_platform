"""Sarvam Bulbul v4 Flash voices (engine id "sarvam_v4", model "bulbul:v4-flash").

Persona voices named <speaker>_<language>_<style>, e.g. "shubh_enhi_ads". The live API
listed 224 on 2026-10-14 (it rejects an unknown speaker with the full list — the docs
page had 222 and three of those no longer exist). Sarvam publishes NO genders, and Hindi
first-person verbs are gendered, so the gender of every voice was MEASURED: one line per
voice through the real API, median pitch, decided per SPEAKER across all their styles
(an excited "sports" or "character" style can push a male voice past 200 Hz) together
with the speaker's known v3 gender. Shipped only where both agree:

  * 210 voices: 78 male, 132 female.
  * Left out until auditioned by ear: advait, ashok, ashwin, chirag, dev, deven, kalpit,
    rohan, sarang (pitch and name disagree, or pitch is borderline).
  * Left out: the two Assamese voices (as-IN needs beta access from Sarvam).

The v3 palette and this one share no ids: a v3 name sent to v4 is "Speaker 'priya' is
not compatible with model bulbul:v4-flash" — a silent call. Keep them apart everywhere.
"""

SARVAM_V4_MODEL = "bulbul:v4-flash"
SARVAM_V4_DEFAULT_VOICE = "shubh_enhi_ads"

SARVAM_V4_MALE = frozenset({
    "aayan_hi_conversational", "aditya_hi_conversational", "aditya_hi_sales",
    "amit_hi_conversational", "anand_hi_documentary", "anand_hi_news", "anand_pa_conversation",
    "anand_pa_customer", "aravind_ta_ads", "aravind_ta_suspense", "arnab_bn_conversation",
    "aryaman_hi_ads", "ashutosh_hi_conversational", "bhavik_gu_conversation",
    "bimal_bn_suspense", "chetan_kn_conversation", "girish_en_devotional",
    "girish_en_documentary", "girish_hi_devotional", "gokul_ta_narration",
    "harpreet_pa_narration", "jaspal_pa_banking", "kabir_hi_conversational", "kunal_hi_kids",
    "mahesh_hi_documentary", "manan_hi_conversational", "mani_hi_conversational",
    "mani_hi_devotional", "mohit_hi_conversational", "mukul_hi_ads", "mukul_hi_suspense",
    "mukul_mr_stories", "nachiket_en_ads", "nachiket_hi_devotional", "nilesh_mr_conversation",
    "ojas_en_social", "rahul_hi_conversational", "ratan_hi_customer_expressive",
    "ratan_hi_devotional", "ratan_hi_documentary", "ratan_hi_latenight",
    "ratan_hi_latenight_warm", "ratan_hi_recovery", "ratan_hi_social", "ratan_hi_sports",
    "rehan_hi_social", "rustom_en_suspense", "shubh_en_ads", "shubh_en_audiobook",
    "shubh_en_narration", "shubh_en_narration_gentle", "shubh_en_numbers", "shubh_en_recovery",
    "shubh_en_sports", "shubh_enhi_ads", "shubh_enhi_banking", "shubh_enhi_companion",
    "shubh_hi_ads", "shubh_hi_customer", "shubh_hi_devotional", "shubh_hi_ecomm",
    "shubh_hi_recovery", "shubh_hi_stories_dramatic", "shubh_hi_stories_mixed",
    "soham_mr_narration", "sumit_hi_conversational", "sunny_en_social", "sunny_enhi_customer",
    "sunny_hi_ads", "sunny_hi_reels", "tarun_hi_conversational", "tarun_hi_sales",
    "tarun_te_narration", "vaibhav_hi_social", "varun_en_ads", "varun_en_suspense",
    "vijay_ta_narration", "vipul_hi_social"
})

SARVAM_V4_FEMALE = frozenset({
    "aarti_hi_customer", "aditi_en_stories", "amelia_en_conversational", "aparna_en_companion",
    "aparna_en_edtech", "aparna_hi_customer", "aparna_hi_kyc", "chaitra_hi_customer",
    "chaitra_kn_conversation", "chaitra_kn_narration", "chandrika_en_stories", "chhavi_hi_kids",
    "ishita_en_customer", "ishita_en_medical", "ishita_en_numbers", "ishita_en_social",
    "ishita_en_stories", "ishita_enhi_companion", "ishita_enhi_customer",
    "ishita_enhi_customer_expressive", "ishita_hi_ads", "ishita_hi_ads_informal",
    "ishita_hi_banking", "ishita_hi_devotional", "ishita_hi_edtech", "ishita_hi_numbers",
    "ishita_hi_social", "ishita_mr_conversational", "kavitha_te_conversation",
    "kavitha_te_narration", "kavya_hi_conversational", "mrunal_mr_narration",
    "neha_en_customer", "neha_en_latenight", "neha_mr_narration", "nupur_en_kids",
    "payal_en_edtech", "pooja_gu_conversational", "pooja_gu_customer", "pooja_te_conversation",
    "priya_hi_recovery", "ritu_en_edtech", "ritu_en_latenight", "ritu_en_medical",
    "ritu_en_reels", "ritu_hi_ads_formal", "ritu_hi_ads_informal", "ritu_hi_banking",
    "ritu_hi_conversation", "ritu_hi_customer", "ritu_hi_customer_utility",
    "ritu_hi_customer_warm", "ritu_hi_edtech", "ritu_hi_edtech_bot", "ritu_hi_insurance",
    "ritu_hi_kids", "ritu_hi_medical", "ritu_hi_reels", "ritu_hi_sales", "ritu_hi_social",
    "ritu_hi_social_lively", "ritu_mr_insurance", "ritu_mr_narration",
    "roopa_bn_conversational", "roopa_en_conversational", "roopa_hi_companion",
    "roopa_hi_conversational", "roopa_hi_market", "roopa_hi_narration", "roopa_hi_recovery",
    "rupali_mr_stories", "sanchita_en_companion", "sanchita_en_insurance", "sanchita_en_market",
    "sanchita_en_recovery", "sanchita_en_social", "sanchita_enhi_companion",
    "sanchita_hi_ads_formal", "sanchita_hi_ads_informal", "sanchita_hi_assistant",
    "sanchita_hi_banking", "sanchita_hi_edtech", "sanchita_hi_feedback",
    "sanchita_hi_interview", "sanchita_hi_kyc", "sanchita_hi_market", "sanchita_hi_romantic",
    "sanchita_hi_social", "sarika_hi_conversation", "shabana_en_edtech", "shalini_en_companion",
    "shalini_en_customer", "shalini_enhi_companion", "shalini_enhi_customer",
    "shalini_hi_companion", "shalini_hi_social", "shilpa_hi_narration",
    "shreya_hi_conversational", "shreya_hi_news", "shruti_hi_edtech", "simran_en_ads",
    "simran_en_automobile", "simran_en_conversation", "simran_en_customer", "simran_en_edtech",
    "simran_en_edtech_bot", "simran_en_narration", "simran_en_recovery", "simran_en_sales",
    "simran_en_therapist", "simran_enhi_banking_expressive", "simran_enhi_companion",
    "simran_enhi_customer", "simran_hi_assistant", "simran_hi_automobile",
    "simran_hi_conversation", "simran_hi_latenight", "simran_hi_narration", "simran_hi_news",
    "simran_hi_news_breaking", "simran_hi_recovery", "simran_hi_sales",
    "simran_hi_social_energetic", "simran_hi_social_excited", "sophia_en_conversational",
    "suchitra_hi_ecomm", "suchitra_kn_narration", "suhani_hi_social", "suman_hi_companion",
    "tanya_hi_narration", "vandana_hi_ecomm", "zarina_en_conversation"
})

SARVAM_V4_VOICES = SARVAM_V4_MALE | SARVAM_V4_FEMALE

_LANGUAGE = {"hi": "Hindi", "enhi": "Hinglish", "en": "English", "mr": "Marathi", "kn": "Kannada",
             "pa": "Punjabi", "ta": "Tamil", "te": "Telugu", "gu": "Gujarati", "bn": "Bengali"}


def v4_language(voice: str) -> str:
    """The language part of a v4 voice id ("hi", "enhi", "en", …), or ""."""
    parts = (voice or "").split("_")
    return parts[1] if len(parts) >= 3 else ""
