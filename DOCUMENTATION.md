# Prep(x) Study Planner — Architecture & Demo Walkthrough

If you only read one thing: 5 Google ADK agents take your course PDFs and build you a real study plan. Not a toy. It handles scanned textbooks, free-tier rate limits, and messy real-world documents. Everything below follows the app chronologically — from opening the page to downloading your CSV.

---

## What You're Looking At

A multi-agent AI study planner built on:
- **Google ADK** (Agent Development Kit) — 5 `LlmAgent` instances with tool use and session management
- **Gemini 2.5 Flash** — the LLM powering every agent
- **FastAPI** backend with real-time SSE streaming
- **React/TypeScript** frontend with Tailwind CSS

The whole system lives in two key files:
- `backend/agents.py` — all 5 agents, their tools, and the runner
- `backend/main.py` — the API layer and orchestration workflow

---

## Step 1: Setup — Adding Courses and Uploading Documents

When the app loads, you land on the Setup view. This is where you define your courses and upload your documents.

**For each course, you provide up to 3 PDFs:**
1. **Syllabus** — the course outline with modules, weekly topics, assessment weights
2. **Midterm Overview** — the exam guide listing what's on the test, the exam date, topic breakdown
3. **Textbook** — the reference material the agents will cross-reference for chapter mappings

**Smart upload features:**
- Drop a folder and the system auto-classifies each PDF by filename (looks for keywords like "syllabus", "midterm", "textbook")
- Course codes are auto-detected from filenames using regex (`PHYS 234`, `HLTH 204`, etc.)
- Exam dates can be entered manually OR auto-detected later from the midterm overview

Files are uploaded to the backend via `POST /api/upload` and stored at `sessions/<sessionId>/<courseId>/<docType>/`. The `courseId` is a random immutable ID — not the course code — so renaming a course doesn't break file paths.

**Constraints section:**
- Weekday study hours (slider, 1-12h)
- Weekend study hours (slider, 1-16h)
- Blocked dates (no-study days)

Once everything's uploaded, you hit **"Initiate Orchestration"** and the agents take over.

---

## Step 2: Planning — The 5-Agent Pipeline

The frontend opens a Server-Sent Events (SSE) connection and displays a live terminal. Every agent logs its progress in real-time — you can watch each one activate, process, and complete.

The pipeline runs **per course** through 4 agents, then one final agent synthesizes everything across all courses.

```
For each course:
  SyllabusExpert → ExamScopeAnalyst → TocNavigator → StudyGuideGuru

Then across all courses:
  ChiefOrchestrator → Final Study Plan
```

Here's what each agent does, in the order they run:

---

### Agent 1: SyllabusExpert

**Job:** Extract course structure from the syllabus PDF.

- Receives the syllabus text (extracted locally with PyPDF2 — no file upload to Gemini, saves tokens)
- Pulls out up to 10 modules with up to 3 topics each
- Identifies assessment types, weights, and dates
- Returns structured JSON: `{ course_name, course_code, modules, assessments }`
- Output format enforced via `response_mime_type="application/json"`

**Why it matters:** If the midterm overview is missing or has no topics, the system falls back to these syllabus modules as the topic list. It's the safety net.

---

### Agent 2: ExamScopeAnalyst

**Job:** Identify what's actually on the exam — topics, importance, and the exam date.

- Receives the midterm overview text (also extracted locally with PyPDF2)
- Extracts up to 15 exam topics, each ranked by importance: high, medium, or low
- Auto-detects the exam date in YYYY-MM-DD format
- Returns: `{ exam_date, topics: [{name, importance}] }`

**Exam date resolution:** The system checks three sources in order:
1. User's manually-entered date (highest priority)
2. Date auto-detected from the midterm overview by this agent
3. Falls back to "unknown" if neither exists

**Topic fallback:** If this agent finds 0 topics (maybe the overview was vague), the system automatically falls back to the syllabus modules from Agent 1.

---

### Agent 3: TocNavigator

**Job:** Scan the textbook's table of contents and find which chapters are relevant to the exam topics.

