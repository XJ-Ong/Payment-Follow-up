"""Scheduled background jobs for daily scoring refresh and weekly summaries.

Jobs are timezone-aware (Asia/Kuala_Lumpur) and logged to ActivityLog. The
scheduler is enabled via ENABLE_SCHEDULER env var; when disabled, all features
remain manually accessible through their REST endpoints.
"""
import os
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .db.models import ActivityLog
from .db.session import SessionLocal
from .ids import external_uuid
from .orbyte.mock import MockOrbyteAdapter
from .services.followups import refresh_workspace
from .services.summary import generate_summary

# Configuration from environment
ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "false").lower() == "true"
DAILY_CHECK_HOUR = int(os.getenv("DAILY_CHECK_HOUR", "9"))  # 9 AM by default
ENABLE_WEEKLY_SUMMARY = os.getenv("ENABLE_WEEKLY_SUMMARY", "false").lower() == "true"
WEEKLY_SUMMARY_DAY = os.getenv("WEEKLY_SUMMARY_DAY", "monday").lower()
WEEKLY_SUMMARY_HOUR = int(os.getenv("WEEKLY_SUMMARY_HOUR", "9"))

# Company and actor for scheduled jobs
COMPANY = external_uuid("COMP-01")
SYSTEM_ACTOR = external_uuid("USR-01")  # Owner as system actor

# Global scheduler instance
scheduler: BackgroundScheduler | None = None


def start_scheduler():
    """Start the background scheduler with daily and weekly jobs.

    Called from FastAPI lifespan on startup if ENABLE_SCHEDULER=true.
    Jobs use Asia/Kuala_Lumpur timezone.
    """
    global scheduler

    if not ENABLE_SCHEDULER:
        print("Scheduler disabled (ENABLE_SCHEDULER=false)")
        return

    scheduler = BackgroundScheduler(timezone="Asia/Kuala_Lumpur")

    # Daily scoring refresh
    scheduler.add_job(
        daily_scoring_job,
        trigger=CronTrigger(hour=DAILY_CHECK_HOUR, minute=0, timezone="Asia/Kuala_Lumpur"),
        id="daily_scoring",
        name="Daily Priority Scoring Refresh",
        replace_existing=True,
        misfire_grace_time=3600,  # 1 hour grace if server was down
    )

    # Weekly summary (optional)
    if ENABLE_WEEKLY_SUMMARY:
        day_of_week = {
            "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
            "friday": 4, "saturday": 5, "sunday": 6,
        }.get(WEEKLY_SUMMARY_DAY, 0)

        scheduler.add_job(
            weekly_summary_job,
            trigger=CronTrigger(
                day_of_week=day_of_week,
                hour=WEEKLY_SUMMARY_HOUR,
                minute=0,
                timezone="Asia/Kuala_Lumpur",
            ),
            id="weekly_summary",
            name="Weekly Summary Generation",
            replace_existing=True,
            misfire_grace_time=7200,  # 2 hour grace for weekly job
        )

    scheduler.start()
    print(f"Scheduler started: daily job at {DAILY_CHECK_HOUR}:00 MYT")
    if ENABLE_WEEKLY_SUMMARY:
        print(f"Weekly summary job: {WEEKLY_SUMMARY_DAY.capitalize()} at {WEEKLY_SUMMARY_HOUR}:00 MYT")


def stop_scheduler():
    """Stop the scheduler gracefully.

    Called from FastAPI lifespan on shutdown.
    """
    global scheduler

    if scheduler is not None:
        scheduler.shutdown(wait=True)
        scheduler = None
        print("Scheduler stopped")


def daily_scoring_job():
    """Daily job: refresh priority scoring for all invoices.

    Calls refresh_workspace() and logs the action.
    Errors are caught and logged; job never crashes the scheduler.
    """
    print(f"[Scheduler] Running daily scoring refresh at {datetime.now()}")

    with SessionLocal() as db:
        try:
            adapter = MockOrbyteAdapter()
            workspace = refresh_workspace(db, COMPANY, adapter, actor_id=SYSTEM_ACTOR)

            # Log successful run
            db.add(ActivityLog(
                id=uuid4(),
                company_id=COMPANY,
                actor_type="system",
                actor_id=SYSTEM_ACTOR,
                action="scheduler.daily_scoring",
                entity_type="company",
                entity_id=COMPANY,
                after_state={
                    "eligible_count": len([inv for inv in workspace.invoices if inv.calculation.eligible]),
                    "total_score": sum(float(inv.calculation.score) for inv in workspace.invoices),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                created_at=datetime.now(timezone.utc),
            ))
            db.commit()

            print("[Scheduler] Daily scoring refresh completed successfully")

        except Exception as error:
            db.rollback()
            # Log failure (don't crash scheduler)
            print(f"[Scheduler] Daily scoring refresh failed: {error}")
            db.add(ActivityLog(
                id=uuid4(),
                company_id=COMPANY,
                actor_type="system",
                actor_id=SYSTEM_ACTOR,
                action="scheduler.daily_scoring_failed",
                entity_type="company",
                entity_id=COMPANY,
                after_state={
                    "error": str(error)[:500],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                created_at=datetime.now(timezone.utc),
            ))
            db.commit()


def weekly_summary_job():
    """Weekly job: generate summary for the previous week.

    Calculates week_start (last Monday) and week_end (last Sunday),
    calls generate_summary(), logs the action.
    """
    print(f"[Scheduler] Running weekly summary generation at {datetime.now()}")

    with SessionLocal() as db:
        try:
            adapter = MockOrbyteAdapter()

            # Calculate previous week bounds
            today = date.today()
            days_since_monday = (today.weekday() - 0) % 7  # 0 = Monday
            last_monday = today - timedelta(days=days_since_monday + 7)
            last_sunday = last_monday + timedelta(days=6)

            summary_id = generate_summary(
                COMPANY, last_monday, last_sunday, SYSTEM_ACTOR, db, "English", adapter,
            )
            db.commit()

            # Log successful run
            db.add(ActivityLog(
                id=uuid4(),
                company_id=COMPANY,
                actor_type="system",
                actor_id=SYSTEM_ACTOR,
                action="scheduler.weekly_summary",
                entity_type="weekly_summary",
                entity_id=summary_id,
                after_state={
                    "week_start": last_monday.isoformat(),
                    "week_end": last_sunday.isoformat(),
                    "summary_id": str(summary_id),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                created_at=datetime.now(timezone.utc),
            ))
            db.commit()

            print(f"[Scheduler] Weekly summary generated: {summary_id}")

        except Exception as error:
            db.rollback()
            print(f"[Scheduler] Weekly summary generation failed: {error}")
            db.add(ActivityLog(
                id=uuid4(),
                company_id=COMPANY,
                actor_type="system",
                actor_id=SYSTEM_ACTOR,
                action="scheduler.weekly_summary_failed",
                entity_type="company",
                entity_id=COMPANY,
                after_state={
                    "error": str(error)[:500],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                created_at=datetime.now(timezone.utc),
            ))
            db.commit()
