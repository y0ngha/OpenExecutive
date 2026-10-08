"""Name the tool round that is currently in flight, for the chat progress line.

The agent loop yields one `_THINKING` sentinel per tool-use iteration, and the
UI turns that into a single muted line beside the bouncing dots. That line used
to read "Consulting specialists…" unconditionally, so an MCP call or a calendar
write looked like a specialist fan-out. This module supplies the label that
makes it honest: one `activity` SSE event per tool round, naming what actually
ran.

Sibling of `action_chips.py`, which does the same tool -> phrase mapping in the
*past* tense for side-effecting calls only. This one is present-progressive and
covers every tool, read-only included, because the point is to describe work
that has not finished yet.

Invariant: a real `consult_specialist` round gets exactly one generic label —
"Consulting specialists…". Individual specialist names are NEVER put in a
user-facing label (CLAUDE.md: the internal agent architecture is never exposed
to the user; there is one voice).
"""
from __future__ import annotations

import re
from typing import Any

from openexecutive.utils.i18n import is_korean

# Shown when a round contains only tools with no entry in `_LABELS`. Going
# silent is not an option — a round with no label is the exact failure this
# event exists to fix, and the UI would fall back to its own placeholder.
FALLBACK_LABEL = "Working…"

SPECIALIST_LABEL = "Consulting specialists…"

# Korean for the two above. The fallback matches the UI's own placeholder
# (packages/ui lib.api.fallbackActivity).
_FALLBACK_LABEL_KO = "작업 중…"
_SPECIALIST_LABEL_KO = "전문가와 상의하는 중…"

# Longest underlying MCP tool name rendered into a label. MCP names are
# model-authored text on their way to the DOM, so they are capped and stripped
# here rather than trusted. React escapes the value, but a 4KB name or an
# embedded newline would still wreck a one-line indicator.
_MCP_NAME_MAX = 48
_MCP_NAME_UNSAFE = re.compile(r"[^A-Za-z0-9_.:\- ]")

# Canonical tool name -> present-progressive phrase. Every entry ends in an
# ellipsis and is short enough for one line next to the dots; the drift test in
# tests/unit/test_activity_labels.py enforces both, and also enforces that every
# registered Executive tool appears here.
_LABELS: dict[str, str] = {
    # Specialist fan-out — deliberately generic. See the module docstring.
    "consult_specialist": SPECIALIST_LABEL,

    # Skills
    "search_skills": "Looking through saved skills…",
    "load_skill": "Opening a saved skill…",
    "create_skill": "Drafting a new playbook…",
    "update_skill": "Drafting a playbook change…",
    "delete_skill": "Proposing a playbook deletion…",

    # Scheduling and outbound messages
    "schedule_followup": "Scheduling a follow-up…",
    "suggest_workflow": "Queuing a workflow suggestion…",
    "send_telegram_message": "Sending a Telegram message…",
    "send_slack_dm": "Sending a Slack DM…",
    "send_discord_dm": "Sending a Discord DM…",
    "message_person": "Sending a message…",
    "lookup_person": "Looking up people…",
    "ack_alert": "Updating a proposal…",
    "find_alerts": "Looking through the briefing board…",

    # Calendar. These write, so none of them says "checking" — the label is
    # emitted before the call runs and must not promise a read.
    "create_calendar_event": "Putting time on the calendar…",
    "create_instant_meeting": "Spinning up a meeting…",
    "cancel_calendar_event": "Clearing time from the calendar…",

    # People and org chart
    "list_people": "Looking up people…",
    "upsert_person": "Updating the people roster…",
    "archive_person": "Updating the people roster…",
    "resolve_roster_request": "Updating the people roster…",
    "set_department_head": "Updating the org chart…",
    "ask_about_person": "Checking what I know about someone…",
    "list_open_loops": "Checking what people owe…",
    "close_open_loop": "Closing an open loop…",
    "assign_open_loop": "Assigning a task…",

    # Departments
    "list_department_goals": "Reviewing department goals…",
    "update_department_goal": "Updating a department goal…",
    "create_goal": "Adding a goal…",
    "record_decision_outcome": "Recording how a decision turned out…",
    "remember_fact": "Noting that for good…",
    "forget_fact": "Dropping an old fact…",
    "update_company_profile": "Updating the company profile…",

    # Broadcast channels
    "send_department_message": "Posting to a department channel…",
    "send_company_broadcast": "Sending a company-wide note…",

    # Watchlist
    "add_watchlist_entry": "Adding to the watchlist…",
    "list_watchlist": "Checking the watchlist…",
    "remove_watchlist_entry": "Updating the watchlist…",
    "tune_watchlist_entry": "Tuning the watchlist…",

    # Research, alerts, artifacts
    "run_executive_research": "Researching…",
    "create_alert": "Flagging something for review…",
    "run_python_job": "Working on the files…",
    "draft_artifact": "Writing that up…",
    "list_artifacts": "Looking through earlier work…",
    "get_artifact": "Rereading that document…",
    "read_document": "Reading a document…",

    # Workflows
    "draft_workflow": "Drafting a workflow…",
    "save_workflow": "Saving the workflow…",
    "list_workflows": "Checking available workflows…",
    "run_workflow": "Running a workflow…",

    # Ask OE panel form fill
    "propose_form_values": "Filling in the form…",

    # Act as me: a draft in the speaker's own Gmail (never sent)
    "ghostwrite_email": "Drafting an email in your voice…",
    # Act as me: reads of the speaker's own mailbox
    "search_my_email": "Searching your email…",
    "read_my_email": "Reading your email…",
    "read_my_email_attachment": "Reading an attachment…",
    "remind_me": "Setting a reminder…",
    "my_email_awaiting_reply": "Checking what's waiting on a reply…",

    # Always in the loop: the speaker's own notes
    "recall_history": "Checking your notes…",

    # MCP gateway. `call_tool` is dynamic and handled in `_label_for`.
    "search_tools": "Looking for the right tool…",
    "load_mcp_server": "Connecting a tool server…",
}

