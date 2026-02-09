import asyncio

from backend.config import STT_CONFIG
from faster_whisper import WhisperModel

model = None
model_lock = asyncio.Lock()

should_stop = False
current_file = None
transcription_progress = {}


async def get_model():
    global model
    if model is None:
        async with model_lock:
            if model is None:
                model = WhisperModel(model_size_or_path=STT_CONFIG["whisper_model"])
    return model


async def transcribe_audio(file_path: str) -> list:
    global should_stop, current_file, transcription_progress
    should_stop = False
    current_file = file_path

    try:
        stt_model = await get_model()
        segments_generator = stt_model.transcribe(file_path, beam_size=STT_CONFIG["beam_size"],
                                                  temperature=STT_CONFIG["temperature"],
                                                  language=STT_CONFIG["language"],
                                                  vad_filter=STT_CONFIG["vad_filter"],
                                                  condition_on_previous_text=STT_CONFIG["condition_on_previous_text"])

        transcription = []
        segments, info = segments_generator
        duration = getattr(info, "duration", None)
        transcription_progress[file_path] = {
            "progress": 0.0 if duration else None,
            "duration": duration,
            "current": 0.0,
            "status": "transcribing",
        }

        for segment in segments:
            if should_stop:
                if file_path in transcription_progress:
                    transcription_progress[file_path]["status"] = "interrupted"
                current_file = None
                raise asyncio.CancelledError("Transcription cancelled")

            transcription.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text
            })
            if file_path in transcription_progress:
                current = segment.end
                if duration and duration > 0:
                    progress = min((current / duration) * 100.0, 100.0)
                else:
                    progress = None
                transcription_progress[file_path].update({
                    "progress": progress,
                    "current": current,
                    "status": "transcribing",
                })

            await asyncio.sleep(0)

        if file_path in transcription_progress:
            transcription_progress[file_path].update({
                "progress": 100.0 if duration else transcription_progress[file_path]["progress"],
                "current": duration or transcription_progress[file_path]["current"],
                "status": "done",
            })
        current_file = None
        return transcription

    except asyncio.CancelledError:
        should_stop = True
        if file_path in transcription_progress:
            transcription_progress[file_path]["status"] = "interrupted"
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


def is_file_being_transcribed(file_path: str) -> bool:
    """检查指定文件是否正在被转录"""
    return current_file == file_path


def get_transcription_progress(file_path: str):
    return transcription_progress.get(file_path)
