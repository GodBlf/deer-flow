"""HTTP scope contract exercised against real DeerMem storage."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import memory
from deerflow.agents.memory.backends.deermem.deer_mem import DeerMem
from deerflow.agents.memory.backends.noop.noop_manager import NoopMemoryManager


@pytest.fixture
def scoped_client(tmp_path):
    manager = DeerMem(backend_config={"storage_path": str(tmp_path), "retrieval_adapter": ""})
    app = FastAPI()
    app.include_router(memory.router)
    with patch.object(memory, "get_memory_manager", return_value=manager), patch.object(memory, "get_effective_user_id", return_value="alice"), TestClient(app) as client:
        yield client, manager


def test_scoped_crud_and_identical_ids_are_isolated(scoped_client):
    client, manager = scoped_client
    for user in ("alice", "bob"):
        for agent in (None, "writer", "coder"):
            manager.import_memory({"facts": [{"id": "same", "content": f"{user}-{agent}", "confidence": 0.9}]}, user_id=user, agent_name=agent)
    response = client.patch("/api/memory/facts/same?agent_name=WRITER&user_id=bob", json={"content": "changed", "user_id": "bob"})
    assert response.status_code == 200
    assert response.json()["facts"][0]["content"] == "changed"
    assert manager.get_memory(user_id="alice", agent_name="coder")["facts"][0]["content"] == "alice-coder"
    assert manager.get_memory(user_id="bob", agent_name="writer")["facts"][0]["content"] == "bob-writer"
    assert client.get("/api/memory").json()["facts"][0]["content"] == "alice-None"
    assert client.get("/api/memory?agent_name=CODER").json()["facts"][0]["content"] == "alice-coder"
    assert client.delete("/api/memory/facts/same?agent_name=writer").status_code == 200
    assert client.patch("/api/memory/facts/same?agent_name=writer", json={"content": "missing"}).status_code == 404
    assert client.post("/api/memory/facts?agent_name=writer", json={"content": "new preference"}).status_code == 200
    assert len(manager.get_memory(user_id="alice", agent_name="coder")["facts"]) == 1


@pytest.mark.parametrize("agent", ["", "../bob", "foo/bar", "white space", "__other__", "bad\n"])
def test_invalid_scope_rejected_before_manager(scoped_client, agent):
    client, manager = scoped_client
    with patch.object(type(manager), "get_memory", side_effect=AssertionError("must validate first")):
        assert client.get("/api/memory", params={"agent_name": agent}).status_code == 422
    assert client.post("/api/memory/facts", params={"agent_name": agent}, json={"content": "x"}).status_code == 422
    assert client.patch("/api/memory/facts/id", params={"agent_name": agent}, json={"content": "x"}).status_code == 422
    assert client.delete("/api/memory/facts/id", params={"agent_name": agent}).status_code == 422


def test_scope_discovery_and_clear_preserve_shared_context(scoped_client, tmp_path):
    client, manager = scoped_client
    for agent in (None, "writer", "orphan"):
        manager.import_memory({"user": {"workContext": {"summary": "shared"}}, "facts": [{"id": "same", "content": "fact", "confidence": 0.9}]}, user_id="alice", agent_name=agent)
    manager.create_fact("bob private", user_id="bob", agent_name="secret")
    agents = [SimpleNamespace(name="writer", display_name="Writing"), SimpleNamespace(name="empty", display_name=None)]
    with patch.object(memory, "list_custom_agents", return_value=agents) as listing:
        response = client.get("/api/memory/scopes")
        assert response.status_code == 200
        listing.assert_called_once_with(user_id="alice")
        scopes = {item["agent_name"]: item for item in response.json()["scopes"]}
        assert set(scopes) == {"__default__", "writer", "orphan", "empty"}
        assert scopes["writer"]["display_name"] == "Writing"
        assert scopes["orphan"]["orphaned"]
        assert scopes["writer"]["fact_count"] == 1
        assert scopes["writer"]["last_updated"]
        assert scopes["empty"]["last_updated"] is None
        assert str(tmp_path) not in response.text
        assert client.delete("/api/memory/facts").status_code == 422
        cleared = client.delete("/api/memory/facts?agent_name=__default__")
        assert cleared.status_code == 200
        assert cleared.json()["facts"] == []
        assert cleared.json()["user"]["workContext"]["summary"] == "shared"
        assert manager.get_memory(user_id="alice", agent_name="writer")["facts"]
        assert client.delete("/api/memory/facts?agent_name=orphan").status_code == 200
        assert "orphan" not in {item["agent_name"] for item in client.get("/api/memory/scopes").json()["scopes"]}
    assert client.delete("/api/memory").status_code == 200
    assert manager.get_memory(user_id="alice", agent_name="writer")["facts"] == []
    assert manager.get_memory(user_id="bob", agent_name="secret")["facts"]


def test_unsupported_scoped_operations_fail_closed(scoped_client):
    client, _ = scoped_client
    with patch.object(memory, "get_memory_manager", return_value=NoopMemoryManager()):
        assert client.get("/api/memory/capabilities").json()["scoped_read"] is False
        assert client.get("/api/memory/scopes").status_code == 501
        assert client.get("/api/memory?agent_name=writer").status_code == 501
        assert client.post("/api/memory/facts?agent_name=writer", json={"content": "x"}).status_code == 501
        assert client.patch("/api/memory/facts/id?agent_name=writer", json={"content": "x"}).status_code == 501
        assert client.delete("/api/memory/facts/id?agent_name=writer").status_code == 501
        assert client.delete("/api/memory/facts?agent_name=writer").status_code == 501


def test_discovery_ignores_symlinks(scoped_client, tmp_path):
    client, manager = scoped_client
    manager.create_fact("other user secret", user_id="bob", agent_name="secret")
    root = tmp_path / "users" / "alice" / "agents"
    root.mkdir(parents=True, exist_ok=True)
    (root / "secret").symlink_to(tmp_path / "users" / "bob" / "agents" / "secret", target_is_directory=True)
    with patch.object(memory, "list_custom_agents", return_value=[]):
        response = client.get("/api/memory/scopes")
        assert response.status_code == 200
        assert [s["agent_name"] for s in response.json()["scopes"]] == ["__default__"]


def test_empty_default_and_export_import_remain_unscoped(scoped_client):
    client, manager = scoped_client
    with patch.object(memory, "list_custom_agents", return_value=[]):
        scopes = client.get("/api/memory/scopes").json()["scopes"]
        assert scopes == [{"agent_name": "__default__", "fact_count": 0, "last_updated": None, "display_name": None, "orphaned": False}]
    manager.create_fact("writer only", user_id="alice", agent_name="writer")
    client.post("/api/memory/import", json={"facts": [{"id": "imported", "content": "default only"}], "user": {"workContext": {"summary": "imported summary"}}})
    exported = client.get("/api/memory/export").json()
    assert [fact["content"] for fact in exported["facts"]] == ["default only"]
    assert manager.get_memory(user_id="alice", agent_name="writer")["facts"][0]["content"] == "writer only"
    assert manager.get_memory(user_id="alice", agent_name="writer")["user"]["workContext"]["summary"] == "imported summary"


@pytest.mark.parametrize("level", ["default", "facts", "shard", "file"])
def test_discovery_never_reads_linked_fact_content(scoped_client, tmp_path, level):
    client, manager = scoped_client
    manager.create_fact("private", user_id="bob", agent_name="secret")
    private_root = tmp_path / "users" / "bob" / "agents" / "secret"
    private_file = next((private_root / "facts").glob("**/*.md"))
    root = tmp_path / "users" / "alice" / "agents"
    root.mkdir(parents=True, exist_ok=True)
    if level == "default":
        (root / "__default__").symlink_to(private_root, target_is_directory=True)
    elif level == "facts":
        (root / "writer").mkdir()
        (root / "writer" / "facts").symlink_to(private_root / "facts", target_is_directory=True)
    elif level == "shard":
        (root / "writer" / "facts").mkdir(parents=True)
        (root / "writer" / "facts" / "ab").symlink_to(private_file.parent, target_is_directory=True)
    else:
        (root / "writer" / "facts" / "ab").mkdir(parents=True)
        (root / "writer" / "facts" / "ab" / private_file.name).symlink_to(private_file)
    with patch.object(memory, "list_custom_agents", return_value=[]):
        response = client.get("/api/memory/scopes")
        assert response.status_code == 200
        assert response.json()["scopes"][0]["fact_count"] == 0
        assert len(response.json()["scopes"]) == 1


def test_clear_route_cancels_only_selected_pending_extraction(scoped_client):
    client, manager = scoped_client
    with patch.object(type(manager), "cancel_by_agent", return_value=1) as cancel:
        assert client.delete("/api/memory/facts?agent_name=WRITER").status_code == 200
        assert cancel.call_count == 2
        for call in cancel.call_args_list:
            assert call.args == ("writer",)
            assert call.kwargs == {"user_id": "alice"}


def test_scoped_conflict_is_409_not_default_fallback(scoped_client):
    from deerflow.agents.memory import MemoryConflictError

    client, manager = scoped_client
    with patch.object(type(manager), "clear_memory", side_effect=MemoryConflictError("changed")) as clear:
        assert client.delete("/api/memory/facts?agent_name=writer").status_code == 409
        clear.assert_called_once_with(user_id="alice", agent_name="writer")


def test_source_thread_id_only_from_recorded_conversation(scoped_client):
    client, manager = scoped_client
    manager.import_memory(
        {"facts": [{"id": "thread", "content": "from conversation", "source": {"type": "conversation", "threadId": "conversation-1"}}, {"id": "manual", "content": "manual", "source": "manual"}]}, user_id="alice", agent_name="writer"
    )
    facts = {fact["id"]: fact for fact in client.get("/api/memory?agent_name=writer").json()["facts"]}
    assert facts["thread"]["sourceThreadId"] == "conversation-1"
    assert "sourceThreadId" not in facts["manual"]


def test_discovery_includes_unread_legacy_orphan(scoped_client, tmp_path):
    import json

    client, _ = scoped_client
    legacy = tmp_path / "users" / "alice" / "agents" / "orphan" / "memory.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text(json.dumps({"version": "1.0", "facts": [{"id": "legacy", "content": "legacy orphan", "confidence": 0.9}]}), encoding="utf-8")
    with patch.object(memory, "list_custom_agents", return_value=[]):
        response = client.get("/api/memory/scopes")
        assert response.status_code == 200
        scope = next(item for item in response.json()["scopes"] if item["agent_name"] == "orphan")
        assert scope["fact_count"] == 1
        assert scope["orphaned"]
