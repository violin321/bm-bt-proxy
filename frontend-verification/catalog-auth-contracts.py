"""Directory login boundaries and persistence, without real credentials."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.catalog_auth import login_catalog
from app.config import AppSettings, UpstreamSource, public_source, request_config
from app.upstream_catalog import parse_article_categories


def source(**extra):
    return UpstreamSource(**{"id": "fixture", "url": "http://source.test/prefix/api/v1/articles/torrents",
                             "headers": {"X-API-Key": "search-private"}, **extra})


credentials = {"username": "fixture-user", "password": " pass+$private ", "otp_code": "123456"}
directory = {"data": [{"categories": [{"name": "字幕", "count": 4}]}]}


class Login(unittest.IsolatedAsyncioTestCase):
    async def test_both_envelopes_post_form_then_verify_only_the_directory(self):
        for wrapped in [False, True]:
            calls = []
            def respond(request):
                calls.append(request)
                if request.method == "POST":
                    self.assertEqual(request.url.path, "/prefix/api/v1/users/login")
                    self.assertEqual(request.url.query, b"")
                    self.assertEqual(parse_qs(request.content.decode()),
                                     {k: [credentials[k]] for k in ["username", "password"]})
                    self.assertNotIn("X-API-Key", request.headers)
                    value = {"access_token": "session-private"}
                    return httpx.Response(200, json={"code": 0, "data": value} if wrapped else value)
                self.assertEqual(request.url.path, "/prefix/api/v1/articles/categories")
                self.assertEqual(request.headers["Authorization"], "Bearer session-private")
                self.assertEqual(request.headers["X-API-Key"], "search-private")
                return httpx.Response(200, json=directory)
            original = source()
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                updated = await login_catalog(original, credentials, client)
            self.assertEqual(len(calls), 2)
            self.assertEqual(request_config(original), request_config(updated))
            self.assertNotIn("session-private", json.dumps(public_source(updated)))
            self.assertNotIn(credentials["password"], json.dumps(updated.model_dump()))

    async def test_2fa_completes_before_directory_access(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            if request.url.path.endswith("/login"):
                return httpx.Response(200, json={"code": 0, "data": {"requires_2fa": True, "otp_token": "challenge-private"}})
            if request.url.path.endswith("/2fa"):
                self.assertEqual(parse_qs(request.content.decode()), {"otp_token": ["challenge-private"], "otp_code": ["123456"]})
                return httpx.Response(200, json={"code": 0, "data": {"access_token": "session-private"}})
            return httpx.Response(200, json=directory)
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            updated = await login_catalog(source(), credentials, client)
        self.assertEqual(updated.catalog_headers, {"Authorization": "Bearer session-private"})
        self.assertEqual(len(calls), 3)

    async def test_missing_otp_and_login_failures_are_redacted_and_never_follow_redirects(self):
        responses = [httpx.Response(302, headers={"Location": "http://other.test/"}),
                     httpx.Response(401, text="password=private"),
                     httpx.Response(200, json={"code": 1, "message": "password=private"}),
                     httpx.Response(200, json={"requires_2fa": True, "otp_token": "private"}),
                     httpx.Response(200, json={"access_token": "line\nbreak"}),
                     httpx.Response(200, content=b"x" * (64 * 1024 + 1))]
        for response in responses:
            calls = []
            def respond(request):
                calls.append(request)
                return response
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond), follow_redirects=True) as client:
                with self.assertRaises(HTTPException) as error:
                    await login_catalog(source(), {**credentials, "otp_code": ""}, client)
            self.assertEqual(len(calls), 1)
            self.assertNotIn("private", str(error.exception.detail))

    async def test_unsupported_disabled_and_invalid_credentials_never_contact_source(self):
        def unexpected(request):
            self.fail("unexpected upstream request")
        async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected)) as client:
            for s, value in [(source(catalog_mode="disabled"), credentials),
                             (source(url="http://source.test/api/torrents"), credentials),
                             (source(), {"username": "u", "password": 7}),
                             (source(), {**credentials, "login_url": "http://other.test"})]:
                with self.assertRaises(HTTPException):
                    await login_catalog(s, value, client)

    async def test_no_session_committed_if_directory_permissions_fail(self):
        def respond(request):
            return httpx.Response(200, json={"access_token": "session-private"}) if request.method == "POST" else httpx.Response(403)
        original = source(catalog_headers={"Cookie": "old-private"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with self.assertRaises(HTTPException):
                await login_catalog(original, credentials, client)
        self.assertEqual(original.catalog_headers, {"Cookie": "old-private"})


class Persistence(unittest.TestCase):
    def test_api_saves_only_verified_session_and_failed_login_preserves_config(self):
        from app import main
        from app.label_catalog import LabelCatalog
        async def login(s, creds):
            self.assertEqual(creds, credentials)
            if s.name == "failed":
                raise HTTPException(422, "登录失败")
            return s.model_copy(update={"catalog_headers": {"Authorization": "Bearer session-private"}})
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "config.json"
            settings = AppSettings(sources=[source()])
            with patch.object(main, "settings", settings), patch.object(main, "WEB_USERNAME", "preview"), patch.object(main, "WEB_PASSWORD", "preview"), patch.object(main, "login_catalog", login), patch.object(main, "label_catalog", LabelCatalog(Path(tmp)/"labels.db")), patch("app.config.CONFIG_FILE", str(config)), patch("app.config.DATA_DIR", tmp):
                # Avoid startup: it would load unrelated default settings.
                client = TestClient(main.app)
                self.assertEqual(client.put("/api/sources/fixture", json={"catalog_login": credentials}).status_code, 401)
                client.cookies.set("bm_session", main.generate_cookie_token())
                response = client.put("/api/sources/fixture", json={"catalog_login": credentials})
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("session-private", response.text)
                saved = config.read_text()
                self.assertNotIn("catalog_login", saved)
                self.assertNotIn(credentials["password"], saved)
                self.assertIn("session-private", saved)
                response = client.put("/api/sources/fixture", json={"name": "failed", "catalog_login": credentials})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(config.read_text(), saved)
                self.assertEqual(client.get("/api/settings").json()["sources"][0]["has_catalog_headers"], True)
                client.close()

    def test_flat_and_nested_article_category_responses(self):
        flat = parse_article_categories(directory)
        nested = parse_article_categories({"data": [{"sections": directory["data"]}]})
        self.assertEqual(flat, nested)
        with self.assertRaises(ValueError):
            parse_article_categories({"data": [{"sections": [{}]}]})


if __name__ == "__main__":
    unittest.main(verbosity=2)
