"""Editable configuration contracts; money stays decimal on input and string on output."""
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

Day = Annotated[int, Field(strict=True, ge=0, le=2147483647)]
Tier = Literal['New', 'Regular', 'Key']

class ProfileInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(strict=True, ge=1)
    relationship_tier: Tier
    preferred_channel: Literal['Email', 'WhatsApp', 'Telegram']
    telegram_chat_id: str | None = Field(default=None, max_length=64, pattern=r'^-?[1-9][0-9]*$')
    language: Literal['English', 'Bahasa Malaysia']
    tone: Literal['Friendly', 'Neutral', 'Firm']
    do_not_contact: bool = Field(strict=True)

class ProfileView(ProfileInput):
    client_id: UUID
    name: str
    email: str | None
    phone: str | None
    grace_days: int

class GraceDays(BaseModel):
    model_config = ConfigDict(extra='forbid')
    New: Day
    Regular: Day
    Key: Day

class RulesInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(strict=True, ge=1)
    grace_days_by_tier: GraceDays
    alert_threshold: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    safety_flag_days: int = Field(strict=True, gt=0, le=2147483647)
    min_spacing_days: Day
    skip_holidays: bool = Field(strict=True)
    second_approval_amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
