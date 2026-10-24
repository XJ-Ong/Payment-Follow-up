"""Telegram Bot API transport and deliberately simulated email/WhatsApp channels.

No automatic retries: a lost response can mean Telegram accepted the message.
Never log HTTP exception strings/URLs: Telegram embeds the bot token in the URL.
"""
import os
import re
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    channel: Literal["Telegram", "WhatsApp", "Email"]
    recipient: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=4096)

    @model_validator(mode="after")
    def validate_message(self):
        if not self.body.strip() or self.recipient != self.recipient.strip():
            raise ValueError("Nonblank body and trimmed recipient required")
        if self.channel == "Telegram" and not re.fullmatch(r"-?[1-9][0-9]*", self.recipient):
            raise ValueError("Telegram recipient must be a numeric chat ID")
        return self


class DeliveryResult(BaseModel):
    model_config = ConfigDict(frozen=True)
    channel: Literal["Telegram", "WhatsApp", "Email"]
    status: Literal["sent", "simulated", "failed", "unknown"]
    provider_message_id: str | None = None
    error_code: str | None = None
    retry_after_seconds: int | None = None


class MessagingService:
    def __init__(self, token: str | None = None, *, transport: httpx.BaseTransport | None = None):
        self._token = token.strip() if token else None
        self._transport = transport

    @classmethod
    def from_env(cls):
        return cls(os.getenv("TELEGRAM_BOT_TOKEN"))

    def send(self, message: Message) -> DeliveryResult:
        """Call only with server-verified approved text and authorized recipient.

        `sent` means Telegram accepted the message, not that a recipient read it.
        This method is blocking; run in a sync route or background worker.
        """
        def result(status, **kwargs):
            return DeliveryResult(channel=message.channel, status=status, **kwargs)

        if message.channel != "Telegram":
            return result("simulated")
        if not self._token:
            return result("failed", error_code="not_configured")
        try:
            with httpx.Client(timeout=15.0, transport=self._transport, follow_redirects=False, trust_env=False) as client:
                response = client.post(
                    f"https://api.telegram.org/bot{self._token}/sendMessage",
                    json={"chat_id": message.recipient, "text": message.body,
                          "link_preview_options": {"is_disabled": True}},
                )
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout):
            return result("failed", error_code="connection_failed")
        except httpx.RequestError:
            return result("unknown", error_code="transport_uncertain")
        try:
            data = response.json()
        except ValueError:
            return result("unknown", error_code="invalid_response")
        if not isinstance(data, dict):
            return result("unknown", error_code="invalid_response")
        if response.status_code == 200 and data.get("ok") is True:
            payload = data.get("result")
            message_id = payload.get("message_id") if isinstance(payload, dict) else None
            if type(message_id) is int and message_id > 0:
                return result("sent", provider_message_id=str(message_id))
            return result("unknown", error_code="invalid_response")
        code = data.get("error_code")
        if data.get("ok") is False and type(code) is int and 400 <= code < 500:
            parameters = data.get("parameters")
            delay = parameters.get("retry_after") if isinstance(parameters, dict) else None
            return result("failed", error_code=f"telegram_{code}",
                          retry_after_seconds=delay if type(delay) is int and delay >= 0 else None)
        return result("unknown", error_code="provider_uncertain")
