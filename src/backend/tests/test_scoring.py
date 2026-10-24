from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import pytest
from app.services.scoring import calculate, malaysia_date, ranking_key

AS_OF = date(2026, 10, 23)


def score(**overrides):
    data = dict(total=Decimal("1000.00"), payments=Decimal("0.00"), due_date=AS_OF-timedelta(days=40), as_of=AS_OF, status="open", grace_days=0, alert_threshold=Decimal("50000"), safety_flag_days=30, min_spacing_days=5, do_not_contact=False)
    return calculate(**(data | overrides))


@pytest.mark.parametrize("payments,outstanding,expected", [("0", "1000", "40000"), ("250.01", "749.99", "29999.60"), ("1000", "0", "0"), ("1001", "0", "0")])
def test_exact_balances(payments, outstanding, expected):
    result = score(payments=Decimal(payments))
    assert result.outstanding == Decimal(outstanding)
    assert result.score == Decimal(expected)


@pytest.mark.parametrize("offset,grace,effective", [(1,0,0), (0,0,0), (-7,7,0), (-8,7,1)])
def test_date_and_grace_boundaries(offset, grace, effective):
    result = score(due_date=AS_OF + timedelta(days=offset), grace_days=grace)
    assert result.effective_days == effective
    if offset >= 0:
        assert not result.eligible


def test_exact_alert_boundaries_and_safety_override_grace():
    assert score(total=Decimal("1250")).trigger_type == "both"  # exactly 50k
    assert score(due_date=AS_OF-timedelta(days=30)).trigger_type == "safety_rule"
    assert score(due_date=AS_OF-timedelta(days=29)).trigger_type is None
    assert score(grace_days=50).eligible  # safety rule works independently of grace


@pytest.mark.parametrize("changes,reason", [({"do_not_contact": True}, "do not contact"), ({"status": "void"}, "void"), ({"payments": Decimal("1000")}, "No outstanding"), ({"last_sent_date": AS_OF-timedelta(days=4)}, "spacing")])
def test_suppression(changes, reason):
    result = score(**changes)
    assert not result.eligible
    assert any(reason in r for r in result.exclusion_reasons)


def test_spacing_exactly_five_days():
    assert score(last_sent_date=AS_OF-timedelta(days=5)).eligible
    assert not score(last_sent_date=AS_OF+timedelta(days=1)).eligible


def test_holidays_are_distinct_and_weekends_count_across_year():
    due = date(2026,12,31)
    end = date(2027,1,4)  # Fri holiday, Sat/Sun still count
    holidays = (due, date(2027,1,1), date(2027,1,1), date(2027,1,5))
    assert score(due_date=due, as_of=end, holidays=holidays).days_overdue == 4
    result = score(due_date=due, as_of=end, holidays=holidays, skip_holidays=True)
    assert result.days_overdue == 3
    assert result.holidays_excluded == (date(2027,1,1),)


def test_malaysia_midnight():
    assert malaysia_date(datetime(2026,10,22,15,59,tzinfo=timezone.utc)) == date(2026,10,22)
    assert malaysia_date(datetime(2026,10,22,16,0,tzinfo=timezone.utc)) == AS_OF
    with pytest.raises(ValueError):
        malaysia_date(datetime(2026,10,23))


def test_stable_tie_breaks():
    c = score()
    assert sorted([("B", "2", c), ("A", "2", c), ("A", "1", c)], key=lambda x: ranking_key(*x)) == [("A", "1", c), ("A", "2", c), ("B", "2", c)]
    assert ranking_key("Z", "9", score(due_date=AS_OF-timedelta(days=50), total=Decimal("800"))) < ranking_key("A", "1", c)
