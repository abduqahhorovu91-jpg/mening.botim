import asyncio
import json
import mimetypes
import os
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote_plus, urlparse
from urllib.request import Request, urlopen

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.error import BadRequest, Conflict, NetworkError
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

TOKEN = "8204726213:AAGnNnPI2VqcN6llRzxXZl6cU8Rx7EJFRwc"
BOT_USERNAME = "Hidop_bot"
API_HOST = "0.0.0.0"
API_PORT = int(os.getenv("PORT", "8000"))
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://mening-botim-api.onrender.com/")

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "dist"
FRONTEND_INDEX = FRONTEND_DIR / "index.html"
VIDEOS_FILE = BASE_DIR / "videos.json"
USERS_FILE = BASE_DIR / "user.json"
SAVED_VIDEOS_FILE = BASE_DIR / "saved_videos.json"
VIDEO_REACTIONS_FILE = BASE_DIR / "video_reactions.json"
USER_REACTIONS_FILE = BASE_DIR / "user_reactions.json"
LIVE_MESSAGES_FILE = BASE_DIR / "live_messages.json"
CHAT_MESSAGES_FILE = BASE_DIR / "chat_messages.json"
LIVE_CURRENT_FILE = BASE_DIR / "live_current.json"
AD_CONFIG_FILE = BASE_DIR / "ad_config.json"

WELCOME_TEXT = (
    "👋 Assalomu alaykum! Botimizga xush kelibsiz\n"
    "botimizda siz qidirgan kinoni topasiz 😉\n"
    "🔗 qo'llab quvvatlash uchun pastagi tugmani bosing"
)
SECOND_TEXT = "BIZ BILAN ZERIKMAYSIZ 😉\nBOSHLASH UCHUN BOSHLASH NI BOSING ✅"
START_BUTTON_TEXT = (
    "🎬 Botdan foydalanish uchun:\n\n"
    "📝 o'zingiz yoqtirgan kinoni 🅿🅻🅴🆈🅻🅸🆂🆃 dan topasiz \n"
    "📥 Videoni saqlab olishingiz mumkin\n\n"
    "👉 Endi kinolarni 🅿🅻🅴🆈🅻🅸🆂🆃 dan topasiz"
)
BUTTON_URL = f"https://t.me/share/url?url=https://t.me/{BOT_USERNAME}"
FORCED_MODAL_YOUTUBE_URL = "https://youtu.be/yAAOsFoViKQ?si=OmBx0YuR5ZKuDGUn"
ADMIN_USER_IDS = {8239140931}
AD_VIDEO_URL, AD_LINK_URL, LIVE_URL = range(3)


def load_json_file(path: Path, fallback):
    if not path.exists():
        save_json_file(path, fallback)
        return fallback
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except (json.JSONDecodeError, OSError):
        return fallback


def save_json_file(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def load_videos() -> dict:
    return load_json_file(VIDEOS_FILE, {"next_id": 1, "items": []})


def load_users() -> dict:
    return load_json_file(USERS_FILE, {"next_id": 1, "items": []})


def save_users(data: dict) -> None:
    save_json_file(USERS_FILE, data)


def build_telegram_file_url(file_path: str) -> str:
    normalized_path = str(file_path or "").strip()
    if not normalized_path:
        return ""
    if normalized_path.startswith("http://") or normalized_path.startswith("https://"):
        return normalized_path
    return f"https://api.telegram.org/file/bot{TOKEN}/{normalized_path.lstrip('/')}"


def load_saved_videos() -> dict:
    return load_json_file(SAVED_VIDEOS_FILE, {})


def save_saved_videos(data: dict) -> None:
    save_json_file(SAVED_VIDEOS_FILE, data)


def load_user_reactions() -> dict:
    return load_json_file(USER_REACTIONS_FILE, {})


def save_user_reactions(data: dict) -> None:
    save_json_file(USER_REACTIONS_FILE, data)


def load_simple_list(path: Path) -> list:
    return load_json_file(path, [])


def load_ad_config() -> dict:
    raw = load_json_file(AD_CONFIG_FILE, {"items": []})
    if isinstance(raw, dict) and isinstance(raw.get("items"), list):
        items = [item for item in raw.get("items", []) if isinstance(item, dict)]
    elif isinstance(raw, dict):
        legacy_video_url = str(raw.get("video_url", "")).strip()
        legacy_link_url = str(raw.get("link_url", "")).strip()
        items = []
        if legacy_video_url or legacy_link_url:
            items.append(
                {
                    "id": 1,
                    "enabled": bool(raw.get("enabled")),
                    "video_url": legacy_video_url,
                    "link_url": legacy_link_url,
                    "caption": str(raw.get("caption", "")).strip(),
                    "created_at": "",
                }
            )
    else:
        items = []

    enabled_items = [item for item in items if bool(item.get("enabled"))]
    active_item = enabled_items[-1] if enabled_items else (items[-1] if items else {})
    return {
        "items": items,
        "enabled": bool(active_item.get("enabled")),
        "link_url": str(active_item.get("link_url", "")).strip(),
        "caption": str(active_item.get("caption", "")).strip(),
        "video_url": str(active_item.get("video_url", "")).strip(),
    }


def save_ad_config(data: dict) -> None:
    existing = load_ad_config()
    items = [item for item in existing.get("items", []) if isinstance(item, dict)]
    incoming_items = data.get("items")
    if isinstance(incoming_items, list):
        normalized_items = []
        for index, item in enumerate(incoming_items, start=1):
            if not isinstance(item, dict):
                continue
            normalized_items.append(
                {
                    "id": int(item.get("id", index)),
                    "enabled": bool(item.get("enabled", True)),
                    "link_url": str(item.get("link_url", "")).strip(),
                    "caption": str(item.get("caption", "")).strip(),
                    "video_url": str(item.get("video_url", "")).strip(),
                    "created_at": str(item.get("created_at", "")).strip(),
                }
            )
        payload = {"items": normalized_items}
        save_json_file(AD_CONFIG_FILE, payload)
        return

    next_id = max([int(item.get("id", 0)) for item in items] + [0]) + 1
    items.append(
        {
            "id": next_id,
            "enabled": bool(data.get("enabled", True)),
            "link_url": str(data.get("link_url", "")).strip(),
            "caption": str(data.get("caption", "")).strip(),
            "video_url": str(data.get("video_url", "")).strip(),
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
    )
    payload = {"items": items}
    save_json_file(AD_CONFIG_FILE, payload)


def delete_ad_config_item(ad_id: int) -> bool:
    data = load_ad_config()
    items = [item for item in data.get("items", []) if isinstance(item, dict)]
    updated = [item for item in items if int(item.get("id", 0)) != int(ad_id)]
    if len(updated) == len(items):
        return False
    save_ad_config({"items": updated})
    return True


def build_ad_list_keyboard(items: list[dict]) -> InlineKeyboardMarkup:
    keyboard = []
    for item in items:
        ad_id = int(item.get("id", 0))
        label = f"🗑 Reklama #{ad_id}"
        keyboard.append([InlineKeyboardButton(label, callback_data=f"delete_ad:{ad_id}")])
    return InlineKeyboardMarkup(keyboard)


def build_admin_menu_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("1 - //reklama", callback_data="admin_menu:reklama")],
            [InlineKeyboardButton("2 - //reklama//", callback_data="admin_menu:reklama_list")],
            [InlineKeyboardButton("3 - //live", callback_data="admin_menu:live")],
            [InlineKeyboardButton("4 - //live//", callback_data="admin_menu:live_list")],
        ]
    )


