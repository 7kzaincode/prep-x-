import os
import json
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from PyPDF2 import PdfReader
from datetime import datetime, timedelta

load_dotenv(dotenv_path="../.env.local")

# Initialize Gemini Client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
MODEL_NAME = "gemini-2.5-flash"


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
        # Convert 1-indexed to 0-indexed, clamp to bounds
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
# Gemini helper — text-only (no file uploads)
# ---------------------------------------------------------------------------

def get_text_response(prompt: str) -> dict:
    """Send a text-only prompt to Gemini (no file upload)."""
    print(f"\n--- [AGENT CALL — text only] ---")
    print(f"Prompt length: {len(prompt)} chars")
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
        )
    )
    # Token tracking
    usage = response.usage_metadata
    if usage:
        print(f"📊 Tokens — Input: {usage.prompt_token_count}, Output: {usage.candidates_token_count}, Total: {usage.total_token_count}")
    print(f"Response: {response.text[:200]}...")
    return json.loads(response.text)


def get_file_response(prompt: str, file_paths: List[str]) -> dict:
    """Send prompt with file uploads to Gemini (for syllabus/midterm — small docs)."""
    print(f"\n--- [AGENT CALL — with files] ---")
    print(f"Prompt length: {len(prompt)} chars")
    contents = [prompt]
    for fp in file_paths:
        print(f"Uploading: {os.path.basename(fp)}")
        uploaded = client.files.upload(file=fp)
        contents.append(uploaded)
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
        )
    )
    # Token tracking
    usage = response.usage_metadata
    if usage:
        print(f"📊 Tokens — Input: {usage.prompt_token_count}, Output: {usage.candidates_token_count}, Total: {usage.total_token_count}")
    print(f"Response: {response.text[:200]}...")
    return json.loads(response.text)


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

class SyllabusExpert:
    """Extracts course structure from syllabus (small doc — upload is fine)."""
    def analyze(self, syllabus_paths: List[str]):
        prompt = """Analyze this syllabus. Extract ONLY:
1. Course name and code
2. Up to 10 modules (max 3 topics each)
3. Exam dates and weights

Return JSON:
{
    "course_name": "...",
    "course_code": "...",
    "modules": [{"name": "...", "topics": ["t1", "t2"], "week": 1}],
    "assessments": [{"type": "midterm", "weight": "30%", "date": "YYYY-MM-DD"}]
}

Be concise."""
        return get_file_response(prompt, syllabus_paths)


class ExamScopeAnalyst:
    """Identifies testable topics from midterm overview (small doc — upload is fine)."""
    def analyze(self, overview_paths: List[str]):
        prompt = """Analyze this exam guide. Extract ONLY:
1. Exam date
2. Topics (max 15), each with importance (high/medium/low)

Return JSON:
{
    "exam_date": "YYYY-MM-DD",
    "topics": [{"name": "Topic", "importance": "high"}]
}

Be concise."""
        return get_file_response(prompt, overview_paths)


