import os
import json
import re
import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

from pydantic import BaseModel, Field
from PyPDF2 import PdfReader

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool
from google.genai import types
from google import genai

APP_NAME = "prep_x_study_planner"
UPLOAD_DIR = "sessions"

ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
load_dotenv(dotenv_path=ENV_PATH)

# Enforce Gemini 2.5 Flash as requested.
MODEL_FAST = "gemini-2.5-flash"
MODEL_PLANNER = "gemini-2.5-flash"
if os.getenv("GEMINI_MODEL_FAST") and os.getenv("GEMINI_MODEL_FAST") != "gemini-2.5-flash":
    print("[ADK] Ignoring GEMINI_MODEL_FAST override; enforcing gemini-2.5-flash.")
if os.getenv("GEMINI_MODEL_PLANNER") and os.getenv("GEMINI_MODEL_PLANNER") != "gemini-2.5-flash":
    print("[ADK] Ignoring GEMINI_MODEL_PLANNER override; enforcing gemini-2.5-flash.")
LOW_QUOTA_MODE = os.getenv("ADK_LOW_QUOTA", "0") == "1"

# ADK / google-genai uses GOOGLE_API_KEY; preserve GEMINI_API_KEY compatibility.
if not os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("GEMINI_API_KEY")

print(f"[ADK] Using model: {MODEL_FAST} | Low quota mode: {LOW_QUOTA_MODE}")

# Gemini client for file-upload fallback (scanned PDFs).
_genai_client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

def _gemini_file_json(prompt: str, file_paths: List[str]) -> dict:
    contents: List[Any] = [prompt]
    for fp in file_paths:
        contents.append(_genai_client.files.upload(file=fp))
    response = _genai_client.models.generate_content(
        model=MODEL_FAST,
        contents=contents,
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )
    return json.loads(response.text)

session_service = InMemorySessionService()

# Simple in-memory cache to avoid re-reading PDFs within a session
_TEXT_CACHE: Dict[str, str] = {}
_COURSE_CACHE: Dict[str, Dict[str, Any]] = {}


class SyllabusModule(BaseModel):
    name: str = Field(..., description="Module name")
    topics: List[str] = Field(default_factory=list, description="Up to 3 topics")
    week: Optional[int] = Field(default=None, description="Week number if available")


class Assessment(BaseModel):
    type: str = Field(..., description="Assessment type, e.g., midterm")
    weight: Optional[str] = Field(default=None, description="Weight, e.g., 30%")
    date: Optional[str] = Field(default=None, description="YYYY-MM-DD if available")


class SyllabusOutput(BaseModel):
    course_name: Optional[str] = Field(default="")
    course_code: Optional[str] = Field(default="")
    modules: List[SyllabusModule] = Field(default_factory=list)
    assessments: List[Assessment] = Field(default_factory=list)


class ExamTopic(BaseModel):
    name: str
    importance: str = Field(default="medium", description="high | medium | low")


class ExamScopeOutput(BaseModel):
    exam_date: Optional[str] = Field(default="")
    topics: List[ExamTopic] = Field(default_factory=list)


class StudyGuideItem(BaseModel):
    topic: str
    resource: str
    estimated_hours: float = Field(default=2.0)


class PlanTask(BaseModel):
    date: str
    course: str
    topic: str
    task_type: str
    duration_hours: float
    resources: str
    notes: str


class PlanOutput(BaseModel):
    tasks: List[PlanTask]


@dataclass
class CourseInput:
    id: str
    code: str
    name: str
    examDate: str = ""


# --------------------------
# PDF Utilities
# --------------------------

def _read_pdf_text(path: str, start_page: int = 0, end_page: Optional[int] = None, max_chars: int = 12000) -> str:
    reader = PdfReader(path)
    total = len(reader.pages)
    end = min(end_page or total, total)
    parts: List[str] = []
    size = 0
    for i in range(start_page, end):
        page_text = reader.pages[i].extract_text() or ""
        if page_text.strip():
            chunk = f"[Page {i+1}]\n{page_text}\n"
            parts.append(chunk)
            size += len(chunk)
            if max_chars and size >= max_chars:
                break
    text = "\n".join(parts).strip()
    if max_chars and len(text) > max_chars:
        text = text[:max_chars] + "\n[...truncated...]"
    return text


