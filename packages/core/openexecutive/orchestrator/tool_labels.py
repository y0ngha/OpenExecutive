"""Plain-language names for connected (MCP) tools, shared by the chat's chips
and its progress line.

A connected tool reaches the Executive as `call_tool` wrapping a raw name such
as `google_workspace__search_drive_files` or `microsoft_365__get-mail-message`.
Those names mean nothing to the person reading the chat, so both
`action_chips` (the finished chip, past tense) and `activity_labels` (the
in-flight line, present tense) read their wording from here. Keeping the two
tenses in one table is what keeps "Searching Drive…" and "Searched Drive"
saying the same thing.

Both tenses follow OE_LANGUAGE (`utils.i18n`).

A tool missing from `_TOOLS` is not shown raw: `labels_for` turns its name
into words ("list_task_lists" on Google -> "Listed task lists · Google").
When a connected server gains a tool people will see often, add a row here.

`detail_for` names what one call looked at (the search words, the file or
email it opened). The chat lists these when a chip is tapped, so a chip that
collapses several runs still says what each one did.
"""
from __future__ import annotations

import json
import re
from typing import Any

from openexecutive.memory.drive_reads import parse_content_result
from openexecutive.utils.i18n import MessageTable, tr

# Underlying tool name (without its `server__` prefix, hyphens folded to
# underscores) -> the key of its (done, doing) phrases in `_DONE` / `_DOING`.
# `doing` carries no ellipsis; the progress line adds it. Google Workspace and
# Microsoft 365 names share the table: the two servers do not reuse a name for
# different things.
_TOOLS: dict[str, str] = {
    # Mail
    "search_gmail_messages": "mail_search",
    "list_mail_messages": "mail_search",
    "list_mail_folder_messages": "mail_search",
    "get_gmail_message_content": "mail_read",
    "get_gmail_messages_content_batch": "mail_read",
    "get_gmail_thread_content": "mail_read",
    "get_gmail_threads_content_batch": "mail_read",
    "get_mail_message": "mail_read",
    "get_gmail_attachment_content": "attachment_open",
    "get_mail_attachment": "attachment_open",
    "list_mail_attachments": "attachments_check",
    "draft_gmail_message": "mail_draft",
    "create_draft_email": "mail_draft",
    "create_reply_draft": "reply_draft",
    "create_reply_all_draft": "reply_draft",
    "create_forward_draft": "forward_draft",
    "send_gmail_message": "mail_send",
    "send_mail": "mail_send",
    "send_draft_message": "mail_send",
    "reply_mail_message": "reply_send",
    "reply_all_mail_message": "reply_send",
    "forward_mail_message": "mail_forward",
    "move_mail_message": "mail_file",
    "update_mail_message": "mail_update",
    "delete_mail_message": "mail_delete",
    "modify_gmail_message_labels": "mail_label",
    "list_gmail_labels": "labels_check",
    # Files
    "search_drive_files": "drive_search",
    "list_drive_items": "drive_search",
    "get_drive_file_content": "drive_read",
    "create_drive_file": "drive_save",
    "search_onedrive_files": "onedrive_search",
    "list_drives": "onedrive_check",
    "list_folder_files": "onedrive_search",
    "get_drive_item": "onedrive_read",
    "download_onedrive_file_content": "onedrive_read",
    "upload_file_content": "onedrive_save",
    "copy_drive_item": "file_copy",
    "move_rename_onedrive_item": "file_move",
    "share_drive_item": "file_share",
    # Docs and sheets
    "search_docs": "docs_search",
    "get_doc_content": "doc_read",
    "create_doc": "doc_create",
    "modify_doc_text": "doc_edit",
    "read_sheet_values": "sheet_read",
    "get_spreadsheet_info": "sheet_read",
    "list_spreadsheets": "sheets_search",
    "modify_sheet_values": "sheet_update",
    "create_spreadsheet": "sheet_create",
    # Calendar
    "list_calendars": "calendar_check",
    "get_events": "calendar_check",
    "list_calendar_events": "calendar_check",
    "get_calendar_event": "calendar_check",
    "get_calendar_view": "calendar_check",
    "query_freebusy": "availability_check",
    "find_meeting_times": "availability_check",
    "manage_event": "calendar_update",
    "create_calendar_event": "calendar_update",
    "update_calendar_event": "calendar_update",
    "update_specific_calendar_event": "calendar_update",
    "delete_calendar_event": "event_remove",
    "accept_calendar_event": "invite_answer",
    "decline_calendar_event": "invite_answer",
    "tentatively_accept_calendar_event": "invite_answer",
    "forward_calendar_event": "invite_forward",
}

