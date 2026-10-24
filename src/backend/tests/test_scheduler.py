"""Tests for the scheduled job infrastructure and logic."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import scheduler
from app.db.models import ActivityLog
from app.ids import external_uuid


COMPANY = external_uuid("COMP-01")


def _workspace(eligible_scores):
    """Minimal stand-in for the WorkspaceView returned by refresh_workspace."""
    return SimpleNamespace(invoices=[
        SimpleNamespace(calculation=SimpleNamespace(eligible=eligible, score=score))
        for eligible, score in eligible_scores
    ])


def test_daily_scoring_job_logs_success(database):
    """Daily job should log successful run to activity log."""
    engine, _ = database

    with patch.object(scheduler, "SessionLocal", return_value=Session(engine)):
        with patch.object(scheduler, "refresh_workspace") as mock_refresh:
            mock_refresh.return_value = _workspace([(True, "1000.00"), (False, "0.00")])

            scheduler.daily_scoring_job()

    # Verify activity log entry
    with Session(engine) as db:
        log_entry = db.scalar(
            select(ActivityLog)
            .where(ActivityLog.action == "scheduler.daily_scoring")
            .where(ActivityLog.company_id == COMPANY)
            .order_by(ActivityLog.created_at.desc())
        )
        assert log_entry is not None
        assert log_entry.actor_type == "system"
        assert log_entry.after_state["eligible_count"] == 1


def test_daily_scoring_job_logs_failure(database):
    """Daily job should log errors without crashing."""
    engine, _ = database

    with patch.object(scheduler, "SessionLocal", return_value=Session(engine)):
        with patch.object(scheduler, "refresh_workspace", side_effect=Exception("Database error")):
            scheduler.daily_scoring_job()  # Should not raise

    # Verify failure logged
    with Session(engine) as db:
        log_entry = db.scalar(
            select(ActivityLog)
            .where(ActivityLog.action == "scheduler.daily_scoring_failed")
            .where(ActivityLog.company_id == COMPANY)
            .order_by(ActivityLog.created_at.desc())
        )
        assert log_entry is not None
        assert "Database error" in log_entry.after_state["error"]


def test_weekly_summary_job_calculates_previous_week(database):
    """Weekly job should generate summary for last Monday-Sunday."""
    engine, _ = database

    with patch.object(scheduler, "SessionLocal", return_value=Session(engine)):
        with patch.object(scheduler, "generate_summary") as mock_generate:
            mock_generate.return_value = uuid4()

            # Mock today as Wednesday
            with patch.object(scheduler, "date") as mock_date:
                mock_date.today.return_value = date(2026, 10, 28)  # Wednesday

                scheduler.weekly_summary_job()

            # Should generate for previous week (Oct 19-25)
            call_args = mock_generate.call_args
            assert call_args[0][1] == date(2026, 10, 19)  # Last Monday
            assert call_args[0][2] == date(2026, 10, 25)  # Last Sunday


def test_scheduler_starts_and_stops():
    """Scheduler should start and stop gracefully."""
    with patch.object(scheduler, "ENABLE_SCHEDULER", True):
        with patch.object(scheduler, "BackgroundScheduler") as MockScheduler:
            mock_instance = Mock()
            MockScheduler.return_value = mock_instance

            scheduler.start_scheduler()
            assert mock_instance.start.called

            scheduler.stop_scheduler()
            assert mock_instance.shutdown.called


def test_scheduler_disabled_by_default():
    """When ENABLE_SCHEDULER=false, scheduler should not start."""
    with patch.object(scheduler, "ENABLE_SCHEDULER", False):
        with patch.object(scheduler, "BackgroundScheduler") as MockScheduler:
            scheduler.start_scheduler()
            assert not MockScheduler.called  # Scheduler not created