def _extract_pages_by_ranges(path: str, page_ranges: List[Dict[str, int]], max_chars: int = 15000) -> str:
    reader = PdfReader(path)
    total = len(reader.pages)
    parts: List[str] = []
    size = 0
    for pr in page_ranges:
        start = max(0, (pr.get("start", 1) - 1))
        end = min(pr.get("end", start + 1), total)
        if end <= start:
            end = min(start + 1, total)
        for i in range(start, end):
            page_text = reader.pages[i].extract_text() or ""
            if page_text.strip():
                chunk = f"[Page {i+1}]\n{page_text}\n"
                parts.append(chunk)
                size += len(chunk)
                if max_chars and size >= max_chars:
                    break
        if max_chars and size >= max_chars:
            break
    text = "\n".join(parts).strip()
    if max_chars and len(text) > max_chars:
        text = text[:max_chars] + "\n[...truncated...]"
    return text


# --------------------------
# Tool Builders
# --------------------------

def _course_dir(session_id: str, course_id: str, doc_type: str) -> str:
    return os.path.join(UPLOAD_DIR, session_id, course_id, doc_type)


def _list_pdfs(path: str) -> List[str]:
    if not os.path.exists(path):
        return []
    return [os.path.join(path, f) for f in os.listdir(path) if f.lower().endswith(".pdf")]


def build_tools(session_id: str) -> Dict[str, FunctionTool]:
    def load_course_doc_text(course_id: str, doc_type: str, max_pages: int = 8, max_chars: int = 12000) -> dict:
        """Load and extract text from a course document.
        Args:
            course_id: Immutable course id.
            doc_type: 'syllabus' or 'midterm_overview'.
            max_pages: Maximum pages to read from each PDF.
            max_chars: Maximum characters to return.
        Returns:
            dict: {"status": "success"|"error", "text": str, "file_count": int, "page_count": int, "error_message": str}
        """
        if doc_type not in {"syllabus", "midterm_overview"}:
            return {"status": "error", "error_message": f"Unsupported doc_type: {doc_type}"}
        cache_key = f"{session_id}:{course_id}:{doc_type}:{max_pages}:{max_chars}"
        if cache_key in _TEXT_CACHE:
            return {"status": "success", "text": _TEXT_CACHE[cache_key], "file_count": 1, "page_count": max_pages}
        doc_dir = _course_dir(session_id, course_id, doc_type)
        files = _list_pdfs(doc_dir)
        if not files:
            return {"status": "error", "error_message": f"No PDF files found for {doc_type}."}
        text = _read_pdf_text(files[0], 0, max_pages, max_chars)
        _TEXT_CACHE[cache_key] = text
        return {"status": "success", "text": text, "file_count": len(files), "page_count": max_pages}

    def load_textbook_toc(course_id: str, max_pages: int = 15, max_chars: int = 12000) -> dict:
        """Extract the textbook table of contents (TOC).
        Args:
            course_id: Immutable course id.
            max_pages: Max pages to scan from textbook.
            max_chars: Max characters to return.
        Returns:
            dict: {"status": "success"|"error", "text": str, "total_pages": int, "error_message": str}
        """
        cache_key = f"{session_id}:{course_id}:textbook_toc:{max_pages}:{max_chars}"
        if cache_key in _TEXT_CACHE:
            return {"status": "success", "text": _TEXT_CACHE[cache_key], "total_pages": 0}
        doc_dir = _course_dir(session_id, course_id, "textbook")
        files = _list_pdfs(doc_dir)
        if not files:
            return {"status": "error", "error_message": "No textbook PDF found."}
        reader = PdfReader(files[0])
        total_pages = len(reader.pages)
        text = _read_pdf_text(files[0], 0, max_pages, max_chars)
        _TEXT_CACHE[cache_key] = text
        return {"status": "success", "text": text, "total_pages": total_pages}

    def load_textbook_pages(course_id: str, page_ranges: List[Dict[str, int]], max_chars: int = 15000) -> dict:
        """Extract specific page ranges from the textbook.
        Args:
            course_id: Immutable course id.
            page_ranges: List of {"start": int, "end": int} page ranges (1-indexed).
            max_chars: Max characters to return.
        Returns:
            dict: {"status": "success"|"error", "text": str, "error_message": str}
        """
        if not page_ranges:
            return {"status": "error", "error_message": "page_ranges is required"}
        doc_dir = _course_dir(session_id, course_id, "textbook")
        files = _list_pdfs(doc_dir)
        if not files:
            return {"status": "error", "error_message": "No textbook PDF found."}
        text = _extract_pages_by_ranges(files[0], page_ranges, max_chars=max_chars)
        return {"status": "success", "text": text}

    return {
        "load_course_doc_text": FunctionTool(func=load_course_doc_text),
        "load_textbook_toc": FunctionTool(func=load_textbook_toc),
        "load_textbook_pages": FunctionTool(func=load_textbook_pages),
    }


