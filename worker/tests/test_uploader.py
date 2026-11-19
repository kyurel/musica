import httpx

from musica_worker import uploader
from musica_worker.uploader import PresignedUploader, access_headers


def test_access_headers_only_when_both_set():
    assert access_headers({}) == {}
    assert access_headers({"MUSICA_ACCESS_CLIENT_ID": "id"}) == {}
    assert access_headers({"MUSICA_ACCESS_CLIENT_ID": "id", "MUSICA_ACCESS_CLIENT_SECRET": "s"}) == {
        "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "s"}


def test_access_token_goes_to_the_app_not_to_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("MUSICA_ACCESS_CLIENT_ID", "id")
    monkeypatch.setenv("MUSICA_ACCESS_CLIENT_SECRET", "secret")
    seen = []

    def handler(req: httpx.Request):
        seen.append(req)
        if req.url.host == "musica.example":
            return httpx.Response(200, json={"url": "https://r2.example/p.mp3?sig=1", "key": "previews/v.mp3"})
        return httpx.Response(200)

    real = httpx.Client
    monkeypatch.setattr(uploader.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    f = tmp_path / "p.mp3"
    f.write_bytes(b"mp3")
    assert PresignedUploader("https://musica.example/", lambda: "tok").upload_preview("v", f) == "previews/v.mp3"
    app, storage = seen
    assert app.headers["CF-Access-Client-Secret"] == "secret" and app.headers["Authorization"] == "Bearer tok"
    assert "CF-Access-Client-Secret" not in storage.headers and "Authorization" not in storage.headers
