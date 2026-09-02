"""
KudaVas Audio Transcription Server
Chạy script này trước khi dùng extension.
Lắng nghe port 8765, nhận audio URL → trả về transcript.

Cách chạy:
    pip install openai-whisper fastapi uvicorn
    python whisper_server.py

API:
    POST /transcribe
    Body: {"url": "https://..."}  hoặc {"path": "D:/audio.mp3"}

Response:
    {"success": true, "text": "...", "language": "vi"}
"""

import os
import tempfile
import time
import threading
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any

import requests
import uvicorn
import whisper
import os
import re
from fastapi import Header, HTTPException

# Cache {key: {"text": str, "ts": epoch}}.
# Key = entry_id (vd "0_abc123") nếu có, fallback = sha1(url)[:16].
# Nhiều câu hỏi dùng chung 1 audio → chỉ transcribe 1 lần.
TRANSCRIPT_CACHE: Dict[str, Dict[str, Any]] = {}
TRANSCRIPT_TTL = 60 * 60 * 24  # 24h

# Cache answer {qhash: {"answer": ..., "ts": epoch}}
ANSWER_CACHE: Dict[str, Dict[str, Any]] = {}
ANSWER_TTL = 60 * 60 * 24  # 24h

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

try:
    from openai import OpenAI
    _openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
except Exception:
    OpenAI = None
    _openai_client = None

# ── Config ──────────────────────────────────────────────────────────
HOST = "127.0.0.1"
PORT = 8765
WHISPER_MODEL = "base"  # tiny / base / small / medium / large
PLAYWRIGHT_ENABLED = True  # Bật True nếu muốn dùng /extract-and-transcribe
# ──────────────────────────────────────────────────────────────────


# Load model once at startup (thread-safe)
print(f"[Whisper] Loading model '{WHISPER_MODEL}'...")
_model: Optional[any] = None
_model_lock = threading.Lock()


def get_model():
    global _model
    with _model_lock:
        if _model is None:
            _model = whisper.load_model(WHISPER_MODEL)
        return _model