# --------------------------
# Agent Builders
# --------------------------

def build_agents(session_id: str) -> Dict[str, Any]:
    tools = build_tools(session_id)

    syllabus_instruction = (
        "You are SyllabusExpert. Your job is to extract structure from a syllabus. "
        "Always call load_course_doc_text with doc_type='syllabus' first. "
        "Then return ONLY JSON with keys: course_name, course_code, modules, assessments. "
        "modules is a list of {name, topics (<=3), week}. assessments is a list of {type, weight, date}. "
        "If the tool returns an error, return empty modules and assessments."
    )

    scope_instruction = (
        "You are ExamScopeAnalyst. Your job is to extract exam scope from the midterm overview. "
        "Always call load_course_doc_text with doc_type='midterm_overview' first. "
        "Then return ONLY JSON with keys: exam_date (YYYY-MM-DD or empty), topics. "
        "topics is a list of {name, importance} where importance is high|medium|low. "
        "If the tool returns an error, return empty topics."
    )

    guide_instruction = (
        "You are StudyGuideGuru. Map topics to textbook sections with estimated hours. "
        "Step 1: call load_textbook_toc to read the table of contents. "
        "Step 2: pick relevant sections and call load_textbook_pages with page_ranges. "
        "Step 3: return ONLY JSON array of {topic, resource, estimated_hours}. "
        "Keep estimated_hours realistic (0.5 to 4.0). "
        "If tools return errors, return an empty array."
    )

    if LOW_QUOTA_MODE:
        syllabus_instruction = (
            "You are SyllabusExpert. Extract structure from the syllabus text provided in the message "
            "under SYLLABUS_TEXT. Return ONLY JSON with keys: course_name, course_code, modules, assessments. "
            "modules is a list of {name, topics (<=3), week}. assessments is a list of {type, weight, date}."
        )
        scope_instruction = (
            "You are ExamScopeAnalyst. Extract exam scope from the midterm overview text provided in the message "
            "under OVERVIEW_TEXT. Return ONLY JSON with keys: exam_date (YYYY-MM-DD or empty), topics. "
            "topics is a list of {name, importance} where importance is high|medium|low."
        )
        guide_instruction = (
            "You are StudyGuideGuru. Map topics to textbook resources using only the TOC text provided "
            "under TOC_TEXT. Return ONLY JSON array of {topic, resource, estimated_hours}. "
            "Keep estimated_hours realistic (0.5 to 4.0)."
        )

    planner_instruction = (
        "You are ChiefOrchestrator. Create a day-by-day study plan. "
        "Rules: do not exceed daily hour budgets, spread tasks evenly, schedule learn before practice, "
        "include review before exams, and allow rest days when possible. "
        "If you schedule a rest day, set course='REST', task_type='rest', topic='Rest Day', duration_hours=0. "
        "Return ONLY JSON with key 'tasks' = list of tasks. "
        "Each task: {date, course, topic, task_type, duration_hours, resources, notes}. "
        "Notes format: 'Focus: ... | Practice: ... | Memorize: ... | Self-Test: ...'"
    )

    syllabus_agent = LlmAgent(
        name="SyllabusExpert",
        model=MODEL_FAST,
        description="Extracts course structure and assessments from syllabi.",
        instruction=syllabus_instruction,
        tools=[] if LOW_QUOTA_MODE else [tools["load_course_doc_text"]],
        generate_content_config=types.GenerateContentConfig(temperature=0.1, max_output_tokens=900),
    )

    scope_agent = LlmAgent(
        name="ExamScopeAnalyst",
        model=MODEL_FAST,
        description="Identifies exam topics and importance from the midterm overview.",
        instruction=scope_instruction,
        tools=[] if LOW_QUOTA_MODE else [tools["load_course_doc_text"]],
        generate_content_config=types.GenerateContentConfig(temperature=0.1, max_output_tokens=700),
    )

    guide_agent = LlmAgent(
        name="StudyGuideGuru",
        model=MODEL_FAST,
        description="Maps exam topics to textbook sections with estimated hours.",
        instruction=guide_instruction,
        tools=[] if LOW_QUOTA_MODE else [tools["load_textbook_toc"], tools["load_textbook_pages"]],
        generate_content_config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=1200),
    )

    planner_agent = LlmAgent(
        name="ChiefOrchestrator",
        model=MODEL_PLANNER,
        description="Synthesizes a day-by-day study plan across courses.",
        instruction=planner_instruction,
        output_schema=PlanOutput,
        generate_content_config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=3500),
    )

    return {
        "syllabus": syllabus_agent,
        "scope": scope_agent,
        "guide": guide_agent,
        "planner": planner_agent,
    }