- Only receives the first 15 pages of the textbook (that's where the TOC lives)
- Cross-references the exam topics from Agent 2 against the TOC
- Returns: `{ relevant_sections: [{chapter, start_page, end_page, covers_topics}] }`
- These page ranges tell the next agent exactly where to look

**Why a separate agent for this:** Textbooks can be 600+ pages. You don't want to send the whole thing to an LLM. TocNavigator narrows it down to just the relevant sections — usually 5-15 page ranges out of hundreds.

---

### Agent 4: StudyGuideGuru

**Job:** Map each exam topic to specific textbook resources and estimate study hours.

This is the only agent with **tools**:

| Tool | What it does |
|------|-------------|
| `load_textbook_toc` | Extracts the first N pages (TOC) from a textbook PDF |
| `load_textbook_pages` | Extracts specific page ranges from a textbook (clamped to 3 pages per section, 15K char max) |

**How it actually works:**
- The relevant textbook pages are pre-extracted in Python (using TocNavigator's page ranges) and included directly in the prompt
- This saves API round-trips — instead of the agent making 8 tool calls (one per section), it gets all the sampled content upfront
- The tools exist as a fallback if the pre-sampled content isn't enough
- Returns: `{ mappings: [{topic, resource, estimated_hours}] }`

**The resource field is specific:** Not "Textbook" or "Notes" — it's things like "Ch 3.2-3.4 (pp. 45-67)" or "Ch 5.1 (pp. 182-192)". Real chapter references pulled from the actual textbook.

**Why no `response_mime_type` on this agent:** Gemini doesn't support JSON mime type enforcement when tools are enabled. So this agent returns raw JSON without the mime type constraint.

---

### Agent 5: ChiefOrchestrator

**Job:** Take everything from all courses and build the final day-by-day study schedule.

- Receives compressed data: topics, importance levels, textbook resources, estimated hours, and exam dates for every course
- Also receives user constraints: daily hour budgets, blocked dates
- Uses Gemini's **thinking mode** (`thinking_budget=2048`) to reason about scheduling
- `max_output_tokens=65536` — needed because the plan can be 30-60+ tasks in JSON

**Scheduling rules baked into the prompt:**
- Never exceed the daily hour budget
- High-importance topics get priority
- Learning sequence: learn a topic → practice it → review before the exam
- Tasks spread evenly across available days (no cramming everything into week 1)
- Rest days every 4-6 study days
- **Hard deadline:** zero tasks scheduled on or after a course's exam date — if there's not enough time, low-importance topics get dropped
- Each topic gets the full hours estimated by StudyGuideGuru

**Study notes:** Every task gets a topic-specific note with 4 sections:
- **Focus:** what concepts to study
- **Practice:** specific problem types to work through
- **Memorize:** key formulas or definitions
- **Self-Test:** how to verify understanding without notes

These notes are generated from the actual course content — not generic filler.

---

## How the Agents Talk to Each Other

This is sequential multi-agent collaboration. Each agent's output feeds the next:

```
SyllabusExpert ──► modules (fallback topic list)
                        │
ExamScopeAnalyst ──► topics + importance + exam date
                        │
TocNavigator ──► relevant chapter/page ranges
                        │
StudyGuideGuru ──► topic → resource mappings + hours
                        │
ChiefOrchestrator ──► final day-by-day study plan
```

No agent sees another agent's raw session. Each one runs with a **completely isolated** `InMemorySessionService` — fresh session, fresh runner, unique ID. This prevents session contamination (if they shared a session, the ChiefOrchestrator would inherit 50K+ chars of noise from earlier agents and produce garbage output).

---

## Session Isolation (The Bug That Almost Killed It)

Early on, all agents shared one ADK session. Every agent's prompt, response, and tool calls accumulated in that session's history. By the time the ChiefOrchestrator ran, it had 50K+ characters of irrelevant context from the previous 4 agents — PDF text, TOC dumps, mapping JSON. The output was either truncated or empty.

The fix: every `run_agent()` call creates its own `InMemorySessionService` with a unique `call_id`. Zero bleed between agents.

```python
async def run_agent(agent, user_message):
    session_service = InMemorySessionService()  # Fresh per call
    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)
    call_id = uuid.uuid4().hex[:12]
    session = await session_service.create_session(app_name=APP_NAME, user_id=f"user_{call_id}", session_id=f"session_{call_id}")
```

---

## Rate Limiting (Free Tier Reality)

Gemini free tier: 5 requests per minute. Each ADK agent call is at least 1 request, and tool calls can add more. With 5 agents per course and 3 courses, that's 15+ API calls minimum.

Solution: a global rate limiter that enforces 13 seconds between API calls (5 RPM = 12s minimum, 13s for safety):

```python
_RPM_DELAY = 13
async def _rate_limit():
    elapsed = time.time() - _last_api_call
    if elapsed < _RPM_DELAY:
        await asyncio.sleep(_RPM_DELAY - elapsed)
```

This runs automatically before every `runner.run_async()` call. It's why the pipeline takes a couple minutes — but it never hits a 429.

---

## Step 3: Results — The Study Plan

Once the ChiefOrchestrator finishes, the frontend receives the plan (a JSON array of tasks) and populates three views:

### Curriculum View
- Tasks grouped by course
- Mastery percentage per course (based on completed tasks)
- Progress bars
- Click any topic to open the detail modal

### Calendar View
- 6-week grid calendar
- Each day shows which courses have tasks, with total hours
- Click a day to see all tasks for that date
- Flagged days are highlighted

### Timeline View
- Vertical day-by-day list
- Full task cards with course name, topic, task type, resources, and duration
- Color-coded left border per course

### Task Detail Modal
Click any task in any view to open its detail modal:
- Edit the date and duration
- View the textbook resource reference
- Read the structured study notes (Focus | Practice | Memorize | Self-Test)
- Mark as complete or flag for review

### Interactive Features
- **Complete tasks** — checkbox toggles, tracks mastery %
- **Flag tasks** — mark tasks you're unsure about, filter to show only flagged
- **Edit tasks** — change date or hours directly in the modal

---

## Step 4: Export

Two export formats available:

### CSV Export
- 7 columns: Date, Course, Topic, Task Type, Duration (H), Resources, Notes
- All fields properly quoted (RFC 4180) so commas in topic names don't break columns
- Downloads as `plan.csv`

### Markdown Export
- Standard markdown table with 6 columns
- Downloads as `plan.md`

---

## Real-Time Streaming (How the Terminal Works)

The planning terminal isn't polling — it's a real SSE (Server-Sent Events) connection.

1. Frontend opens `EventSource` to `/api/plan/{sessionId}/stream`
2. Backend pushes each agent log as a JSON event:
   ```json
   {"agent": "SyllabusExpert", "message": "Analyzing syllabus for PHYS 234...", "status": "loading"}
   ```
3. Keepalive pings every 30s if idle
4. When all agents finish, the backend sends a done signal:
   ```json
   {"_done": true, "agent": "System", "message": "All agents finished."}
   ```
5. Frontend closes the stream, fetches the final plan, and transitions to results

Each agent has its own color in the terminal:
- SyllabusExpert → blue
- ExamScopeAnalyst → emerald
- TocNavigator → cyan
- StudyGuideGuru → amber
- ChiefOrchestrator → purple
- System → gray

---

## Token Efficiency

PDFs are extracted locally with PyPDF2 — no full documents are uploaded to Gemini. This keeps costs way down:

| Agent | Approx Input Tokens |
|-------|---------------------|
| SyllabusExpert | ~1-3K |
| ExamScopeAnalyst | ~1-3K |
| TocNavigator | ~3-8K (first 15 pages only) |
| StudyGuideGuru | ~4-6K (sampled 3pp/section, max 15K chars) |
| ChiefOrchestrator | ~2-4K (compressed summaries) |
| **Total per course** | **~11-24K tokens** |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Tailwind CSS |
| Backend | FastAPI (Python), Uvicorn |
| AI Framework | Google ADK v1.24.1 |
| LLM | Gemini 2.5 Flash |
| PDF Processing | PyPDF2 (local extraction) |
| Streaming | Server-Sent Events (SSE) |
| State | In-memory (session logs, queues, results) |

---

## Backend API Endpoints

| Endpoint | Method | What it does |
|----------|--------|-------------|
| `/health` | GET | Health check — confirms API key is set |
| `/api/upload` | POST | Upload a PDF (sessionId, courseCode, docType, file) |
| `/api/plan` | POST | Kick off the agent pipeline (runs in background) |
| `/api/plan/{sessionId}/stream` | GET | SSE stream of real-time agent logs |
| `/api/plan/{sessionId}/logs` | GET | Fetch all logs (polling fallback) |
| `/api/plan/{sessionId}/result` | GET | Fetch the final generated plan |

---

## Tradeoffs and Decisions

**Why manual orchestration instead of ADK SequentialAgent?**
Reliability. I needed tight control over fallback logic (what happens when no topics are found? when the textbook is scanned? when the exam date is missing?) and predictable quota usage on the free tier. The pipeline maps directly to SequentialAgent, but explicit orchestration lets me handle edge cases without extra guard agents.

**Why local PDF extraction instead of Gemini file upload?**
Token cost. Uploading a 600-page textbook to Gemini burns tens of thousands of tokens. Extracting text locally with PyPDF2 costs zero. The agents only see the text they need — a few pages at most.

**Why isolated sessions per agent?**
Without isolation, session history accumulates across agents. By the time the 5th agent runs, it's drowning in 50K+ chars of context from the first 4. Isolated sessions keep each agent focused on its own job.

**Why 13-second rate limiting?**
Free tier is 5 RPM. 60/5 = 12 seconds minimum between calls. 13 gives a safety buffer. It makes the pipeline slower but it never gets rate-limited.

---

## What I'd Improve Next

1. OCR pipeline for scanned textbook PDFs (so local extraction always works)
2. Wrap the pipeline in `SequentialAgent` with structured state passing
3. Add output validation (sanity checks for dates, hours, empty topics)
4. Disk-based caching so re-runs of the same course are nearly free
5. A dry-run mode for demos that skips API calls

---

## Assessment Checklist

| Requirement | How it's met |
|-------------|-------------|
| **Multi-agent orchestration** | 5 ADK `LlmAgent` agents with distinct responsibilities |
| **Multi-document processing** | Syllabus + midterm overview + textbook per course |
| **Tool use** | StudyGuideGuru has `load_textbook_toc` and `load_textbook_pages` FunctionTools |
| **State management** | `InMemorySessionService` with isolated sessions per agent call |
| **Structured output** | JSON study plan exported as CSV and Markdown |
| **Multi-agent collaboration** | Sequential data flow: syllabus → scope → TOC → resources → schedule |