def download_hls(m3u8_url: str, tmp_dir: Path) -> Optional[Path]:
    """
    Parse HLS playlist (.m3u8), chọn variant cao nhất, tải về file mp3/ts ghép lại.
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://cdnapisec.kaltura.com/",
        }
        # Lấy playlist
        resp = requests.get(m3u8_url, headers=headers, timeout=30)
        resp.raise_for_status()
        lines = resp.text.strip().splitlines()

        base_url = m3u8_url.rsplit("/", 1)[0] + "/"
        # Master playlist: tìm #EXT-X-STREAM-INF có BANDWIDTH cao nhất
        best_url = None
        best_bw = -1
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.startswith("#EXT-X-STREAM-INF"):
                # parse BANDWIDTH
                import re as _re
                bw_match = _re.search(r"BANDWIDTH=(\d+)", line)
                bw = int(bw_match.group(1)) if bw_match else 0
                if i + 1 < len(lines):
                    candidate = lines[i + 1].strip()
                    if not candidate.startswith("#"):
                        if bw > best_bw:
                            best_bw = bw
                            # resolve relative
                            from urllib.parse import urljoin
                            best_url = urljoin(base_url, candidate)
                i += 2
                continue
            i += 1

        if best_url:
            print(f"[Whisper] HLS best variant ({best_bw} bps): {best_url[:100]}")
            # Recurse - có thể best_url vẫn là master, hoặc là media playlist
            if best_url.endswith(".m3u8"):
                # Thử tải thẳng các segment (giả định media playlist đơn giản)
                seg_resp = requests.get(best_url, headers=headers, timeout=30)
                seg_resp.raise_for_status()
                seg_lines = seg_resp.text.strip().splitlines()
                seg_urls = [l.strip() for l in seg_lines if l.strip() and not l.startswith("#")]
                if not seg_urls:
                    return None
                from urllib.parse import urljoin
                seg_base = best_url.rsplit("/", 1)[0] + "/"
                out_path = tmp_dir / f"audio_{int(time.time()*1000)}.ts"
                with open(out_path, "wb") as out:
                    for su in seg_urls[:200]:  # cap 200 segments
                        full = urljoin(seg_base, su)
                        r = requests.get(full, headers=headers, timeout=30)
                        if r.ok:
                            out.write(r.content)
                return out_path if out_path.stat().st_size > 1024 else None
            else:
                # .mp4 / .m4s - tải thẳng
                r = requests.get(best_url, headers=headers, timeout=60, stream=True)
                r.raise_for_status()
                out_path = tmp_dir / f"audio_{int(time.time()*1000)}.mp4"
                with open(out_path, "wb") as f:
                    for chunk in r.iter_content(8192):
                        f.write(chunk)
                return out_path
        return None
    except Exception as e:
        print(f"[Whisper] HLS download failed: {e}")
        return None


def download_audio(url: str, tmp_dir: Path) -> Optional[Path]:
    """Tải audio từ URL, trả về đường dẫn file tạm."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Referer": "https://cdnapisec.kaltura.com/",
        }
        resp = requests.get(url, headers=headers, timeout=30, stream=True, allow_redirects=True)
        resp.raise_for_status()

        # Detect extension
        content_type = resp.headers.get("Content-Type", "").lower()
        ctype_path = url.lower().split("?")[0]

        if "audio/wav" in content_type or ctype_path.endswith(".wav"):
            ext = "wav"
        elif "audio/ogg" in content_type or ctype_path.endswith(".ogg"):
            ext = "ogg"
        elif "audio/x-m4a" in content_type or "audio/m4a" in content_type or ctype_path.endswith(".m4a"):
            ext = "m4a"
        elif "audio/webm" in content_type or ctype_path.endswith(".webm"):
            ext = "webm"
        elif "audio/aac" in content_type or ctype_path.endswith(".aac"):
            ext = "aac"
        elif "mpegurl" in content_type or ctype_path.endswith(".m3u8"):
            # HLS playlist - return as-is, caller will pick best variant later
            ext = "m3u8"
        elif "video/mp4" in content_type or ctype_path.endswith(".mp4"):
            ext = "mp4"
        elif "audio/mpeg" in content_type or ctype_path.endswith(".mp3"):
            ext = "mp3"
        else:
            ext = "mp3"  # fallback

        filename = tmp_dir / f"audio_{int(time.time()*1000)}.{ext}"
        with open(filename, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)

        # Sanity check: nếu file quá nhỏ hoặc là HTML thì fail
        size = filename.stat().st_size
        with open(filename, "rb") as f:
            head = f.read(32)
        is_html = head.lstrip().startswith(b"<!") or head.lstrip().startswith(b"<html") or b"<html" in head.lower()
        if size < 1024:
            print(f"[Whisper] File quá nhỏ ({size} bytes), có thể không phải audio")
            filename.unlink(missing_ok=True)
            return None
        if is_html:
            print(f"[Whisper] File là HTML, không phải audio")
            filename.unlink(missing_ok=True)
            return None

        print(f"[Whisper] Downloaded: {filename.name} ({size/1024:.1f} KB, type={content_type or '?'})")
        return filename

    except Exception as e:
        print(f"[Whisper] Download failed: {e}")
        return None


def transcribe_file(audio_path: Path, language: Optional[str] = "vi") -> dict:
    """Chạy Whisper trên file audio."""
    try:
        model = get_model()
        result = model.transcribe(
            str(audio_path),
            language=language if language != "auto" else None,
            task="transcribe",
            verbose=False,
            fp16=False,
        )
        text = (result.get("text") or "").strip()
        if not text:
            return {
                "success": False,
                "text": "",
                "error": f"Whisper trả về rỗng (segments={len(result.get('segments', []))})",
            }
        return {
            "success": True,
            "text": text,
            "language": result.get("language", language or "unknown"),
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "text": "", "error": str(e)}


# ── FastAPI app ────────────────────────────────────────────────────
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="KudaVas Whisper Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranscribeRequest(BaseModel):
    url: Optional[str] = None
    path: Optional[str] = None
    entry_id: Optional[str] = None  # dùng làm cache key; nếu trống → fallback sha1(url)
    language: Optional[str] = "vi"  # "vi", "en", "auto"
    force: bool = False  # True = bỏ cache, transcribe lại


class ExtractRequest(BaseModel):
    url: str
    entry_id: Optional[str] = None  # Kaltura entry_id nếu URL chỉ là embed loader
    language: Optional[str] = "vi"


