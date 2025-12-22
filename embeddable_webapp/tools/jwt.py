import os
import requests
from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

BASE = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

def insert_item(name: str, qty: int) -> dict:
    url = f"{BASE}/items"
    # PostgREST：加 Prefer: return=representation 才會把插入後的列回傳
    headers = {**HEADERS, "Prefer": "return=representation"}
    r = requests.post(url, headers=headers, json={"name": name, "qty": qty}, timeout=30)
    r.raise_for_status()
    return r.json()[0]

def select_items() -> list[dict]:
    # ?select=* 表示回傳所有欄位
    url = f"{BASE}/items?select=*"
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()

def upsert_item_by_name(name: str, qty: int) -> list[dict]:
    """
    需要 items.name 有 unique constraint/index，才能 on_conflict=name
    """
    url = f"{BASE}/items?on_conflict=name"
    headers = {
        **HEADERS,
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    r = requests.post(url, headers=headers, json=[{"name": name, "qty": qty}], timeout=30)
    r.raise_for_status()
    return r.json()

def delete_item_by_id(item_id: str) -> int:
    # PostgREST delete 用 query filter：?id=eq.<uuid>
    url = f"{BASE}/items?id=eq.{item_id}"
    r = requests.delete(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    # delete 預設不回傳內容，成功通常是 204
    return r.status_code

if __name__ == "__main__":
    # created = insert_item("apple", 10)
    # print("INSERT:", created)

    # rows = select_items()
    # print("SELECT:", rows)

    upserted = upsert_item_by_name("apple", 99)
    print("UPSERT:", upserted)

    rows = select_items()
    print("SELECT:", rows)

    # status = delete_item_by_id(created["id"])
    # print("DELETE status:", status)

    # rows = select_items()
    # print("SELECT:", rows)