# `_LABELS` in Korean, for OE_LANGUAGE=KOREAN. Same keys; a test keeps them
# in step.
_LABELS_KO: dict[str, str] = {
    "consult_specialist": _SPECIALIST_LABEL_KO,
    "search_skills": "저장된 스킬을 살펴보는 중…",
    "load_skill": "저장된 스킬을 여는 중…",
    "create_skill": "새 플레이북 초안을 쓰는 중…",
    "update_skill": "플레이북 변경안을 쓰는 중…",
    "delete_skill": "플레이북 삭제를 제안하는 중…",
    "schedule_followup": "후속 조치를 예약하는 중…",
    "suggest_workflow": "워크플로 제안을 올리는 중…",
    "send_telegram_message": "Telegram 메시지를 보내는 중…",
    "send_slack_dm": "Slack DM을 보내는 중…",
    "send_discord_dm": "Discord DM을 보내는 중…",
    "message_person": "메시지를 보내는 중…",
    "lookup_person": "구성원을 찾는 중…",
    "ack_alert": "제안을 업데이트하는 중…",
    "find_alerts": "브리핑 보드를 살펴보는 중…",
    "create_calendar_event": "캘린더에 일정을 넣는 중…",
    "create_instant_meeting": "회의를 여는 중…",
    "cancel_calendar_event": "캘린더에서 일정을 빼는 중…",
    "list_people": "구성원을 찾는 중…",
    "upsert_person": "구성원 명단을 업데이트하는 중…",
    "archive_person": "구성원 명단을 업데이트하는 중…",
    "resolve_roster_request": "구성원 명단을 업데이트하는 중…",
    "set_department_head": "조직도를 업데이트하는 중…",
    "ask_about_person": "이 사람에 대해 아는 내용을 확인하는 중…",
    "list_open_loops": "사람들이 맡은 일을 확인하는 중…",
    "close_open_loop": "남은 일을 마무리하는 중…",
    "assign_open_loop": "할 일을 맡기는 중…",
    "list_department_goals": "부서 목표를 검토하는 중…",
    "update_department_goal": "부서 목표를 업데이트하는 중…",
    "create_goal": "목표를 추가하는 중…",
    "record_decision_outcome": "결정의 결과를 기록하는 중…",
    "remember_fact": "기억해 두는 중…",
    "forget_fact": "오래된 정보를 지우는 중…",
    "update_company_profile": "회사 프로필을 업데이트하는 중…",
    "send_department_message": "부서 채널에 올리는 중…",
    "send_company_broadcast": "전사 공지를 보내는 중…",
    "add_watchlist_entry": "관심 목록에 추가하는 중…",
    "list_watchlist": "관심 목록을 확인하는 중…",
    "remove_watchlist_entry": "관심 목록을 업데이트하는 중…",
    "tune_watchlist_entry": "관심 목록을 조정하는 중…",
    "run_executive_research": "조사하는 중…",
    "create_alert": "검토할 항목을 표시하는 중…",
    "draft_artifact": "문서로 정리하는 중…",
    "list_artifacts": "이전 작업을 살펴보는 중…",
    "get_artifact": "문서를 다시 읽는 중…",
    "read_document": "문서를 읽는 중…",
    "draft_workflow": "워크플로 초안을 쓰는 중…",
    "save_workflow": "워크플로를 저장하는 중…",
    "list_workflows": "쓸 수 있는 워크플로를 확인하는 중…",
    "run_workflow": "워크플로를 실행하는 중…",
    "propose_form_values": "양식을 채우는 중…",
    "ghostwrite_email": "내 말투로 이메일 초안을 쓰는 중…",
    "recall_history": "메모를 확인하는 중…",
    "search_tools": "알맞은 도구를 찾는 중…",
    "load_mcp_server": "도구 서버에 연결하는 중…",
    "run_python_job": "파일 작업하는 중…",
    "search_my_email": "메일함을 검색하는 중…",
    "read_my_email": "메일을 읽는 중…",
    "read_my_email_attachment": "첨부파일을 읽는 중…",
    "remind_me": "리마인더를 설정하는 중…",
    "my_email_awaiting_reply": "답장을 기다리는 메일을 확인하는 중…",
}


