"""AI service for drafting reminders, explaining rankings and summarising weeks.

Wraps an OpenAI-compatible API (Runpod vLLM) with:
- Number verification (AI output must match the input facts)
- Template fallback (on failure, timeout or verification failure)
- Prompt versioning (for debugging and A/B testing)
- Metadata for the append-only activity log and the draft's AI tag

Every generator returns ``(text, metadata)`` so callers can persist the audit
trail. The system works when the model is switched off: AI-1 falls back to the
same template the workflow already uses, and AI-2/AI-3 are deterministic
templates over code-calculated numbers (solution_v2.md §6.2: AI never computes
amounts, days or scores).

Guardrails (solution_v2.md §6.3) honoured here:
- Numbers come from data: the draft is discarded unless the invoice number,
  due date, outstanding amount and company name appear verbatim.
- Template fallback: any failure returns a fixed template.
- Tone limits: Friendly/Neutral/Firm only, no legal or disruption threats.
- No personal data beyond need: only the fields in ``facts`` are sent; contact
  numbers and emails are never passed to the model.
"""
import os
from decimal import Decimal
from typing import Literal

Tone = Literal["Friendly", "Neutral", "Firm"]
Language = Literal["English", "Bahasa Malaysia"]

PROMPT_VERSION = "v1.0"  # Increment when a prompt changes.
DEFAULT_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-2-7b-chat-hf")
MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", "300"))
TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.7"))
REQUEST_TIMEOUT = float(os.getenv("AI_TIMEOUT_SECONDS", "10"))

# The OpenAI client is optional. Without the library, the credentials, or a
# reachable endpoint, every call degrades to a template so the demo never blocks.
client = None
AI_AVAILABLE = False
try:
    from openai import OpenAI  # noqa: PLC0415
except ImportError:
    pass
else:
    if os.getenv("AI_MODE", "ai").strip().lower() != "template":
        try:
            client = OpenAI()  # Reads OPENAI_API_KEY and OPENAI_BASE_URL.
            AI_AVAILABLE = True
        except Exception:
            client = None
            AI_AVAILABLE = False


def draft_reminder(facts: dict, policy: dict, tone: Tone | None = None) -> tuple[str, dict]:
    """Generate a payment-reminder draft with AI, falling back to a template.

    Args:
        facts: invoice_no, due_date, outstanding_amount, currency, customer_name,
            company_name, channel, language, tone.
        policy: Reserved for future approval rules; unused for drafting.
        tone: Optional override; defaults to ``facts["tone"]``.

    Returns:
        ``(body, metadata)``. Metadata always carries ``source`` ("ai" or
        "template") plus the verification and fallback detail needed for the
        activity log.
    """
    del policy  # Reserved for future drafting rules.
    if tone is not None:
        facts = {**facts, "tone": tone}
    if not AI_AVAILABLE or client is None:
        return _template_fallback(facts, "ai_unavailable")
    try:
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{"role": "user", "content": _build_reminder_prompt(facts)}],
            max_tokens=MAX_TOKENS,
            temperature=TEMPERATURE,
            timeout=REQUEST_TIMEOUT,
        )
        body = (response.choices[0].message.content or "").strip()
        verification = _verify_numbers(body, facts)
        if not verification["passed"]:
            return _template_fallback(facts, "verification_failed", verification)
        usage = getattr(response, "usage", None)
        return body, {
            "source": "ai",
            "model": DEFAULT_MODEL,
            "prompt_version": PROMPT_VERSION,
            "verification_passed": True,
            "verification_details": verification,
            "tokens_used": getattr(usage, "total_tokens", None),
        }
    except Exception as error:  # The template must still complete the journey.
        return _template_fallback(facts, f"ai_error: {str(error)[:100]}")


def _build_reminder_prompt(facts: dict) -> str:
    """Build the drafting prompt: role, the four key facts and the constraints."""
    tone_guidance = {
        "Friendly": "warm and polite, maintaining a good customer relationship",
        "Neutral": "professional and straightforward",
        "Firm": "direct and serious, but still respectful (no threats or legal language)",
    }
    channel_format = {
        "WhatsApp": "a short message suitable for WhatsApp (2-3 sentences)",
        "Email": "a brief email message (3-4 sentences)",
        "SMS": "a very short SMS message (1-2 sentences, under 160 characters)",
    }
    tone = facts.get("tone", "Friendly")
    channel = facts.get("channel", "WhatsApp")
    language = facts.get("language", "English")
    return f"""Write a payment reminder for:

Invoice Number: {facts['invoice_no']}
Due Date: {facts['due_date']}
Outstanding Amount: {facts['currency']} {facts['outstanding_amount']}
Customer Name: {facts['customer_name']}
Company Name: {facts['company_name']}

Requirements:
- Tone: {tone_guidance.get(tone, tone_guidance['Friendly'])}
- Format: {channel_format.get(channel, channel_format['WhatsApp'])}
- Language: {language}
- Include all 4 key facts: invoice number, due date, outstanding amount and company name
- Use the EXACT invoice number, date and amount provided above, unchanged
- Do NOT include any contact details (no phone number or email address)
- Do NOT threaten legal action or service disruption
- Request payment confirmation or an expected payment date

Write only the message body, with no subject line or greeting prefix."""