class SolveRequest(BaseModel):
    """Một câu hỏi cần solve. Nếu có url/entry_id → transcribe audio trước."""
    index: int
    question: str
    type: str = "multiple_choice"  # multiple_choice, true_false, checkbox, short_answer, essay, matching, multiple_dropdowns
    options: list = []
    url: Optional[str] = None
    entry_id: Optional[str] = None
    partner_id: Optional[str] = None
    language: Optional[str] = "vi"


class SolveBatchRequest(BaseModel):
    """Batch câu hỏi, server sẽ tự cache audio + answer."""
    questions: list  # list[SolveRequest]
    openai_model: Optional[str] = None


def cache_key(entry_id: Optional[str], url: Optional[str]) -> Optional[str]:
    """Trả về key cache: entry_id ưu tiên, fallback sha1(url)."""
    if entry_id and entry_id.strip():
        return f"id:{entry_id.strip()}"
    if url and url.strip():
        return "u:" + hashlib.sha1(url.strip().encode("utf-8")).hexdigest()[:16]
    return None


def cleanup_cache():
    """Bỏ entry quá TTL."""
    now = time.time()
    stale = [k for k, v in TRANSCRIPT_CACHE.items() if now - v.get("ts", 0) > TRANSCRIPT_TTL]
    for k in stale:
        TRANSCRIPT_CACHE.pop(k, None)
    stale_ans = [k for k, v in ANSWER_CACHE.items() if now - v.get("ts", 0) > ANSWER_TTL]
    for k in stale_ans:
        ANSWER_CACHE.pop(k, None)


def question_hash(q: dict) -> str:
    """Hash câu hỏi (không tính index/url) làm answer cache key."""
    h = "|".join([
        str(q.get("type", "")),
        str(q.get("question", "")).strip(),
        "|".join(str(o) for o in q.get("options", []) or []),
    ])
    return "a:" + hashlib.sha1(h.encode("utf-8")).hexdigest()[:20]


def transcribe_for_solve(q: dict) -> Optional[str]:
    """Transcribe audio cho câu hỏi (có cache). Trả về text hoặc None."""
    if not q.get("url") and not q.get("entry_id"):
        return None

    cleanup_cache()
    ckey = cache_key(q.get("entry_id"), q.get("url"))
    if ckey and ckey in TRANSCRIPT_CACHE:
        return TRANSCRIPT_CACHE[ckey]["text"]

    real_url = None
    # FAST PATH: Kaltura download URL
    partner_id = q.get("partner_id")
    pid_from_url = None
    if q.get("url"):
        pm = re.search(r"/p/(\d+)/", q["url"])
        if pm:
            pid_from_url = pm.group(1)
    if not partner_id:
        partner_id = pid_from_url

    if partner_id and q.get("entry_id"):
        real_url = build_kaltura_download_url(partner_id, q["entry_id"])
        # Verify HEAD
        try:
            r = requests.head(
                real_url,
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://cdnapisec.kaltura.com/"},
                timeout=10, allow_redirects=True,
            )
            if r.status_code != 200:
                print(f"[Solve] FAST PATH HEAD {r.status_code} → fallback Playwright")
                real_url = None
        except Exception as e:
            print(f"[Solve] FAST PATH err: {e}")
            real_url = None

    # FALLBACK: Playwright extract
    if not real_url and q.get("url"):
        try:
            real_url = extract_real_audio_url(q["url"], entry_id=q.get("entry_id"))
        except Exception as e:
            print(f"[Solve] Extract err: {e}")

    if not real_url:
        return None

    # Download + transcribe
    tmp_dir = Path(tempfile.gettempdir()) / "kudavas_whisper"
    tmp_dir.mkdir(exist_ok=True)
    audio_path: Optional[Path] = None
    try:
        if ".m3u8" in real_url.lower():
            audio_path = download_hls(real_url, tmp_dir)
        else:
            audio_path = download_audio(real_url, tmp_dir)
        if not audio_path:
            return None
        result = transcribe_file(audio_path, q.get("language", "vi"))
        if not result.get("success"):
            return None
        text = result.get("text", "")
        if ckey:
            TRANSCRIPT_CACHE[ckey] = {
                "text": text,
                "language": result.get("language", q.get("language", "vi")),
                "ts": time.time(),
                "source_url": real_url,
            }
            print(f"[Solve] Cached transcript ({ckey}): {len(text)} chars")
        return text
    finally:
        if audio_path and audio_path.exists():
            try: audio_path.unlink()
            except Exception: pass


