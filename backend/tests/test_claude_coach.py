from types import SimpleNamespace

import pytest

from tests.test_career_engine_api import login


@pytest.mark.asyncio
async def test_coach_chat_calls_claude_and_returns_model_response(client_app, monkeypatch) -> None:
    client, app = client_app
    workspace = await login(client, app)
    app.state.settings.anthropic_api_key = "test-anthropic-key"
    app.state.settings.anthropic_model = "claude-sonnet-5-5"
    captured: dict[str, object] = {}

    class FakeMessages:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                content=[SimpleNamespace(type="text", text="Your next step is to tailor your CV.")],
            )

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client_options"] = kwargs
            self.messages = FakeMessages()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

    monkeypatch.setattr("app.routers.career.AsyncAnthropic", FakeClient)
    response = await client.post(
        "/api/v1/coach/chat",
        json={
            "candidate_id": workspace["candidate_id"],
            "message": "What should I do next?",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["message"] == "Your next step is to tailor your CV."
    assert response.json()["coach_mode"] == "claude"
    assert captured["model"] == "claude-sonnet-5-5"
    assert captured["max_tokens"] == 900
    assert "Candidate's message" in captured["messages"][0]["content"]


@pytest.mark.asyncio
async def test_coach_chat_fails_closed_when_claude_key_is_missing(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)
    app.state.settings.anthropic_api_key = None

    response = await client.post(
        "/api/v1/coach/chat",
        json={
            "candidate_id": workspace["candidate_id"],
            "message": "Help me prepare for an interview.",
        },
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "claude_not_configured"