def _label(name: str) -> str:
    """The label for a tool in ``_LABELS``, in OE_LANGUAGE."""
    return (_LABELS_KO if is_korean() else _LABELS)[name]


def _fallback_label() -> str:
    return _FALLBACK_LABEL_KO if is_korean() else FALLBACK_LABEL


# One `_THINKING` per iteration means exactly one label per iteration, so a
# mixed round has to collapse. It collapses by rank rather than by joining
# clauses: the indicator is a single muted line, and two joined phrases both
# overflow on a narrow panel and read like generated grammar.
#
# Lower rank wins. The order tracks what the user most wants to know is
# happening, which in practice tracks how long the call blocks the turn.
# Rank 0 is also what keeps a mixed specialist round generic.
#
# A tool in no bucket is not unreachable: when nothing in the round is ranked,
# `_pick` falls back to the first block it can name, so a read like
# `list_workflows` still gets its own label even alongside a tool the map has
# never heard of. Ties inside a bucket break on block order, which the
# Anthropic response preserves, so the choice is deterministic.
_PRIORITY: tuple[frozenset[str], ...] = (
    frozenset({"consult_specialist"}),
    frozenset({"run_executive_research"}),
    frozenset({"run_workflow", "draft_workflow", "save_workflow"}),
    frozenset({"call_tool", "load_mcp_server", "search_tools"}),
    frozenset({
        "create_calendar_event",
        "create_instant_meeting",
        "cancel_calendar_event",
    }),
    frozenset({
        "send_slack_dm",
        "send_discord_dm",
        "send_telegram_message",
        "message_person",
        "send_department_message",
        "send_company_broadcast",
        "schedule_followup",
        "suggest_workflow",
    }),
    frozenset({
        "upsert_person",
        "archive_person",
        "resolve_roster_request",
        "set_department_head",
        "update_department_goal",
        "create_goal",
        "record_decision_outcome",
        "remember_fact",
        "forget_fact",
        "update_company_profile",
        "close_open_loop",
        "assign_open_loop",
    }),
    frozenset({
        "create_alert",
        "ack_alert",
        "draft_artifact",
        "add_watchlist_entry",
        "remove_watchlist_entry",
        "tune_watchlist_entry",
    }),
    frozenset({
        "create_skill",
        "update_skill",
        "delete_skill",
        "propose_form_values",
    }),
)