# Phrase key -> the finished chip's words (past tense).
_DONE = MessageTable("tool_labels.done", {
    "mail_search": "Searched your mail",
    "mail_read": "Read an email",
    "attachment_open": "Opened an attachment",
    "attachments_check": "Checked attachments",
    "mail_draft": "Drafted an email",
    "reply_draft": "Drafted a reply",
    "forward_draft": "Drafted a forward",
    "mail_send": "Sent an email",
    "reply_send": "Sent a reply",
    "mail_forward": "Forwarded an email",
    "mail_file": "Filed an email",
    "mail_update": "Updated an email",
    "mail_delete": "Deleted an email",
    "mail_label": "Labeled an email",
    "labels_check": "Checked your mail labels",
    "drive_search": "Searched Drive",
    "drive_read": "Read a Drive file",
    "drive_save": "Saved a file to Drive",
    "onedrive_search": "Searched OneDrive",
    "onedrive_check": "Checked OneDrive",
    "onedrive_read": "Read a OneDrive file",
    "onedrive_save": "Saved a file to OneDrive",
    "file_copy": "Copied a file",
    "file_move": "Moved a file",
    "file_share": "Shared a file",
    "docs_search": "Searched your docs",
    "doc_read": "Read a doc",
    "doc_create": "Created a doc",
    "doc_edit": "Edited a doc",
    "sheet_read": "Read a spreadsheet",
    "sheets_search": "Searched your spreadsheets",
    "sheet_update": "Updated a spreadsheet",
    "sheet_create": "Created a spreadsheet",
    "calendar_check": "Checked your calendar",
    "availability_check": "Checked availability",
    "calendar_update": "Updated your calendar",
    "event_remove": "Removed a calendar event",
    "invite_answer": "Answered an invite",
    "invite_forward": "Forwarded an invite",
})

# Phrase key -> the in-flight line's words (present progressive).
_DOING = MessageTable("tool_labels.doing", {
    "mail_search": "Searching your mail",
    "mail_read": "Reading an email",
    "attachment_open": "Opening an attachment",
    "attachments_check": "Checking attachments",
    "mail_draft": "Drafting an email",
    "reply_draft": "Drafting a reply",
    "forward_draft": "Drafting a forward",
    "mail_send": "Sending an email",
    "reply_send": "Sending a reply",
    "mail_forward": "Forwarding an email",
    "mail_file": "Filing an email",
    "mail_update": "Updating an email",
    "mail_delete": "Deleting an email",
    "mail_label": "Labeling an email",
    "labels_check": "Checking your mail labels",
    "drive_search": "Searching Drive",
    "drive_read": "Reading a Drive file",
    "drive_save": "Saving a file to Drive",
    "onedrive_search": "Searching OneDrive",
    "onedrive_check": "Checking OneDrive",
    "onedrive_read": "Reading a OneDrive file",
    "onedrive_save": "Saving a file to OneDrive",
    "file_copy": "Copying a file",
    "file_move": "Moving a file",
    "file_share": "Sharing a file",
    "docs_search": "Searching your docs",
    "doc_read": "Reading a doc",
    "doc_create": "Creating a doc",
    "doc_edit": "Editing a doc",
    "sheet_read": "Reading a spreadsheet",
    "sheets_search": "Searching your spreadsheets",
    "sheet_update": "Updating a spreadsheet",
    "sheet_create": "Creating a spreadsheet",
    "calendar_check": "Checking your calendar",
    "availability_check": "Checking availability",
    "calendar_update": "Updating your calendar",
    "event_remove": "Removing a calendar event",
    "invite_answer": "Answering an invite",
    "invite_forward": "Forwarding an invite",
})

# The English (done, doing) pair for each listed tool.
_LABELS: dict[str, tuple[str, str]] = {
    tool: (_DONE.english[key], _DOING.english[key]) for tool, key in _TOOLS.items()
}

# Server prefix -> the name people know it by, for the fallback's suffix.
# Product names, so the same in every language.
_SERVICES: dict[str, str] = {
    "google_workspace": "Google",
    "microsoft_365": "Microsoft 365",
    "oe": "Open Executive",
}

# First word of an unlisted tool -> the done / doing verb for the fallback.
_VERB_DONE = MessageTable("tool_labels.verb_done", {
    "search": "Searched",
    "find": "Looked up",
    "query": "Looked up",
    "get": "Read",
    "read": "Read",
    "fetch": "Read",
    "download": "Read",
    "list": "Listed",
    "create": "Created",
    "add": "Added",
    "update": "Updated",
    "modify": "Updated",
    "edit": "Edited",
    "set": "Updated",
    "delete": "Deleted",
    "remove": "Removed",
    "send": "Sent",
    "reply": "Replied to",
    "forward": "Forwarded",
    "draft": "Drafted",
    "move": "Moved",
    "share": "Shared",
    "upload": "Uploaded",
    "copy": "Copied",
})
_VERB_DOING = MessageTable("tool_labels.verb_doing", {
    "search": "Searching",
    "find": "Looking up",
    "query": "Looking up",
    "get": "Reading",
    "read": "Reading",
    "fetch": "Reading",
    "download": "Reading",
    "list": "Listing",
    "create": "Creating",
    "add": "Adding",
    "update": "Updating",
    "modify": "Updating",
    "edit": "Editing",
    "set": "Updating",
    "delete": "Deleting",
    "remove": "Removing",
    "send": "Sending",
    "reply": "Replying to",
    "forward": "Forwarding",
    "draft": "Drafting",
    "move": "Moving",
    "share": "Sharing",
    "upload": "Uploading",
    "copy": "Copying",
})

