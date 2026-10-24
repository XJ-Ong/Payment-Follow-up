"""Integration tests for AI-drafted reminders (AI-1), ranking explanations (AI-2) and weekly summaries (AI-3)."""
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ActivityLog, Invoice
from app.main import COMPANY
from app.services import ai_service, workflow
from app.services.followups import refresh_workspace
from test_workflow import ADAPTER, FINANCE, NOW, TODAY, act, create, invoice


def _fake_ai_reminder(facts, policy, tone=None):
    """Deterministic stand-in for a live model: the template body always passes validation."""
    body = workflow.template(facts)
    return body, {
        "source": "ai",
        "model": "test-llm",
        "prompt_version": "v1.0",
        "verification_passed": True,
        "verification_details": {"passed": True, "checks": 4, "draft_length": len(body)},
        "tokens_used": 128,
    }


def _version_created_log(engine, invoice_id):
    with Session(engine) as db:
        return db.scalar(select(ActivityLog).where(
            ActivityLog.company_id == COMPANY,
            ActivityLog.action == "draft.version_created",
            ActivityLog.entity_id == invoice_id,
        ))


def test_new_version_uses_template_fallback_when_ai_unavailable(database):
    """First draft attempts AI and falls back to the template when no model is available."""
    engine, _ = database
    invoice_id = invoice(engine)
    with patch.object(ai_service, "AI_AVAILABLE", False):
        draft = create(engine, invoice_id)
    assert draft["written_by"] == "template"
    assert draft["ai_model"] is None
    assert draft["prompt_version"] is None
    assert draft["verification_result"]["source"] == "template"
    assert draft["verification_result"]["fallback_reason"] == "ai_unavailable"
    # Guardrail "Logged": the activity log records the drafting source and fallback.
    entry = _version_created_log(engine, invoice_id)
    assert entry.after_state["source"] == "template"
    assert entry.after_state["fallback_reason"] == "ai_unavailable"


def test_new_version_stores_ai_metadata(database):
    """When AI produces a verified draft, its identity and verification are persisted."""
    engine, _ = database
    invoice_id = invoice(engine)
    with patch.object(ai_service, "draft_reminder", side_effect=_fake_ai_reminder):
        draft = create(engine, invoice_id)
    assert draft["written_by"] == "ai"
    assert draft["ai_model"] == "test-llm"
    assert draft["prompt_version"] == "v1.0"
    result = draft["verification_result"]
    assert result["facts_checked"] is True
    assert result["source"] == "ai"
    assert result["verification_passed"] is True
    assert result["tokens_used"] == 128
    entry = _version_created_log(engine, invoice_id)
    assert entry.after_state["source"] == "ai"
    assert entry.after_state["ai_model"] == "test-llm"


def test_user_edit_marks_as_human(database):
    """A human edit of an AI draft supersedes it with written_by 'human' and no AI identity."""
    engine, _ = database
    invoice_id = invoice(engine)
    with patch.object(ai_service, "draft_reminder", side_effect=_fake_ai_reminder):
        draft = create(engine, invoice_id)
    assert draft["written_by"] == "ai"
    edited = act(engine, draft, "versions", body=draft["body"] + "\nWe would appreciate prompt payment.")
    assert edited["version"] == 2
    assert edited["written_by"] == "human"
    assert edited["ai_model"] is None
    assert edited["prompt_version"] is None
    assert edited["verification_result"]["source"] == "human"


def test_workspace_invoice_view_includes_ranking_explanation(database):
    """AI-2: overdue invoices carry a ranking explanation; upcoming invoices do not."""
    engine, _ = database
    overdue_id = invoice(engine)
    upcoming_id = invoice(engine)
    with Session(engine) as db:
        upcoming = db.get(Invoice, upcoming_id)
        upcoming.due_date = TODAY + timedelta(days=10)
        db.commit()
    with Session(engine) as db:
        workspace = refresh_workspace(db, COMPANY, ADAPTER, FINANCE.id, now=NOW)
        db.commit()
    overdue = next(i for i in workspace.invoices if i.id == overdue_id)
    upcoming_row = next(i for i in workspace.invoices if i.id == upcoming_id)
    assert overdue.explanation
    assert "1,000" in overdue.explanation or "1000" in overdue.explanation
    assert upcoming_row.explanation is None


def test_summary_generate_and_fetch_endpoints(client):
    """AI-3: POST /api/summaries/generate then GET /api/summaries/{id}; invalid ranges are rejected."""
    headers = {"X-Role": "Owner"}
    bad = client.post("/api/summaries/generate", headers=headers,
                      json={"week_start": "2026-10-25", "week_end": "2026-10-24"})
    assert bad.status_code == 422
    created = client.post("/api/summaries/generate", headers=headers,
                          json={"week_start": "2026-10-18", "week_end": "2026-10-24", "language": "English"})
    assert created.status_code == 200, created.text
    payload = created.json()
    assert payload["written_by"] == "template"  # no live model in the test environment
    assert "total_overdue" in payload["metrics"]
    assert payload["narrative"]
    fetched = client.get(f"/api/summaries/{payload['id']}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["narrative"] == payload["narrative"]
    assert client.get(f"/api/summaries/{uuid4()}", headers=headers).status_code == 404