def _mcp_label(tool_input: Any) -> tuple[str, str]:
    """Label an MCP `call_tool` from the underlying tool it wraps.

    The real tool name lives in `tool_input["name"]` — the same field
    `action_chips.summarize_action` reads to surface the true tool on an MCP
    chip. A static label here would be useless, which matters because MCP is
    the case that made the old indicator wrong most visibly.
    """
    korean = is_korean()
    generic = "연결된 도구 사용 중…" if korean else "Using a connected tool…"
    raw = tool_input.get("name") if isinstance(tool_input, dict) else None
    if not isinstance(raw, str):
        return generic, "call_tool"
    name = _MCP_NAME_UNSAFE.sub("", raw).strip()[:_MCP_NAME_MAX].strip()
    if not name:
        return generic, "call_tool"
    return (f"{name} 사용 중…" if korean else f"Using {name}…"), name


def _label_for(tool_use: dict[str, Any]) -> tuple[str, str]:
    """Return `(label, canonical_tool_name)` for one tool_use block."""
    name = tool_use.get("name")
    if not isinstance(name, str):
        return _fallback_label(), ""
    if name == "call_tool":
        return _mcp_label(tool_use.get("input"))
    return (_label(name) if name in _LABELS else _fallback_label()), name


def _is_nameable(tool_use: dict[str, Any]) -> bool:
    return tool_use.get("name") in _LABELS or tool_use.get("name") == "call_tool"


def _pick(tool_uses: list[dict[str, Any]]) -> dict[str, Any]:
    """Choose the one tool_use block whose label represents the round.

    Ranked tools win first. Failing that, prefer any block we can actually
    name over block order — otherwise an unlabelled tool sitting in position
    zero would shadow a nameable one behind it and the round would render
    "Working…" despite having something to say. Only a round where nothing is
    nameable falls back to the first block.
    """
    for bucket in _PRIORITY:
        for tool_use in tool_uses:
            if tool_use.get("name") in bucket:
                return tool_use
    for tool_use in tool_uses:
        if _is_nameable(tool_use):
            return tool_use
    return tool_uses[0]


def fallback_activity(*, iteration: int | None = None) -> dict[str, Any]:
    """The unnamed-round event, for when a label could not be produced.

    The agent loop pairs every `_THINKING` sentinel with exactly one `activity`
    event. Yielding nothing here would break that pairing, and a client that
    keeps the last label it saw would then caption this round with the previous
    round's work — a stale label is worse than an honest "Working…".
    """
    payload: dict[str, Any] = {
        "type": "activity",
        "label": _fallback_label(),
        "tool": "",
    }
    if iteration is not None:
        payload["iteration"] = iteration
    return payload


def summarize_activity(
    tool_uses: list[dict[str, Any]],
    *,
    iteration: int | None = None,
) -> dict[str, Any] | None:
    """Build the `activity` SSE event for one tool round, or None.

    `tool_uses` holds the `{"id", "name", "input"}` dicts the agent loop
    collected from the model's tool_use blocks. Returns None only for an empty
    round — defensive, since the loop reaches this point only on
    `stop_reason == "tool_use"`. Anything else always produces an event; an
    unmapped tool falls back to `FALLBACK_LABEL` rather than going silent.

    The returned dict is the SSE event body; `api/routes/chat.py` forwards it
    verbatim. It is progress only and is never persisted with the assistant
    message, unlike an `action_taken` chip.
    """
    if not tool_uses:
        return None

    label, tool = _label_for(_pick(tool_uses))
    payload: dict[str, Any] = {"type": "activity", "label": label, "tool": tool}
    if iteration is not None:
        payload["iteration"] = iteration
    return payload