def build_live_stop_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("⛔ Live ni to'xtatish", callback_data="live_stop:confirm")]]
    )


def is_valid_youtube_live_url(url: str) -> bool:
    normalized = str(url or "").strip().lower()
    if not (normalized.startswith("http://") or normalized.startswith("https://")):
        return False
    return "youtube.com" in normalized or "youtu.be" in normalized


def get_video_count() -> int:
    return len(load_videos().get("items", []))


def get_video_item(video_id: int) -> dict | None:
    for item in load_videos().get("items", []):
        if int(item.get("id", 0)) == int(video_id):
            return item
    return None


def format_duration(seconds: int) -> str:
    total = max(0, int(seconds or 0))
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def build_video_caption(video_id: int, video: dict) -> str:
    title = str(video.get("title", "")).strip()
    comment = str(video.get("comment", "")).strip()
    duration = format_duration(int(video.get("duration", 0)))
    if comment:
        return (
            f"🎥filim nomi: {title}\n"
            f"🗝️film kodi : {video_id}\n"
            f"🧭film avqti: {duration}\n"
            f"✉️commant:{comment}\n\n"
            "@Hidop_bot tomonidan yuklab olindi"
        )
    return (
        f"🎥filim nomi: {title}\n"
        f"🗝️film kodi : {video_id}\n"
        f"🧭film avqti: {duration}\n\n"
        "@Hidop_bot tomonidan yuklab olindi"
    )


def serialize_video_item(video: dict) -> dict:
    payload = dict(video)
    payload["poster_url"] = str(video.get("poster_url", "") or video.get("preview_url", "") or "").strip()
    payload["poster_proxy_url"] = ""
    payload["trailer_proxy_url"] = ""
    payload["stream_url"] = str(video.get("trailer_url", "") or FORCED_MODAL_YOUTUBE_URL)
    payload["web_streamable"] = True
    payload["web_stream_error"] = ""
    payload["web_stream_message"] = ""
    payload["web_stream_source"] = "external"
    payload["file_size"] = int(video.get("file_size", 0) or 0)
    return payload


def upsert_user(user_id: str) -> dict:
    data = load_users()
    items = data.get("items", [])
    normalized_user_id = str(user_id).strip()
    for item in items:
        if str(item.get("user_id", "")).strip() == normalized_user_id:
            return item
    new_item = {
        "id": int(data.get("next_id", 1)),
        "user_id": normalized_user_id,
        "username": "",
        "full_name": "",
        "photo_file_id": "",
        "photo_url": "",
        "shared_user_ids": [],
    }
    items.append(new_item)
    data["items"] = items
    data["next_id"] = new_item["id"] + 1
    save_users(data)
    return new_item


