"""Day, month and clock words for dates shown to people, in OE_LANGUAGE.

strftime's ``%a`` / ``%b`` / ``%p`` are English only, so a message a person
reads builds its date from these parts inside its own ``tr`` template:
``tr("x.when", "{weekday} {day} {month}", **day_parts(local))`` reads
"Fri 16 Oct" in English and, with the Korean template "{month} {day}일({weekday})",
"10월 16일(금)". Text for a model (an intent, a prompt) stays English and
uses strftime directly.
"""
from __future__ import annotations

from datetime import date, datetime

from openexecutive.utils.i18n import MessageTable, tr

WEEKDAY = MessageTable("dates.weekday", {
    "0": "Mon", "1": "Tue", "2": "Wed", "3": "Thu", "4": "Fri", "5": "Sat", "6": "Sun",
})
WEEKDAY_LONG = MessageTable("dates.weekday_long", {
    "0": "Monday", "1": "Tuesday", "2": "Wednesday", "3": "Thursday", "4": "Friday",
    "5": "Saturday", "6": "Sunday",
})
MONTH = MessageTable("dates.month", {
    "1": "Jan", "2": "Feb", "3": "Mar", "4": "Apr", "5": "May", "6": "Jun",
    "7": "Jul", "8": "Aug", "9": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
})
MONTH_LONG = MessageTable("dates.month_long", {
    "1": "January", "2": "February", "3": "March", "4": "April", "5": "May", "6": "June",
    "7": "July", "8": "August", "9": "September", "10": "October", "11": "November",
    "12": "December",
})


def day_parts(d: date, *, long: bool = False) -> dict[str, str]:
    """``weekday``, ``day`` and ``month`` of ``d`` for a ``tr`` template."""
    weekday = (WEEKDAY_LONG if long else WEEKDAY)[str(d.weekday())]
    month = (MONTH_LONG if long else MONTH)[str(d.month)]
    return {"weekday": weekday, "day": str(d.day), "month": month}


def clock(dt: datetime) -> str:
    """A 12-hour time: "9:05 am" in English, "오전 9:05" in Korean."""
    hour, minute = str(dt.hour % 12 or 12), f"{dt.minute:02d}"
    if dt.hour < 12:
        return tr("dates.clock.am", "{hour}:{minute} am", hour=hour, minute=minute)
    return tr("dates.clock.pm", "{hour}:{minute} pm", hour=hour, minute=minute)


__all__ = ["MONTH", "MONTH_LONG", "WEEKDAY", "WEEKDAY_LONG", "clock", "day_parts"]
