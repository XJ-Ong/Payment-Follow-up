"""Explicit, synthetic Telegram smoke test; no database or web server needed."""
import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from .service import Message, MessagingService


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--send-test", action="store_true", help="Send one real synthetic test message")
    args = parser.parse_args()
    if not args.send_test:
        parser.error("Pass --send-test to explicitly send a real Telegram message")
    load_dotenv(Path(__file__).resolve().parents[4] / ".env")
    recipient = os.getenv("TELEGRAM_TEST_CHAT_ID", "").strip()
    if not recipient or not os.getenv("TELEGRAM_BOT_TOKEN", "").strip():
        parser.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_TEST_CHAT_ID in the environment or root .env")
    try:
        message = Message(channel="Telegram", recipient=recipient,
                          body="Payment Follow-up test: synthetic invoice TEST-001 has MYR 10.00 outstanding. This is a test message only.")
    except ValueError:
        parser.error("TELEGRAM_TEST_CHAT_ID must be a numeric Telegram chat ID")
    result = MessagingService.from_env().send(message)
    print(result.model_dump_json())
    return 0 if result.status == "sent" else 1


if __name__ == "__main__":
    raise SystemExit(main())
