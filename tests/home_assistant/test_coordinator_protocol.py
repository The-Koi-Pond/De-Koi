"""Protocol regression tests for the Home Assistant coordinator."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web


REPO_ROOT = Path(__file__).resolve().parents[2]


class _DataUpdateCoordinator:
    @classmethod
    def __class_getitem__(cls, _item: object) -> type["_DataUpdateCoordinator"]:
        return cls

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass


class _UpdateFailed(Exception):
    pass


class _ConfigEntryNotReady(Exception):
    pass


def _load_coordinator_module() -> types.ModuleType:
    package = types.ModuleType("custom_components.marinara_engine")
    package.__path__ = [
        str(REPO_ROOT / "custom_components" / "marinara_engine")
    ]
    sys.modules["custom_components"] = types.ModuleType("custom_components")
    sys.modules["custom_components.marinara_engine"] = package

    homeassistant = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    core.HomeAssistant = object
    exceptions = types.ModuleType("homeassistant.exceptions")
    exceptions.ConfigEntryNotReady = _ConfigEntryNotReady
    helpers = types.ModuleType("homeassistant.helpers")
    aiohttp_client = types.ModuleType("homeassistant.helpers.aiohttp_client")
    aiohttp_client.async_get_clientsession = lambda _hass: None
    update_coordinator = types.ModuleType("homeassistant.helpers.update_coordinator")
    update_coordinator.DataUpdateCoordinator = _DataUpdateCoordinator
    update_coordinator.UpdateFailed = _UpdateFailed

    sys.modules.update(
        {
            "homeassistant": homeassistant,
            "homeassistant.core": core,
            "homeassistant.exceptions": exceptions,
            "homeassistant.helpers": helpers,
            "homeassistant.helpers.aiohttp_client": aiohttp_client,
            "homeassistant.helpers.update_coordinator": update_coordinator,
        }
    )

    module_name = "custom_components.marinara_engine.coordinator"
    spec = importlib.util.spec_from_file_location(
        module_name,
        REPO_ROOT / "custom_components" / "marinara_engine" / "coordinator.py",
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


coordinator_module = _load_coordinator_module()
MarinaraCoordinator = coordinator_module.MarinaraCoordinator
StorageProtocolError = coordinator_module.StorageProtocolError


class CoordinatorProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.commands: list[str] = []
        self.responses: dict[str, Any] = {}

        async def invoke(request: web.Request) -> web.Response:
            payload = await request.json()
            command = payload["command"]
            self.commands.append(command)
            return web.json_response(self.responses[command])

        app = web.Application()
        app.router.add_post("/api/invoke", invoke)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]

        self.session = aiohttp.ClientSession()
        self.coordinator = object.__new__(MarinaraCoordinator)
        self.coordinator.base_url = f"http://127.0.0.1:{port}"
        self.coordinator._session = self.session
        self.coordinator._authorization = None

    async def asyncTearDown(self) -> None:
        await self.session.close()
        await self.runner.cleanup()

    async def test_malformed_storage_list_stops_agent_sync_before_writes(self) -> None:
        self.responses["storage_list"] = {"unexpected": "object"}

        with self.assertRaisesRegex(
            StorageProtocolError, "storage_list.*expected a JSON array"
        ):
            await self.coordinator.sync_agent([])

        self.assertEqual(self.commands, ["storage_list"])

    async def test_malformed_storage_create_is_not_reported_as_success(self) -> None:
        self.responses.update({"storage_list": [], "storage_create": []})

        with self.assertRaisesRegex(
            StorageProtocolError, "storage_create.*expected a JSON object"
        ):
            await self.coordinator.sync_agent([])

        self.assertEqual(self.commands, ["storage_list", "storage_create"])

    async def test_malformed_storage_update_is_not_reported_as_success(self) -> None:
        self.responses["storage_update"] = "ok"

        with self.assertRaisesRegex(
            StorageProtocolError, "storage_update.*expected a JSON object"
        ):
            await self.coordinator._storage_update("agents", "agent-1", {})

        self.assertEqual(self.commands, ["storage_update"])


if __name__ == "__main__":
    unittest.main()