# --------------------------
# Helpers
# --------------------------

def _parse_json(text: str) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Attempt to extract JSON block
        match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                return None
    return None


def _coerce_exam_date(value: str) -> str:
    if not value:
        return ""
    if value.lower() in {"unknown", "n/a", "none"}:
        return ""
    return value


def _is_weekend(date_str: str) -> bool:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").weekday() >= 5
    except ValueError:
        return False


def _scale_day_tasks(tasks: List[dict], limit: float) -> List[dict]:
    total = sum(float(t.get("duration_hours", 0)) for t in tasks)
    if total <= 0 or total <= limit:
        return tasks
    scale = limit / total
    for t in tasks:
        hours = float(t.get("duration_hours", 0)) * scale
        # Round to nearest 0.5 hour, minimum 0.5
        rounded = max(0.5, round(hours * 2) / 2)
        t["duration_hours"] = rounded
    return tasks


def validate_and_adjust_plan(plan: List[dict], constraints: Dict[str, Any]) -> List[dict]:
    weekday_limit = float(constraints.get("weekdayHours", 3))
    weekend_limit = float(constraints.get("weekendHours", 6))
    by_date: Dict[str, List[dict]] = {}
    for t in plan:
        by_date.setdefault(t.get("date", ""), []).append(t)
    for date_str, day_tasks in by_date.items():
        limit = weekend_limit if _is_weekend(date_str) else weekday_limit
        _scale_day_tasks(day_tasks, limit)
    # flatten
    adjusted = [t for d in sorted(by_date.keys()) for t in by_date[d]]
    return adjusted


def normalize_plan(tasks: List[dict]) -> List[dict]:
    normalized: List[dict] = []
    for t in tasks:
        if not isinstance(t, dict):
            continue
        duration_raw = t.get("duration_hours", 1)
        try:
            duration = float(duration_raw)
        except (TypeError, ValueError):
            duration = 1.0
        normalized.append({
            "date": t.get("date", ""),
            "course": t.get("course", ""),
            "topic": t.get("topic", ""),
            "task_type": t.get("task_type", "learn"),
            "duration_hours": duration,
            "resources": t.get("resources", "Textbook"),
            "notes": t.get("notes", ""),
        })
    return normalized


def _safe_date(value: str) -> Optional[datetime]:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except Exception:
        return None


