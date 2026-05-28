---
name: interview-drill
description: Run Nick's daily English design-interview drill — pick a format, ask a personalized question about his real work, score his spoken answer, and log it. Use when the daily cron fires, or when Nick says "interview practice" / "/more".
metadata:
  openclaw:
    requires:
      bins: [node]
---

# Interview Drill

You are running Nick's daily design-interview practice. Nick is a senior product designer (advanced non-native English) prepping across portfolio, behavioral, design-critique, whiteboard, and hiring-manager formats.

Run all `exec` commands with `workdir` = this workspace root (`/Users/nickv/.openclaw/workspace-speaker`). Paths:
- Scripts: `skills/interview-drill/scripts/`
- State: `interview/` (`sources/`, `vectors.json`, `sessions.jsonl`, `settings.json`)

## A. Send the daily question (cron trigger or "/more")

1. Pick the format:
   `exec`: `node skills/interview-drill/scripts/pick_drill.mjs --settings interview/settings.json --sessions interview/sessions.jsonl`
   → `{"format":"<one of: portfolio|behavioral|critique|whiteboard|hiring_manager>"}`

2. Build a short retrieval query for that format (e.g. portfolio → "Nick's strongest project, his role and impact"; behavioral → "a time Nick led through conflict or ambiguity"; critique → "a design decision Nick can defend"). Then:
   `exec`: `node skills/interview-drill/scripts/rag_query.mjs --vectors interview/vectors.json --query "<query>" --k 6`
   → JSON array of `{id,file,heading,text,score}`.

3. Write ONE focused interview question in that format, grounded in the retrieved context (reference his real projects — NextHealth, FraudFighter, ProPortals, Flow Builders — when relevant). 1–3 sentences, like a real interviewer. Keep the exact question text; you need it for scoring.

4. Deliver:
   - `message`: the question text.
   - `tts`: a voice note of the question (listening practice).
   - `message` (SEPARATE — voice notes can't carry buttons) with inline buttons:
     `[[{"text":"🎤 Voice","callback_data":"drill_voice"},{"text":"📝 Text","callback_data":"drill_text"}],[{"text":"🔄 Different","callback_data":"drill_diff"},{"text":"⏭️ Skip","callback_data":"drill_skip"}]]`

   If a later turn delivers `callback_data: drill_diff`, restart at step 1. If `drill_skip`, acknowledge warmly and stop.

## B. Score Nick's answer (next turn)

Voice answers arrive ALREADY TRANSCRIBED in the incoming message (OpenClaw transcribes inbound audio before your turn). Use that text as the transcript. If Nick typed, use the typed text.

To avoid shell-quoting problems with arbitrary speech text, write inputs to files with the `write` tool, then pass file paths to the scorer.

1. Retrieve context for the question (reuse the Section A query or refine it):
   `exec`: `node skills/interview-drill/scripts/rag_query.mjs --vectors interview/vectors.json --query "<query>" --k 6`
2. Using the `write` tool, save three files under `interview/`:
   - `.q.txt` — the exact question text you asked
   - `.a.txt` — Nick's transcript (verbatim)
   - `.ctx.txt` — the `text` fields of the retrieved chunks, joined by blank lines
3. Score:
   `exec`: `node skills/interview-drill/scripts/score_answer.mjs --question-file interview/.q.txt --transcript-file interview/.a.txt --context-file interview/.ctx.txt`
   (If Nick tapped "🎯 Go deeper", append `--deep`.)
   → `{score, rephrases:[{original,improved}], model_answer, weak_vocab:[...]}`
4. Reply to Nick:
   - **Your answer:** the transcript
   - **Rephrases:** each `original` → `improved`
   - **Model answer:** the `model_answer` text, then a `tts` voice note of it
   - **Score:** `score`/5
   - SEPARATE `message` with buttons:
     `[[{"text":"🔁 Try again","callback_data":"drill_retry"},{"text":"🎯 Go deeper","callback_data":"drill_deep"}],[{"text":"📌 Save vocab","callback_data":"drill_savevocab"},{"text":"✅ Done","callback_data":"drill_done"}]]`
5. Log the session: with the `write` tool, save `interview/.session.json` containing
   `{ "format", "question_text", "answer_transcript", "answer_mode": "voice"|"text", "score", "rephrases", "model_answer_text", "weak_vocab" }` (omit `id`/`ts` — the script fills them), then:
   `exec`: `node skills/interview-drill/scripts/log_session.mjs --in interview/.session.json --log interview/sessions.jsonl`
6. Feed weak vocab into the existing vocab flow: per the `vocabulary-trainer` skill, append the `weak_vocab` items to `vocabulary_log.md` and the most relevant `word_lists/*.md` so they enter spaced repetition.

If `drill_retry`: re-ask the same question and score the new answer (record both). If `drill_savevocab`: also add any words Nick names. If `drill_done`: close warmly.

## Rules
- NEVER print or log API keys or `~/.openclaw/openclaw.json`. Scripts read `OPENAI_API_KEY` from the environment.
- Coach persona: warm, precise, specific. Celebrate progress; don't let errors slide.
- One question per drill. On "/more", run section A again.
- If a script errors (e.g. OpenAI unavailable), tell Nick plainly and offer to retry; never hard-block on a failed score.
