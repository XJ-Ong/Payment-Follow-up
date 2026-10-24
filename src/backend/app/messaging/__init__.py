"""Outbound transport only: callers own approval, persistence and deduplication."""
from .service import DeliveryResult, Message, MessagingService

__all__ = ["DeliveryResult", "Message", "MessagingService"]
