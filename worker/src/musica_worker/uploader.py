"""Preview upload through a short-lived presigned URL.

The worker never holds storage keys. It asks the Musica web app for a one-time upload
URL for a version (signed in as its user), then PUTs the file there.

Contract (served by the web app):
  POST {api}/api/previews/upload-url  {"version_id": "..."}
  Authorization: Bearer <user access token>
  -> 200 {"url": "<presigned PUT URL>", "key": "<object key>"}

The web app sits behind Cloudflare Access, so the request also carries the Access
service token (MUSICA_ACCESS_CLIENT_ID / MUSICA_ACCESS_CLIENT_SECRET) when it is set.
It goes only to the web app, never to the storage URL.
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx


def access_headers(env=os.environ) -> dict[str, str]:
    cid, secret = env.get("MUSICA_ACCESS_CLIENT_ID"), env.get("MUSICA_ACCESS_CLIENT_SECRET")
    return {"CF-Access-Client-Id": cid, "CF-Access-Client-Secret": secret} if cid and secret else {}


class PresignedUploader:
    def __init__(self, api_url: str, access_token: callable) -> None:
        self.api_url = api_url.rstrip("/")
        self.access_token = access_token  # called each time, so refreshed tokens are used

    def upload_preview(self, version_id: str, file: Path) -> str:
        with httpx.Client(timeout=120) as http:
            r = http.post(f"{self.api_url}/api/previews/upload-url", json={"version_id": version_id},
                          headers={"Authorization": f"Bearer {self.access_token()}", **access_headers()})
            r.raise_for_status()
            target = r.json()
            with open(file, "rb") as f:
                put = http.put(target["url"], content=f.read(), headers={"Content-Type": "audio/mpeg"})
            put.raise_for_status()
            return target["key"]
