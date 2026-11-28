# vacademy-activeness (BBB HTML5 plugin)

Opt-in camera activeness score for learners in Vacademy Meet (BBB 3.0) classes.
The face model runs in the learner's browser (MediaPipe, loaded from jsDelivr on
first use); only the score is sent to admin_core. Design and backend contract:
`docs/live-classes/LIVE_CLASSES_DEEP_DIVE.md` (§8b).

```bash
npm ci --ignore-scripts   # never run dependency install scripts on this machine
npm test                  # scoring logic (node --test)
npm run typecheck
npm run build             # → ../../plugins/vacademy-activeness/{manifest.json,VacademyActiveness.js}
```

Commit the built `plugins/vacademy-activeness/` output. The BBB start workflow
copies `bigbluebutton-server/` to each pool server and `install-recording-hook.sh`
(step 8b) installs it at `/var/www/bigbluebutton-default/assets/plugins/`.
Bump `version` in package.json on every change so browsers fetch the new bundle.

Built against plugin SDK 0.0.96 (BBB 3.0.22; `~0.0.96` also loads on 3.0.39 /
SDK 0.0.105). BBB 4.0 rejects 0.x manifests — rebuild against SDK 1.x then.