def build_fallback_plan(courses_data: List[Dict[str, Any]], constraints: Dict[str, Any]) -> List[dict]:
    weekday_limit = float(constraints.get("weekdayHours", 3))
    weekend_limit = float(constraints.get("weekendHours", 6))

    today = datetime.now().date()
    start = today + timedelta(days=1)

    exam_dates = []
    for cd in courses_data:
        course = cd.get("course", {})
        exam_dt = _safe_date(course.get("examDate", ""))
        if exam_dt:
            exam_dates.append(exam_dt.date() - timedelta(days=1))
    end = max(exam_dates) if exam_dates else (start + timedelta(days=6))

    courses = []
    for cd in courses_data:
        course = cd.get("course", {})
        scope = cd.get("scope", {}) if isinstance(cd.get("scope", {}), dict) else {}
        topics = [t.get("name") if isinstance(t, dict) else str(t) for t in scope.get("topics", [])]
        if not topics:
            topics = ["Core Concepts", "Practice Problems", "Exam Readiness"]
        courses.append({
            "code": course.get("code", "COURSE"),
            "exam": course.get("examDate", ""),
            "topics": topics,
        })

    plan: List[dict] = []
    if not courses:
        return plan

    course_idx = 0
    topic_idx: Dict[str, int] = {c["code"]: 0 for c in courses}
    current = start
    while current <= end:
        course = courses[course_idx % len(courses)]
        code = course["code"]
        topics = course["topics"]
        t_idx = topic_idx[code] % len(topics)
        topic = topics[t_idx]
        topic_idx[code] += 1

        is_weekend = current.weekday() >= 5
        limit = weekend_limit if is_weekend else weekday_limit
        duration = max(1.0, min(2.0, limit))

        exam_dt = _safe_date(course.get("exam", ""))
        task_type = "learn"
        if exam_dt:
            days_to_exam = (exam_dt.date() - current).days
            if days_to_exam <= 2:
                task_type = "review"

        plan.append({
            "date": current.strftime("%Y-%m-%d"),
            "course": code,
            "topic": topic,
            "task_type": task_type,
            "duration_hours": duration,
            "resources": "Textbook / Notes",
            "notes": "Focus: Review core ideas | Practice: Do 5–10 targeted questions | Memorize: Key formulas/definitions | Self-Test: Explain without notes",
        })

        course_idx += 1
        current += timedelta(days=1)

    return plan


def write_plan_exports(session_id: str, plan: List[dict]) -> None:
    exports_dir = os.path.join(UPLOAD_DIR, session_id, "exports")
    os.makedirs(exports_dir, exist_ok=True)
    csv_path = os.path.join(exports_dir, "plan.csv")
    md_path = os.path.join(exports_dir, "plan.md")

    headers = ["Date", "Course", "Topic", "Task Type", "Duration (H)", "Resources", "Notes"]
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write(",".join(headers) + "\n")
        for t in plan:
            row = [
                t.get("date", ""),
                t.get("course", ""),
                t.get("topic", ""),
                t.get("task_type", ""),
                str(t.get("duration_hours", "")),
                f"\"{(t.get('resources', '')).replace('"', '""')}\"",
                f"\"{(t.get('notes', '')).replace('"', '""')}\"",
            ]
            f.write(",".join(row) + "\n")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# Study Plan\n\n")
        f.write("| Date | Course | Topic | Task Type | Hours | Resources | Notes |\n")
        f.write("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n")
        for t in plan:
            f.write(
                f"| {t.get('date','')} | {t.get('course','')} | {t.get('topic','')} | {t.get('task_type','')} | {t.get('duration_hours','')} | {t.get('resources','')} | {t.get('notes','')} |\n"
            )


async def _ensure_session(session_id: str) -> None:
    session = await session_service.get_session(app_name=APP_NAME, user_id=session_id, session_id=session_id)
    if not session:
        await session_service.create_session(app_name=APP_NAME, user_id=session_id, session_id=session_id, state={"session_id": session_id})


async def _run_agent(agent: LlmAgent, session_id: str, message: str, max_retries: int = 2) -> str:
    content = types.Content(role="user", parts=[types.Part(text=message)])
    last_error: Optional[Exception] = None
    for attempt in range(max_retries + 1):
        try:
            runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)
            final_text = ""
            async for event in runner.run_async(user_id=session_id, session_id=session_id, new_message=content):
                if event.is_final_response() and event.content and event.content.parts:
                    final_text = event.content.parts[0].text or ""
            return final_text
        except Exception as e:
            last_error = e
            msg = str(e)
            if "RESOURCE_EXHAUSTED" in msg or "429" in msg:
                delay = 30
                m = re.search(r"retryDelay\\W*'?(\\d+)s", msg)
                if m:
                    delay = int(m.group(1))
                await asyncio.sleep(delay)
                continue
            raise
    if last_error:
        raise last_error
    return ""


# --------------------------
# Public API
# --------------------------

