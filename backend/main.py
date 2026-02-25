from fastapi import FastAPI, UploadFile, File, HTTPException, Body, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import os
import ctypes
import tempfile
from datetime import datetime
import time
import logging
import hashlib
from backend.services.stt_service import transcribe_audio, stop_transcription, is_file_being_transcribed, get_transcription_progress
from backend.services.ai_service import generate_summary, generate_mindmap, chat_with_model, generate_detailed_summary
from backend.models import ChatMessage, ChatRequest
import asyncio
import uuid
import json
from backend.db import init_db, list_files, get_file, insert_file, update_file, delete_file_with_related, get_merged_summary, upsert_merged_summary, get_merged_detailed_summary, upsert_merged_detailed_summary, find_duplicate_file, get_merged_mindmap, upsert_merged_mindmap, get_chat_history, upsert_chat_history

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("videochat")

app = FastAPI()

async def persist_upload_file(file: UploadFile, destination: str, compute_hash: bool = False):
    file_size = 0
    hasher = hashlib.sha256() if compute_hash else None
    try:
        with open(destination, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                buffer.write(chunk)
                file_size += len(chunk)
                if hasher:
                    hasher.update(chunk)
    finally:
        await file.close()
    return file_size, hasher.hexdigest() if hasher else None

def sanitize_filename(filename: Optional[str]) -> str:
    if not filename:
        return ""
    base = os.path.basename(filename)
    base = base.replace("\\", "_").replace("/", "_")
    return base.strip()

def schedule_delete_on_reboot(file_path: str) -> bool:
    if os.name != "nt":
        return False
    try:
        move_file_ex = ctypes.windll.kernel32.MoveFileExW
        move_file_ex.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
        move_file_ex.restype = ctypes.c_bool
        return bool(move_file_ex(file_path, None, 0x00000004))
    except Exception:
        return False

def retry_delete_file(file_path: str, attempts: int = 8, delay_seconds: float = 1.0):
    for _ in range(attempts):
        if not os.path.exists(file_path):
            return
        try:
            os.remove(file_path)
            return
        except (PermissionError, OSError):
            time.sleep(delay_seconds)
    if os.path.exists(file_path):
        schedule_delete_on_reboot(file_path)

async def cancel_transcription_for_file(file_id: str, file_path: str):
    global transcription_task, current_transcribing_id
    if not transcription_task:
        return
    if current_transcribing_id != file_id and not is_file_being_transcribed(file_path):
        return
    stop_transcription()
    if not transcription_task.cancelled():
        transcription_task.cancel()
    try:
        await asyncio.wait_for(transcription_task, timeout=1.5)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        pass
    transcription_task = None
    current_transcribing_id = None

# 添加静态文件服务
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    client = request.client.host if request.client else "-"
    query = request.url.query
    content_length = request.headers.get("content-length", "-")
    try:
        response = await call_next(request)
        elapsed_ms = (time.time() - start_time) * 1000
        logger.info(
            "method=%s path=%s query=%s status=%s client=%s content_length=%s elapsed_ms=%.2f",
            request.method,
            request.url.path,
            query,
            response.status_code,
            client,
            content_length,
            elapsed_ms,
        )
        return response
    except Exception:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.exception(
            "method=%s path=%s query=%s status=500 client=%s content_length=%s elapsed_ms=%.2f",
            request.method,
            request.url.path,
            query,
            client,
            content_length,
            elapsed_ms,
        )
        raise

# 添加一个变量来跟踪转录任务
transcription_task = None
current_transcribing_id = None

class TextRequest(BaseModel):
    text: str


class MergedSummaryRequest(BaseModel):
    selectionKey: str
    summary: str


class MergedDetailedSummaryRequest(BaseModel):
    selectionKey: str
    summary: str


class MergedMindmapRequest(BaseModel):
    selectionKey: str
    mindmap: str


class ChatHistoryRequest(BaseModel):
    contextKey: str
    messages: List[ChatMessage]


@app.on_event("startup")
async def startup_event():
    init_db()

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    global transcription_task
    try:
        os.makedirs("uploads", exist_ok=True)
        content_type = file.content_type or ""
        if not (content_type.startswith("video/") or content_type.startswith("audio/")):
            raise HTTPException(status_code=400, detail="Unsupported file type")
        safe_name = sanitize_filename(file.filename)
        if not safe_name:
            raise HTTPException(status_code=400, detail="Invalid filename")
        file_id = uuid.uuid4().hex
        stored_name = f"{file_id}_{safe_name}"
        file_path = os.path.join("uploads", stored_name)
        await persist_upload_file(file, file_path)
        
        transcription_task = asyncio.create_task(transcribe_audio(file_path))
        try:
            transcription = await transcription_task
            transcription_task = None
            return {"transcription": transcription}
            
        except asyncio.CancelledError:
            if not transcription_task.cancelled():
                transcription_task.cancel()
            transcription_task = None
            return JSONResponse(
                status_code=499,
                content={"status": "interrupted", "detail": "Transcription interrupted"}
            )
            
    except asyncio.CancelledError:
        return JSONResponse(
            status_code=499,
            content={"status": "interrupted", "detail": "Transcription interrupted"}
        )
    except Exception as e:
        if transcription_task and not transcription_task.cancelled():
            transcription_task.cancel()
        transcription_task = None
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/files")
async def get_files():
    return {"files": list_files()}


@app.get("/api/merged-summary/{selection_key}")
async def get_merged_summary_record(selection_key: str):
    summary = get_merged_summary(selection_key)
    if summary is None:
        raise HTTPException(status_code=404, detail="Merged summary not found")
    return {"summary": summary}


@app.post("/api/merged-summary")
async def save_merged_summary(request: MergedSummaryRequest):
    if not request.selectionKey:
        raise HTTPException(status_code=400, detail="selectionKey is required")
    upsert_merged_summary(request.selectionKey, request.summary or "")
    return {"message": "Merged summary saved"}


@app.get("/api/merged-detailed-summary/{selection_key}")
async def get_merged_detailed_summary_record(selection_key: str):
    summary = get_merged_detailed_summary(selection_key)
    if summary is None:
        raise HTTPException(status_code=404, detail="Merged detailed summary not found")
    return {"summary": summary}


@app.get("/api/merged-detailed-summary")
async def get_merged_detailed_summary_by_query(selectionKey: Optional[str] = None):
    if not selectionKey:
        raise HTTPException(status_code=400, detail="selectionKey is required")
    summary = get_merged_detailed_summary(selectionKey)
    if summary is None:
        raise HTTPException(status_code=404, detail="Merged detailed summary not found")
    return {"summary": summary}


@app.post("/api/merged-detailed-summary")
async def save_merged_detailed_summary(request: MergedDetailedSummaryRequest):
    if not request.selectionKey:
        raise HTTPException(status_code=400, detail="selectionKey is required")
    upsert_merged_detailed_summary(request.selectionKey, request.summary or "")
    return {"message": "Merged detailed summary saved"}


@app.get("/api/merged-mindmap/{selection_key}")
async def get_merged_mindmap_record(selection_key: str):
    mindmap = get_merged_mindmap(selection_key)
    if mindmap is None:
        raise HTTPException(status_code=404, detail="Merged mindmap not found")
    return {"mindmap": mindmap}


@app.post("/api/merged-mindmap")
async def save_merged_mindmap(request: MergedMindmapRequest):
    if not request.selectionKey:
        raise HTTPException(status_code=400, detail="selectionKey is required")
    upsert_merged_mindmap(request.selectionKey, request.mindmap or "")
    return {"message": "Merged mindmap saved"}


@app.post("/api/files/upload")
async def upload_file_record(file: UploadFile = File(...)):
    try:
        os.makedirs("uploads", exist_ok=True)
        content_type = file.content_type or ""
        if not (content_type.startswith("video/") or content_type.startswith("audio/")):
            raise HTTPException(status_code=400, detail="Unsupported file type")
        safe_name = sanitize_filename(file.filename)
        if not safe_name:
            raise HTTPException(status_code=400, detail="Invalid filename")
        file_id = uuid.uuid4().hex
        stored_name = f"{file_id}_{safe_name}"
        file_path = os.path.join("uploads", stored_name)
        file_size, file_hash = await persist_upload_file(file, file_path, compute_hash=True)
        existing = find_duplicate_file(safe_name, file_size, file_hash)
        if existing:
            try:
                os.remove(file_path)
            except OSError:
                pass
            return {"skipped": True, "file": existing}

        file_type = "video" if content_type.startswith("video/") else "audio"
        record = {
            "id": file_id,
            "name": safe_name,
            "type": file_type,
            "storedName": stored_name,
            "url": f"/uploads/{stored_name}",
            "status": "waiting",
            "transcription": None,
            "summary": "",
            "detailedSummary": "",
            "mindmapData": None,
            "fileSize": file_size,
            "fileHash": file_hash,
            "duration": 0,
            "transcribeElapsed": None,
        }
        insert_file(record)
        return record
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/files/{file_id}")
async def remove_file(file_id: str, background_tasks: BackgroundTasks):
    stored_name = delete_file_with_related(file_id)
    if stored_name is None:
        raise HTTPException(status_code=404, detail="File not found")
    if stored_name:
        file_path = os.path.join("uploads", stored_name)
        if os.path.exists(file_path):
            await cancel_transcription_for_file(file_id, file_path)
            try:
                os.remove(file_path)
            except (PermissionError, OSError):
                deleted = False
                for _ in range(3):
                    await asyncio.sleep(0.2)
                    try:
                        os.remove(file_path)
                        deleted = True
                        break
                    except (PermissionError, OSError):
                        pass
                if not deleted:
                    pending_path = os.path.join("uploads", f".pending_delete_{file_id}_{uuid.uuid4().hex}")
                    try:
                        os.replace(file_path, pending_path)
                        background_tasks.add_task(retry_delete_file, pending_path, 12, 1.0)
                        return {"message": "File deleted", "warning": "File is in use and will be removed later"}
                    except (PermissionError, OSError):
                        background_tasks.add_task(retry_delete_file, file_path, 12, 1.0)
                        if schedule_delete_on_reboot(file_path):
                            return {"message": "File deleted", "warning": "File is scheduled for deletion on reboot"}
                        return {"message": "File deleted", "warning": "File is in use and will be removed later"}
    return {"message": "File deleted"}


@app.post("/api/files/{file_id}/transcribe")
async def transcribe_file(file_id: str):
    global transcription_task, current_transcribing_id
    file_record = get_file(file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = os.path.join("uploads", file_record["storedName"])
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    start_time = time.monotonic()
    update_file(file_id, {"status": "transcribing", "transcribe_elapsed": None})
    current_transcribing_id = file_id
    transcription_task = asyncio.create_task(transcribe_audio(file_path))

    try:
        transcription = await transcription_task
        transcription_task = None
        current_transcribing_id = None
        elapsed = time.monotonic() - start_time
        update_file(file_id, {"status": "done", "transcription": json.dumps(transcription), "transcribe_elapsed": elapsed})
        return {"transcription": transcription}
    except asyncio.CancelledError:
        if not transcription_task.cancelled():
            transcription_task.cancel()
        transcription_task = None
        current_transcribing_id = None
        elapsed = time.monotonic() - start_time
        update_file(file_id, {"status": "interrupted", "transcribe_elapsed": elapsed})
        return JSONResponse(
            status_code=499,
            content={"status": "interrupted", "detail": "Transcription interrupted"}
        )
    except Exception as e:
        if transcription_task and not transcription_task.cancelled():
            transcription_task.cancel()
        transcription_task = None
        current_transcribing_id = None
        elapsed = time.monotonic() - start_time
        update_file(file_id, {"status": "error", "transcribe_elapsed": elapsed})
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/files/{file_id}/transcribe-progress")
async def get_transcribe_progress(file_id: str):
    file_record = get_file(file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = os.path.join("uploads", file_record["storedName"])
    progress = get_transcription_progress(file_path)
    if not progress:
        return {"progress": None, "status": file_record["status"]}
    return {
        "progress": progress.get("progress"),
        "duration": progress.get("duration"),
        "current": progress.get("current"),
        "status": progress.get("status"),
    }


@app.post("/api/files/{file_id}/summary")
async def summary_by_file(file_id: str):
    file_record = get_file(file_id)
    if not file_record or not file_record.get("transcription"):
        raise HTTPException(status_code=400, detail="No transcription data provided")

    text = "\n".join(segment["text"] for segment in file_record["transcription"])

    async def generate():
        summary_text = ""
        async for chunk in generate_summary(text):
            summary_text += chunk
            yield chunk
        update_file(file_id, {"summary": summary_text})

    return StreamingResponse(generate(), media_type="text/plain")


@app.post("/api/files/{file_id}/detailed-summary")
async def detailed_summary_by_file(file_id: str):
    file_record = get_file(file_id)
    if not file_record or not file_record.get("transcription"):
        raise HTTPException(status_code=400, detail="No transcription data provided")

    text = "\n".join(segment["text"] for segment in file_record["transcription"])

    async def generate():
        summary_text = ""
        async for chunk in generate_detailed_summary(text):
            summary_text += chunk
            yield chunk
        update_file(file_id, {"detailed_summary": summary_text})

    return StreamingResponse(generate(), media_type="text/plain")


@app.post("/api/files/{file_id}/mindmap")
async def mindmap_by_file(file_id: str):
    file_record = get_file(file_id)
    if not file_record or not file_record.get("transcription"):
        raise HTTPException(status_code=400, detail="No transcription data provided")

    text = "\n".join(segment["text"] for segment in file_record["transcription"])
    try:
        mindmap_json = await generate_mindmap(text)
        update_file(file_id, {"mindmap_data": mindmap_json})
        return {"mindmap": mindmap_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/summary")
async def get_summary(request: TextRequest):
    async def generate():
        async for chunk in generate_summary(request.text):
            yield chunk

    return StreamingResponse(generate(), media_type="text/plain")

@app.post("/api/mindmap")
async def get_mindmap(request: TextRequest):
    try:
        mindmap_json = await generate_mindmap(request.text)
        return {"mindmap": mindmap_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat(request: ChatRequest):
    async def generate():
        async for chunk in chat_with_model(request.messages, request.context):
            yield chunk

    return StreamingResponse(generate(), media_type="text/plain")


@app.get("/api/chat-history/{context_key}")
async def get_chat_history_record(context_key: str):
    history = get_chat_history(context_key)
    if history is None:
        raise HTTPException(status_code=404, detail="Chat history not found")
    return {"messages": history}


@app.post("/api/chat-history")
async def save_chat_history(request: ChatHistoryRequest):
    if not request.contextKey:
        raise HTTPException(status_code=400, detail="contextKey is required")
    messages = [message.dict() for message in request.messages]
    upsert_chat_history(request.contextKey, messages)
    return {"message": "Chat history saved"}

@app.post("/api/detailed-summary")
async def get_detailed_summary(request: TextRequest):
    async def generate():
        async for chunk in generate_detailed_summary(request.text):
            yield chunk

    return StreamingResponse(generate(), media_type="text/plain")

@app.post("/api/export/summary")
async def export_summary(summary: str = Body(...)):
    try:
        # 生成文件名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"summary_{timestamp}.md"
        
        # 创建临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix=".md") as temp_file:
            temp_file.write(summary.encode('utf-8'))
            temp_file.flush()
            
            return FileResponse(
                path=temp_file.name,
                filename=filename,
                media_type="text/markdown",
                background=None
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def generate_vtt(transcription):
    vtt_content = "WEBVTT\n\n"
    for segment in transcription:
        start = format_timestamp(segment['start'])
        end = format_timestamp(segment['end'])
        vtt_content += f"{start} --> {end}\n{segment['text']}\n\n"
    return vtt_content

def generate_srt(transcription):
    srt_content = ""
    for i, segment in enumerate(transcription, 1):
        start = format_timestamp(segment['start'], srt=True)
        end = format_timestamp(segment['end'], srt=True)
        srt_content += f"{i}\n{start} --> {end}\n{segment['text']}\n\n"
    return srt_content

def generate_txt(transcription):
    return "\n".join(segment['text'] for segment in transcription)

def format_timestamp(seconds, srt=False):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    msecs = int((seconds - int(seconds)) * 1000)
    
    if srt:
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{msecs:03d}"
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{msecs:03d}"

@app.post("/api/export/{format}")
async def export_transcription(format: str, transcription: List[dict]):
    if not transcription:
        raise HTTPException(status_code=400, detail="No transcription data provided")
    
    try:
        # 创建临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{format}") as temp_file:
            content = ""
            if format == "vtt":
                content = generate_vtt(transcription)
                mime_type = "text/vtt"
            elif format == "srt":
                content = generate_srt(transcription)
                mime_type = "application/x-subrip"
            elif format == "txt":
                content = generate_txt(transcription)
                mime_type = "text/plain"
            else:
                raise HTTPException(status_code=400, detail="Unsupported format")
            
            temp_file.write(content.encode('utf-8'))
            temp_file.flush()
            
            # 生成文件名
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"transcription_{timestamp}.{format}"
            
            # 返回文件
            return FileResponse(
                path=temp_file.name,
                filename=filename,
                media_type=mime_type,
                background=None  # 立即发送文件
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/stop-transcribe")
async def stop_transcribe():
    global transcription_task, current_transcribing_id
    try:
        # 先设置停止标志
        stop_transcription()
        
        if transcription_task and not transcription_task.cancelled():
            # 取消正在进行的转录任务
            transcription_task.cancel()
            try:
                await asyncio.wait_for(transcription_task, timeout=0.5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            transcription_task = None
        if current_transcribing_id:
            update_file(current_transcribing_id, {"status": "interrupted"})
            current_transcribing_id = None
            
        return {"message": "Transcription stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) 
