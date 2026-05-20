"""Refiner 模块 - 使用 DeepSeek API 对 ASR 转写结果进行润色"""

import json
import os
from pathlib import Path

import httpx
from openai import AsyncOpenAI
from runtime_config import load_server_env, reload_server_env
from refiner_prompts import SYSTEM_PROMPTS, VOICE_INPUT_NORMALIZATION_PROMPT

load_server_env()

_client = None
MAX_DICTIONARY_TERMS = 100
DEFAULT_LLM_MODEL = "deepseek-chat"
DEFAULT_TRANSLATION_TARGET_LANGUAGE_NAME = "English"
FALLBACK_TRANSLATION_TARGET_LANGUAGE_NAMES = {
    "en": "English",
    "ja": "Japanese",
}
TRANSLATION_TARGET_LANGUAGES_PATH = (
    Path(__file__).resolve().parent.parent
    / "shared"
    / "translation-target-languages.json"
)


def load_translation_target_language_names() -> dict[str, str]:
    try:
        with TRANSLATION_TARGET_LANGUAGES_PATH.open("r", encoding="utf-8") as file:
            items = json.load(file)
    except (OSError, json.JSONDecodeError):
        return FALLBACK_TRANSLATION_TARGET_LANGUAGE_NAMES.copy()

    names = FALLBACK_TRANSLATION_TARGET_LANGUAGE_NAMES.copy()
    if not isinstance(items, list):
        return names

    for item in items:
        if not isinstance(item, dict):
            continue

        language_id = str(item.get("id", "")).strip()
        prompt_name = str(item.get("promptName", "")).strip()
        if language_id and prompt_name:
            names[language_id] = prompt_name

    return names


TRANSLATION_TARGET_LANGUAGE_NAMES = load_translation_target_language_names()


def format_target_language_for_prompt(value: object) -> str:
    language_id = str(value or "").strip()
    return TRANSLATION_TARGET_LANGUAGE_NAMES.get(
        language_id,
        TRANSLATION_TARGET_LANGUAGE_NAMES.get("en", DEFAULT_TRANSLATION_TARGET_LANGUAGE_NAME),
    )


class RefineFailedError(RuntimeError):
    pass


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        )
    return _client


def reload_refiner_runtime_config() -> None:
    global _client
    reload_server_env()
    _client = None


def normalize_request_llm_config(parameters: dict | None) -> dict | None:
    if not isinstance(parameters, dict):
        return None

    llm = parameters.get("llm")
    if not isinstance(llm, dict):
        return None

    provider_id = str(llm.get("provider_id", "")).strip()
    base_url = str(llm.get("base_url", "")).strip().rstrip("/")
    api_key = str(llm.get("api_key", "")).strip()
    model = str(llm.get("model", "")).strip()
    auth_type = "anthropic" if llm.get("auth_type") == "anthropic" else "bearer"

    if not provider_id or not base_url or not model:
        return None
    if provider_id != "custom" and not api_key:
        return None

    return {
        "provider_id": provider_id,
        "base_url": base_url,
        "api_key": api_key,
        "model": model,
        "auth_type": auth_type,
    }


def create_openai_compatible_client(config: dict) -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=config["api_key"] or "not-needed",
        base_url=config["base_url"],
    )