def update_user_profile(user_id: int | str, username: str = "", full_name: str = "", photo_file_id: str = "", photo_url: str = "") -> dict:
    data = load_users()
    items = data.get("items", [])
    normalized_user_id = str(user_id).strip()
    target = None
    for item in items:
        if str(item.get("user_id", "")).strip() == normalized_user_id:
            target = item
            break
    if target is None:
        target = {
            "id": int(data.get("next_id", 1)),
            "user_id": normalized_user_id,
            "username": "",
            "full_name": "",
            "photo_file_id": "",
            "photo_url": "",
            "shared_user_ids": [],
        }
        items.append(target)
        data["next_id"] = target["id"] + 1

    # Telegram profilida ism yoki rasm o'zgarsa (yoki olib tashlansa),
    # user.json ham aynan shu holatga tenglashsin.
    target["username"] = str(username or "").strip()
    target["full_name"] = str(full_name or "").strip()
    target["photo_file_id"] = str(photo_file_id or "").strip()
    target["photo_url"] = str(photo_url or "").strip()
    data["items"] = items
    save_users(data)
    return target


def find_user(user_id: int) -> dict | None:
    users = load_users().get("items", [])
    for item in users:
        if str(item.get("user_id", "")).strip() == str(user_id):
            return item
    return None


async def notify_admins_about_new_user(context: ContextTypes.DEFAULT_TYPE, user: dict) -> None:
    user_id = str(user.get("user_id", "")).strip()
    full_name = str(user.get("full_name", "")).strip()
    username = str(user.get("username", "")).strip()
    display_name = full_name or (f"@{username}" if username else "No name")
    text = f"New user\nID: {user_id}\nName: {display_name}"

    for admin_user_id in ADMIN_USER_IDS:
        try:
            await context.bot.send_message(chat_id=admin_user_id, text=text)
        except Exception:
            pass


async def sync_telegram_user_profile(update: Update, context: ContextTypes.DEFAULT_TYPE) -> dict | None:
    telegram_user = update.effective_user
    if not telegram_user:
        return None
    existing_user = find_user(telegram_user.id)

    photo_file_id = ""
    photo_url = ""
    try:
        profile_photos = await context.bot.get_user_profile_photos(user_id=telegram_user.id, limit=1)
        if profile_photos and profile_photos.photos:
            largest_photo = profile_photos.photos[0][-1]
            photo_file_id = str(largest_photo.file_id)
            telegram_file = await context.bot.get_file(photo_file_id)
            if telegram_file.file_path:
                photo_url = build_telegram_file_url(telegram_file.file_path)
    except BadRequest:
        pass
    except NetworkError:
        pass

    saved_user = update_user_profile(
        user_id=telegram_user.id,
        username=telegram_user.username or "",
        full_name=telegram_user.full_name or "",
        photo_file_id=photo_file_id,
        photo_url=photo_url,
    )
    if existing_user is None:
        await notify_admins_about_new_user(context, saved_user)
    return saved_user


def get_saved_videos_for_owner(owner_id: int) -> list[dict]:
    saved_map = load_saved_videos()
    owner_items = saved_map.get(str(owner_id), [])
    result = []
    for entry in owner_items:
        if not isinstance(entry, dict):
            continue
        video = get_video_item(int(entry.get("video_id", 0)))
        if not video:
            continue
        payload = serialize_video_item(video)
        payload["saved_id"] = int(entry.get("saved_id", payload["id"]))
        payload["saved_name"] = str(entry.get("name", video.get("title", ""))).strip()
        payload["saved_at"] = str(entry.get("saved_at", "")).strip()
        payload["category"] = "Pleylist"
        payload["palette"] = "instagram"
        result.append(payload)
    return result


def add_saved_video(owner_id: int, video_id: int, name: str) -> tuple[bool, int | None]:
    data = load_saved_videos()
    key = str(owner_id)
    items = data.get(key, [])
    for item in items:
        if int(item.get("video_id", 0)) == video_id:
            return True, None
    items.append(
        {
            "saved_id": video_id,
            "video_id": video_id,
            "name": name,
            "saved_at": datetime.now().isoformat(timespec="seconds"),
        }
    )
    data[key] = items
    save_saved_videos(data)
    return False, video_id


def delete_saved_video(owner_id: int, video_id: int) -> bool:
    data = load_saved_videos()
    key = str(owner_id)
    items = data.get(key, [])
    updated = [
        item for item in items
        if int(item.get("saved_id", 0)) != video_id and int(item.get("video_id", 0)) != video_id
    ]
    if len(updated) == len(items):
        return False
    data[key] = updated
    save_saved_videos(data)
    return True


def get_video_reaction_count(video_id: int, reaction_type: str) -> int:
    data = load_user_reactions()
    entry = data.get(str(video_id), {})
    return len(entry.get(reaction_type, [])) if isinstance(entry, dict) else 0


def get_user_reaction(user_id: int, video_id: int) -> str | None:
    data = load_user_reactions()
    entry = data.get(str(video_id), {})
    user_key = str(user_id)
    if user_key in entry.get("likes", []):
        return "likes"
    if user_key in entry.get("dislikes", []):
        return "dislikes"
    return None


def set_video_reaction_state(video_id: int, user_id: int, reaction_type: str) -> dict:
    data = load_user_reactions()
    video_key = str(video_id)
    user_key = str(user_id)
    entry = data.setdefault(video_key, {"likes": [], "dislikes": []})
    likes = [value for value in entry.get("likes", []) if value != user_key]
    dislikes = [value for value in entry.get("dislikes", []) if value != user_key]
    if reaction_type == "likes":
        likes.append(user_key)
    elif reaction_type == "dislikes":
        dislikes.append(user_key)
    data[video_key] = {"likes": likes, "dislikes": dislikes}
    save_user_reactions(data)
    return {
        "likes": len(likes),
        "dislikes": len(dislikes),
        "user_reaction": reaction_type if reaction_type in {"likes", "dislikes"} else None,
    }


