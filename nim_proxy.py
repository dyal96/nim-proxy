import os
import json
import time
import sqlite3
import requests
from datetime import datetime, timedelta
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, HTMLResponse, FileResponse, JSONResponse, Response
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

# ─── Configuration ───────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "usage.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
ENV_PATH = os.path.join(BASE_DIR, ".env")

# Load .env manually
def load_env():
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                if line.strip() and not line.startswith('#'):
                    parts = line.strip().split('=', 1)
                    if len(parts) == 2:
                        key, val = parts
                        os.environ[key.strip()] = val.strip().strip('"').strip("'")

load_env()

NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY")
NVIDIA_BASE_URL = os.environ.get("UPSTREAM_BASE_URL", "https://integrate.api.nvidia.com/v1")
DEFAULT_NIM_MODEL = os.environ.get("NIM_MODEL", "meta/llama-3.1-70b-instruct")

# Global state
CURRENT_MODEL = DEFAULT_NIM_MODEL
SERVER_START_TIME = time.time()
VERSION = "2.0.0"

# ─── SQLite Setup ────────────────────────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT DEFAULT (datetime('now')),
            model TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            latency_ms REAL DEFAULT 0,
            source TEXT DEFAULT 'web'
        )
    """)
    conn.commit()
    conn.close()

def log_usage(model, input_tokens, output_tokens, latency_ms, source="web"):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute(
            "INSERT INTO usage (model, input_tokens, output_tokens, total_tokens, latency_ms, source) VALUES (?, ?, ?, ?, ?, ?)",
            (model, input_tokens, output_tokens, input_tokens + output_tokens, latency_ms, source)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB] Failed to log usage: {e}")

def detect_source(request: Request):
    ua = (request.headers.get("user-agent") or "").lower()
    auth = (request.headers.get("x-client-name") or "").lower()
    if "claude" in ua or "claude" in auth:
        return "claude-code"
    if "continue" in ua or "cline" in ua or "roo" in ua:
        return "vscode"
    if "crush" in ua or "crush" in auth:
        return "crush"
    if "antigravity" in ua or "antigravity" in auth:
        return "antigravity"
    # Check referer for web UI
    ref = (request.headers.get("referer") or "").lower()
    if "localhost" in ref and "/chat" in ref:
        return "web"
    return "api"

# ─── App Lifecycle ───────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    print(f"[NIM Proxy v{VERSION}] Database initialized at {DB_PATH}")
    yield

app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Static File Serving ─────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>NIM Proxy Running</h1><p>static/index.html not found</p>"

# Mount static files
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ─── Health & Status ─────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    uptime = time.time() - SERVER_START_TIME
    hours, remainder = divmod(int(uptime), 3600)
    minutes, seconds = divmod(remainder, 60)
    return {
        "status": "ok",
        "version": VERSION,
        "uptime": f"{hours}h {minutes}m {seconds}s",
        "current_model": CURRENT_MODEL,
        "key_set": bool(NVIDIA_API_KEY),
        "db_path": DB_PATH
    }

@app.get("/v1")
@app.api_route("/v1", methods=["HEAD", "OPTIONS"])
async def root_probe(request: Request):
    if request.method == "GET":
        return JSONResponse(
            content={
                "status": "ok",
                "current_model": CURRENT_MODEL,
                "key_set": bool(NVIDIA_API_KEY)
            },
            headers={"Allow": "GET, HEAD, OPTIONS"}
        )
    return Response(status_code=204, headers={"Allow": "GET, HEAD, OPTIONS"})

@app.api_route("/v1/messages", methods=["HEAD", "OPTIONS"])
async def probe_messages():
    return Response(status_code=204, headers={"Allow": "POST, HEAD, OPTIONS"})

@app.api_route("/v1/messages/count_tokens", methods=["HEAD", "OPTIONS"])
async def probe_count_tokens():
    return Response(status_code=204, headers={"Allow": "POST, HEAD, OPTIONS"})

@app.get("/api/metadata")
async def get_metadata():
    headers = {"Authorization": f"Bearer {NVIDIA_API_KEY}"}
    try:
        # Some NIM instances have /metadata or /manifest
        # We'll try /metadata first
        resp = requests.get(f"{NVIDIA_BASE_URL}/metadata", headers=headers, timeout=5)
        if resp.status_code == 200:
            return resp.json()
        return {"error": "Metadata not available", "status": resp.status_code}
    except Exception as e:
        return {"error": str(e)}

# ─── Model Management ────────────────────────────────────────────────────────

@app.get("/v1/models")
async def list_models():
    headers = {"Authorization": f"Bearer {NVIDIA_API_KEY}"}
    try:
        resp = requests.get(f"{NVIDIA_BASE_URL}/models", headers=headers, timeout=15)
        return resp.json()
    except Exception as e:
        return {"error": str(e)}

@app.post("/v1/update_model")
async def update_model(request: Request):
    global CURRENT_MODEL
    data = await request.json()
    new_model = data.get("model")
    if new_model:
        CURRENT_MODEL = new_model
        # Persist to .env
        update_env_var("NIM_MODEL", new_model)
        print(f"[Config] Updated active model to: {CURRENT_MODEL}")
        return {"status": "success", "model": CURRENT_MODEL}
    return {"status": "error", "message": "No model provided"}

@app.post("/v1/update_key")
async def update_key(request: Request):
    global NVIDIA_API_KEY
    data = await request.json()
    new_key = data.get("key")
    if new_key:
        NVIDIA_API_KEY = new_key
        update_env_var("NVIDIA_API_KEY", new_key)
        print("[Config] Updated NVIDIA API Key")
        return {"status": "success"}
    return {"status": "error", "message": "No key provided"}

# ─── Config CRUD ─────────────────────────────────────────────────────────────

def read_env_vars():
    env_vars = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                if line.strip() and not line.startswith('#'):
                    parts = line.strip().split('=', 1)
                    if len(parts) == 2:
                        env_vars[parts[0].strip()] = parts[1].strip().strip('"').strip("'")
    return env_vars

def update_env_var(key, value):
    env_vars = read_env_vars()
    env_vars[key] = value
    with open(ENV_PATH, "w") as f:
        for k, v in env_vars.items():
            f.write(f'{k}="{v}"\n')

@app.get("/api/config")
async def get_config():
    env_vars = read_env_vars()
    return {
        "nvidia_api_key": "•" * 8 + (env_vars.get("NVIDIA_API_KEY", "")[-8:] if env_vars.get("NVIDIA_API_KEY") else ""),
        "nvidia_api_key_set": bool(env_vars.get("NVIDIA_API_KEY")),
        "nim_model": CURRENT_MODEL,
        "base_url": NVIDIA_BASE_URL,
        "port": 8082,
        "version": VERSION,
        "default_temperature": float(env_vars.get("DEFAULT_TEMPERATURE", "1.0")),
        "default_max_tokens": int(env_vars.get("DEFAULT_MAX_TOKENS", "1024")),
        "default_top_p": float(env_vars.get("DEFAULT_TOP_P", "0.95")),
    }

@app.post("/api/config")
async def update_config(request: Request):
    global NVIDIA_API_KEY, CURRENT_MODEL
    data = await request.json()
    updated = []

    if "nvidia_api_key" in data and data["nvidia_api_key"]:
        NVIDIA_API_KEY = data["nvidia_api_key"]
        update_env_var("NVIDIA_API_KEY", data["nvidia_api_key"])
        updated.append("nvidia_api_key")

    if "nim_model" in data and data["nim_model"]:
        CURRENT_MODEL = data["nim_model"]
        update_env_var("NIM_MODEL", data["nim_model"])
        updated.append("nim_model")

    if "default_temperature" in data:
        update_env_var("DEFAULT_TEMPERATURE", str(data["default_temperature"]))
        updated.append("default_temperature")

    if "default_max_tokens" in data:
        update_env_var("DEFAULT_MAX_TOKENS", str(data["default_max_tokens"]))
        updated.append("default_max_tokens")

    if "default_top_p" in data:
        update_env_var("DEFAULT_TOP_P", str(data["default_top_p"]))
        updated.append("default_top_p")

    return {"status": "success", "updated": updated}

# ─── Usage Analytics ─────────────────────────────────────────────────────────

@app.get("/api/usage")
async def get_usage(period: str = "24h", limit: int = 100):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    period_map = {
        "1h": 1, "6h": 6, "24h": 24,
        "7d": 168, "30d": 720, "all": 0
    }
    hours = period_map.get(period, 24)

    if hours > 0:
        since = (datetime.utcnow() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
        c.execute("SELECT * FROM usage WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?", (since, limit))
    else:
        c.execute("SELECT * FROM usage ORDER BY timestamp DESC LIMIT ?", (limit,))

    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return {"data": rows, "period": period, "count": len(rows)}

@app.get("/api/usage/summary")
async def get_usage_summary(period: str = "24h"):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    period_map = {"1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720, "all": 0}
    hours = period_map.get(period, 24)

    if hours > 0:
        since = (datetime.utcnow() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
        where = f"WHERE timestamp >= '{since}'"
    else:
        where = ""

    # Total stats
    c.execute(f"SELECT COUNT(*) as total_requests, COALESCE(SUM(input_tokens),0) as total_input, COALESCE(SUM(output_tokens),0) as total_output, COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(AVG(latency_ms),0) as avg_latency FROM usage {where}")
    row = c.fetchone()
    total_requests, total_input, total_output, total_tokens, avg_latency = row

    # By model
    c.execute(f"SELECT model, COUNT(*) as count, SUM(total_tokens) as tokens FROM usage {where} GROUP BY model ORDER BY tokens DESC LIMIT 10")
    by_model = [{"model": r[0], "count": r[1], "tokens": r[2]} for r in c.fetchall()]

    # By source
    c.execute(f"SELECT source, COUNT(*) as count, SUM(total_tokens) as tokens FROM usage {where} GROUP BY source ORDER BY count DESC")
    by_source = [{"source": r[0], "count": r[1], "tokens": r[2]} for r in c.fetchall()]

    # Timeline (dynamic buckets for charts)
    if period == "1h":
        time_col = "strftime('%Y-%m-%d %H:%M:00', timestamp)"
    elif period in ["7d", "30d", "all"]:
        time_col = "strftime('%Y-%m-%d 00:00:00', timestamp)"
    else:
        time_col = "strftime('%Y-%m-%d %H:00:00', timestamp)"

    c.execute(f"SELECT {time_col} as hour, SUM(total_tokens) as tokens, COUNT(*) as requests FROM usage {where} GROUP BY hour ORDER BY hour")
    timeline = [{"hour": r[0], "tokens": r[1], "requests": r[2]} for r in c.fetchall()]

    conn.close()
    return {
        "period": period,
        "total_requests": total_requests,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_tokens": total_tokens,
        "avg_latency_ms": round(avg_latency, 1),
        "by_model": by_model,
        "by_source": by_source,
        "timeline": timeline
    }

@app.delete("/api/usage/purge")
async def purge_usage():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM usage")
    conn.commit()
    count = c.execute("SELECT changes()").fetchone()[0]
    conn.close()
    return {"status": "success", "deleted": count}

# ─── IDE Config Generator ───────────────────────────────────────────────────

@app.get("/api/ide-configs/{ide}")
async def get_ide_config(ide: str):
    host = "localhost"
    port = 8082
    model = CURRENT_MODEL
    model_short = model.split("/")[-1] if "/" in model else model

    configs = {
        "claude-code": {
            "name": "Claude Code",
            "description": "Environment variables for Claude Code CLI",
            "type": "shell",
            "powershell": f'$env:ANTHROPIC_BASE_URL="http://{host}:{port}/v1"\n$env:ANTHROPIC_API_KEY="sk-ant-dummy"\n# Active model: {model}\nclaude',
            "bash": f'export ANTHROPIC_BASE_URL="http://{host}:{port}/v1"\nexport ANTHROPIC_API_KEY="sk-ant-dummy"\n# Active model: {model}\nclaude',
            "instructions": "Paste these environment variables in your terminal before running 'claude'."
        },
        "vscode-continue": {
            "name": "VS Code — Continue",
            "description": "Add this to your Continue config.json",
            "type": "json",
            "config": json.dumps({
                "models": [{
                    "title": f"NVIDIA NIM — {model_short}",
                    "provider": "openai",
                    "model": model,
                    "apiBase": f"http://{host}:{port}/v1",
                    "apiKey": "sk-ant-dummy"
                }]
            }, indent=2),
            "instructions": "Add this block to your Continue extension's config.json file."
        },
        "vscode-cline": {
            "name": "VS Code — Cline / Roo Code",
            "description": "Settings for Cline or Roo Code extensions",
            "type": "json",
            "config": json.dumps({
                "provider": "anthropic",
                "baseUrl": f"http://{host}:{port}",
                "apiKey": "sk-ant-dummy",
                "model": model,
                "note": "The proxy translates Anthropic format to NVIDIA NIM automatically."
            }, indent=2),
            "instructions": "Set API Provider to 'Anthropic', paste the Base URL and API Key."
        },
        "crush": {
            "name": "Crush IDE",
            "description": "Complete .crush.json provider configuration",
            "type": "json",
            "config": json.dumps({
                "$schema": "https://charm.land/crush.json",
                "models": {
                    "large": {
                        "model": model,
                        "provider": "nim-local"
                    }
                },
                "providers": {
                    "nim-local": {
                        "name": "NVIDIA NIM (Local)",
                        "base_url": f"http://{host}:{port}/v1/",
                        "type": "openai-compat",
                        "api_key": "sk-ant-dummy",
                        "models": [{
                            "id": model,
                            "name": model_short,
                            "context_window": 128000,
                            "default_max_tokens": 8192
                        }]
                    }
                },
                "options": {"debug": True}
            }, indent=2),
            "instructions": "Save as .crush.json in your project root or global config directory."
        },
        "antigravity": {
            "name": "Antigravity",
            "description": "OpenAI-compatible provider configuration for Antigravity",
            "type": "json",
            "config": json.dumps({
                "provider": "openai-compat",
                "name": "NVIDIA NIM (Local Proxy)",
                "base_url": f"http://{host}:{port}/v1",
                "api_key": "sk-ant-dummy",
                "model": model,
                "context_window": 128000
            }, indent=2),
            "instructions": "Use these settings in your Antigravity provider configuration."
        }
    }

    if ide not in configs:
        return JSONResponse({"error": f"Unknown IDE: {ide}. Available: {list(configs.keys())}"}, status_code=404)

    return configs[ide]

@app.get("/api/ide-configs")
async def list_ide_configs():
    return {"available": ["claude-code", "vscode-continue", "vscode-cline", "crush", "antigravity"]}

# ─── Anthropic Messages Proxy ────────────────────────────────────────────────

@app.post("/v1/messages")
async def proxy_messages(request: Request):
    start_time = time.time()
    source = detect_source(request)
    anthropic_body = await request.json()

    model = anthropic_body.get("model", CURRENT_MODEL)
    if model.startswith("claude-"):
        model = CURRENT_MODEL

    # Read defaults from env
    env_vars = read_env_vars()
    default_temp = float(env_vars.get("DEFAULT_TEMPERATURE", "1.0"))
    default_max = int(env_vars.get("DEFAULT_MAX_TOKENS", "1024"))

    openai_body = {
        "model": model,
        "messages": [],
        "temperature": anthropic_body.get("temperature", default_temp),
        "max_tokens": anthropic_body.get("max_tokens", default_max),
        "stream": anthropic_body.get("stream", True),
        "stream_options": {"include_usage": True} if anthropic_body.get("stream", True) else None
    }

    # System prompt
    if "system" in anthropic_body:
        system_content = anthropic_body["system"]
        if isinstance(system_content, list):
            system_text = "".join([c.get("text", "") for c in system_content if c.get("type") == "text"])
            openai_body["messages"].append({"role": "system", "content": system_text})
        else:
            openai_body["messages"].append({"role": "system", "content": system_content})

    # Convert messages
    for msg in anthropic_body.get("messages", []):
        content = msg.get("content")
        if isinstance(content, list):
            text_parts = []
            for c in content:
                if c.get("type") == "text":
                    text_parts.append(c.get("text", ""))
                elif c.get("type") == "tool_result":
                    # Basic mapping for tool results back to OpenAI format
                    text_parts.append(f"[Tool Result: {c.get('content', '')}]")
            openai_body["messages"].append({"role": msg["role"], "content": "".join(text_parts)})
        else:
            openai_body["messages"].append({"role": msg["role"], "content": content})

    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if openai_body["stream"] else "application/json"
    }

    print(f"[Proxy] {source} -> {model} (stream={openai_body['stream']})")

    # Shared mutable state for usage tracking in streaming
    usage_data = {"input_tokens": 0, "output_tokens": 0}

    def event_generator():
        ttft = 0
        tokens_sent = 0
        thinking_mode = False
        
        try:
            with requests.post(f"{NVIDIA_BASE_URL}/chat/completions", headers=headers, json=openai_body, stream=True) as r:
                if r.status_code != 200:
                    error_text = r.text
                    print(f"[Error] Upstream API ({r.status_code}): {error_text}")
                    yield "data: " + json.dumps({"type": "error", "error": {"type": "api_error", "message": f"Upstream Error: {error_text}"}}) + "\n\n"
                    return

                yield "event: message_start\n"
                yield "data: " + json.dumps({"type": "message_start", "message": {"id": f"msg_{os.urandom(4).hex()}", "type": "message", "role": "assistant", "content": [], "model": model, "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 0, "output_tokens": 0}}}) + "\n\n"

                active_block_index = -1
                active_block_type = None # "text", "tool_use", "thinking"
                
                def start_block(idx, btype, **kwargs):
                    nonlocal active_block_index, active_block_type
                    active_block_index = idx
                    active_block_type = btype
                    content_block = {"type": btype}
                    if btype == "text":
                        content_block["text"] = ""
                    elif btype == "thinking":
                        content_block["thinking"] = ""
                    elif btype == "tool_use":
                        content_block["id"] = kwargs.get("id", f"tool_{os.urandom(4).hex()}")
                        content_block["name"] = kwargs.get("name", "")
                        content_block["input"] = {}
                    
                    return "event: content_block_start\ndata: " + json.dumps({"type": "content_block_start", "index": idx, "content_block": content_block}) + "\n\n"

                def stop_block():
                    nonlocal active_block_index, active_block_type
                    if active_block_index >= 0:
                        res = "event: content_block_stop\ndata: " + json.dumps({"type": "content_block_stop", "index": active_block_index}) + "\n\n"
                        active_block_index = -1
                        active_block_type = None
                        return res
                    return ""

                for line in r.iter_lines():
                    if line:
                        if ttft == 0:
                            ttft = (time.time() - start_time) * 1000
                        
                        line_str = line.decode('utf-8')
                        if line_str.startswith("data: "):
                            data_content = line_str[6:]
                            if data_content.strip() == "[DONE]":
                                break

                            try:
                                chunk = json.loads(data_content)
                                if not chunk.get("choices"):
                                    if chunk.get("usage"):
                                        usage_data["input_tokens"] = chunk["usage"].get("prompt_tokens", 0)
                                        usage_data["output_tokens"] = chunk["usage"].get("completion_tokens", 0)
                                    continue
                                
                                delta = chunk["choices"][0].get("delta", {})
                                
                                # Handle reasoning_content (Direct support for DeepSeek-R1 style)
                                reasoning = delta.get("reasoning_content")
                                if reasoning:
                                    if active_block_type != "thinking":
                                        yield stop_block()
                                        yield start_block(active_block_index + 1, "thinking")
                                    yield "event: content_block_delta\ndata: " + json.dumps({"type": "content_block_delta", "index": active_block_index, "delta": {"type": "thinking_delta", "thinking": reasoning}}) + "\n\n"

                                # Handle Text Content
                                content = delta.get("content")
                                if content:
                                    # Simple heuristic for <think> tags in models that don't use reasoning_content field
                                    if "<think>" in content:
                                        thinking_mode = True
                                        content = content.replace("<think>", "")
                                        if active_block_type != "thinking":
                                            yield stop_block()
                                            yield start_block(active_block_index + 1, "thinking")
                                    
                                    if "</think>" in content:
                                        thinking_mode = False
                                        content = content.replace("</think>", "")
                                        yield stop_block()
                                    
                                    if thinking_mode:
                                        if active_block_type != "thinking":
                                            yield stop_block()
                                            yield start_block(active_block_index + 1, "thinking")
                                        yield "event: content_block_delta\ndata: " + json.dumps({"type": "content_block_delta", "index": active_block_index, "delta": {"type": "thinking_delta", "thinking": content}}) + "\n\n"
                                    else:
                                        if active_block_type != "text":
                                            yield stop_block()
                                            yield start_block(active_block_index + 1, "text")
                                        
                                        yield "event: content_block_delta\n"
                                        yield "data: " + json.dumps({
                                            "type": "content_block_delta",
                                            "index": active_block_index,
                                            "delta": {"type": "text_delta", "text": content}
                                        }) + "\n\n"
                                        tokens_sent += 1

                                # Handle Tool Calls
                                if delta.get("tool_calls"):
                                    for tc in delta["tool_calls"]:
                                        if tc.get("function", {}).get("name"):
                                            yield stop_block()
                                            yield start_block(active_block_index + 1, "tool_use", name=tc["function"]["name"], id=tc.get("id"))
                                        
                                        if tc.get("function", {}).get("arguments"):
                                            yield "event: content_block_delta\n"
                                            yield "data: " + json.dumps({
                                                "type": "content_block_delta",
                                                "index": active_block_index,
                                                "delta": {"type": "input_json_delta", "partial_json": tc["function"]["arguments"]}
                                            }) + "\n\n"

                                if chunk.get("usage"):
                                    usage = chunk["usage"]
                                    usage_data["input_tokens"] = usage.get("prompt_tokens", 0)
                                    usage_data["output_tokens"] = usage.get("completion_tokens", 0)
                                    yield "event: message_delta\n"
                                    yield "data: " + json.dumps({
                                        "type": "message_delta",
                                        "usage": {
                                            "input_tokens": usage_data["input_tokens"],
                                            "output_tokens": usage_data["output_tokens"]
                                        }
                                    }) + "\n\n"
                            except Exception as e:
                                print(f"[Error] Parsing chunk: {e}")

                yield stop_block()

                latency = (time.time() - start_time) * 1000
                tps = (usage_data["output_tokens"] / (latency / 1000)) if latency > 0 else 0
                
                yield "event: message_delta\n"
                yield "data: " + json.dumps({
                    "type": "message_delta", 
                    "delta": {"stop_reason": "end_turn", "stop_sequence": None}, 
                    "usage": {
                        "input_tokens": usage_data["input_tokens"],
                        "output_tokens": usage_data["output_tokens"]
                    },
                    "metrics": {
                        "ttft_ms": round(ttft, 2),
                        "latency_ms": round(latency, 2),
                        "tps": round(tps, 2)
                    }
                }) + "\n\n"

                yield "event: message_stop\n"
                yield "data: " + json.dumps({"type": "message_stop"}) + "\n\n"

                # Log usage after streaming completes
                latency = (time.time() - start_time) * 1000
                log_usage(model, usage_data["input_tokens"], usage_data["output_tokens"], latency, source)

        except Exception as e:
            print(f"[Error] Proxy internal: {e}")
            yield "data: " + json.dumps({"type": "error", "error": {"type": "api_error", "message": str(e)}}) + "\n\n"

    if openai_body["stream"]:
        return StreamingResponse(event_generator(), media_type="text/event-stream")
    else:
        resp = requests.post(f"{NVIDIA_BASE_URL}/chat/completions", headers=headers, json=openai_body)
        latency = (time.time() - start_time) * 1000

        if resp.status_code != 200:
            print(f"[Error] NVIDIA API ({resp.status_code}): {resp.text}")
            return {"type": "error", "error": {"type": "api_error", "message": resp.text}}

        nim_data = resp.json()
        input_t = nim_data.get("usage", {}).get("prompt_tokens", 0)
        output_t = nim_data.get("usage", {}).get("completion_tokens", 0)
        log_usage(model, input_t, output_t, latency, source)

        return {
            "id": nim_data["id"],
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": nim_data["choices"][0]["message"]["content"]}],
            "model": nim_data["model"],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": input_t, "output_tokens": output_t}
        }

# ─── OpenAI Passthrough Proxy ────────────────────────────────────────────────

@app.post("/v1/chat/completions")
async def proxy_openai(request: Request):
    start_time = time.time()
    source = detect_source(request)
    openai_body = await request.json()

    if "model" not in openai_body or openai_body["model"].startswith("gpt-"):
        openai_body["model"] = CURRENT_MODEL

    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Content-Type": "application/json"
    }

    print(f"[Proxy] {source} -> {openai_body['model']} (OpenAI format)")

    if openai_body.get("stream"):
        usage_data = {"input_tokens": 0, "output_tokens": 0}

        def stream_passthrough():
            with requests.post(f"{NVIDIA_BASE_URL}/chat/completions", headers=headers, json=openai_body, stream=True) as r:
                for line in r.iter_lines():
                    if line:
                        line_str = line.decode('utf-8')
                        # Try to extract usage from stream chunks
                        if line_str.startswith("data: ") and line_str[6:].strip() != "[DONE]":
                            try:
                                chunk = json.loads(line_str[6:])
                                if chunk.get("usage"):
                                    usage_data["input_tokens"] = chunk["usage"].get("prompt_tokens", 0)
                                    usage_data["output_tokens"] = chunk["usage"].get("completion_tokens", 0)
                            except:
                                pass
                        yield line_str + "\n\n"

            latency = (time.time() - start_time) * 1000
            log_usage(openai_body["model"], usage_data["input_tokens"], usage_data["output_tokens"], latency, source)

        return StreamingResponse(stream_passthrough(), media_type="text/event-stream")
    else:
        resp = requests.post(f"{NVIDIA_BASE_URL}/chat/completions", headers=headers, json=openai_body)
        latency = (time.time() - start_time) * 1000
        data = resp.json()

        input_t = data.get("usage", {}).get("prompt_tokens", 0)
        output_t = data.get("usage", {}).get("completion_tokens", 0)
        log_usage(openai_body["model"], input_t, output_t, latency, source)

        return data

# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"==========================================")
    print(f"  NIM Proxy v{VERSION}")
    print(f"  http://localhost:8082")
    print(f"  Model: {CURRENT_MODEL}")
    print(f"==========================================")
    uvicorn.run(app, host="0.0.0.0", port=8082)
