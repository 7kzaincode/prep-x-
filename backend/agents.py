import os
import json
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from dotenv import load_dotenv
from PyPDF2 import PdfReader

ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
load_dotenv(dotenv_path=ENV_PATH)

# ADK reads GOOGLE_API_KEY; alias from our env var
if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("GEMINI_API_KEY")

MODEL_NAME = "gemini-2.5-flash"
APP_NAME = "prep_x_study_planner"

# Rate limiter — free tier is 5 RPM, need 13s between calls
import asyncio
import time
_last_api_call = 0.0
_RPM_DELAY = 13  # seconds between API calls (5 RPM = 12s min, 13s for safety)

async def _rate_limit():
    """Wait if needed to stay under the Gemini free-tier RPM limit."""
    global _last_api_call
    now = time.time()
    elapsed = now - _last_api_call
    if elapsed < _RPM_DELAY:
        wait = _RPM_DELAY - elapsed
        print(f"  [Rate limiter] Waiting {wait:.1f}s to stay under RPM limit...")
        await asyncio.sleep(wait)
    _last_api_call = time.time()


# ---------------------------------------------------------------------------
# PDF utilities — extract text locally to avoid sending full PDFs to Gemini
# ---------------------------------------------------------------------------

def extract_pdf_text(path: str, start_page: int = 0, end_page: Optional[int] = None) -> str:
    """Extract text from a PDF file for a given page range (0-indexed)."""
    reader = PdfReader(path)
    total = len(reader.pages)
    end = min(end_page or total, total)
    text_parts = []
    for i in range(start_page, end):
        page_text = reader.pages[i].extract_text() or ""
        if page_text.strip():
            text_parts.append(f"[Page {i+1}]\n{page_text}")
    return "\n\n".join(text_parts)


def extract_toc_text(path: str, max_pages: int = 15) -> str:
    """Extract the first N pages of a textbook (likely contains the TOC)."""
    return extract_pdf_text(path, 0, max_pages)


def extract_pages_by_ranges(path: str, page_ranges: List[Dict]) -> str:
    """Extract specific page ranges from a PDF.
    page_ranges: [{"start": 1, "end": 30}, {"start": 45, "end": 60}]
    Pages are 1-indexed in the input (matching textbook page numbers).
    """
    reader = PdfReader(path)
    total = len(reader.pages)
    text_parts = []
    for pr in page_ranges:
        start = max(0, pr.get("start", 1) - 1)
        end = min(pr.get("end", start + 1), total)
        for i in range(start, end):
            page_text = reader.pages[i].extract_text() or ""
            if page_text.strip():
                text_parts.append(f"[Page {i+1}]\n{page_text}")
    return "\n\n".join(text_parts)


def get_total_pages(path: str) -> int:
    return len(PdfReader(path).pages)


# ---------------------------------------------------------------------------
# FunctionTool functions for StudyGuideGuru
# ---------------------------------------------------------------------------

def load_textbook_toc(textbook_path: str, max_pages: int = 15) -> str:
    """Extract the table of contents (first N pages) from a textbook PDF.

    Args:
        textbook_path: Absolute path to the textbook PDF file.
        max_pages: Number of pages from the start to extract (default 15).

    Returns:
        Extracted text from the first N pages containing the table of contents.
    """
    if not os.path.exists(textbook_path):
        return f"Error: file not found at {textbook_path}"
    total = get_total_pages(textbook_path)
    text = extract_toc_text(textbook_path, max_pages)
    return f"[Textbook: {total} total pages]\n{text}"


def load_textbook_pages(textbook_path: str, page_ranges_json: str) -> str:
    """Extract specific page ranges from a textbook PDF.

    Args:
        textbook_path: Absolute path to the textbook PDF file.
        page_ranges_json: JSON string of page ranges, e.g. '[{"start": 45, "end": 48}]'.
            Pages are 1-indexed. Each range is clamped to max 3 pages to save tokens.

    Returns:
        Extracted text from the specified page ranges.
    """
    if not os.path.exists(textbook_path):
        return f"Error: file not found at {textbook_path}"
    page_ranges = json.loads(page_ranges_json)
    clamped = []
    for pr in page_ranges:
        start = pr.get("start", 1)
        end = min(start + 3, pr.get("end", start + 3))
        clamped.append({"start": start, "end": end})
    text = extract_pages_by_ranges(textbook_path, clamped)
    if len(text) > 15000:
        text = text[:15000] + "\n[...truncated...]"
    return text


# ---------------------------------------------------------------------------
# ADK Agent definitions
# ---------------------------------------------------------------------------