def ask_openai(q: dict, transcript: Optional[str], model: Optional[str] = None,
               api_key: Optional[str] = None) -> Optional[Any]:
    """Gọi OpenAI để ra đáp án. Trả về answer theo schema từng type."""
    # Header X-OpenAI-Key LUÔN thắng env (kể cả env rỗng).
    # Chỉ fallback env khi header không có.
    header_key = (api_key or "").strip()
    env_key = (OPENAI_API_KEY or "").strip()
    use_key = header_key or env_key

    if not use_key:
        print("[Solve] Thiếu API key (cả header và env đều rỗng)")
        return None
    if not OpenAI:
        print("[Solve] Chưa cài openai SDK: pip install openai")
        return None

    # Mask key khi log (chỉ show 4 ký tự đầu + cuối) để debug mà không leak.
    masked = f"{use_key[:7]}...{use_key[-4:]}" if len(use_key) > 14 else use_key
    src = "header" if header_key else "env"
    print(f"[Solve] Using OpenAI key from {src}: {masked} | model={model or OPENAI_MODEL}")
    client = OpenAI(api_key=use_key)

    qtype = q.get("type", "multiple_choice")
    qtext = q.get("question", "")
    opts = q.get("options", []) or []

    sys_prompt = (
        "You are a quiz-solving assistant. You are given a question (and optionally an audio transcript). "
        "Return ONLY a strict JSON object with key 'answer' whose value matches the question type.\n"
        "If multiple_choice / true_false: 'answer' = exact option text (string).\n"
        "If checkbox: 'answer' = JSON array of option texts.\n"
        "If short_answer / numerical / essay: 'answer' = concise string.\n"
        "If matching: 'answer' = JSON object {term: definition}.\n"
        "If multiple_dropdowns: 'answer' = JSON array, one item per blank (in order).\n"
        "If fill_in_multiple_blanks: 'answer' = JSON ARRAY of strings, one per blank in order. "
        "Count the blanks in the question (marked with [a/an/the] or underscores like ___) and "
        "provide EXACTLY that many values, otherwise the form rejects the submission.\n"
        "Do not add commentary outside the JSON. Output must be valid JSON."
    )

    user_lines = []
    if transcript:
        user_lines.append(f"AUDIO TRANSCRIPT:\n{transcript}\n")
    user_lines.append(f"QUESTION TYPE: {qtype}")
    user_lines.append(f"QUESTION: {qtext}")
    if opts:
        user_lines.append("OPTIONS:")
        for o in opts:
            user_lines.append(f"- {o}")
    user_lines.append("Return JSON only.")

    try:
        resp = client.chat.completions.create(
            model=model or OPENAI_MODEL,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": "\n".join(user_lines)},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
        )
        content = resp.choices[0].message.content
        import json
        data = json.loads(content)
        answer = data.get("answer")

        # Normalize answer shape per question type.
        # multiple_dropdowns MUST be a JSON array — AI sometimes returns a bare
        # string when there's only one blank. Wrap it so the client doesn't choke.
        if qtype == "multiple_dropdowns" and answer is not None:
            if not isinstance(answer, list):
                answer = [answer]
        # fill_in_multiple_blanks same rule — array, one per blank.
        if qtype == "fill_in_multiple_blanks" and answer is not None:
            if not isinstance(answer, list):
                # If AI returned a string with separators, split heuristically.
                if isinstance(answer, str) and ("|" in answer or ";" in answer or " / " in answer):
                    sep = "|" if "|" in answer else (";" if ";" in answer else " / ")
                    answer = [s.strip() for s in answer.split(sep) if s.strip()]
                else:
                    answer = [answer]

        return answer
    except Exception as e:
        print(f"[Solve] OpenAI err: {e}")
        return None