def send_video_by_api(target_user_id: int, video: dict) -> tuple[bool, str]:
    file_id = str(video.get("file_id", "")).strip()
    if not file_id:
        return False, "Video file_id topilmadi."
    payload = {
        "chat_id": int(target_user_id),
        "video": file_id,
        "caption": build_video_caption(int(video.get("id", 0)), video),
        "supports_streaming": True,
    }
    request = Request(
        f"https://api.telegram.org/bot{TOKEN}/sendVideo",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
            if result.get("ok"):
                return True, "Video yuborildi ✅"
            return False, result.get("description", "Telegram xatolik qaytardi.")
    except HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
            description = str(payload.get("description", "HTTP xatolik."))
        except Exception:
            description = f"HTTP xatolik: {error.code}"
        return False, description
    except URLError:
        return False, "Telegram API bilan ulanishda xatolik bo'ldi."


def send_video_in_background(target_user_id: int, video: dict) -> None:
    def runner() -> None:
        ok, message = send_video_by_api(target_user_id, video)
        status = "ok" if ok else "error"
        print(f"[send_video:{status}] user={target_user_id} video={video.get('id')} message={message}")

    Thread(target=runner, daemon=True).start()


def build_external_file_response(handler: BaseHTTPRequestHandler, file_url: str):
    normalized_url = str(file_url or "").strip()
    if not normalized_url:
        handler._send_json(404, {"success": False, "error": "File not found"})
        return
    try:
        upstream = urlopen(normalized_url, timeout=30)
        data = upstream.read()
        handler.send_response(200)
        handler.send_header("Content-Type", upstream.headers.get("Content-Type", "application/octet-stream"))
        handler.send_header("Content-Length", str(len(data)))
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        handler.wfile.write(data)
    except Exception:
        handler._send_json(502, {"success": False, "error": "File yuklanmadi"})


class ApiHandler(BaseHTTPRequestHandler):
    def _send_bytes(self, status_code: int, payload: bytes, content_type: str, head_only: bool = False) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if not head_only:
            self.wfile.write(payload)

    def _send_json(self, status_code: int, payload: dict) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(encoded)

    def _serve_frontend(self, request_path: str, head_only: bool = False) -> bool:
        if not FRONTEND_INDEX.exists():
            return False

        normalized = request_path or "/"
        relative_path = normalized.lstrip("/") or "index.html"
        target = (FRONTEND_DIR / relative_path).resolve()

        try:
            target.relative_to(FRONTEND_DIR.resolve())
        except ValueError:
            return False

        if target.is_file():
            content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            self._send_bytes(200, target.read_bytes(), content_type, head_only=head_only)
            return True

        self._send_bytes(200, FRONTEND_INDEX.read_bytes(), "text/html; charset=utf-8", head_only=head_only)
        return True

    def _send_head_only(self, status_code: int, content_type: str = "text/plain; charset=utf-8") -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, HEAD")
        self.end_headers()

    def do_OPTIONS(self) -> None:
        self._send_json(200, {"ok": True})

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/healthz":
            self._send_head_only(200)
            return

        if path.startswith("/api/"):
            self._send_head_only(200, "application/json; charset=utf-8")
            return

        if self._serve_frontend(path, head_only=True):
            return

        self._send_head_only(404)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/healthz":
            self._send_json(200, {"ok": True, "status": "healthy"})
            return

        if not path.startswith("/api/") and self._serve_frontend(path):
            return

        if path == "/api/catalog":
            items = [serialize_video_item(item) for item in load_videos().get("items", []) if isinstance(item, dict)]
            self._send_json(200, {"ok": True, "items": items})
            return
        if path == "/api/users":
            self._send_json(200, {"ok": True, "items": load_users().get("items", [])})
            return
        if path == "/api/saved-videos":
            owner_id = str((query.get("owner_id") or query.get("user_id") or [""])[0]).strip()
            if not owner_id.isdigit():
                self._send_json(400, {"ok": False, "error": "owner_id required"})
                return
            self._send_json(200, {"ok": True, "items": get_saved_videos_for_owner(int(owner_id))})
            return
        if path == "/api/user-profile":
            user_id = str((query.get("user_id") or [""])[0]).strip()
            if not user_id.isdigit():
                self._send_json(400, {"ok": False, "error": "user_id kerak"})
                return
            user = find_user(int(user_id)) or {}
            username = str(user.get("username", "")).strip()
            full_name = str(user.get("full_name", "")).strip()
            photo_url = str(user.get("photo_url", "")).strip()
            display_name = full_name or (f"@{username}" if username else f"ID {user_id}")
            self._send_json(
                200,
                {
                    "ok": True,
                    "user_id": int(user_id),
                    "username": username,
                    "full_name": full_name,
                    "display_name": display_name,
                    "photo_url": photo_url,
                },
            )
            return
        if path == "/api/user-profile-photo":
            user_id = str((query.get("user_id") or [""])[0]).strip()
            if not user_id.isdigit():
                self._send_json(400, {"ok": False, "error": "user_id kerak"})
                return
            user = find_user(int(user_id)) or {}
            self._send_json(
                200,
                {
                    "ok": True,
                    "photo_url": str(user.get("photo_url", "")).strip(),
                    "photo_file_id": str(user.get("photo_file_id", "")).strip(),
                },
            )
            return
        if path == "/api/shared-users":
            self._send_json(200, {"ok": True, "count": 0, "items": []})
            return
        if path == "/api/ad-config":
            self._send_json(200, {"ok": True, **load_ad_config()})
            return
        if path == "/api/live-current":
            payload = load_json_file(LIVE_CURRENT_FILE, {})
            self._send_json(200, {"ok": True, "item": payload or None})
            return
        if path == "/api/live-messages":
            self._send_json(200, {"ok": True, "items": load_simple_list(LIVE_MESSAGES_FILE)[-45:]})
            return
        if path == "/api/chat-messages":
            self._send_json(200, {"ok": True, "items": load_simple_list(CHAT_MESSAGES_FILE)[-45:]})
            return
        if path == "/api/video-reactions":
            video_id = str((query.get("video_id") or [""])[0]).strip()
            user_id = str((query.get("user_id") or [""])[0]).strip()
            if not video_id.isdigit():
                self._send_json(400, {"ok": False, "error": "video_id kerak"})
                return
            uid = int(user_id) if user_id.isdigit() else None
            self._send_json(
                200,
                {
                    "ok": True,
                    "likes": get_video_reaction_count(int(video_id), "likes"),
                    "dislikes": get_video_reaction_count(int(video_id), "dislikes"),
                    "user_reaction": get_user_reaction(uid, int(video_id)) if uid is not None else None,
                },
            )
            return
        if path.startswith("/api/video/") and path.endswith("/status"):
            try:
                video_id = int(path.split("/")[3])
            except Exception:
                self._send_json(404, {"success": False, "error": "Video not found"})
                return
            video = get_video_item(video_id)
            if not video:
                self._send_json(404, {"success": False, "error": "Video not found"})
                return
            stream_url = str(video.get("trailer_url", "") or FORCED_MODAL_YOUTUBE_URL).strip()
            self._send_json(
                200,
                {
                    "success": True,
                    "playable": True,
                    "reason": "",
                    "message": "",
                    "stream_url": stream_url,
                    "source": "external",
                    "file_size": int(video.get("file_size", 0) or 0),
                },
            )
            return
        if path.startswith("/api/video/") and path.endswith("/poster"):
            try:
                video_id = int(path.split("/")[3])
            except Exception:
                self._send_json(404, {"success": False, "error": "Video not found"})
                return
            video = get_video_item(video_id)
            if not video:
                self._send_json(404, {"success": False, "error": "Video not found"})
                return
            build_external_file_response(self, str(video.get("preview_url", "") or video.get("poster_url", "")))
            return
        if path.startswith("/api/video/") and path.endswith("/trailer"):
            try:
                video_id = int(path.split("/")[3])
            except Exception:
                self._send_json(404, {"success": False, "error": "Video not found"})
                return
            video = get_video_item(video_id)
            if not video:
                self._send_json(404, {"success": False, "error": "Video not found"})
                return
            build_external_file_response(self, str(video.get("trailer_url", "") or FORCED_MODAL_YOUTUBE_URL))
            return
        if path.startswith("/api/video/") and path.endswith("/play"):
            try:
                video_id = int(path.split("/")[3])
            except Exception:
                self._send_json(404, {"success": False, "error": "Video not found"})
                return
            video = get_video_item(video_id)
            if not video:
                self._send_json(404, {"success": False, "error": "Video not found"})
                return
            build_external_file_response(self, str(video.get("trailer_url", "") or FORCED_MODAL_YOUTUBE_URL))
            return
        self._send_json(404, {"ok": False, "message": "Not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"

        if path == "/esp32":
            if not content_length:
                raw_body = b""
            self._send_bytes(200, raw_body, "text/plain; charset=utf-8")
            return

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(400, {"ok": False, "message": "JSON noto'g'ri."})
            return

        if path == "/api/users":
            user_id = str(payload.get("user_id", "")).strip()
            if not user_id.isdigit():
                self._send_json(400, {"ok": False, "message": "Foydalanuvchi ID noto'g'ri."})
                return
            item = update_user_profile(
                user_id=user_id,
                username=str(payload.get("username", "")).strip(),
                full_name=str(payload.get("full_name", "")).strip(),
                photo_file_id=str(payload.get("photo_file_id", "")).strip(),
                photo_url=str(payload.get("photo_url", "")).strip(),
            )
            self._send_json(200, {"ok": True, "item": item})
            return
        if path == "/api/send-video":
            target_user_id = str(payload.get("target_user_id", "")).strip()
            video_id = str(payload.get("video_id", "")).strip()
            if not target_user_id.isdigit() or not video_id.isdigit():
                self._send_json(400, {"ok": False, "message": "target_user_id va video_id kerak"})
                return
            video = get_video_item(int(video_id))
            if not video:
                self._send_json(404, {"ok": False, "message": "Video topilmadi."})
                return
            file_id = str(video.get("file_id", "")).strip()
            if not file_id:
                self._send_json(400, {"ok": False, "message": "Video file_id topilmadi."})
                return
            send_video_in_background(int(target_user_id), video)
            self._send_json(202, {"ok": True, "queued": True, "message": "Video yuborish boshlandi ✅"})
            return
        if path == "/api/esp-message":
            raw_message = str(payload.get("message", "")).strip()
            if not raw_message:
                self._send_json(400, {"ok": False, "message": "message kerak"})
                return
            self._send_json(200, {"ok": True, "echo": raw_message})
            return
        if path == "/api/save-video":
            owner_id = str(payload.get("owner_id", "") or payload.get("user_id", "")).strip()
            video_id = str(payload.get("video_id", "")).strip()
            if not owner_id.isdigit() or not video_id.isdigit():
                self._send_json(400, {"ok": False, "error": "owner_id va video_id kerak"})
                return
            video = get_video_item(int(video_id))
            if not video:
                self._send_json(404, {"ok": False, "error": "Video topilmadi"})
                return
            already_saved, saved_id = add_saved_video(int(owner_id), int(video_id), str(video.get("title", "")))
            self._send_json(200, {"ok": True, "already_saved": already_saved, "saved_id": saved_id, "message": "Video saqlandi ✅"})
            return
        if path == "/api/delete-saved-video":
            owner_id = str(payload.get("owner_id", "")).strip()
            video_id = str(payload.get("video_id", "")).strip()
            if not owner_id.isdigit() or not video_id.isdigit():
                self._send_json(400, {"ok": False, "error": "owner_id va video_id kerak"})
                return
            ok = delete_saved_video(int(owner_id), int(video_id))
            if not ok:
                self._send_json(404, {"ok": False, "error": "Video topilmadi"})
                return
            self._send_json(200, {"ok": True, "message": "Video o'chirildi"})
            return
        if path == "/api/react-video":
            user_id = str(payload.get("user_id", "") or payload.get("owner_id", "")).strip()
            video_id = str(payload.get("video_id", "")).strip()
            reaction = str(payload.get("reaction", "")).strip().lower()
            if not user_id.isdigit() or not video_id.isdigit():
                self._send_json(400, {"ok": False, "error": "user_id va video_id kerak"})
                return
            if reaction not in {"likes", "dislikes", "none"}:
                self._send_json(400, {"ok": False, "error": "reaction noto'g'ri"})
                return
            self._send_json(200, {"ok": True, **set_video_reaction_state(int(video_id), int(user_id), reaction)})
            return
        if path == "/api/live-messages":
            items = load_simple_list(LIVE_MESSAGES_FILE)
            items.append(payload)
            save_json_file(LIVE_MESSAGES_FILE, items[-45:])
            self._send_json(200, {"ok": True, "item": payload})
            return
        if path == "/api/chat-messages":
            items = load_simple_list(CHAT_MESSAGES_FILE)
            items.append(payload)
            save_json_file(CHAT_MESSAGES_FILE, items[-45:])
            self._send_json(200, {"ok": True, "item": payload})
            return
        if path == "/api/live-current":
            save_json_file(LIVE_CURRENT_FILE, payload)
            self._send_json(200, {"ok": True, "item": payload})
            return
        self._send_json(404, {"ok": False, "message": "Not found"})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/live-current":
            save_json_file(LIVE_CURRENT_FILE, {})
            self._send_json(200, {"ok": True})
            return
        self._send_json(404, {"ok": False, "message": "Not found"})


def start_api_server() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((API_HOST, API_PORT), ApiHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"API server running on http://{API_HOST}:{API_PORT}")
    return server


def ensure_runtime_files() -> None:
    load_videos()
    load_users()
    load_saved_videos()
    load_user_reactions()
    load_simple_list(LIVE_MESSAGES_FILE)
    load_simple_list(CHAT_MESSAGES_FILE)
    load_json_file(LIVE_CURRENT_FILE, {})
    load_ad_config()


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    await sync_telegram_user_profile(update, context)
    keyboard = [[InlineKeyboardButton("Ulashish", url=BUTTON_URL)]]
    await update.message.reply_text(WELCOME_TEXT, reply_markup=InlineKeyboardMarkup(keyboard))
    await asyncio.sleep(2)
    second_keyboard = [[InlineKeyboardButton("🚀 boshlash", callback_data="start_bot")]]
    await update.message.reply_text(SECOND_TEXT, reply_markup=InlineKeyboardMarkup(second_keyboard))


async def send_playlist_webapp_prompt(message) -> None:
    if not message:
        return
    webapp_keyboard = [[InlineKeyboardButton("🅿🅻🅴🆈🅻🅸🆂🆃 ni ochish", web_app=WebAppInfo(url=WEBAPP_URL))]]
    await message.reply_text(
        "🅿🅻🅴🆈🅻🅸🆂🆃 ni Telegram ichida ochish uchun tugmani bosing⬇️",
        reply_markup=InlineKeyboardMarkup(webapp_keyboard),
    )


async def start_button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.message:
        return
    await sync_telegram_user_profile(update, context)
    await query.answer()
    await send_playlist_webapp_prompt(query.message)


def is_admin_user(update: Update) -> bool:
    return bool(update.effective_user and update.effective_user.id in ADMIN_USER_IDS)


async def admin_menu_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    if not is_admin_user(update):
        return
    await update.message.reply_text("Admin panel:", reply_markup=build_admin_menu_keyboard())


async def ad_command_entry(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not update.message:
        return ConversationHandler.END
    if not is_admin_user(update):
        return ConversationHandler.END
    context.user_data["admin_ad_flow"] = "video"
    await update.message.reply_text("Reklama video linkini yuboring.")
    return AD_VIDEO_URL


async def ad_video_url_step(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not update.message:
        return AD_VIDEO_URL

    video_url = ""
    if update.message.video:
        telegram_file = await context.bot.get_file(update.message.video.file_id)
        video_url = build_telegram_file_url(telegram_file.file_path or "")
    elif update.message.document and str(update.message.document.mime_type or "").lower() == "video/mp4":
        telegram_file = await context.bot.get_file(update.message.document.file_id)
        video_url = build_telegram_file_url(telegram_file.file_path or "")
    elif update.message.text:
        candidate = str(update.message.text).strip()
        if candidate.startswith("http://") or candidate.startswith("https://"):
            video_url = candidate

    if not video_url:
        await update.message.reply_text("MP4 video yoki to'g'ri video link yuboring.")
        return AD_VIDEO_URL

    context.user_data["ad_video_url"] = video_url
    context.user_data["admin_ad_flow"] = "link"
    await update.message.reply_text("Endi link yuboring.")
    return AD_LINK_URL


async def ad_link_url_step(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not update.message or not update.message.text:
        return AD_LINK_URL
    link_url = str(update.message.text).strip()
    if not (link_url.startswith("http://") or link_url.startswith("https://")):
        await update.message.reply_text("To'g'ri link yuboring. Masalan: https://...")
        return AD_LINK_URL
    video_url = str(context.user_data.get("ad_video_url", "")).strip()
    save_ad_config(
        {
            "enabled": True,
            "video_url": video_url,
            "link_url": link_url,
            "caption": "",
        }
    )
    context.user_data.pop("ad_video_url", None)
    context.user_data.pop("admin_ad_flow", None)
    await update.message.reply_text("Reklama saqlandi ✅")
    return ConversationHandler.END


async def ad_list_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    if not is_admin_user(update):
        return
    data = load_ad_config()
    items = [item for item in data.get("items", []) if isinstance(item, dict)]
    if not items:
        await update.message.reply_text("Hozircha reklama yo'q.")
        return
    lines = ["Mavjud reklamalar:"]
    for item in items:
        ad_id = int(item.get("id", 0))
        video_url = str(item.get("video_url", "")).strip()
        link_url = str(item.get("link_url", "")).strip()
        lines.append(f"#{ad_id} | video: {video_url or '-'} | link: {link_url or '-'}")
    await update.message.reply_text("\n".join(lines), reply_markup=build_ad_list_keyboard(items))


async def delete_ad_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return
    if not is_admin_user(update):
        await query.answer()
        return
    payload = str(query.data or "").strip()
    if not payload.startswith("delete_ad:"):
        return
    try:
        ad_id = int(payload.split(":", 1)[1])
    except Exception:
        await query.answer("Noto'g'ri reklama ID", show_alert=True)
        return
    deleted = delete_ad_config_item(ad_id)
    if not deleted:
        await query.answer("Reklama topilmadi", show_alert=True)
        return
    await query.answer("Reklama o'chirildi ✅")
    data = load_ad_config()
    items = [item for item in data.get("items", []) if isinstance(item, dict)]
    if not items:
        await query.edit_message_text("Hozircha reklama yo'q.")
        return
    lines = ["Mavjud reklamalar:"]
    for item in items:
        current_id = int(item.get("id", 0))
        video_url = str(item.get("video_url", "")).strip()
        link_url = str(item.get("link_url", "")).strip()
        lines.append(f"#{current_id} | video: {video_url or '-'} | link: {link_url or '-'}")
    await query.edit_message_text("\n".join(lines), reply_markup=build_ad_list_keyboard(items))


async def admin_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return
    if not is_admin_user(update):
        await query.answer()
        return
    payload = str(query.data or "").strip()
    if not payload.startswith("admin_menu:"):
        return

    action = payload.split(":", 1)[1]
    await query.answer()
    if action == "reklama":
        context.user_data["admin_ad_flow"] = "video"
        await query.message.reply_text("Reklama video linkini yuboring.")
        return
    if action == "reklama_list":
        data = load_ad_config()
        items = [item for item in data.get("items", []) if isinstance(item, dict)]
        if not items:
            await query.message.reply_text("Hozircha reklama yo'q.")
            return
        lines = ["Mavjud reklamalar:"]
        for item in items:
            ad_id = int(item.get("id", 0))
            video_url = str(item.get("video_url", "")).strip()
            link_url = str(item.get("link_url", "")).strip()
            lines.append(f"#{ad_id} | video: {video_url or '-'} | link: {link_url or '-'}")
        await query.message.reply_text("\n".join(lines), reply_markup=build_ad_list_keyboard(items))
        return
    if action == "live":
        context.user_data["admin_live_flow"] = "link"
        await query.message.reply_text("YouTube live linkini yuboring.")
        return
    if action == "live_list":
        await query.message.reply_text(
            "Live ni to'xtatishni tasdiqlang.",
            reply_markup=build_live_stop_keyboard(),
        )
        return


async def ad_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.pop("ad_video_url", None)
    context.user_data.pop("admin_ad_flow", None)
    context.user_data.pop("admin_live_flow", None)
    if update.message:
        await update.message.reply_text("Reklama bekor qilindi.")
    return ConversationHandler.END


async def admin_flow_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not is_admin_user(update):
        return

    ad_step = str(context.user_data.get("admin_ad_flow", "")).strip()
    if ad_step == "video":
        await ad_video_url_step(update, context)
        return
    if ad_step == "link":
        await ad_link_url_step(update, context)
        return

    live_step = str(context.user_data.get("admin_live_flow", "")).strip()
    if live_step == "link":
        await live_url_step(update, context)
        return


async def user_message_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or is_admin_user(update):
        return
    await sync_telegram_user_profile(update, context)
    await send_playlist_webapp_prompt(update.message)


async def live_command_entry(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not update.message:
        return ConversationHandler.END
    if not is_admin_user(update):
        return ConversationHandler.END
    context.user_data["admin_live_flow"] = "link"
    await update.message.reply_text("YouTube live linkini yuboring.")
    return LIVE_URL


async def live_url_step(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not update.message or not update.message.text:
        return LIVE_URL
    live_url = str(update.message.text).strip()
    if not is_valid_youtube_live_url(live_url):
        await update.message.reply_text("YouTube live link yuboring. Masalan: https://www.youtube.com/live/...")
        return LIVE_URL
    payload = {
        "id": int(datetime.now().timestamp()),
        "title": "YouTube Live",
        "embed_url": live_url,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    save_json_file(LIVE_CURRENT_FILE, payload)
    context.user_data.pop("admin_live_flow", None)
    await update.message.reply_text("Live boshlandi ✅")
    return ConversationHandler.END


async def live_off_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    if not is_admin_user(update):
        return
    await update.message.reply_text(
        "Live ni to'xtatishni tasdiqlang.",
        reply_markup=build_live_stop_keyboard(),
    )


async def live_stop_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return
    if not is_admin_user(update):
        await query.answer()
        return
    save_json_file(LIVE_CURRENT_FILE, {})
    context.user_data.pop("admin_live_flow", None)
    await query.answer("Live o'chirildi ✅")
    await query.edit_message_text("Live o'chirildi ✅")


def main() -> None:
    ensure_runtime_files()
    try:
        start_api_server()
    except PermissionError:
        print("API serverni ishga tushirib bo'lmadi, bot polling davom etadi.")
    except OSError as exc:
        if getattr(exc, "errno", None) == 48:
            raise RuntimeError(
                "8000-port band. Oldingi processni to'xtating yoki `kill 13658` qiling, "
                "chunki frontend ham shu portdagi API'ga ulangan."
            ) from exc
        raise
    application = Application.builder().token(TOKEN).build()
    application.add_handler(
        ConversationHandler(
            entry_points=[MessageHandler(filters.User(user_id=list(ADMIN_USER_IDS)) & filters.Regex(r"^//reklama$"), ad_command_entry)],
            states={
                AD_VIDEO_URL: [
                    MessageHandler((filters.TEXT | filters.VIDEO | filters.Document.MimeType("video/mp4")) & ~filters.COMMAND, ad_video_url_step)
                ],
                AD_LINK_URL: [MessageHandler(filters.TEXT & ~filters.COMMAND, ad_link_url_step)],
            },
            fallbacks=[CommandHandler("cancel", ad_cancel), MessageHandler(filters.Regex(r"^bekor$"), ad_cancel)],
        )
    )
    application.add_handler(
        ConversationHandler(
            entry_points=[MessageHandler(filters.User(user_id=list(ADMIN_USER_IDS)) & filters.Regex(r"^//live$"), live_command_entry)],
            states={
                LIVE_URL: [MessageHandler(filters.TEXT & ~filters.COMMAND, live_url_step)],
            },
            fallbacks=[CommandHandler("cancel", ad_cancel), MessageHandler(filters.Regex(r"^bekor$"), ad_cancel)],
        )
    )
    admin_only_filter = filters.User(user_id=list(ADMIN_USER_IDS))
    application.add_handler(MessageHandler(admin_only_filter & filters.Regex(r"^//u//$"), admin_menu_command))
    application.add_handler(MessageHandler(admin_only_filter & filters.Regex(r"^//reklama//$"), ad_list_command))
    application.add_handler(MessageHandler(admin_only_filter & filters.Regex(r"^//live//$"), live_off_command))
    application.add_handler(
        MessageHandler(
            (
                filters.User(user_id=list(ADMIN_USER_IDS))
                & (filters.TEXT | filters.VIDEO | filters.Document.MimeType("video/mp4"))
                & ~filters.COMMAND
            ),
            admin_flow_router,
        )
    )
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND, user_message_router)
    )
    application.add_handler(CallbackQueryHandler(start_button_callback, pattern="^start_bot$"))
    application.add_handler(CallbackQueryHandler(admin_menu_callback, pattern=r"^admin_menu:"))
    application.add_handler(CallbackQueryHandler(delete_ad_callback, pattern=r"^delete_ad:\d+$"))
    application.add_handler(CallbackQueryHandler(live_stop_callback, pattern=r"^live_stop:confirm$"))
    print("🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥")
    try:
        application.run_polling()
    except Conflict as exc:
        print(f"Telegram polling conflict: {exc}")
        print("Bot polling to'xtatildi, lekin API va frontend ishlashda davom etadi.")
        while True:
            asyncio.run(asyncio.sleep(3600))
    except NetworkError:
        print("Telegram bilan ulanishda xatolik. API server ishlashda davom etadi.")
        while True:
            asyncio.run(asyncio.sleep(3600))


if __name__ == "__main__":
    main()
