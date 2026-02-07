import os
import shutil
import uuid
import json
import asyncio
from datetime import datetime
from typing import List, Optional, Dict
from dotenv import load_dotenv

# Load environment variables FIRST before other imports
ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
load_dotenv(dotenv_path=ENV_PATH)
if not os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("GEMINI_API_KEY")
_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or ""
print(f"[ENV] Loaded .env.local from: {ENV_PATH}")
print(f"[ENV] API key suffix: {_key[-4:] if _key else 'none'}")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agents import analyze_course, generate_plan as generate_plan_agent, CourseInput, MODEL_FAST, LOW_QUOTA_MODE

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
    key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or ""
    return {
        "status": "healthy",
        "api_key_configured": bool(key),
        "model": MODEL_FAST,
        "low_quota_mode": LOW_QUOTA_MODE,
        "key_suffix": key[-4:] if key else ""
    }

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
async def start_plan(request: PlanRequest):
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

    all_course_data: List[Dict] = []
    total_courses = len(request.courses)

    try:
        for idx, course in enumerate(request.courses):
            course_input = CourseInput(id=course.id, code=course.code, name=course.name, examDate=course.examDate)
            course_data = await analyze_course(sessionId, course_input, log_fn=add_log)
            all_course_data.append(course_data)
            add_log(sessionId, "System", f"Course {idx + 1}/{total_courses} fully analyzed: {course.code}", "success")

        final_plan = await generate_plan_agent(sessionId, all_course_data, request.constraints.dict(), log_fn=add_log)

        # Inject courseColor into each task
        for task in final_plan:
            if isinstance(task, dict) and "courseColor" not in task:
                task["courseColor"] = course_color_map.get(task.get("course", ""), "#4a5d45")

        session_results[sessionId] = final_plan

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
        add_log(sessionId, "System", f"Error: {error_msg}", "error")
        # Store error as result so frontend stops polling
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
