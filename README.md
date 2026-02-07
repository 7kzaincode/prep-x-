# Prep(x) Study Planner

Prep(x) is an AI-powered study planner that generates a day-by-day schedule for upcoming exams. It uses a multi-agent pipeline built with **Google’s Agent Development Kit (ADK)** and a lightweight React UI.

---

## Architecture (ADK)

**Agents**
- `SyllabusExpert` – extracts modules + assessments from the syllabus.
- `ExamScopeAnalyst` – extracts midterm topics + exam date.
- `StudyGuideGuru` – maps topics to textbook sections with estimated hours.
- `ChiefOrchestrator` – generates the final day-by-day plan.

**Tools**
- `load_course_doc_text` – extracts a limited page range from syllabus / overview PDFs.
- `load_textbook_toc` – scans the textbook TOC for relevant sections.
- `load_textbook_pages` – extracts only the needed textbook pages.

**Key Design Choices**
- **Token efficiency:** PDF text is locally extracted and truncated before LLM calls.
- **Stateful sessions:** Files are uploaded once per session and reused.
- **Structured output:** A CSV + Markdown plan is written to `sessions/<sessionId>/exports/`.
- **Deterministic guardrails:** Daily hours are normalized to constraints if needed.

---

## Run Locally

### Prerequisites
- Node.js
- Python 3.10+

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Install backend dependencies

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
```

### 3. Set your Gemini API key

Create a file called `.env.local` in the project root and add:

```
GEMINI_API_KEY=your_api_key_here
```

Optional model overrides:
```
GEMINI_MODEL_FAST=gemini-2.5-flash
GEMINI_MODEL_PLANNER=gemini-2.5-flash
ADK_LOW_QUOTA=1
```

### 4. Start the backend

```bash
python backend/main.py
```

### 5. Start the frontend

```bash
npm run dev
```

### 6. Open the app

```
http://localhost:3000
```

---

## Output Files

After plan generation, the backend writes:
- `sessions/<sessionId>/exports/plan.csv`
- `sessions/<sessionId>/exports/plan.md`

---

Enjoy studying :)