syllabus_expert = LlmAgent(
    name="SyllabusExpert",
    model=MODEL_NAME,
    instruction=(
        "You are a syllabus analysis expert. Analyze the provided syllabus text and extract course structure.\n"
        "Extract ONLY:\n"
        "1. Course name and code\n"
        "2. Up to 10 modules (max 3 topics each)\n"
        "3. Exam dates and weights\n\n"
        "Return valid JSON with keys: course_name, course_code, modules (array of {name, topics, week}), "
        "assessments (array of {type, weight, date}).\n"
        "Be concise."
    ),
    generate_content_config=types.GenerateContentConfig(
        response_mime_type="application/json",
    ),
)

exam_scope_analyst = LlmAgent(
    name="ExamScopeAnalyst",
    model=MODEL_NAME,
    instruction=(
        "You are an exam scope analyst. Analyze the provided exam guide/midterm overview text.\n"
        "Extract ONLY:\n"
        "1. Exam date (YYYY-MM-DD format)\n"
        "2. Topics (max 15), each with importance (high/medium/low)\n\n"
        "Return valid JSON with keys: exam_date, topics (array of {name, importance}).\n"
        "Be concise."
    ),
    generate_content_config=types.GenerateContentConfig(
        response_mime_type="application/json",
    ),
)

toc_navigator = LlmAgent(
    name="TocNavigator",
    model=MODEL_NAME,
    instruction=(
        "You are a textbook table-of-contents navigator. Given the TOC text from a textbook and "
        "a list of exam topics, identify which chapters and page ranges are relevant to each topic.\n\n"
        "Return valid JSON with key: relevant_sections (array of {chapter, start_page, end_page, covers_topics}).\n"
        "Only include sections genuinely relevant to the exam topics."
    ),
    generate_content_config=types.GenerateContentConfig(
        response_mime_type="application/json",
    ),
)

study_guide_guru = LlmAgent(
    name="StudyGuideGuru",
    model=MODEL_NAME,
    instruction=(
        "You are a study guide expert that maps exam topics to textbook resources.\n\n"
        "You will be given exam topics, relevant TOC sections, and ALREADY SAMPLED textbook page content.\n"
        "The sampled content is provided directly in the message — use it to map topics.\n"
        "You have tools available (load_textbook_toc, load_textbook_pages) but ONLY call them if "
        "the provided content is clearly insufficient. In most cases the provided text is enough.\n"
        "Do NOT call tools unless absolutely necessary.\n\n"
        "Return ONLY valid JSON (no markdown) with key: mappings (array of {topic, resource, estimated_hours}).\n"
        "- resource MUST be specific chapter/section references like 'Ch 3.2-3.4 (pp. 45-67)'\n"
        "- Do NOT use generic text like 'Textbook' or 'Notes'\n"
        "- Use EXACT topic names as provided — do not rephrase\n"
        "- estimated_hours should be realistic (0.5 to 4.0)"
    ),
    tools=[load_textbook_toc, load_textbook_pages],
)

chief_orchestrator = LlmAgent(
    name="ChiefOrchestrator",
    model=MODEL_NAME,
    instruction=(
        "You are the chief study planner. Synthesize all course analysis data into an optimal "
        "day-by-day study schedule.\n\n"
        "RULES:\n"
        "- Don't exceed daily hour budget\n"
        "- Prioritize high-importance topics\n"
        "- Schedule 'learn' before 'practice' for each topic\n"
        "- Include 'review' sessions before exams\n"
        "- SPREAD TASKS EVENLY until the exam date — do NOT bunch them at the start\n"
        "- Include REST DAYS (1 rest day every 4-6 days) to prevent burnout\n"
        "- If schedule is too compressed, prioritize ONLY high/medium topics\n"
        "- Use the estimated_hours provided for each topic — honor the time each topic needs\n"
        "- A course with fewer topics does NOT mean less time per topic. "
        "Complex topics (e.g. physics, math) need the full hours specified in the data.\n"
        "- HARD DEADLINE: NEVER schedule ANY task for a course ON or AFTER its exam_date. "
        "The LAST study day for each course MUST be the day BEFORE its exam_date. "
        "If there's not enough time, drop low-importance topics — do NOT exceed the deadline.\n\n"
        "Return ONLY a raw JSON object (no markdown, no ```). The JSON must have a 'tasks' key "
        "containing an array. Each task object has these STRING fields:\n"
        "  date (YYYY-MM-DD), course (code), topic, task_type (learn/practice/review), "
        "  duration_hours (number), resources (string), notes (SINGLE flat string, NOT an object).\n\n"
        "The notes field must be a SINGLE flat string with 4 pipe-separated sections:\n"
        "  Focus: <what to study> | Practice: <specific problem types> | Memorize: <key formulas/definitions> | Self-Test: <how to verify understanding>\n"
        "Each section MUST contain real, specific content derived from the actual topic and course material provided above.\n"
        "Pull actual concepts, formulas, techniques, and terminology from the topics and resources you were given.\n"
        "NEVER use filler like 'core concepts here', 'problem types here', or 'key formulas'. "
        "Every word must be meaningful and specific to that topic.\n\n"
        "Use the EXACT topic names and resource references provided — do not rephrase them.\n"
        "Generate ALL tasks for ALL topics. Do not stop early."
    ),
    generate_content_config=types.GenerateContentConfig(
        max_output_tokens=65536,
        thinking_config=types.ThinkingConfig(thinking_budget=2048),
    ),
)


