import asyncio
import os
import time
from typing import Callable, Optional, Dict, Any, List

from backend.config import STT_CONFIG
from faster_whisper import WhisperModel

model = None
model_lock = asyncio.Lock()

should_stop = False
current_file = None
transcription_progress = {}
pause_event = asyncio.Event()
pause_event.set()


def normalize_path(file_path: str) -> str:
    try:
        return os.path.normcase(os.path.abspath(file_path))
    except Exception:
        return file_path


async def get_model():
    global model
    if model is None:
        async with model_lock:
            if model is None:
                model = WhisperModel(model_size_or_path=STT_CONFIG["whisper_model"])
    return model


async def transcribe_audio(
    file_path: str,
    on_update: Optional[Callable[[list, Optional[Dict[str, Any]]], None]] = None,
    start_offset: Optional[float] = None,
    initial_transcription: Optional[List[Dict[str, Any]]] = None,
) -> list:
    global should_stop, current_file, transcription_progress
    should_stop = False
    normalized_path = normalize_path(file_path)
    current_file = normalized_path
    pause_event.set()

    try:
        stt_model = await get_model()
        clip_timestamps = None
        if start_offset is not None and start_offset > 0:
            clip_timestamps = [float(start_offset)]
        segments_generator = stt_model.transcribe(file_path, beam_size=STT_CONFIG["beam_size"],
                                                  temperature=STT_CONFIG["temperature"],
                                                  language=STT_CONFIG["language"],
                                                  vad_filter=STT_CONFIG["vad_filter"],
                                                  condition_on_previous_text=STT_CONFIG["condition_on_previous_text"],
                                                  clip_timestamps=clip_timestamps or "0")

        transcription = list(initial_transcription) if initial_transcription else []
        segments, info = segments_generator
        duration = getattr(info, "duration", None)
        initial_current = float(start_offset or 0.0)
        initial_progress = None
        if duration and duration > 0:
            initial_progress = min((initial_current / duration) * 100.0, 100.0)
        transcription_progress[normalized_path] = {
            "progress": initial_progress if duration else None,
            "duration": duration,
            "current": initial_current,
            "status": "transcribing",
        }
        last_save_time = time.monotonic()
        segment_count = 0

        for segment in segments:
            await pause_event.wait()
            if should_stop:
                if normalized_path in transcription_progress:
                    transcription_progress[normalized_path]["status"] = "interrupted"
                current_file = None
                raise asyncio.CancelledError("Transcription cancelled")

            current = segment.end
            if duration and duration > 0:
                progress = min((current / duration) * 100.0, 100.0)
            else:
                progress = None
            if normalized_path in transcription_progress:
                transcription_progress[normalized_path].update({
                    "progress": progress,
                    "current": current,
                    "status": "transcribing",
                })
            transcription.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text
            })
            segment_count += 1
            if on_update:
                now = time.monotonic()
                if segment_count == 1 or segment_count % 5 == 0 or (now - last_save_time) >= 2.0:
                    try:
                        on_update(transcription, {
                            "progress": progress,
                            "current": current,
                            "duration": duration,
                        })
                    except Exception:
                        pass
                    last_save_time = now

            await asyncio.sleep(0)

        if on_update:
            try:
                on_update(transcription, {
                    "progress": 100.0 if duration else transcription_progress[normalized_path]["progress"],
                    "current": duration or transcription_progress[normalized_path]["current"],
                    "duration": duration,
                })
            except Exception:
                pass
        if normalized_path in transcription_progress:
            transcription_progress[normalized_path].update({
                "progress": 100.0 if duration else transcription_progress[normalized_path]["progress"],
                "current": duration or transcription_progress[normalized_path]["current"],
                "status": "done",
            })
        current_file = None
        return transcription

    except asyncio.CancelledError:
        should_stop = True
        if normalized_path in transcription_progress:
            transcription_progress[normalized_path]["status"] = "interrupted"
        current_file = None
        raise
    finally:
        should_stop = False
        current_file = None


def stop_transcription():
    global should_stop, current_file, transcription_progress
    should_stop = True
    if current_file and current_file in transcription_progress:
        transcription_progress[current_file]["status"] = "interrupted"


def pause_transcription():
    if current_file and current_file in transcription_progress:
        transcription_progress[current_file]["status"] = "paused"
    pause_event.clear()


def resume_transcription():
    if current_file and current_file in transcription_progress:
        transcription_progress[current_file]["status"] = "transcribing"
    pause_event.set()


def is_file_being_transcribed(file_path: str) -> bool:
    """检查指定文件是否正在被转录"""
    return current_file == normalize_path(file_path)


def get_transcription_progress(file_path: str):
    return transcription_progress.get(normalize_path(file_path))