def build_kaltura_download_url(partner_id: str, entry_id: str) -> str:
    """
    Build Kaltura direct download URL (audio/video binary, no DRM).
    https://cdnapisec.kaltura.com/p/{partner}/sp/{partner}00/playManifest/entryId/{entry}/format/download/protocol/https/flavorParamIds/0
    flavorParamIds/0 = lowest flavor, always present, smallest size (good for audio).
    """
    return (
        f"https://cdnapisec.kaltura.com/p/{partner_id}"
        f"/sp/{partner_id}00/playManifest/entryId/{entry_id}"
        f"/format/download/protocol/https/flavorParamIds/0"
    )


def extract_real_audio_url(url: str, entry_id: Optional[str] = None, timeout_ms: int = 25000) -> Optional[str]:
    """
    Lấy URL audio thật từ URL Kaltura.
    Ưu tiên: build URL download trực tiếp từ partner_id + entry_id (nhanh, không cần browser).
    Fallback: dùng Playwright navigate trang player, bắt network request media.
    """
    import re
    if not entry_id:
        m = re.search(r"entry_id[/=]([^&/]+)", url)
        if m:
            entry_id = m.group(1)
    partner_id = None
    pm = re.search(r"/p/(\d+)/", url)
    if pm:
        partner_id = pm.group(1)

    # FAST PATH: nếu đủ partner_id + entry_id → dùng URL download trực tiếp (kbps mbps)
    if partner_id and entry_id:
        download_url = build_kaltura_download_url(partner_id, entry_id)
        print(f"[Extract] FAST PATH → {download_url[:120]}")
        # Verify bằng HEAD request
        try:
            r = requests.head(
                download_url,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Referer": "https://cdnapisec.kaltura.com/",
                },
                allow_redirects=True,
                timeout=10,
            )
            ctype = r.headers.get("Content-Type", "").lower()
            clen = r.headers.get("Content-Length", "?")
            print(f"[Extract] HEAD → {r.status_code}, type={ctype}, len={clen}")
            if r.status_code == 200 and ("audio" in ctype or "video" in ctype or "octet-stream" in ctype):
                return download_url
        except Exception as e:
            print(f"[Extract] HEAD failed: {e}")
        # Cũng thử thẳng, dù server có thể trả HTML - download_audio sẽ check
        return download_url

    # FALLBACK: không đủ info, dùng Playwright
    if not PLAYWRIGHT_ENABLED:
        return None
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "[Extract] Playwright chưa cài. pip install playwright && playwright install chromium"
        )
        return None

    MEDIA_EXT = (".m3u8", ".mp4", ".mp3", ".webm", ".aac", ".ogg", ".wav", ".flv", ".m4a")
    result = {"video": None, "domains": set()}

    def handle_request(request):
        rurl = request.url
        try:
            from urllib.parse import urlparse
            host = urlparse(rurl).netloc
            if host and host not in result["domains"]:
                result["domains"].add(host)
                print(f"[Extract]   ↳ request: {host}")
        except Exception:
            pass
        if result["video"] is not None:
            return
        path = rurl.lower().split("?", 1)[0]
        if any(path.endswith(ext) for ext in MEDIA_EXT):
            result["video"] = rurl
            print(f"[Extract]   ★ media hit: {rurl[:140]}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--autoplay-policy=no-user-gesture-required",
                ],
            )
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = context.new_page()
            page.on("request", handle_request)
            print("[Extract] Opening page (fallback)...")
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            except Exception as e:
                print(f"[Extract] goto warn: {e}")
            page.wait_for_timeout(2000)

            try:
                page.evaluate(
                    """() => {
                        const v = document.querySelector('video');
                        const a = document.querySelector('audio');
                        const t = v || a;
                        if (t) { t.muted = true; t.play().catch(()=>{}); }
                        document.querySelectorAll('[class*="play"], [id*="play"], [aria-label*="play" i]').forEach(el => el.click());
                    }"""
                )
            except Exception as e:
                print(f"[Extract] play warn: {e}")

            page.wait_for_timeout(5000)

            # Fallback: read src of <video>/<audio>, or scan window globals for kaltura config
            if not result["video"]:
                try:
                    src = page.evaluate(
                        """() => {
                            const v = document.querySelector('video');
                            if (v) {
                                if (v.src && v.src !== window.location.href && !v.src.startsWith('blob:')) return v.src;
                                const s = v.querySelector('source');
                                if (s && s.src) return s.src;
                            }
                            const a = document.querySelector('audio');
                            if (a) {
                                if (a.src && a.src !== window.location.href && !a.src.startsWith('blob:')) return a.src;
                                const s = a.querySelector('source');
                                if (s && s.src) return s.src;
                            }
                            try {
                                const kc = window.kConfig || (window.kWidget && window.kWidget.embed && window.kWidget.embed.kalturaPlayerData);
                                if (kc) {
                                    const blob = JSON.stringify(kc);
                                    const m = blob.match(/https?:\\/\\/[A-Za-z0-9._\\-/:%?&=#]+\\.(m3u8|mp4|mp3|webm|m4a)/i);
                                    if (m) return m[0];
                                }
                            } catch(e) {}
                            return null;
                        }"""
                    )
                    if src:
                        print(f"[Extract]   ★ fallback src: {src[:140]}")
                        result["video"] = src
                except Exception as e:
                    print(f"[Extract] fallback eval warn: {e}")

            browser.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[Extract] Playwright error: {e}")
        return None

    print(f"[Extract] Domains seen: {sorted(result['domains'])}")
    return result["video"]