async def request_anthropic_completion(config: dict, system_prompt: str, user_message: str) -> str:
    url = f"{config['base_url']}/messages"
    headers = {
        "content-type": "application/json",
        "x-api-key": config["api_key"],
        "anthropic-version": "2023-06-01",
    }
    payload = {
        "model": config["model"],
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "temperature": 0.3,
        "max_tokens": 2048,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(url=url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data.get("content", [])
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                return str(item.get("text", "")).strip()
    if isinstance(content, str):
        return content.strip()
    return ""


async def request_openai_compatible_completion(config: dict, system_prompt: str, user_message: str) -> str:
    client = create_openai_compatible_client(config)
    response = await client.chat.completions.create(
        model=config["model"],
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.3,
        max_tokens=2048,
    )
    return response.choices[0].message.content.strip()


def normalize_dictionary_terms(parameters: dict | None) -> list[dict]:
    if not isinstance(parameters, dict):
        return []

    terms = parameters.get("dictionary_terms", [])
    if not isinstance(terms, list):
        return []

    normalized = []
    for item in terms[:MAX_DICTIONARY_TERMS]:
        if not isinstance(item, dict):
            continue

        phrase = str(item.get("phrase", "")).strip()
        aliases = item.get("aliases", [])
        if not phrase:
            continue

        normalized_aliases = []
        if isinstance(aliases, list):
            for alias in aliases:
                text = str(alias).strip()
                if text and text.lower() != phrase.lower() and text not in normalized_aliases:
                    normalized_aliases.append(text)

        normalized.append({"phrase": phrase, "aliases": normalized_aliases})

    return normalized


def build_dictionary_context(dictionary_terms: list[dict]) -> str:
    terms = normalize_dictionary_terms({"dictionary_terms": dictionary_terms})
    if not terms:
        return ""

    lines = ["用户个人词表："]
    for term in terms:
        aliases = term["aliases"]
        if aliases:
            lines.append(f"- {'、'.join(aliases)} 应写作 {term['phrase']}")
        else:
            lines.append(f"- {term['phrase']} 是用户词表中的正确写法")

    lines.append("")
    lines.append("修复 ASR 错词、专业术语、品牌名和代码词时，优先遵循用户个人词表。")
    return "\n".join(lines)


def build_refiner_user_message(
    raw_text: str,
    mode: str = "transcript",
    context: dict | None = None,
    parameters: dict | None = None,
) -> str:
    dictionary_context = build_dictionary_context(normalize_dictionary_terms(parameters))
    user_message = raw_text

    if mode == "transcript" and context:
        app_info = context.get("active_application", {})
        text_point = context.get("text_insertion_point", {})
        cursor_state = text_point.get("cursor_state", {})

        context_parts = []
        if app_info.get("app_name"):
            context_parts.append(f"App: {app_info['app_name']}")
        if app_info.get("browser_context", {}).get("domain"):
            context_parts.append(f"Website: {app_info['browser_context']['domain']}")
        if cursor_state.get("text_before_cursor"):
            before = cursor_state["text_before_cursor"][-200:]
            context_parts.append(f"Text before cursor: {before}")

        if context_parts:
            user_message = f"[Context: {'; '.join(context_parts)}]\n\nTranscription to refine:\n{raw_text}"

    elif mode == "transcript" and dictionary_context:
        user_message = f"Transcription to refine:\n{raw_text}"

    elif mode == "translation" and parameters:
        target_lang = format_target_language_for_prompt(parameters.get("output_language", "en"))
        user_message = f"目标语言：{target_lang}\n\n待翻译的语音转写文本：\n{raw_text}"

    elif mode == "ask_anything" and parameters:
        selected_text = parameters.get("selected_text", "")
        if selected_text:
            user_message = f"[Selected text in editor: {selected_text}]\n\nUser's voice command:\n{raw_text}"

    if dictionary_context:
        return f"{dictionary_context}\n\n{user_message}"
    return user_message


async def refine_text(
    raw_text: str,
    mode: str = "transcript",
    context: dict | None = None,
    parameters: dict | None = None,
) -> str:
    """使用 DeepSeek 对 ASR 原始文本进行润色
    
    Args:
        raw_text: ASR 转写的原始文本
        mode: 模式 - transcript/ask_anything/translation
        context: 音频上下文（当前 app、输入框内容等）
        parameters: 额外参数（如翻译目标语言）
    
    Returns:
        润色后的文本
    """
    if not raw_text or not raw_text.strip():
        return ""

    system_prompt = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["transcript"])

    # 词典属于用户偏好上下文，只影响术语纠错，不改变任务边界。
    user_message = build_refiner_user_message(
        raw_text=raw_text,
        mode=mode,
        context=context,
        parameters=parameters,
    )

    try:
        llm_config = normalize_request_llm_config(parameters)
        if llm_config:
            if llm_config["auth_type"] == "anthropic":
                return await request_anthropic_completion(llm_config, system_prompt, user_message)
            return await request_openai_compatible_completion(llm_config, system_prompt, user_message)

        client = _get_client()
        response = await client.chat.completions.create(
            model=DEFAULT_LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.3,
            max_tokens=2048,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        provider_id = normalize_request_llm_config(parameters or {}) or {"provider_id": "deepseek"}
        print(f"[Refiner] {provider_id['provider_id']} API 调用失败: {e}")
        if mode == "transcript":
            return raw_text
        raise RefineFailedError(str(e)) from e
