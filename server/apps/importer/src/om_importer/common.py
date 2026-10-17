import hashlib
import uuid
from datetime import date, datetime, timezone

VERSION = "1.0.0"


def scalar(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def package(path, profile):
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "schema_version": VERSION,
        "import_id": str(uuid.uuid4()),
        "source": {"filename": path.name, "sha256": checksum, "file_type": path.suffix[1:].lower()},
        "extraction": {"engine_version": "0.2.0", "profile": profile,
                       "extracted_at": datetime.now(timezone.utc).isoformat(), "metadata": {}},
        "resource": {"name": "Cemetery register" if profile == "cemetery_v1" else "Parish announcements",
                     "proposed_table": "dr_" + profile + "_" + checksum[:12], "columns": []},
        "source_blocks": [], "records": [], "issues": [],
        "review_status": "needs_review", "revision": 1, "audit": [],
    }


def issue(p, code, message, block_id, record_id=None, severity="warning"):
    item = {"id": f"issue-{len(p['issues']) + 1}", "code": code,
            "severity": severity, "message": message, "block_id": block_id,
            "record_id": record_id, "status": "open"}
    p["issues"].append(item)
    return item


def record(p, block, normalized, start=None, end=None):
    loc = dict(block["location"])
    raw = block["raw"]
    if isinstance(raw, str):
        start = 0 if start is None else start
        end = len(raw) if end is None else end
        loc.update(char_start=start, char_end=end)
        raw = raw[start:end]
    key = hashlib.sha256((p['source']['sha256'] + block['id'] + str(loc)
                          + str(len(p['records']))).encode()).hexdigest()
    r = {"id": key, "block_id": block["id"], "source_location": loc,
         "original": raw, "normalized": normalized, "review_status": "needs_review"}
    p["records"].append(r)
    return r


def columns(p, definitions):
    p["resource"]["columns"] = [{"name": name, "sql_type": sql_type, "nullable": True}
                                   for name, sql_type in definitions.items()]