class StudyGuideGuru:
    """Two-pass approach: (1) TOC scan to find chapters, (2) minimal mapping."""

    def analyze(self, textbook_paths: List[str], topics: List):
        if not textbook_paths:
            return []

        # Normalize topic list
        topic_names = []
        for t in topics:
            if isinstance(t, dict):
                topic_names.append(t.get("name", str(t)))
            else:
                topic_names.append(str(t))

        textbook_path = textbook_paths[0]
        total_pages = get_total_pages(textbook_path)

        # ---- PASS 1: TOC scan (first 15 pages only) ----
        print(f"\n[StudyGuideGuru] Pass 1: Scanning TOC ({total_pages} total pages)...")
        toc_text = extract_toc_text(textbook_path, max_pages=15)

        toc_prompt = f"""Table of contents of a {total_pages}-page textbook.

EXAM TOPICS: {json.dumps(topic_names)}

Identify chapters/page ranges for these topics ONLY.

Return JSON:
{{
    "relevant_sections": [
        {{"chapter": "Ch 3: Probability", "start_page": 45, "end_page": 78, "covers_topics": ["Topic A"]}}
    ]
}}

TOC:
{toc_text}"""

        toc_result = get_text_response(toc_prompt)
        sections = toc_result.get("relevant_sections", [])
        print(f"[StudyGuideGuru] Pass 1 done: {len(sections)} sections")

        if not sections:
            return [{"topic": t, "resource": "Unknown", "estimated_hours": 2.0} for t in topic_names]

        # ---- PASS 2: Sample 2-3 pages per section, minimal output ----
        # Only sample first 3 pages of each section
        page_ranges = [{"start": s.get("start_page", 1), "end": min(s.get("start_page", 1) + 3, s.get("end_page", 10))} for s in sections]

        extracted_pages = sum(pr["end"] - pr["start"] + 1 for pr in page_ranges)
        print(f"[StudyGuideGuru] Pass 2: Sampling {extracted_pages} pages (first 3 per section)")

        relevant_text = extract_pages_by_ranges(textbook_path, page_ranges)

        # Aggressive truncation
        max_chars = 15000  # ~4K tokens
        if len(relevant_text) > max_chars:
            relevant_text = relevant_text[:max_chars] + "\n[...truncated...]"
            print(f"[StudyGuideGuru] Truncated to {max_chars} chars")

        detail_prompt = f"""Map exam topics to textbook resources.

TOPICS: {json.dumps(topic_names)}

Return ONLY:
[
    {{"topic": "...", "resource": "Ch 3.2-3.4 (pp. 45-67)", "estimated_hours": 2.0}}
]

TEXT:
{relevant_text}"""

        return get_text_response(detail_prompt)


class ChiefOrchestrator:
    """Synthesizes all agent outputs into an optimal day-by-day study schedule."""
    def generate_plan(self, courses_data: List[Dict], constraints: Dict):
        # Compress courses_data to minimal format
        compressed = []
        for cd in courses_data:
            course = cd.get("course", {})
            scope = cd.get("scope", {})
            guide = cd.get("guide", [])
            
            topics_summary = []
            for t in scope.get("topics", []):
                name = t.get("name", str(t)) if isinstance(t, dict) else str(t)
                importance = t.get("importance", "medium") if isinstance(t, dict) else "medium"
                # Find matching resource from guide
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
                "exam_date": scope.get("exam_date", course.get("examDate", "unknown")),
                "topics": topics_summary
            })
        
        today_str = datetime.now().strftime("%Y-%m-%d")
        tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        prompt = f"""Create a comprehensive study schedule.

COURSES:
{json.dumps(compressed)}

CONSTRAINTS:
- Weekday hours: {constraints.get('weekdayHours', 3)}
- Weekend hours: {constraints.get('weekendHours', 6)}
- No-study dates: {constraints.get('noStudyDates', [])}
- Today: {today_str}. Start: {tomorrow_str}.
- Last study day = 1 day before exam

RULES:
- Don't exceed daily hour budget
- Prioritize high-importance topics
- Schedule "learn" before "practice" for each topic
- Include "review" sessions before exams
- SPREAD TASKS EVENLY until the exam date. Do NOT bunch them all at the start.
- Include REST DAYS if the schedule allows (e.g. 1 rest day every 4-6 days) to prevent burnout.
- If finding the schedule too compressed, reduce daily hours or prioritize ONLY high/medium topics.

NOTES FORMAT for each task - be specific and actionable:
- Focus: What core concepts to understand deeply (be specific to the topic)
- Practice: Specific problem types or exercises to work through
- Memorize: Key formulas, definitions, or facts to commit to memory
- Self-Test: How to verify understanding (explain to someone, solve without notes, etc.)

Return JSON array:
[
    {{
        "date": "YYYY-MM-DD",
        "course": "CODE",
        "topic": "Topic Name",
        "task_type": "learn",
        "duration_hours": 2,
        "resources": "Chapter X, Section Y (pp. Z)",
        "notes": "Focus: [specific concept explanation] | Practice: [specific problem types] | Memorize: [specific formulas/definitions] | Self-Test: [specific verification method]"
    }}
]

Make the notes genuinely helpful for studying, not generic placeholders."""
        return get_text_response(prompt)
