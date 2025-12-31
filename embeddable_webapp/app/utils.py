# utils/appscript_token.py
import base64
import hmac
import hashlib
import time
import requests
from urllib.parse import urlsplit, urlunsplit
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


def sync_user_to_appscript(username: str, email: str) -> bool:
    """
    同步使用者資料到 Apps Script (Google Sheets)
    
    Args:
        username: 使用者名稱
        email: 使用者電子郵件
    
    Returns:
        bool: 是否同步成功
    """
    try:
        # 產生管理員 token（用於呼叫 Apps Script API）
        secret = settings.APPSCRIPT_SHARED_SECRET
        ts = int(time.time())
        action = "add_user"
        payload = f"{action}|{username}|{email}|{ts}".encode("utf-8")
        
        signature = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
        payload_b64 = base64url_encode(payload)
        sig_b64 = base64url_encode(signature)
        admin_token = f"{payload_b64}.{sig_b64}"
        
        # 呼叫 Apps Script API
        # 注意：APPSCRIPT_WEBAPP_URL 可能已包含給 iframe 用的 token query。
        # 這裡是 action API 呼叫，會另外帶入 admin_token，避免 URL 內既有 query 造成重複 token。
        raw_url = (settings.APPSCRIPT_WEBAPP_URL or "").strip()
        parts = urlsplit(raw_url)
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        params = {
            'action': 'add_user',
            'token': admin_token,
            'username': username,
            'email': email
        }
        
        response = requests.get(url, params=params, timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            return result.get('success', False)
        else:
            print(f"同步使用者失敗: HTTP {response.status_code}")
            return False
            
    except Exception as e:
        print(f"同步使用者到 Apps Script 時發生錯誤: {str(e)}")
        return False