# ---------------------------------------------------------------------------
# Core ADK runner — isolated session per call
# ---------------------------------------------------------------------------

async def run_agent(agent: LlmAgent, user_message: str) -> dict:
    """Run an ADK agent with a completely isolated session.

    Creates a fresh InMemorySessionService per call so there is zero chance
    of cross-agent session contamination.
    """
    session_service = InMemorySessionService()

    runner = Runner(
        agent=agent,
        app_name=APP_NAME,
        session_service=session_service,
    )

    call_id = uuid.uuid4().hex[:12]
    user_id = f"user_{call_id}"
    session_id = f"session_{call_id}"

    session = await session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
    )

    user_content = types.Content(
        role="user",
        parts=[types.Part(text=user_message)],
    )

    # Wait for rate limit before hitting the API
    await _rate_limit()

    final_text = ""
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=user_content,
    ):
        if hasattr(event, "usage_metadata") and event.usage_metadata:
            u = event.usage_metadata
            print(f"  [{agent.name}] Tokens — In: {getattr(u, 'prompt_token_count', '?')}, "
                  f"Out: {getattr(u, 'candidates_token_count', '?')}")

        if event.is_final_response() and event.content and event.content.parts:
            final_text = "".join(p.text for p in event.content.parts if p.text)

    # Try to parse the final response as JSON
    if final_text:
        try:
            return json.loads(final_text)
        except json.JSONDecodeError:
            # Try extracting JSON from markdown code blocks
            if "```json" in final_text:
                json_block = final_text.split("```json")[1].split("```")[0].strip()
                try:
                    return json.loads(json_block)
                except json.JSONDecodeError:
                    pass
            elif "```" in final_text:
                json_block = final_text.split("```")[1].split("```")[0].strip()
                try:
                    return json.loads(json_block)
                except json.JSONDecodeError:
                    pass
            print(f"  WARNING: Could not parse {agent.name} response as JSON")
            print(f"  Response preview: {final_text[:300]}")
            return {}

    print(f"  WARNING: {agent.name} returned empty response")
    return {}


# ---------------------------------------------------------------------------
# Public async wrapper functions (called by main.py)
# ---------------------------------------------------------------------------

async def analyze_syllabus(syllabus_paths: List[str]) -> dict:
    """Run SyllabusExpert on locally-extracted PDF text."""
    if not syllabus_paths:
        return {"course_name": "", "modules": [], "assessments": []}

    all_text = []
    for path in syllabus_paths:
        text = extract_pdf_text(path)
        all_text.append(f"--- {os.path.basename(path)} ---\n{text}")
    combined = "\n\n".join(all_text)

    print(f"\n--- [SyllabusExpert] PDF text: {len(combined)} chars ---")
    result = await run_agent(syllabus_expert, f"Analyze this syllabus:\n\n{combined}")

    if not isinstance(result, dict):
        return {"course_name": "", "modules": [], "assessments": []}
    return result


async def analyze_exam_scope(overview_paths: List[str]) -> dict:
    """Run ExamScopeAnalyst on locally-extracted PDF text."""
    if not overview_paths:
        return {"exam_date": "", "topics": []}

    all_text = []
    for path in overview_paths:
        text = extract_pdf_text(path)
        all_text.append(f"--- {os.path.basename(path)} ---\n{text}")
    combined = "\n\n".join(all_text)

    print(f"\n--- [ExamScopeAnalyst] PDF text: {len(combined)} chars ---")
    result = await run_agent(exam_scope_analyst, f"Analyze this exam guide:\n\n{combined}")

    if not isinstance(result, dict):
        return {"exam_date": "", "topics": []}
    return result