@app.post("/transcribe")
def transcribe(req: TranscribeRequest):
    if not req.url and not req.path:
        raise HTTPException(status_code=400, detail="Cần cung cấp 'url' hoặc 'path'")

    cleanup_cache()
    ckey = cache_key(req.entry_id, req.url)
    if ckey and not req.force and ckey in TRANSCRIPT_CACHE:
        cached = TRANSCRIPT_CACHE[ckey]
        age = time.time() - cached.get("ts", 0)
        print(f"[Whisper] CACHE HIT ({ckey}) → {len(cached.get('text', ''))} chars, age={age:.0f}s")
        return {
            "success": True,
            "text": cached.get("text", ""),
            "language": cached.get("language", req.language),
            "segments": [],
            "cached": True,
            "cache_key": ckey,
        }

    tmp_dir = Path(tempfile.gettempdir()) / "kudavas_whisper"
    tmp_dir.mkdir(exist_ok=True)

    audio_path: Optional[Path] = None

    try:
        if req.url:
            print(f"[Whisper] Downloading: {req.url[:100]}...")
            if ".m3u8" in req.url.lower():
                audio_path = download_hls(req.url, tmp_dir)
            else:
                audio_path = download_audio(req.url, tmp_dir)
            if not audio_path:
                raise HTTPException(status_code=502, detail="Tải audio thất bại (file không hợp lệ hoặc là HTML)")
        elif req.path:
            audio_path = Path(req.path)
            if not audio_path.exists():
                raise HTTPException(
                    status_code=404, detail=f"File không tìm thấy: {req.path}"
                )

        print(
            f"[Whisper] Transcribing: {audio_path.name} ({audio_path.stat().st_size/1024:.1f} KB) ..."
        )
        result = transcribe_file(audio_path, req.language)

        if not result["success"]:
            import traceback

            traceback.print_exc()
            raise HTTPException(
                status_code=500, detail=result.get("error", "Transcribe failed")
            )

        # Lưu cache nếu có key
        if ckey:
            TRANSCRIPT_CACHE[ckey] = {
                "text": result.get("text", ""),
                "language": result.get("language", req.language),
                "ts": time.time(),
                "source_url": req.url or "",
            }
            print(f"[Whisper] Cached ({ckey}): {len(result.get('text', ''))} chars")

        result["cached"] = False
        result["cache_key"] = ckey
        return result

    finally:
        # Dọn file tạm ngay sau khi xong
        if audio_path and audio_path.exists():
            try:
                audio_path.unlink()
            except Exception:
                pass


@app.post("/extract-and-transcribe")
def extract_and_transcribe(req: ExtractRequest):
    """
    Vào URL audio trong browser thật (Playwright), bắt link .m3u8/.mp4 thật,
    download + transcribe luôn.
    Hữu ích cho các URL kiểu Kaltura embedIframeJs (URL iframe, không phải file audio).
    """
    if not req.url:
        raise HTTPException(status_code=400, detail="Cần cung cấp 'url'")

    if not PLAYWRIGHT_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Playwright chưa bật. Sửa PLAYWRIGHT_ENABLED = True trong whisper_server.py",
        )

    print(f"[Extract] Crawling: {req.url[:100]}")
    real_url = extract_real_audio_url(req.url, entry_id=req.entry_id)
    if not real_url:
        raise HTTPException(
            status_code=404,
            detail=(
                "Không tìm được link .m3u8/.mp4 thật. "
                "Nếu URL là Kaltura embed loader, cần truyền thêm 'entry_id'."
            ),
        )

    print(f"[Extract] Found real URL: {real_url[:100]}")
    # Reuse transcribe flow
    sub_req = TranscribeRequest(url=real_url, language=req.language)
    return transcribe(sub_req)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": WHISPER_MODEL,
        "playwright_enabled": PLAYWRIGHT_ENABLED,
    }


