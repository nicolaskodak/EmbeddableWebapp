# utils/appscript_token.py
import base64
import hmac
import hashlib
import time
from django.conf import settings


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def generate_iframe_token(user_id: str, origin: str, max_age_seconds: int = 60) -> str:
    """
    產生給 Apps Script 用的 token。
    user_id: 可以是 str(user.id) 或 username
    origin: 嵌入頁面的來源 URL（例如 'http://127.0.0.1:8000'）
    max_age_seconds: 不是寫在 token 裡，只是你可以記錄用途，Apps Script 端會做過期檢查
    """
    secret = settings.APPSCRIPT_SHARED_SECRET
    ts = int(time.time())  # epoch seconds
    payload = f"{user_id}|{ts}|{origin}".encode("utf-8")

    signature = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()

    payload_b64 = base64url_encode(payload)
    sig_b64 = base64url_encode(signature)

    token = f"{payload_b64}.{sig_b64}"
    return token