async def analyze_textbook(textbook_paths: List[str], topics: List) -> list:
    """Two-pass textbook analysis: TocNavigator → StudyGuideGuru."""
    if not textbook_paths:
        return []

    topic_names = []
    for t in topics:
        if isinstance(t, dict):
            topic_names.append(t.get("name", str(t)))
        else:
            topic_names.append(str(t))

    if not topic_names:
        return []

    textbook_path = textbook_paths[0]
    total_pages = get_total_pages(textbook_path)

    # --- PASS 1: TocNavigator scans TOC ---
    print(f"\n--- [TocNavigator] Scanning TOC ({total_pages} total pages) ---")
    toc_text = extract_toc_text(textbook_path, max_pages=15)

    toc_message = (
        f"Table of contents of a {total_pages}-page textbook.\n\n"
        f"EXAM TOPICS: {json.dumps(topic_names)}\n\n"
        f"Identify chapters/page ranges for these topics ONLY.\n\n"
        f"TOC:\n{toc_text}"
    )

    toc_result = await run_agent(toc_navigator, toc_message)
    sections = toc_result.get("relevant_sections", [])
    print(f"[TocNavigator] Found {len(sections)} relevant sections")

    if not sections:
        return [{"topic": t, "resource": "Textbook (section not identified)", "estimated_hours": 2.0}
                for t in topic_names]

    # --- PASS 2: StudyGuideGuru maps topics using pre-extracted pages ---
    # Pre-extract pages here to avoid tool call round-trips (saves API calls for rate limit)
    page_ranges = [
        {"start": s.get("start_page", 1), "end": min(s.get("start_page", 1) + 3, s.get("end_page", 10))}
        for s in sections
    ]
    sampled_count = sum(pr["end"] - pr["start"] + 1 for pr in page_ranges)
    print(f"\n--- [StudyGuideGuru] Mapping {len(topic_names)} topics, sampling {sampled_count} pages ---")

    relevant_text = extract_pages_by_ranges(textbook_path, page_ranges)
    if len(relevant_text) > 15000:
        relevant_text = relevant_text[:15000] + "\n[...truncated...]"

    guide_message = (
        f"Map exam topics to textbook resources.\n\n"
        f"TOPICS: {json.dumps(topic_names)}\n\n"
        f"RELEVANT SECTIONS (from table of contents analysis):\n"
        f"{json.dumps(sections, indent=2)}\n\n"
        f"SAMPLED TEXTBOOK CONTENT:\n{relevant_text}\n\n"
        f"Map each topic to specific textbook resources with estimated study hours.\n"
        f"Return JSON with a mappings array."
    )

    guide_result = await run_agent(study_guide_guru, guide_message)

    if isinstance(guide_result, dict) and "mappings" in guide_result:
        return guide_result["mappings"]
    if isinstance(guide_result, list):
        return guide_result
    return []


async def generate_study_plan(courses_data: List[Dict], constraints: Dict) -> list:
    """Run ChiefOrchestrator to generate the final study schedule."""
    compressed = []
    for cd in courses_data:
        course = cd.get("course", {})
        scope = cd.get("scope", {})
        guide = cd.get("guide", [])

        topics_summary = []
        for t in scope.get("topics", []):
            name = t.get("name", str(t)) if isinstance(t, dict) else str(t)
            importance = t.get("importance", "medium") if isinstance(t, dict) else "medium"
            resource = "Textbook"
            hours = 2.0
            # Match guide entries (case-insensitive + substring fallback)
            for g in guide:
                if isinstance(g, dict):
                    g_topic = g.get("topic", "")
                    if g_topic.lower() == name.lower() or name.lower() in g_topic.lower() or g_topic.lower() in name.lower():
                        resource = g.get("resource", "Textbook")
                        hours = g.get("estimated_hours", 2.0)
                        break
            topics_summary.append({
                "topic": name, "importance": importance,
                "resource": resource, "hours": hours,
            })

        # Prefer the resolved examDate from main.py (already handles auto-detect + manual override)
        exam_date = course.get("examDate", "") or scope.get("exam_date", "")
        if exam_date and exam_date.lower() in ("unknown", "n/a", "none"):
            exam_date = ""

        compressed.append({
            "code": course.get("code", "COURSE"),
            "exam_date": exam_date or "unknown",
            "topics": topics_summary,
        })

    today_str = datetime.now().strftime("%Y-%m-%d")
    tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    plan_message = (
        f"Create a comprehensive study schedule.\n\n"
        f"COURSES:\n{json.dumps(compressed)}\n\n"
        f"CONSTRAINTS:\n"
        f"- Weekday hours: {constraints.get('weekdayHours', 3)}\n"
        f"- Weekend hours: {constraints.get('weekendHours', 6)}\n"
        f"- No-study dates: {constraints.get('noStudyDates', [])}\n"
        f"- Today: {today_str}. Start: {tomorrow_str}.\n"
        f"- HARD STOP: Last study day for each course = 1 day BEFORE its exam_date. "
        f"ZERO tasks allowed on or after exam_date.\n\n"
        f"Return a JSON object with a 'tasks' key containing the array of study tasks."
    )

    result = await run_agent(chief_orchestrator, plan_message)

    if isinstance(result, dict) and "tasks" in result:
        return result["tasks"]
    if isinstance(result, list):
        return result
    return []
