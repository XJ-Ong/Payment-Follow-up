import json

import httpx
import pytest
from pydantic import ValidationError

from app.messaging import Message, MessagingService


def message(channel="Telegram", **kwargs):
    return Message(channel=channel, recipient="123456", body="Invoice TEST-1: MYR 10.00", **kwargs)


def service(handler):
    return MessagingService("123:test-secret", transport=httpx.MockTransport(handler))


def test_telegram_request_and_success():
    def handler(request):
        assert request.method == "POST"
        assert request.url.host == "api.telegram.org"
        assert request.url.path.endswith("/sendMessage")
        assert json.loads(request.content) == {
            "chat_id": "123456", "text": "Invoice TEST-1: MYR 10.00",
            "link_preview_options": {"is_disabled": True},
        }
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 42}})
    result = service(handler).send(message())
    assert result.status == "sent"
    assert result.provider_message_id == "42"


@pytest.mark.parametrize("channel", ["WhatsApp", "Email"])
def test_simulation_never_calls_network(channel):
    def handler(request):
        pytest.fail("Simulated channels must not contact a provider")
    assert service(handler).send(message(channel)).status == "simulated"


def test_missing_configuration():
    assert MessagingService().send(message()).error_code == "not_configured"


@pytest.mark.parametrize("code", [400, 401, 403, 429])
def test_provider_rejection_and_rate_limit(code):
    result = service(lambda _: httpx.Response(code, json={
        "ok": False, "error_code": code,
        "description": "Never expose provider descriptions or secrets",
        "parameters": {"retry_after": 12},
    })).send(message())
    assert result.status == "failed"
    assert result.error_code == f"telegram_{code}"
    assert result.retry_after_seconds == 12
    assert "description" not in result.model_dump_json()


@pytest.mark.parametrize("error,status", [
    (httpx.ConnectError, "failed"), (httpx.ConnectTimeout, "failed"),
    (httpx.ReadTimeout, "unknown"), (httpx.WriteError, "unknown"),
])
def test_transport_errors_are_redacted_and_not_retried(error, status):
    calls = []
    def handler(request):
        calls.append(request)
        raise error("123:test-secret", request=request)
    result = service(handler).send(message())
    assert result.status == status
    assert "test-secret" not in result.model_dump_json()
    assert len(calls) == 1


@pytest.mark.parametrize("response", [
    httpx.Response(502, text="Bad gateway"),
    httpx.Response(500, json={"ok": False, "error_code": 500}),
    httpx.Response(200, json=[]),
    httpx.Response(200, json={"ok": True, "result": {}}),
    httpx.Response(302, headers={"location": "https://example.com"}),
])
def test_uncertain_responses(response):
    assert service(lambda _: response).send(message()).status == "unknown"


@pytest.mark.parametrize("changes", [
    {"recipient": "@someone"}, {"recipient": " 123"}, {"recipient": "0"},
    {"body": " "}, {"body": "x" * 4097}, {"channel": "SMS"},
])
def test_invalid_input(changes):
    with pytest.raises(ValidationError):
        Message(**({"channel": "Telegram", "recipient": "123", "body": "test"} | changes))


def test_group_chat_and_unicode_text():
    msg = Message(channel="Telegram", recipient="-100123456", body="Peringatan: baki MYR 10.00 😊")
    assert msg.recipient == "-100123456"


def test_environment_factory(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    assert MessagingService.from_env().send(message()).status == "failed"
