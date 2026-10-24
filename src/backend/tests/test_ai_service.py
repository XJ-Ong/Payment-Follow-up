"""Tests for the AI service: drafting, verification, fallback, explanations, summaries."""
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest

from app.services import ai_service


@pytest.fixture
def facts():
    return {
        "invoice_no": "INV-2024-001",
        "due_date": "2026-10-15",
        "outstanding_amount": "5000.00",
        "currency": "MYR",
        "customer_name": "Restoran Pak Ali",
        "company_name": "Maju Jaya Enterprise",
        "channel": "WhatsApp",
        "language": "English",
        "tone": "Friendly",
    }


@pytest.fixture
def calculation():
    return {
        "outstanding": Decimal("5000.00"),
        "days_overdue": 10,
        "grace_days": 7,
        "effective_days": 3,
        "score": Decimal("15000.00"),
        "trigger_type": "threshold",
    }


@pytest.fixture
def metrics():
    return {
        "total_overdue": Decimal("50000.00"),
        "change_from_last_week": Decimal("5000.00"),
        "amount_collected": Decimal("10000.00"),
        "reminders_drafted": 5,
        "reminders_approved": 4,
        "reminders_skipped": 1,
        "items_snoozed_next_week": 2,
    }


def test_draft_reminder_falls_back_when_ai_unavailable(facts):
    with patch.object(ai_service, "AI_AVAILABLE", False):
        body, meta = ai_service.draft_reminder(facts, {})
    assert "INV-2024-001" in body
    assert "5000.00" in body
    assert "Restoran Pak Ali" in body
    assert meta["source"] == "template"
    assert meta["fallback_reason"] == "ai_unavailable"


def test_draft_reminder_falls_back_on_api_error(facts):
    mock = Mock()
    mock.chat.completions.create.side_effect = TimeoutError("API timeout")
    with patch.object(ai_service, "AI_AVAILABLE", True), patch.object(ai_service, "client", mock):
        body, meta = ai_service.draft_reminder(facts, {})
    assert "INV-2024-001" in body
    assert meta["source"] == "template"
    assert meta["fallback_reason"].startswith("ai_error")


def test_draft_reminder_falls_back_when_numbers_changed(facts):
    response = Mock()
    response.choices = [Mock(message=Mock(content="Please pay MYR 5000.00 for INV-WRONG-001 by 2026-10-15. Maju Jaya Enterprise"))]
    response.usage = Mock(total_tokens=42)
    mock = Mock()
    mock.chat.completions.create.return_value = response
    with patch.object(ai_service, "AI_AVAILABLE", True), patch.object(ai_service, "client", mock):
        body, meta = ai_service.draft_reminder(facts, {})
    assert meta["source"] == "template"
    assert meta["fallback_reason"] == "verification_failed"
    assert meta["verification_details"]["checks"]["invoice_no"] is False


def test_draft_reminder_uses_ai_output_when_verified(facts):
    draft = "Hi Restoran Pak Ali, a gentle reminder that invoice INV-2024-001 for MYR 5000.00 was due on 2026-10-15. Please confirm your payment date. Thank you, Maju Jaya Enterprise"
    response = Mock()
    response.choices = [Mock(message=Mock(content=draft))]
    response.usage = Mock(total_tokens=75)
    mock = Mock()
    mock.chat.completions.create.return_value = response
    with patch.object(ai_service, "AI_AVAILABLE", True), patch.object(ai_service, "client", mock):
        body, meta = ai_service.draft_reminder(facts, {})
    assert body == draft
    assert meta["source"] == "ai"
    assert meta["model"] == ai_service.DEFAULT_MODEL
    assert meta["prompt_version"] == ai_service.PROMPT_VERSION
    assert meta["verification_passed"] is True
    assert meta["tokens_used"] == 75


def test_number_verification_accepts_formatted_amount(facts):
    draft = "Invoice INV-2024-001 due 2026-10-15, amount MYR 5,000.00 from Maju Jaya Enterprise"
    result = ai_service._verify_numbers(draft, facts)
    assert result["passed"] is True
    assert result["checks"]["outstanding_amount"] is True


def test_number_verification_rejects_wrong_amount(facts):
    draft = "Invoice INV-2024-001 due 2026-10-15, amount MYR 6000.00 from Maju Jaya Enterprise"
    result = ai_service._verify_numbers(draft, facts)
    assert result["passed"] is False
    assert result["checks"]["outstanding_amount"] is False


def test_prompt_contains_key_facts_and_constraints(facts):
    prompt = ai_service._build_reminder_prompt(facts)
    for value in ("INV-2024-001", "2026-10-15", "5000.00", "Restoran Pak Ali", "Maju Jaya Enterprise"):
        assert value in prompt
    assert "Do NOT include any contact details" in prompt
    assert "Do NOT threaten legal action" in prompt
    assert "EXACT invoice number" in prompt


def test_draft_reminder_tone_override_does_not_mutate_input(facts):
    with patch.object(ai_service, "AI_AVAILABLE", False):
        _, meta = ai_service.draft_reminder(facts, {}, tone="Firm")
    assert facts["tone"] == "Friendly"
    assert meta["source"] == "template"


def test_explain_ranking_english(calculation):
    text, meta = ai_service.explain_ranking(calculation, "Restoran Pak Ali", "English")
    assert "Restoran Pak Ali" in text
    assert "5,000.00" in text
    assert "3 effective days" in text
    assert "15,000 RM-days" in text
    assert meta["source"] == "template"
    assert meta["language"] == "English"


def test_explain_ranking_bahasa(calculation):
    text, meta = ai_service.explain_ranking(calculation, "Restoran Pak Ali", "Bahasa Malaysia")
    assert "Restoran Pak Ali" in text
    assert "RM 5,000.00" in text
    assert meta["language"] == "Bahasa Malaysia"


def test_explain_ranking_safety_rule_trigger(calculation):
    text, _ = ai_service.explain_ranking({**calculation, "trigger_type": "safety_rule", "days_overdue": 45},
                                         "Kedai Bina Jaya", "English")
    assert "safety rule" in text.lower()
    assert "45 days overdue" in text


def test_explain_ranking_both_trigger(calculation):
    text, _ = ai_service.explain_ranking({**calculation, "trigger_type": "both"}, "Kedai Bina Jaya", "English")
    assert "both the alert threshold and the safety rule" in text


def test_weekly_narrative_english(metrics):
    text, meta = ai_service.generate_weekly_narrative(metrics, "English")
    assert "50,000.00" in text
    assert "up RM 5,000.00" in text
    assert "10,000.00" in text
    assert "approved 4 of 5" in text
    assert "1 reminders were skipped or snoozed" in text
    assert "2 snoozed items will resume next week" in text
    assert meta["source"] == "template"


def test_weekly_narrative_bahasa(metrics):
    text, meta = ai_service.generate_weekly_narrative(metrics, "Bahasa Malaysia")
    assert "RM 50,000.00" in text
    assert "naik RM 5,000.00" in text
    assert meta["language"] == "Bahasa Malaysia"


def test_weekly_narrative_down_and_unchanged(metrics):
    down, _ = ai_service.generate_weekly_narrative({**metrics, "change_from_last_week": Decimal("-3000.00")}, "English")
    assert "down RM 3,000.00" in down
    unchanged, _ = ai_service.generate_weekly_narrative({**metrics, "change_from_last_week": Decimal("0.00")}, "English")
    assert "unchanged" in unchanged


def test_weekly_narrative_empty_metrics():
    text, _ = ai_service.generate_weekly_narrative({}, "English")
    assert "RM 0.00" in text
