import sqlite3
import os
import json
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "videochat.db")
LOCK_STALE_SECONDS = 30


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                url TEXT NOT NULL,
                status TEXT NOT NULL,
                transcription TEXT,
                summary TEXT,
                detailed_summary TEXT,
                mindmap_data TEXT,
                file_size INTEGER,
                file_hash TEXT,
                duration REAL,
                transcribe_elapsed REAL,
                transcribe_progress REAL,
                transcribe_progress_current REAL,
                transcribe_progress_duration REAL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        ensure_file_size_column(conn)
        ensure_file_hash_column(conn)
        ensure_detailed_summary_column(conn)
        ensure_transcribe_elapsed_column(conn)
        ensure_transcribe_progress_column(conn)
        ensure_transcribe_progress_current_column(conn)
        ensure_transcribe_progress_duration_column(conn)
        ensure_transcription_lock_table(conn)
        backfill_file_sizes(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS merged_summaries (
                selection_key TEXT PRIMARY KEY,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS merged_detailed_summaries (
                selection_key TEXT PRIMARY KEY,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS merged_mindmaps (
                selection_key TEXT PRIMARY KEY,
                mindmap TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_histories (
                context_key TEXT PRIMARY KEY,
                messages TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_file_size_column(conn):
    columns = [row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()]
    if "file_size" not in columns:
        conn.execute("ALTER TABLE files ADD COLUMN file_size INTEGER")

def ensure_file_hash_column(conn):
    columns = [row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()]
    if "file_hash" not in columns:
        conn.execute("ALTER TABLE files ADD COLUMN file_hash TEXT")


def ensure_detailed_summary_column(conn):
    columns = [row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()]
    if "detailed_summary" not in columns:
        conn.execute("ALTER TABLE files ADD COLUMN detailed_summary TEXT")


def ensure_transcribe_elapsed_column(conn):
    columns = [row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()]
    if "transcribe_elapsed" not in columns:
        conn.execute("ALTER TABLE files ADD COLUMN transcribe_elapsed REAL")

def ensure_transcribe_progress_column(conn):
    columns = [row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()]
    if "transcribe_progress" not in columns:
        conn.execute("ALTER TABLE files ADD COLUMN transcribe_progress REAL")

def ensure_transcribe_progress_current_column(conn):
    columns = [row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()]
    if "transcribe_progress_current" not in columns:
        conn.execute("ALTER TABLE files ADD COLUMN transcribe_progress_current REAL")

def ensure_transcribe_progress_duration_column(conn):
    columns = [row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()]
    if "transcribe_progress_duration" not in columns:
        conn.execute("ALTER TABLE files ADD COLUMN transcribe_progress_duration REAL")


def ensure_transcription_lock_table(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS transcription_lock (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            owner TEXT,
            updated_at TEXT
        )
        """
    )
    conn.execute(
        "INSERT OR IGNORE INTO transcription_lock (id, owner, updated_at) VALUES (1, NULL, NULL)"
    )


def backfill_file_sizes(conn):
    rows = conn.execute("SELECT id, stored_name FROM files WHERE file_size IS NULL").fetchall()
    for row in rows:
        file_path = os.path.join(BASE_DIR, "..", "uploads", row["stored_name"])
        if os.path.exists(file_path):
            size = os.path.getsize(file_path)
            conn.execute("UPDATE files SET file_size = ? WHERE id = ?", (size, row["id"]))


def try_acquire_transcription_lock(owner: str) -> bool:
    conn = get_connection()
    try:
        now = datetime.utcnow()
        now_value = now.isoformat()
        stale_before = (now - timedelta(seconds=LOCK_STALE_SECONDS)).isoformat()
        cursor = conn.execute(
            """
            UPDATE transcription_lock
            SET owner = ?, updated_at = ?
            WHERE id = 1 AND (owner IS NULL OR owner = ? OR updated_at IS NULL OR updated_at <= ?)
            """,
            (owner, now_value, owner, stale_before),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def touch_transcription_lock(owner: str) -> None:
    conn = get_connection()
    try:
        now = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE transcription_lock SET updated_at = ? WHERE id = 1 AND owner = ?",
            (now, owner),
        )
        conn.commit()
    finally:
        conn.close()


def release_transcription_lock(owner: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE transcription_lock SET owner = NULL, updated_at = NULL WHERE id = 1 AND owner = ?",
            (owner,),
        )
        conn.commit()
    finally:
        conn.close()


def row_to_file(row, include_transcription: bool = True):
    if not row:
        return None
    transcription = None
    if include_transcription:
        transcription = json.loads(row["transcription"]) if row["transcription"] else None
    has_transcription = row["has_transcription"] if "has_transcription" in row.keys() else None
    if has_transcription is None:
        has_transcription = bool(transcription)
    return {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "storedName": row["stored_name"],
        "url": row["url"],
        "status": row["status"],
        "transcription": transcription,
        "hasTranscription": bool(has_transcription),
        "summary": row["summary"] or "",
        "detailedSummary": row["detailed_summary"] or "",
        "mindmapData": row["mindmap_data"],
        "fileSize": row["file_size"] or 0,
        "fileHash": row["file_hash"],
        "duration": row["duration"] or 0,
        "transcribeElapsed": row["transcribe_elapsed"],
        "transcribeProgress": row["transcribe_progress"],
        "transcribeProgressCurrent": row["transcribe_progress_current"],
        "transcribeProgressDuration": row["transcribe_progress_duration"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_files(page: int = 1, page_size: int = 10, include_transcription: bool = True):
    conn = get_connection()
    try:
        offset = max(page - 1, 0) * page_size
        if include_transcription:
            rows = conn.execute(
                "SELECT * FROM files ORDER BY created_at ASC LIMIT ? OFFSET ?",
                (page_size, offset),
            ).fetchall()
            return [row_to_file(row, include_transcription=True) for row in rows]
        rows = conn.execute(
            """
            SELECT
                id, name, type, stored_name, url, status, summary, detailed_summary,
                mindmap_data, file_size, file_hash, duration, transcribe_elapsed,
                transcribe_progress, transcribe_progress_current, transcribe_progress_duration,
                created_at, updated_at,
                CASE WHEN transcription IS NOT NULL AND LENGTH(transcription) > 0 THEN 1 ELSE 0 END AS has_transcription
            FROM files
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
            """
            ,
            (page_size, offset),
        ).fetchall()
        return [row_to_file(row, include_transcription=False) for row in rows]
    finally:
        conn.close()


def count_files():
    conn = get_connection()
    try:
        row = conn.execute("SELECT COUNT(1) AS total FROM files").fetchone()
        return int(row["total"] if row and row["total"] is not None else 0)
    finally:
        conn.close()


def get_next_queued_file():
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM files WHERE status = ? ORDER BY updated_at ASC, created_at ASC LIMIT 1",
            ("queued",),
        ).fetchone()
        return row_to_file(row, include_transcription=True)
    finally:
        conn.close()


def update_status_by_status(from_status: str, to_status: str):
    conn = get_connection()
    try:
        now = datetime.utcnow().isoformat()
        cursor = conn.execute(
            "UPDATE files SET status = ?, updated_at = ? WHERE status = ?",
            (to_status, now, from_status),
        )
        conn.commit()
        return cursor.rowcount
    finally:
        conn.close()


def get_file(file_id: str):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        return row_to_file(row, include_transcription=True)
    finally:
        conn.close()


def find_duplicate_file(name: str, file_size: int, file_hash: str = None):
    conn = get_connection()
    try:
        row = None
        if file_hash:
            row = conn.execute(
                "SELECT * FROM files WHERE file_hash = ? LIMIT 1",
                (file_hash,),
            ).fetchone()
        if not row:
            row = conn.execute(
                "SELECT * FROM files WHERE name = ? AND file_size = ? LIMIT 1",
                (name, file_size),
            ).fetchone()
        return row_to_file(row)
    finally:
        conn.close()


def find_file_by_path(stored_name: str):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM files WHERE stored_name = ? LIMIT 1",
            (stored_name,),
        ).fetchone()
        return row_to_file(row)
    finally:
        conn.close()


def insert_file(file_data: dict):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO files (
                id, name, type, stored_name, url, status,
                transcription, summary, detailed_summary, mindmap_data,
                file_size, file_hash, duration, transcribe_elapsed,
                transcribe_progress, transcribe_progress_current, transcribe_progress_duration,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file_data["id"],
                file_data["name"],
                file_data["type"],
                file_data["storedName"],
                file_data["url"],
                file_data["status"],
                file_data.get("transcription"),
                file_data.get("summary", ""),
                file_data.get("detailedSummary", ""),
                file_data.get("mindmapData"),
                file_data.get("fileSize", 0),
                file_data.get("fileHash"),
                file_data.get("duration", 0),
                file_data.get("transcribeElapsed"),
                file_data.get("transcribeProgress"),
                file_data.get("transcribeProgressCurrent"),
                file_data.get("transcribeProgressDuration"),
                now,
                now,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def update_file(file_id: str, fields: dict):
    if not fields:
        return
    updated_fields = fields.copy()
    updated_fields["updated_at"] = datetime.utcnow().isoformat()
    keys = list(updated_fields.keys())
    values = [updated_fields[key] for key in keys]
    set_clause = ", ".join([f"{key} = ?" for key in keys])
    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE files SET {set_clause} WHERE id = ?",
            (*values, file_id),
        )
        conn.commit()
    finally:
        conn.close()


def delete_file_with_related(file_id: str):
    conn = get_connection()
    try:
        row = conn.execute("SELECT stored_name FROM files WHERE id = ?", (file_id,)).fetchone()
        conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
        patterns = [
            file_id,
            f"{file_id}|%",
            f"%|{file_id}",
            f"%|{file_id}|%",
        ]
        conn.execute(
            """
            DELETE FROM merged_summaries
            WHERE selection_key = ?
               OR selection_key LIKE ?
               OR selection_key LIKE ?
               OR selection_key LIKE ?
            """,
            patterns,
        )
        conn.execute(
            """
            DELETE FROM merged_detailed_summaries
            WHERE selection_key = ?
               OR selection_key LIKE ?
               OR selection_key LIKE ?
               OR selection_key LIKE ?
            """,
            patterns,
        )
        conn.execute(
            """
            DELETE FROM merged_mindmaps
            WHERE selection_key = ?
               OR selection_key LIKE ?
               OR selection_key LIKE ?
               OR selection_key LIKE ?
            """,
            patterns,
        )
        chat_patterns = [
            file_id,
            f"merged:{file_id}",
            f"merged:{file_id}|%",
            f"merged:%|{file_id}",
            f"merged:%|{file_id}|%",
        ]
        conn.execute(
            """
            DELETE FROM chat_histories
            WHERE context_key = ?
               OR context_key = ?
               OR context_key LIKE ?
               OR context_key LIKE ?
               OR context_key LIKE ?
            """,
            chat_patterns,
        )
        conn.commit()
    finally:
        conn.close()
    return row["stored_name"] if row else None


def get_merged_summary(selection_key: str):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT summary FROM merged_summaries WHERE selection_key = ?",
            (selection_key,),
        ).fetchone()
        return row["summary"] if row else None
    finally:
        conn.close()


def upsert_merged_summary(selection_key: str, summary: str):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO merged_summaries (selection_key, summary, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(selection_key)
            DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at
            """,
            (selection_key, summary, now, now),
        )
        conn.commit()
    finally:
        conn.close()


def get_merged_detailed_summary(selection_key: str):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT summary FROM merged_detailed_summaries WHERE selection_key = ?",
            (selection_key,),
        ).fetchone()
        return row["summary"] if row else None
    finally:
        conn.close()


def upsert_merged_detailed_summary(selection_key: str, summary: str):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO merged_detailed_summaries (selection_key, summary, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(selection_key)
            DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at
            """,
            (selection_key, summary, now, now),
        )
        conn.commit()
    finally:
        conn.close()


def get_merged_mindmap(selection_key: str):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT mindmap FROM merged_mindmaps WHERE selection_key = ?",
            (selection_key,),
        ).fetchone()
        return row["mindmap"] if row else None
    finally:
        conn.close()


def upsert_merged_mindmap(selection_key: str, mindmap: str):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO merged_mindmaps (selection_key, mindmap, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(selection_key)
            DO UPDATE SET mindmap = excluded.mindmap, updated_at = excluded.updated_at
            """,
            (selection_key, mindmap, now, now),
        )
        conn.commit()
    finally:
        conn.close()


def get_chat_history(context_key: str):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT messages FROM chat_histories WHERE context_key = ?",
            (context_key,),
        ).fetchone()
        if not row:
            return None
        return json.loads(row["messages"]) if row["messages"] else []
    finally:
        conn.close()


def upsert_chat_history(context_key: str, messages):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO chat_histories (context_key, messages, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(context_key)
            DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at
            """,
            (context_key, json.dumps(messages, ensure_ascii=False), now, now),
        )
        conn.commit()
    finally:
        conn.close()
