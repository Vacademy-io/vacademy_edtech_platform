-- Scripted agents on Smallest learn their repeated sentences (speech cache FULL).
--
-- A scripted agent repeats itself across calls: Shreya's last 7 days (312 calls)
-- spoke 65% of its characters as sentences it had already spoken, and FULL is the
-- tier that caches those. New agents already default to it (AiAgentService.
-- defaultSpeechCacheMode); this moves the existing ones.
--
-- Same definition as the default: a real authored prompt (>= 2000 chars) on the
-- Smallest engine — the only engine whose cached-vs-live render parity has been
-- checked (TTS_SPEECH_CACHE.md §11). Other engines are left exactly as they are.
-- Reversible per agent from the health dashboard (Calls → speech cache).
UPDATE ai_agent
   SET speech_cache_mode = 'FULL',
       updated_at = now()
 WHERE (tts_model LIKE 'smallest%' OR tts_model LIKE 'lightning%')
   AND length(COALESCE(system_prompt, '')) >= 2000
   AND COALESCE(speech_cache_mode, 'OFF') <> 'FULL';