async def analyze_course(session_id: str, course: CourseInput, log_fn=None) -> Dict[str, Any]:
    await _ensure_session(session_id)
    agents = build_agents(session_id)
    cache_key = f"{session_id}:{course.id}"
    if cache_key in _COURSE_CACHE:
        cached = _COURSE_CACHE[cache_key]
        cached_course = cached.get("course", {})
        if cached_course.get("code") == course.code and cached_course.get("examDate") == course.examDate:
            if log_fn:
                log_fn(session_id, "System", f"Reusing cached analysis for {course.code}.", "success")
            return cached

    if log_fn:
        log_fn(session_id, "SyllabusExpert", f"Analyzing syllabus for {course.code}...", "loading")
    syllabus_msg = (
        f"Analyze syllabus for course.\n"
        f"course_id: {course.id}\ncourse_code: {course.code}\ncourse_name: {course.name}\n"
        f"Use load_course_doc_text with doc_type='syllabus'.\n"
        f"Return JSON only."
    )
    if LOW_QUOTA_MODE:
        syllabus_dir = _course_dir(session_id, course.id, "syllabus")
        syllabus_files = _list_pdfs(syllabus_dir)
        syllabus_text = _read_pdf_text(syllabus_files[0], 0, 8, 12000) if syllabus_files else ""
        syllabus_msg = (
            f"Extract course structure from the syllabus text.\n"
            f"course_code: {course.code}\ncourse_name: {course.name}\n"
            f"SYLLABUS_TEXT:\n{syllabus_text}\n"
            f"Return JSON only."
        )
    syllabus_text = await _run_agent(agents["syllabus"], session_id, syllabus_msg)
    syllabus_data = _parse_json(syllabus_text) or {"course_name": course.name, "course_code": course.code, "modules": [], "assessments": []}
    # Fallback to Gemini file upload if extraction failed (scanned PDFs).
    if isinstance(syllabus_data, dict) and not syllabus_data.get("modules"):
        syllabus_dir = _course_dir(session_id, course.id, "syllabus")
        syllabus_files = _list_pdfs(syllabus_dir)
        if syllabus_files:
            try:
                if log_fn:
                    log_fn(session_id, "SyllabusExpert", "Fallback: using Gemini file upload for syllabus.", "loading")
                syllabus_data = _gemini_file_json(
                    prompt=(
                        "Analyze this syllabus. Extract ONLY:\n"
                        "1. Course name and code\n"
                        "2. Up to 10 modules (max 3 topics each)\n"
                        "3. Exam dates and weights\n\n"
                        "Return JSON:\n"
                        "{\n"
                        '  "course_name": "...",\n'
                        '  "course_code": "...",\n'
                        '  "modules": [{"name": "...", "topics": ["t1", "t2"], "week": 1}],\n'
                        '  "assessments": [{"type": "midterm", "weight": "30%", "date": "YYYY-MM-DD"}]\n'
                        "}\n\n"
                        "Be concise."
                    ),
                    file_paths=syllabus_files[:1],
                )
            except Exception:
                pass
    if log_fn:
        modules_count = len(syllabus_data.get("modules", [])) if isinstance(syllabus_data, dict) else 0
        log_fn(session_id, "SyllabusExpert", f"Syllabus extracted for {course.code} — {modules_count} modules identified.", "success")

    if log_fn:
        log_fn(session_id, "ExamScopeAnalyst", f"Analyzing midterm overview for {course.code}...", "loading")
    scope_msg = (
        f"Analyze midterm overview for course.\n"
        f"course_id: {course.id}\ncourse_code: {course.code}\ncourse_name: {course.name}\n"
        f"Use load_course_doc_text with doc_type='midterm_overview'.\n"
        f"Return JSON only."
    )
    if LOW_QUOTA_MODE:
        overview_dir = _course_dir(session_id, course.id, "midterm_overview")
        overview_files = _list_pdfs(overview_dir)
        overview_text = _read_pdf_text(overview_files[0], 0, 8, 12000) if overview_files else ""
        scope_msg = (
            f"Extract exam scope from the overview text.\n"
            f"course_code: {course.code}\ncourse_name: {course.name}\n"
            f"OVERVIEW_TEXT:\n{overview_text}\n"
            f"Return JSON only."
        )
    scope_text = await _run_agent(agents["scope"], session_id, scope_msg)
    scope_data = _parse_json(scope_text) or {"exam_date": "", "topics": []}
    # Fallback to Gemini file upload if extraction failed (scanned PDFs).
    if isinstance(scope_data, dict) and not scope_data.get("topics"):
        overview_dir = _course_dir(session_id, course.id, "midterm_overview")
        overview_files = _list_pdfs(overview_dir)
        if overview_files:
            try:
                if log_fn:
                    log_fn(session_id, "ExamScopeAnalyst", "Fallback: using Gemini file upload for midterm overview.", "loading")
                scope_data = _gemini_file_json(
                    prompt=(
                        "Analyze this exam guide. Extract ONLY:\n"
                        "1. Exam date\n"
                        "2. Topics (max 15), each with importance (high/medium/low)\n\n"
                        "Return JSON:\n"
                        "{\n"
                        '  "exam_date": "YYYY-MM-DD",\n'
                        '  "topics": [{"name": "Topic", "importance": "high"}]\n'
                        "}\n\n"
                        "Be concise."
                    ),
                    file_paths=overview_files[:1],
                )
            except Exception:
                pass

    exam_date = _coerce_exam_date(scope_data.get("exam_date", "") if isinstance(scope_data, dict) else "")
    topics = scope_data.get("topics", []) if isinstance(scope_data, dict) else []
    topic_names = [t.get("name") if isinstance(t, dict) else str(t) for t in topics]
    resolved_exam_date = course.examDate or exam_date
    if log_fn and resolved_exam_date:
        log_fn(
            session_id,
            "ExamScopeAnalyst",
            f"Exam date for {course.code}: {resolved_exam_date}" + (" (manual override)" if course.examDate else " (from midterm overview)"),
            "success",
        )
    if log_fn:
        preview = ", ".join(topic_names[:4]) + (f" (+{len(topic_names)-4} more)" if len(topic_names) > 4 else "")
        log_fn(session_id, "ExamScopeAnalyst", f"Exam scope for {course.code}: {len(topic_names)} topics — {preview}", "success")

    # If no topics, fallback to syllabus modules
    if not topic_names:
        modules = syllabus_data.get("modules", []) if isinstance(syllabus_data, dict) else []
        fallback_topics = []
        for m in modules:
            if isinstance(m, dict):
                for t in m.get("topics", []) or []:
                    fallback_topics.append({"name": t, "importance": "medium"})
                if not m.get("topics") and m.get("name"):
                    fallback_topics.append({"name": m["name"], "importance": "medium"})
        scope_data["topics"] = fallback_topics
        topics = fallback_topics
        topic_names = [t.get("name") for t in topics]
        if log_fn:
            log_fn(session_id, "ExamScopeAnalyst", f"No topics found — fallback to {len(topic_names)} syllabus topics.", "success")

    if not topic_names:
        fallback_topics = [
            {"name": "Core Concepts", "importance": "medium"},
            {"name": "Practice Problems", "importance": "medium"},
            {"name": "Exam Readiness", "importance": "medium"},
        ]
        scope_data["topics"] = fallback_topics
        topics = fallback_topics
        topic_names = [t.get("name") for t in topics]
        if log_fn:
            log_fn(session_id, "ExamScopeAnalyst", "No topics available — using generic fallback topics.", "success")

    if log_fn:
        log_fn(session_id, "StudyGuideGuru", f"Mapping textbook resources for {course.code}...", "loading")

    guide_msg = (
        f"Map topics to textbook.\n"
        f"course_id: {course.id}\ncourse_code: {course.code}\n"
        f"Topics: {json.dumps(topic_names)}\n"
        f"Use load_textbook_toc then load_textbook_pages.\n"
        f"Return JSON array only."
    )
    if LOW_QUOTA_MODE:
        textbook_dir = _course_dir(session_id, course.id, "textbook")
        textbook_files = _list_pdfs(textbook_dir)
        toc_text = _read_pdf_text(textbook_files[0], 0, 12, 12000) if textbook_files else ""
        guide_msg = (
            f"Map topics to textbook using TOC text only.\n"
            f"course_code: {course.code}\n"
            f"Topics: {json.dumps(topic_names)}\n"
            f"TOC_TEXT:\n{toc_text}\n"
            f"Return JSON array only."
        )
    guide_text = await _run_agent(agents["guide"], session_id, guide_msg)
    guide_data = _parse_json(guide_text) or []
    if isinstance(guide_data, dict) and "topics" in guide_data:
        guide_data = guide_data.get("topics", [])
    if not isinstance(guide_data, list):
        guide_data = []

    total_hours = 0.0
    for g in guide_data:
        if isinstance(g, dict):
            total_hours += float(g.get("estimated_hours", 0) or 0)
    if log_fn:
        log_fn(session_id, "StudyGuideGuru", f"Resource mapping for {course.code}: {len(guide_data)} topics mapped, ~{total_hours:.1f}h estimated.", "success")

    result = {
        "course": {
            "id": course.id,
            "code": course.code,
            "name": course.name,
            "examDate": resolved_exam_date,
        },
        "syllabus": syllabus_data,
        "scope": scope_data,
        "guide": guide_data,
    }
    session = await session_service.get_session(app_name=APP_NAME, user_id=session_id, session_id=session_id)
    if session:
        session.state.setdefault("course_artifacts", {})[course.id] = result
    _COURSE_CACHE[cache_key] = result
    return result


