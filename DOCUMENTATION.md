# Prep(x) Study Planner — Context + Technical Notes

If you only read one thing, read this: the system works, it uses Google ADK, and it survives the real-world mess that is scanned PDFs and free-tier quotas. Everything below explains how, why, and what I’d change next.

## tldr (if you are too lazy..)
1. Multi-agent pipeline: `SyllabusExpert` → `ExamScopeAnalyst` → `StudyGuideGuru` → `ChiefOrchestrator`.
2. Built on Google ADK (agents, tools, session state).
3. Structured output guaranteed: CSV + Markdown plan exported per session.
4. Real-world pain points handled: scanned PDFs, free-tier limits, and flaky JSON.

## Architecture (How the pipeline actually works)
The system is a deliberate sequence of agents. Each agent does one job, writes output, and hands it to the next.

Agents:
1. **SyllabusExpert**  
   Extracts course modules and assessments from the syllabus.
2. **ExamScopeAnalyst**  
   Extracts exam topics and exam date from the midterm overview.
3. **StudyGuideGuru**  
   Maps topics to textbook sections and estimates study time.
4. **ChiefOrchestrator**  
   Builds the day‑by‑day study plan.

Those are ADK `LlmAgent` instances in `backend/agents.py`.

## Agent Prompts (Line-by-Line)

**SyllabusExpert prompt**  
Line 1: “You are SyllabusExpert.” Clear role = better tool use.  
Line 2: “Always call load_course_doc_text.” Forces tool usage for ground truth.  
Line 3: “Return ONLY JSON.” Prevents Markdown fluff.  
Line 4: Defines the exact schema. So parsing doesn’t become archaeology.  
Line 5: “If tool errors, return empty.” This keeps the pipeline alive.

**ExamScopeAnalyst prompt**  
Line 1: “You are ExamScopeAnalyst.” Same role clarity.  
Line 2: “Always call load_course_doc_text.” Same grounding rule.  
Line 3: “Return ONLY JSON.” This avoids rogue paragraphs.  
Line 4: Explicit schema: `exam_date`, `topics`, `importance`.  
Line 5: Error fallback so we don’t crash.

**StudyGuideGuru prompt**  
Line 1: “Map topics to textbook sections.” Core job.  
Line 2: “Call TOC tool first.” Keeps it lightweight.  
Line 3: “Then call pages if needed.” Only pay extra if necessary.  
Line 4: “Return ONLY JSON array.” Again, parser safety.  
Line 5: Hours range constraint so you don’t get “18 hours for 1 section.”

**ChiefOrchestrator prompt**  
Line 1: “Create a day-by-day study plan.” Clear ask.  
Line 2: Hard constraints (hours, spread, ordering).  
Line 3: Rest-day format rule for UI consistency.  
Line 4: Output schema.  
Line 5: Notes format so the plan isn’t generic filler.

## Why I didn’t use SequentialAgent (yet)
Short answer: reliability.  
Longer answer: I needed tight control over fallback logic for scanned PDFs, and I wanted to keep quota usage predictable on the free tier. With `SequentialAgent`, I’d either need callbacks or extra guard agents to inject OCR fallbacks. That’s doable, but it’s more moving parts than the take‑home needs.

If asked, I’d say: “This pipeline maps directly to SequentialAgent, but I kept it explicit so I could handle PDF OCR fallback and quota throttling without surprises.”

## Checklist for requirements 
**Multi‑agent orchestration**  
Yes. We have 4 distinct agents with clear responsibilities.

**Large, multi‑document processing**  
Yes. Users upload syllabus, midterm overview, and textbook. We parse all three.

**State management**  
Yes. Uploads are per session and reused. ADK session state caches outputs. No re‑upload required.

**Structured output**  
Yes. We export `plan.csv` and `plan.md` on every run.

## The PDF scanning problem (pain in the a..)
The big issue: many textbooks are scanned (image‑based).  
PyPDF2 can’t extract text from those pages. So the textbook looked “empty” even though it wasn’t.

Fix I implemented:
1. Local text extraction for speed and low token use.
2. If extraction yields nothing, fallback to Gemini file upload for **syllabus + overview** (because those are small and critical).
3. Textbook stays local unless you want to spend more quota.

This solved the “0 topics” issue and keeps the pipeline stable.

## Quota reality check (aka why 429s showed up)
Free tier for `gemini-2.5-flash` is 20 requests per day per project.
Each ADK tool call can cost two requests.  
That means a few runs can exhaust quota fast.

Mitigations I added:
1. **Low quota mode** (`ADK_LOW_QUOTA=1`): reduces tool calls by pushing extracted text directly into the agent prompt.
2. **Backoff + retry** on 429 responses.
3. **Caching** to avoid re‑processing the same course within a session.

## Key tradeoffs (and why I chose them)
1. **Local parsing vs file upload**  
   Local parsing saves quota, file upload handles scanned PDFs. I do both, but only fall back to upload when needed.

2. **Manual orchestration vs ADK SequentialAgent**  
   Manual orchestration gives control and easier fallback. SequentialAgent is cleaner but less flexible.

3. **Accuracy vs budget**  
   The system defaults to low‑cost operations and only upgrades to file upload if extraction fails.

## What I’d do next
1. OCR pipeline for textbook PDFs (so local extraction always works).
2. Wrap the pipeline in `SequentialAgent` with structured state flow.
3. Add evaluation checks on outputs (basic sanity tests for dates, hours, empty topics).
4. Add a “dry run” mode for demos (no quota usage, still shows UI).
5. Move caches to disk so repeat runs are nearly free.

## What was fun
1. Watching the pipeline actually work end-to-end after the PDF fallback fix.  
2. Seeing the UI come into existence  
3. The fact that the system can be strict and still feel friendly in the UI.

## What took a while
1. Debugging the “0 topics” issue (it wasn’t the model, it was the PDFs).  
2. Quota math. Free tier limits are easy to blow through when tools double calls.  
3. Getting the prompts to be strict without being brittle.

## Biggest drawbacks (right now)
1. Scanned textbooks still need OCR if you want perfect resource mapping.  
2. Free-tier quotas make rapid iteration annoying.  
3. Manual orchestration is a little less “framework-native” than it could be.

## What’s in the code (the parts that matter)
1. Agents and tools: `backend/agents.py`
2. Runtime orchestration: `_run_agent` in `backend/agents.py`
3. Session + caching: `InMemorySessionService`, `_COURSE_CACHE`
4. Structured exports: `write_plan_exports`
5. API integration: `backend/main.py`

## Troubles I ran into (and how I fixed them)
1. **Empty plan output**  
   Cause: agent extraction returned empty topics.  
   Fix: fallback to Gemini file upload for scanned docs.

2. **429 quota errors**  
   Cause: ADK tool calls doubled request count.  
   Fix: low‑quota mode + retries.

3. **“Dashboard shows nothing”**  
   Cause: planner output was empty.  
   Fix: upstream extraction + fallback.

## If you’re reviewing this
This is a real multi‑agent system with state, tools, and structured outputs. It’s not perfect, but it’s honest about its tradeoffs and designed to survive messy inputs. 
I hope you guys enjoy :)