# The English generic phrases; `labels_for` returns them in OE_LANGUAGE.
GENERIC_DONE = "Used a connected tool"
GENERIC_DOING = "Using a connected tool"


def _generic() -> tuple[str, str]:
    return (
        tr("tool_labels.generic.done", "Used a connected tool"),
        tr("tool_labels.generic.doing", "Using a connected tool"),
    )


def _pair(key: str) -> tuple[str, str]:
    return _DONE[key], _DOING[key]

# Tool names and argument values are model- or server-authored text on their
# way to the DOM: keep them to one short, plain line.
_WORDS_MAX = 40
_DETAIL_MAX = 60
_UNSAFE = re.compile(r"[^\w .,:;'&@()/#+-]", re.UNICODE)

# Argument keys that name what a call looked for or at, most telling first.
_DETAIL_KEYS = (
    "query", "q", "search", "search_query", "subject", "title",
    "file_name", "filename", "name", "summary",
)
_SUBJECT_RE = re.compile(r"^Subject:[ \t]*(.+)$", re.MULTILINE)
# The tools whose result is one email, the only ones a subject is read from.
_MAIL_READS = frozenset({
    "get_gmail_message_content",
    "get_gmail_thread_content",
    "get_mail_message",
})
# Larger results are not parsed just to find a subject.
_JSON_MAX = 200_000


def _split(raw: str) -> tuple[str, str]:
    """`server__tool` -> (server, normalized tool)."""
    server, sep, tool = raw.partition("__")
    if not sep:
        server, tool = "", raw
    return server, tool.replace("-", "_").lower()


def _clean(text: str, limit: int) -> str:
    text = _UNSAFE.sub("", " ".join(text.split())).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def labels_for(raw_name: Any, arguments: Any = None) -> tuple[str, str]:
    """(done, doing) phrases for an MCP tool name, in OE_LANGUAGE. Never
    returns the raw name.

    `arguments` matters only for a tool whose action depends on them, such
    as Google's `manage_event`, which also deletes: a deletion must not read
    as "Updated your calendar".
    """
    if not isinstance(raw_name, str) or not raw_name.strip():
        return _generic()
    server, tool = _split(raw_name.strip())
    if (
        tool == "manage_event"
        and isinstance(arguments, dict)
        and str(arguments.get("action", "")).lower() == "delete"
    ):
        return _pair(_TOOLS["delete_calendar_event"])
    if tool in _TOOLS:
        return _pair(_TOOLS[tool])
    words = [w for w in tool.split("_") if w]
    if not words:
        return _generic()
    verb = words[0] if words[0] in _VERB_DONE else None
    rest = " ".join(words[1:] if verb else words)
    rest = _clean(rest, _WORDS_MAX)
    service = _SERVICES.get(server) or _clean(server.replace("_", " ").title(), 24)
    suffix = f" · {service}" if service else ""
    if verb and rest:
        return (
            tr("tool_labels.verb_rest.done", "{verb} {rest}{suffix}",
               verb=_VERB_DONE[verb], rest=rest, suffix=suffix),
            tr("tool_labels.verb_rest.doing", "{verb} {rest}{suffix}",
               verb=_VERB_DOING[verb], rest=rest, suffix=suffix),
        )
    if rest:
        return (
            tr("tool_labels.used_rest.done", "Used {rest}{suffix}", rest=rest, suffix=suffix),
            tr("tool_labels.used_rest.doing", "Using {rest}{suffix}", rest=rest, suffix=suffix),
        )
    return _generic()


def detail_for(raw_name: Any, arguments: Any, result: str) -> str | None:
    """What one call looked at, in a few words, or None when nothing says."""
    _, tool = _split(raw_name) if isinstance(raw_name, str) else ("", "")
    if tool == "get_drive_file_content":
        opened = parse_content_result(result) if isinstance(result, str) else None
        if opened and opened.get("name"):
            return _clean(opened["name"], _DETAIL_MAX) or None
    if isinstance(arguments, dict):
        for key in _DETAIL_KEYS:
            value = arguments.get(key)
            if isinstance(value, str) and value.strip():
                cleaned = _clean(value, _DETAIL_MAX)
                if cleaned:
                    return f'"{cleaned}"' if key in ("query", "q", "search", "search_query") else cleaned
    if tool in _MAIL_READS and isinstance(result, str) and result:
        # Only an email's own header block names it: a "Subject:" line in a
        # body or forwarded text must not become the chip's target.
        header = result[:4000].split("\n\n", 1)[0]
        m = _SUBJECT_RE.search(header)
        if m:
            return _clean(m.group(1), _DETAIL_MAX) or None
        parsed = None
        if len(result) <= _JSON_MAX:
            try:
                parsed = json.loads(result)
            except (ValueError, TypeError):
                parsed = None
        if isinstance(parsed, dict):
            value = parsed.get("subject")
            if isinstance(value, str) and value.strip():
                return _clean(value, _DETAIL_MAX) or None
    return None