async def generate_plan(session_id: str, courses_data: List[Dict[str, Any]], constraints: Dict[str, Any], log_fn=None) -> List[dict]:
    await _ensure_session(session_id)
    agents = build_agents(session_id)

    # Build compressed input for planner
    compressed = []
    for cd in courses_data:
        course = cd.get("course", {})
        scope = cd.get("scope", {})
        guide = cd.get("guide", [])

        topics_summary = []
        for t in scope.get("topics", []) if isinstance(scope, dict) else []:
            name = t.get("name", str(t)) if isinstance(t, dict) else str(t)
            importance = t.get("importance", "medium") if isinstance(t, dict) else "medium"
            resource = "Textbook"
            hours = 2.0
            for g in guide:
                if isinstance(g, dict) and g.get("topic", "").lower() == name.lower():
                    resource = g.get("resource", "Textbook")
                    hours = g.get("estimated_hours", 2.0)
                    break
            topics_summary.append({"topic": name, "importance": importance, "resource": resource, "hours": hours})

        compressed.append({
            "code": course.get("code", "COURSE"),
            "exam_date": scope.get("exam_date") or course.get("examDate", ""),
            "topics": topics_summary,
        })

    today_str = datetime.now().strftime("%Y-%m-%d")
    tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    if log_fn:
        total_est = sum(sum(t.get("hours", 0) for t in c.get("topics", [])) for c in compressed)
        log_fn(session_id, "ChiefOrchestrator", f"Synthesizing schedule across {len(compressed)} courses (~{total_est:.0f}h of content)...", "loading")

    planner_msg = (
        "Create a comprehensive study schedule.\n"
        f"COURSES: {json.dumps(compressed)}\n"
        f"CONSTRAINTS: {json.dumps(constraints)}\n"
        f"Today: {today_str}. Start: {tomorrow_str}. Last study day = 1 day before exam.\n"
        "Use constraints.reviewFrequency to decide how often to schedule review sessions.\n"
        "Return JSON with key 'tasks' only."
    )

    plan_text = await _run_agent(agents["planner"], session_id, planner_msg)
    parsed = _parse_json(plan_text) or {}
    tasks = parsed.get("tasks", []) if isinstance(parsed, dict) else []
    if not isinstance(tasks, list):
        tasks = []

    tasks = normalize_plan(tasks)
    if tasks:
        plan = validate_and_adjust_plan(tasks, constraints)
    else:
        if log_fn:
            log_fn(session_id, "System", "Planner returned empty tasks — generating fallback plan.", "loading")
        plan = build_fallback_plan(courses_data, constraints)
    if log_fn:
        days = len(set(t.get("date", "") for t in plan))
        log_fn(session_id, "ChiefOrchestrator", f"Plan complete — {len(plan)} study sessions scheduled across {days} days.", "success")

    session = await session_service.get_session(app_name=APP_NAME, user_id=session_id, session_id=session_id)
    if session:
        session.state["latest_plan"] = plan

    write_plan_exports(session_id, plan)
    if log_fn:
        log_fn(session_id, "System", "Exports written: plan.csv and plan.md", "success")
    return plan