def _verify_numbers(draft: str, facts: dict) -> dict:
    """Check the draft still carries the source invoice number, date, amount and company.

    This is the number guardrail: a model that rewords or hallucinates a figure
    fails verification and is discarded for the template.
    """
    amount = str(facts["outstanding_amount"])
    formatted = f"{Decimal(amount):,.2f}"
    checks = {
        "invoice_no": facts["invoice_no"] in draft,
        "due_date": facts["due_date"] in draft,
        "outstanding_amount": amount in draft or formatted in draft,
        "company_name": facts["company_name"] in draft,
    }
    return {"passed": all(checks.values()), "checks": checks, "draft_length": len(draft)}


def _template_fallback(facts: dict, reason: str, verification: dict | None = None) -> tuple[str, dict]:
    """Return the fixed template plus metadata explaining why it was used."""
    from .workflow import template  # Imported here to avoid a circular import at load time.
    return template(facts), {
        "source": "template",
        "model": None,
        "prompt_version": PROMPT_VERSION,
        "verification_passed": None,
        "verification_details": verification,
        "fallback_reason": reason,
    }


def explain_ranking(calculation: dict, customer_name: str, language: Language = "English") -> tuple[str, dict]:
    """Explain one invoice's priority score in plain words (AI-2).

    ``calculation`` carries the score inputs from the scoring service. The text
    is deterministic: scoring is code, and AI never computes amounts or scores
    (solution_v2.md §6.2).
    """
    outstanding = calculation["outstanding"]
    days_overdue = calculation["days_overdue"]
    grace_days = calculation["grace_days"]
    effective_days = calculation["effective_days"]
    score = calculation["score"]
    trigger = calculation.get("trigger_type") or "threshold"
    if language == "Bahasa Malaysia":
        if trigger == "both":
            text = (f"{customer_name} mempunyai baki tertunggak RM {outstanding:,.2f} selama {effective_days} hari "
                    f"efektif (selepas {grace_days} hari tempoh tangguh), menghasilkan skor keutamaan {score:,.0f} "
                    "RM-hari. Memenuhi ambang isyarat dan peraturan keselamatan.")
        elif trigger == "safety_rule":
            text = (f"{customer_name} telah lewat bayaran selama {days_overdue} hari, mencetuskan peraturan "
                    f"keselamatan (umur maksimum terlampaui) walaupun jumlah kecil RM {outstanding:,.2f}.")
        else:
            text = (f"{customer_name} mempunyai baki RM {outstanding:,.2f} lewat {effective_days} hari, menghasilkan "
                    f"skor keutamaan {score:,.0f} RM-hari yang melebihi ambang isyarat.")
    else:
        if trigger == "both":
            text = (f"{customer_name} has RM {outstanding:,.2f} outstanding for {effective_days} effective days "
                    f"(after a {grace_days}-day grace period), scoring {score:,.0f} RM-days. Meets both the alert "
                    "threshold and the safety rule.")
        elif trigger == "safety_rule":
            text = (f"{customer_name} is {days_overdue} days overdue, triggering the safety rule (maximum age "
                    f"exceeded) despite the small amount of RM {outstanding:,.2f}.")
        else:
            text = (f"{customer_name} has RM {outstanding:,.2f} outstanding for {effective_days} effective days, "
                    f"scoring {score:,.0f} RM-days, above the alert threshold.")
    return text, {"source": "template", "model": None, "prompt_version": PROMPT_VERSION, "language": language}


def generate_weekly_narrative(metrics: dict, language: Language = "English") -> tuple[str, dict]:
    """Write the owner's weekly summary paragraph from code-calculated metrics (AI-3).

    ``metrics`` is the dict produced by the summary service: total_overdue,
    change_from_last_week, amount_collected, reminders_drafted,
    reminders_approved and items_snoozed_next_week. The narrative is a template
    over those numbers so the figures always match the data.
    """
    total_overdue = metrics.get("total_overdue", Decimal("0"))
    change = metrics.get("change_from_last_week", Decimal("0"))
    collected = metrics.get("amount_collected", Decimal("0"))
    drafted = metrics.get("reminders_drafted", 0)
    approved = metrics.get("reminders_approved", 0)
    snoozed = metrics.get("items_snoozed_next_week", 0)
    if language == "Bahasa Malaysia":
        change_text = (f"naik RM {abs(change):,.2f}" if change > 0
                       else f"turun RM {abs(change):,.2f}" if change < 0 else "tidak berubah")
        text = (f"Minggu ini, jumlah tertunggak ialah RM {total_overdue:,.2f} ({change_text} berbanding minggu lalu). "
                f"Kami mengutip RM {collected:,.2f} dan meluluskan {approved} daripada {drafted} peringatan yang "
                "dicadangkan. ")
        if approved < drafted:
            text += f"{drafted - approved} peringatan ditangguhkan atau dilangkau. "
        if snoozed:
            text += f"{snoozed} item yang ditangguhkan akan aktif semula minggu depan."
    else:
        change_text = (f"up RM {abs(change):,.2f}" if change > 0
                       else f"down RM {abs(change):,.2f}" if change < 0 else "unchanged")
        text = (f"This week, total overdue stands at RM {total_overdue:,.2f} ({change_text} from last week). "
                f"We collected RM {collected:,.2f} and approved {approved} of {drafted} suggested reminders. ")
        if approved < drafted:
            text += f"{drafted - approved} reminders were skipped or snoozed. "
        if snoozed:
            text += f"{snoozed} snoozed items will resume next week."
    return text.strip(), {"source": "template", "model": None, "prompt_version": PROMPT_VERSION, "language": language}
