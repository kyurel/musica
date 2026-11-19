"""Signing the worker in as its Mac's user.

`musica-worker login` runs GitHub sign-in in the browser (PKCE, localhost callback) and
keeps only the refresh token, in the macOS Keychain. Every later start refreshes the
session and stores the rotated token again.
"""

from __future__ import annotations

import http.server
import threading
import urllib.parse
import webbrowser

import keyring

KEYCHAIN_SERVICE = "musica-worker"
CALLBACK_PORT = 54329
CALLBACK_URL = f"http://127.0.0.1:{CALLBACK_PORT}/callback"


def make_client(url: str, anon_key: str):
    from supabase import ClientOptions, create_client

    # 'x-musica-via: worker' makes the change log say "<user> via worker".
    options = ClientOptions(flow_type="pkce", headers={"x-musica-via": "worker"},
                            auto_refresh_token=True, persist_session=False)
    return create_client(url, anon_key, options)


def _store(account: str, refresh_token: str) -> None:
    keyring.set_password(KEYCHAIN_SERVICE, account, refresh_token)


def signed_in_client(url: str, anon_key: str, account: str):
    """A client signed in with the stored refresh token. Raises if login is needed."""
    token = keyring.get_password(KEYCHAIN_SERVICE, account)
    if not token:
        raise RuntimeError("not signed in: run `musica-worker login` first")
    client = make_client(url, anon_key)
    resp = client.auth.refresh_session(token)
    _store(account, resp.session.refresh_token)

    def on_change(event, session):  # keep the rotated token
        if session and session.refresh_token:
            _store(account, session.refresh_token)

    client.auth.on_auth_state_change(on_change)
    return client


def login(url: str, anon_key: str, account: str) -> str:
    """Browser sign-in with GitHub. Returns the GitHub login of the signed-in user."""
    client = make_client(url, anon_key)
    res = client.auth.sign_in_with_oauth({"provider": "github", "options": {"redirect_to": CALLBACK_URL}})

    got: dict[str, str] = {}
    done = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            got.update({k: v[0] for k, v in query.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Musica worker signed in. You can close this tab.")
            done.set()

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", CALLBACK_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Opening the browser for GitHub sign-in:\n{res.url}")
    webbrowser.open(res.url)
    done.wait(timeout=300)
    server.shutdown()

    if "code" not in got:
        raise RuntimeError(f"sign-in did not complete: {got.get('error_description', 'timed out')}")
    session = client.auth.exchange_code_for_session({"auth_code": got["code"]})
    _store(account, session.session.refresh_token)
    meta = session.user.user_metadata or {}
    return meta.get("user_name") or meta.get("preferred_username") or session.user.id


def logout(account: str) -> None:
    try:
        keyring.delete_password(KEYCHAIN_SERVICE, account)
    except keyring.errors.PasswordDeleteError:
        pass
