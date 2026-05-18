import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import refiner


class FakeCompletions:
    def __init__(self):
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(message=SimpleNamespace(content="provider result")),
            ],
        )


class FakeClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.chat = SimpleNamespace(completions=FakeCompletions())


class FakeHttpxClient:
    def __init__(self, response):
        self.post = AsyncMock(return_value=response)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class RefinerProvidersTest(unittest.TestCase):
    def test_refine_text_uses_request_llm_config_for_openai_compatible_provider(self):
        created_clients = []

        def create_fake_client(**kwargs):
            client = FakeClient(**kwargs)
            created_clients.append(client)
            return client

        with patch("refiner.AsyncOpenAI", side_effect=create_fake_client):
            result = asyncio.run(refiner.refine_text(
                raw_text="hello",
                mode="transcript",
                parameters={
                    "llm": {
                        "provider_id": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "api_key": "sk-openai",
                        "model": "gpt-5.4",
                        "auth_type": "bearer",
                    },
                },
            ))

        self.assertEqual(result, "provider result")
        self.assertEqual(created_clients[0].kwargs["api_key"], "sk-openai")
        self.assertEqual(created_clients[0].kwargs["base_url"], "https://api.openai.com/v1")
        call = created_clients[0].chat.completions.calls[0]
        self.assertEqual(call["model"], "gpt-5.4")

    def test_request_llm_config_trims_api_key_before_provider_call(self):
        config = refiner.normalize_request_llm_config({
            "llm": {
                "provider_id": "openai",
                "base_url": "https://api.openai.com/v1/",
                "api_key": " sk-openai \n",
                "model": " gpt-5.4 ",
                "auth_type": "bearer",
            },
        })

        self.assertEqual(config["api_key"], "sk-openai")
        self.assertEqual(config["base_url"], "https://api.openai.com/v1")
        self.assertEqual(config["model"], "gpt-5.4")

    def test_refine_text_uses_anthropic_messages_api(self):
        fake_response = SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"content": [{"type": "text", "text": "anthropic result"}]},
        )
        fake_client = FakeHttpxClient(fake_response)

        with patch("refiner.httpx.AsyncClient", return_value=fake_client):
            result = asyncio.run(refiner.refine_text(
                raw_text="hello",
                mode="transcript",
                parameters={
                    "llm": {
                        "provider_id": "anthropic",
                        "base_url": "https://api.anthropic.com/v1",
                        "api_key": "sk-ant",
                        "model": "claude-sonnet-4-5",
                        "auth_type": "anthropic",
                    },
                },
            ))

        self.assertEqual(result, "anthropic result")
        post = fake_client.post
        url = post.await_args.kwargs["url"]
        headers = post.await_args.kwargs["headers"]
        body = post.await_args.kwargs["json"]
        self.assertEqual(url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(headers["x-api-key"], "sk-ant")
        self.assertEqual(headers["anthropic-version"], "2023-06-01")
        self.assertEqual(body["model"], "claude-sonnet-4-5")
        self.assertEqual(body["messages"][0]["role"], "user")

    def test_refine_text_falls_back_to_env_deepseek_when_llm_config_is_incomplete(self):
        fake_client = FakeClient(api_key="env", base_url="env")

        with patch("refiner._get_client", return_value=fake_client):
            result = asyncio.run(refiner.refine_text(
                raw_text="hello",
                mode="transcript",
                parameters={"llm": {"provider_id": "openai"}},
            ))

        self.assertEqual(result, "provider result")
        self.assertEqual(fake_client.chat.completions.calls[0]["model"], "deepseek-chat")

    def test_refine_text_falls_back_to_env_deepseek_when_non_custom_api_key_is_empty(self):
        fake_client = FakeClient(api_key="env", base_url="env")

        with patch("refiner._get_client", return_value=fake_client):
            result = asyncio.run(refiner.refine_text(
                raw_text="hello",
                mode="transcript",
                parameters={
                    "llm": {
                        "provider_id": "deepseek",
                        "base_url": "https://api.deepseek.com/v1",
                        "api_key": "",
                        "model": "deepseek-chat",
                        "auth_type": "bearer",
                    },
                },
            ))

        self.assertEqual(result, "provider result")
        self.assertEqual(fake_client.chat.completions.calls[0]["model"], "deepseek-chat")


if __name__ == "__main__":
    unittest.main()
