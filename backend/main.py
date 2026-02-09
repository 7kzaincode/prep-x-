import os
import shutil
import uuid
import json
import asyncio
from datetime import datetime
from typing import List, Optional, Dict
from dotenv import load_dotenv

# Load environment variables FIRST before other imports
load_dotenv(dotenv_path="../.env.local")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agents import analyze_syllabus, analyze_exam_scope, analyze_textbook, generate_study_plan

app = FastAPI(title="prep(x) API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
UPLOAD_DIR = "sessions"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory storage for logs and results
session_logs: Dict[str, List[Dict]] = {}
session_results: Dict[str, List] = {}
# SSE event queues per session for real-time streaming
session_queues: Dict[str, List[asyncio.Queue]] = {}

# Models
class CourseUpdate(BaseModel):
    id: str
    code: str
    name: str
    examDate: str = ""  # Optional — auto-extracted from midterm overview if empty

class Constraints(BaseModel):
    weekdayHours: float
    weekendHours: float
    noStudyDates: List[str]
    reviewFrequency: str

class PlanRequest(BaseModel):
    sessionId: str
    courses: List[CourseUpdate]
    constraints: Constraints

@app.get("/health")
async def health_check():
    return {"status": "healthy", "api_key_configured": bool(os.getenv("GEMINI_API_KEY"))}

@app.post("/api/upload")
async def upload_file(
    sessionId: str = Form(...),
    courseCode: str = Form(...),
    docType: str = Form(...),
    file: UploadFile = File(...)
):
    session_path = os.path.join(UPLOAD_DIR, sessionId, courseCode, docType)
    os.makedirs(session_path, exist_ok=True)

    file_path = os.path.join(session_path, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {
        "id": str(uuid.uuid4()),
        "name": file.filename,
        "path": file_path,
        "status": "complete"
    }

@app.post("/api/plan")
async def generate_plan(request: PlanRequest):
    sessionId = request.sessionId
    session_logs[sessionId] = []
    session_queues[sessionId] = []

    # Run agentic workflow in background
    asyncio.create_task(run_agent_workflow(request))

    return {"message": "Plan generation started", "sessionId": sessionId}

@app.get("/api/plan/{sessionId}/logs")
async def get_logs(sessionId: str):
    return session_logs.get(sessionId, [])

@app.get("/api/plan/{sessionId}/result")
async def get_result(sessionId: str):
    if sessionId in session_results:
        return session_results[sessionId]
    return {"status": "processing"}

@app.get("/api/plan/{sessionId}/stream")
async def stream_logs(sessionId: str):
    """SSE endpoint for real-time agent log streaming."""
    queue: asyncio.Queue = asyncio.Queue()

    # Register this client's queue
    if sessionId not in session_queues:
        session_queues[sessionId] = []
    session_queues[sessionId].append(queue)

    # Send any existing logs first (catchup)
    existing_logs = session_logs.get(sessionId, [])
    for log in existing_logs:
        await queue.put(log)

    async def event_generator():
        try:
            while True:
                try:
                    log = await asyncio.wait_for(queue.get(), timeout=30.0)
                    # Check for completion signal
                    if log.get("_done"):
                        data = json.dumps(log)
                        yield f"data: {data}\n\n"
                        break
                    data = json.dumps(log)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield f": keepalive\n\n"
        finally:
            # Cleanup queue on disconnect
            if sessionId in session_queues and queue in session_queues[sessionId]:
                session_queues[sessionId].remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

async def run_agent_workflow(request: PlanRequest):
    sessionId = request.sessionId

    # Build course color map from frontend data
    COURSE_COLORS = ['#4a5d45', '#8c7851', '#51688c', '#8c5151', '#518c86']
    course_color_map = {}
    for i, course in enumerate(request.courses):
        course_color_map[course.code] = COURSE_COLORS[i % len(COURSE_COLORS)]

    all_course_data = []
    total_courses = len(request.courses)

    try:
        for idx, course in enumerate(request.courses):
            course_num = idx + 1
            course_dir_key = course.id

            # 1. Syllabus analysis (ADK agent)
            add_log(sessionId, "SyllabusExpert", f"Analyzing syllabus for {course.code}...", "loading")
            syllabus_dir = os.path.join(UPLOAD_DIR, sessionId, course_dir_key, "syllabus")
            syllabus_files = [os.path.join(syllabus_dir, f) for f in os.listdir(syllabus_dir)] if os.path.exists(syllabus_dir) else []

            syllabus_info = await analyze_syllabus(syllabus_files) if syllabus_files else {"course_name": course.name}
            modules = syllabus_info.get('modules', [])
            add_log(sessionId, "SyllabusExpert", f"Syllabus extracted for {course.code} — {len(modules)} modules identified.", "success")

            # 2. Exam scope analysis (ADK agent)
            add_log(sessionId, "ExamScopeAnalyst", f"Analyzing midterm overview for {course.code}...", "loading")
            overview_dir = os.path.join(UPLOAD_DIR, sessionId, course_dir_key, "midterm_overview")
            overview_files = [os.path.join(overview_dir, f) for f in os.listdir(overview_dir)] if os.path.exists(overview_dir) else []

            scope_info = await analyze_exam_scope(overview_files) if overview_files else {"topics": []}
            topics = scope_info.get("topics", [])
            topics_count = len(topics)

            # Extract exam date from midterm overview (auto-detect)
            extracted_exam_date = scope_info.get("exam_date", "")
            if extracted_exam_date and extracted_exam_date.lower() in ("unknown", "n/a", "none", ""):
                extracted_exam_date = ""
            resolved_exam_date = course.examDate if course.examDate else extracted_exam_date
            if resolved_exam_date:
                add_log(sessionId, "ExamScopeAnalyst",
                    f"Exam date for {course.code}: {resolved_exam_date}" +
                    (" (from midterm overview)" if not course.examDate else " (manual override)"),
                    "success")

            # Fallback: if scope returned 0 topics, use syllabus modules as topics
            if topics_count == 0 and modules:
                add_log(sessionId, "ExamScopeAnalyst", f"No topics from midterm overview — falling back to {len(modules)} syllabus modules as topics.", "loading")
                fallback_topics = []
                for m in modules:
                    if isinstance(m, dict):
                        for t in m.get("topics", []):
                            fallback_topics.append({"name": t, "importance": "medium"})
                        if not m.get("topics") and m.get("name"):
                            fallback_topics.append({"name": m["name"], "importance": "medium"})
                if fallback_topics:
                    scope_info["topics"] = fallback_topics
                    topics = fallback_topics
                    topics_count = len(topics)
                    add_log(sessionId, "ExamScopeAnalyst", f"Fallback: {topics_count} topics derived from syllabus modules.", "success")

            # Show topic names in the log
            topic_names = [t.get("name", t) if isinstance(t, dict) else t for t in topics[:4]]
            topic_preview = ", ".join(topic_names)
            if topics_count > 4:
                topic_preview += f" (+{topics_count - 4} more)"
            add_log(sessionId, "ExamScopeAnalyst", f"Exam scope for {course.code}: {topics_count} topics — {topic_preview}", "success")

            # 3. Textbook analysis — two-pass: TocNavigator → StudyGuideGuru (ADK agents with tools)
            add_log(sessionId, "TocNavigator", f"Scanning textbook TOC for {course.code} to find relevant chapters...", "loading")
            textbook_dir = os.path.join(UPLOAD_DIR, sessionId, course_dir_key, "textbook")
            textbook_files = [os.path.join(textbook_dir, f) for f in os.listdir(textbook_dir)] if os.path.exists(textbook_dir) else []

            if textbook_files:
                guide_info = await analyze_textbook(textbook_files, scope_info.get("topics", []))
                add_log(sessionId, "TocNavigator", f"TOC scan complete for {course.code}.", "success")
            else:
                guide_info = []
                add_log(sessionId, "TocNavigator", f"No textbook uploaded for {course.code} — skipping.", "success")

            guide_count = len(guide_info) if isinstance(guide_info, list) else 0
            total_hours = 0
            if isinstance(guide_info, list):
                for g in guide_info:
                    if isinstance(g, dict):
                        total_hours += g.get("estimated_hours", 0)
            add_log(sessionId, "StudyGuideGuru", f"Resource mapping for {course.code}: {guide_count} topics mapped, ~{total_hours:.1f}h estimated.", "success")

            add_log(sessionId, "System", f"Course {course_num}/{total_courses} fully analyzed: {course.code}", "success")

            course_dict = course.dict()
            course_dict["examDate"] = resolved_exam_date

            all_course_data.append({
                "course": course_dict,
                "syllabus": syllabus_info,
                "scope": scope_info,
                "guide": guide_info
            })

        # Final orchestration (ADK agent)
        total_est = sum(
            sum(g.get("estimated_hours", 0) for g in cd.get("guide", []) if isinstance(g, dict))
            for cd in all_course_data
        )
        add_log(sessionId, "ChiefOrchestrator", f"Synthesizing schedule across {total_courses} courses (~{total_est:.0f}h of content)...", "loading")
        final_plan = await generate_study_plan(all_course_data, request.constraints.dict())

        # Inject courseColor into each task
        if isinstance(final_plan, list):
            for task in final_plan:
                if isinstance(task, dict) and "courseColor" not in task:
                    task["courseColor"] = course_color_map.get(task.get("course", ""), "#4a5d45")

        session_results[sessionId] = final_plan
        task_count = len(final_plan) if isinstance(final_plan, list) else 0
        add_log(sessionId, "ChiefOrchestrator", f"Plan complete — {task_count} study sessions scheduled across {len(set(t.get('date','') for t in final_plan if isinstance(t,dict)))} days.", "success")

        # Send done signal through SSE
        broadcast_log(sessionId, {
            "_done": True,
            "agent": "System",
            "message": "All agents finished.",
            "timestamp": datetime.now().strftime("%I:%M:%S %p"),
            "status": "success"
        })

    except Exception as e:
        error_msg = str(e)
        print(f"[ERROR] Agent workflow failed: {error_msg}")
        import traceback
        traceback.print_exc()
        add_log(sessionId, "System", f"Error: {error_msg}", "error")
        session_results[sessionId] = {"error": error_msg}
        broadcast_log(sessionId, {
            "_done": True,
            "agent": "System",
            "message": f"Pipeline failed: {error_msg}",
            "timestamp": datetime.now().strftime("%I:%M:%S %p"),
            "status": "error"
        })

def add_log(sessionId: str, agent: str, message: str, status: str):
    if sessionId not in session_logs:
        session_logs[sessionId] = []
    log_entry = {
        "agent": agent,
        "message": message,
        "timestamp": datetime.now().strftime("%I:%M:%S %p"),
        "status": status
    }
    session_logs[sessionId].append(log_entry)
    broadcast_log(sessionId, log_entry)

def broadcast_log(sessionId: str, log_entry: dict):
    """Push log to all SSE clients listening on this session."""
    if sessionId in session_queues:
        for queue in session_queues[sessionId]:
            try:
                queue.put_nowait(log_entry)
            except asyncio.QueueFull:
                pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