@app.get("/")
def root():
    return {
        "service": "KudaVas Whisper + AI Server",
        "endpoints": {
            "POST /transcribe": "Nhận audio URL hoặc path, trả về transcript",
            "POST /solve": "Nhận batch câu hỏi (có/không audio), trả về đáp án. Cần header X-OpenAI-Key.",
            "POST /extract-and-transcribe": "Vào URL bằng Playwright, transcribe",
            "GET  /health": "Kiểm tra server & model",
            "GET  /cache/stats": "Xem thống kê cache",
        },
        "model": WHISPER_MODEL,
        "openai_model": OPENAI_MODEL,
        "openai_key_configured": bool(OPENAI_API_KEY),
        "example": {"url": "http://example.com/audio.mp3", "language": "auto"},
    }


@app.get("/cache/stats")
def cache_stats():
    return {
        "transcripts": len(TRANSCRIPT_CACHE),
        "answers": len(ANSWER_CACHE),
    }


@app.post("/solve")
def solve_batch(req: SolveBatchRequest,
                x_openai_key: Optional[str] = Header(default=None, alias="X-OpenAI-Key")):
    """
    Batch câu hỏi → cho mỗi câu: transcribe audio (nếu có) + GPT solve.
    Trả về list {index, answer, transcript?, cached_answer?, cached_transcript?, error?}.

    OpenAI key: ưu tiên header `X-OpenAI-Key` (do extension gửi),
    fallback biến môi trường `OPENAI_API_KEY`.
    """
    runtime_key = (x_openai_key or OPENAI_API_KEY or "").strip()
    if not runtime_key:
        raise HTTPException(
            status_code=503,
            detail="Thiếu OpenAI key. Gửi header 'X-OpenAI-Key: sk-...' hoặc set OPENAI_API_KEY env.",
        )

    cleanup_cache()
    results = []
    model = req.openai_model or OPENAI_MODEL

    for q in req.questions:
        idx = q.get("index", 0)
        ahash = question_hash(q)

        # 1. Cached answer?
        cached_ans = ANSWER_CACHE.get(ahash)
        if cached_ans:
            results.append({
                "index": idx,
                "answer": cached_ans["answer"],
                "cached_answer": True,
                "transcript": cached_ans.get("transcript"),
            })
            continue

        # 2. Transcribe audio (nếu có)
        transcript = None
        cached_transcript = False
        if q.get("url") or q.get("entry_id"):
            ckey = cache_key(q.get("entry_id"), q.get("url"))
            if ckey and ckey in TRANSCRIPT_CACHE:
                transcript = TRANSCRIPT_CACHE[ckey]["text"]
                cached_transcript = True
            else:
                transcript = transcribe_for_solve(q)

        # 3. Ask OpenAI
        answer = ask_openai(q, transcript, model=model, api_key=runtime_key)

        if answer is not None:
            ANSWER_CACHE[ahash] = {
                "answer": answer,
                "transcript": transcript,
                "ts": time.time(),
            }

        results.append({
            "index": idx,
            "answer": answer,
            "transcript": transcript,
            "cached_transcript": cached_transcript,
            "error": None if answer is not None else "openai_no_answer",
        })

    print(f"[Solve] {len(req.questions)} q → {sum(1 for r in results if r.get('answer') is not None)} answered")
    return {"answers": results}


# ── Entry point ─────────────────────────────────────────────────────
if __name__ == "__main__":
    if not OPENAI_API_KEY:
        print("[KudaVas] ℹ️  OPENAI_API_KEY env chưa set — sẽ dùng key từ header X-OpenAI-Key")
    print(f"[KudaVas] Server starting on http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
