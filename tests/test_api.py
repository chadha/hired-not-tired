from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
PREFIX = "/api/v1"


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_demo_seed_and_coach():
    seeded = client.post(f"{PREFIX}/demo/seed")
    assert seeded.status_code == 200
    candidate_id = seeded.json()["candidate"]["candidate_id"]

    coach = client.post(
        f"{PREFIX}/coach/chat",
        json={
            "candidate_id": candidate_id,
            "message": "I'm tired of rejection. Maybe I should give up.",
            "include_memory": True,
            "include_recent_interactions": True,
        },
    )
    assert coach.status_code == 200
    assert coach.json()["recommended_actions"]
    assert "not a verdict" in coach.json()["message"]


def test_job_matching():
    seeded = client.post(f"{PREFIX}/demo/seed").json()
    candidate_id = seeded["candidate"]["candidate_id"]
    job_id = seeded["jobs"][0]["job_id"]

    response = client.post(f"{PREFIX}/jobs/{job_id}/match/{candidate_id}")
    assert response.status_code == 200
    assert 0 <= response.json()["match_score"] <= 100
