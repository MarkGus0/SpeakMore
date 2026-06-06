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
MAX_DICTIONARY_TERMS = 40
DEFAULT_LLM_MODEL = "deepseek-chat"
DEFAULT_TRANSLATION_TARGET_LANGUAGE_ID = "en"
DEFAULT_TRANSLATION_TARGET_LANGUAGE_NAME = "English"
MAX_CUSTOM_PROMPT_CHARS = 12000
AUDIO_QUALITY_NUMERIC_FIELDS = (
    "average_rms",
    "peak",
    "clipping_ratio",
    "speech_frame_ratio",
    "low_volume_ratio",
    "estimated_noise_floor",
)
AUDIO_QUALITY_HINT_LABELS = {
    "low_volume": "低音量",
    "clipping": "削波或爆音",
    "likely_noisy": "背景噪声较大",
    "mostly_silence": "大部分为静音或人声很少",
}
FALLBACK_TRANSLATION_TARGET_LANGUAGE_NAMES = {
    "en": "English",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
}
TRANSLATION_TARGET_LANGUAGES_PATH = (
    Path(__file__).resolve().parent.parent
    / "shared"
    / "translation-target-languages.json"
)


def normalize_translation_alias(value: object) -> str:
    return str(value or "").strip().lower()


def load_translation_target_language_metadata() -> tuple[dict[str, str], dict[str, str]]:
    try:
        with TRANSLATION_TARGET_LANGUAGES_PATH.open("r", encoding="utf-8") as file:
            items = json.load(file)
    except (OSError, json.JSONDecodeError):
        names = FALLBACK_TRANSLATION_TARGET_LANGUAGE_NAMES.copy()
        return names, {
            normalize_translation_alias(alias): language_id
            for language_id, name in names.items()
            for alias in (language_id, name)
        }

    names = FALLBACK_TRANSLATION_TARGET_LANGUAGE_NAMES.copy()
    aliases = {
        normalize_translation_alias(alias): language_id
        for language_id, name in names.items()
        for alias in (language_id, name)
    }
    if not isinstance(items, list):
        return names, aliases

    for item in items:
        if not isinstance(item, dict):
            continue

        language_id = str(item.get("id", "")).strip()
        prompt_name = str(item.get("promptName", "")).strip()
        if language_id and prompt_name:
            names[language_id] = prompt_name
            item_aliases = item.get("aliases", [])
            if not isinstance(item_aliases, list):
                item_aliases = []
            for alias in (
                language_id,
                prompt_name,
                item.get("label", ""),
                item.get("displayName", ""),
                *item_aliases,
            ):
                normalized_alias = normalize_translation_alias(alias)
                if normalized_alias:
                    aliases[normalized_alias] = language_id

    return names, aliases


def load_translation_target_language_names() -> dict[str, str]:
    names, _aliases = load_translation_target_language_metadata()
    return names


TRANSLATION_TARGET_LANGUAGE_NAMES, TRANSLATION_TARGET_LANGUAGE_ALIASES = load_translation_target_language_metadata()


def resolve_translation_target_language_id(value: object) -> str:
    return TRANSLATION_TARGET_LANGUAGE_ALIASES.get(normalize_translation_alias(value), "")


def summarize_text_for_log(value: object) -> dict:
    text = str(value or "").strip()
    return {
        "has_text": bool(text),
        "length": len(text),
        "preview": " ".join(text.split())[:80] if text else "",
    }


def normalize_translation_target_language_id(value: object) -> str:
    language_id = resolve_translation_target_language_id(value)
    if language_id:
        return language_id
    if DEFAULT_TRANSLATION_TARGET_LANGUAGE_ID in TRANSLATION_TARGET_LANGUAGE_NAMES:
        return DEFAULT_TRANSLATION_TARGET_LANGUAGE_ID
    return next(iter(TRANSLATION_TARGET_LANGUAGE_NAMES), DEFAULT_TRANSLATION_TARGET_LANGUAGE_ID)


def format_target_language_for_prompt(value: object) -> str:
    language_id = normalize_translation_target_language_id(value)
    return TRANSLATION_TARGET_LANGUAGE_NAMES.get(
        language_id,
        TRANSLATION_TARGET_LANGUAGE_NAMES.get("en", DEFAULT_TRANSLATION_TARGET_LANGUAGE_NAME),
    )


def normalize_custom_command_prompt(parameters: dict | None) -> str:
    if not isinstance(parameters, dict):
        return ""
    prompt = str(parameters.get("custom_prompt", "") or "").strip()
    if len(prompt) > MAX_CUSTOM_PROMPT_CHARS:
        return prompt[:MAX_CUSTOM_PROMPT_CHARS]
    return prompt


def is_realtime_sentence_translation(parameters: dict | None) -> bool:
    return isinstance(parameters, dict) and parameters.get("realtime_sentence_translation") is True


def resolve_system_prompt(mode: str, parameters: dict | None = None) -> str:
    if mode == "translation" and is_realtime_sentence_translation(parameters):
        return (
            "You are a fast live meeting interpreter. Translate only the current committed sentence "
            "into the target language. Use the previous sentences only as hidden context. "
            "Do not repeat previous sentences. Do not include the source text, labels, markdown, "
            "explanations, timestamps, emoji, or extra commentary. Return only the translation."
        )

    if mode != "custom_command":
        return SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["transcript"])

    custom_prompt = normalize_custom_command_prompt(parameters)
    if not custom_prompt:
        raise ValueError("custom_prompt is required for custom_command mode")

    safety_boundary = SYSTEM_PROMPTS["custom_command"]
    return f"{safety_boundary}\n\nUser-configured command prompt:\n{custom_prompt}"


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


async def request_anthropic_completion(
    config: dict,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> str:
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
        "temperature": temperature,
        "max_tokens": max_tokens,
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


async def request_openai_compatible_completion(
    config: dict,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> str:
    client = create_openai_compatible_client(config)
    response = await client.chat.completions.create(
        model=config["model"],
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
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


def normalize_audio_quality(parameters: dict | None) -> dict:
    if not isinstance(parameters, dict):
        return {}

    quality = parameters.get("audio_quality")
    if not isinstance(quality, dict):
        return {}

    normalized: dict[str, object] = {}
    for field in AUDIO_QUALITY_NUMERIC_FIELDS:
        value = quality.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        normalized[field] = round(float(value), 4)

    hints = []
    raw_hints = quality.get("hints", [])
    if isinstance(raw_hints, list):
        for hint in raw_hints:
            text = str(hint or "").strip()
            if text in AUDIO_QUALITY_HINT_LABELS and text not in hints:
                hints.append(text)
    if hints:
        normalized["hints"] = hints

    return normalized


def build_audio_quality_context(parameters: dict | None) -> str:
    quality = normalize_audio_quality(parameters)
    if not quality:
        return ""

    lines = ["本轮音频质量提示："]
    hints = quality.get("hints")
    if isinstance(hints, list) and hints:
        labels = [AUDIO_QUALITY_HINT_LABELS.get(str(hint), str(hint)) for hint in hints]
        lines.append(f"- 检测到：{'、'.join(labels)}。")

    metrics = []
    for field in AUDIO_QUALITY_NUMERIC_FIELDS:
        if field in quality:
            metrics.append(f"{field}={quality[field]}")
    if metrics:
        lines.append(f"- 质量指标：{', '.join(metrics)}。")

    lines.append("- 处理原则：音频质量不佳时少猜保真，只修复可确认的口语噪声和 ASR 错词，不编造人名、地点、时间、数字、任务对象或专有名词。")
    return "\n".join(lines)


def build_refiner_user_message(
    raw_text: str,
    mode: str = "transcript",
    context: dict | None = None,
    parameters: dict | None = None,
) -> str:
    dictionary_context = build_dictionary_context(normalize_dictionary_terms(parameters))
    audio_quality_context = build_audio_quality_context(parameters)
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

    elif mode == "translation":
        target_language_id = normalize_translation_target_language_id(
            parameters.get("output_language") if isinstance(parameters, dict) else None,
        )
        target_lang = format_target_language_for_prompt(target_language_id)
        if is_realtime_sentence_translation(parameters):
            previous_sentences = []
            if isinstance(parameters, dict) and isinstance(parameters.get("realtime_context_sentences"), list):
                previous_sentences = [
                    str(item or "").strip()
                    for item in parameters.get("realtime_context_sentences", [])[-2:]
                    if str(item or "").strip()
                ]
            context_line = "\n".join(previous_sentences)
            user_message = (
                f"Target language: {target_lang} ({target_language_id})\n"
                f"Previous sentences for context only:\n{context_line or '(none)'}\n\n"
                f"Current sentence to translate:\n{raw_text}"
            )
        else:
            user_message = f"目标语言：{target_lang}（语言代码：{target_language_id}）\n\n待翻译的语音转写文本：\n{raw_text}"

    elif mode == "custom_command":
        command_name = ""
        command_id = ""
        if isinstance(parameters, dict):
            command_name = str(parameters.get("command_name", "") or "").strip()
            command_id = str(parameters.get("command_id", "") or "").strip()
        command_parts = []
        if command_name:
            command_parts.append(f"Command name: {command_name}")
        if command_id:
            command_parts.append(f"Command id: {command_id}")
        command_header = "\n".join(command_parts)
        user_message = (
            f"{command_header}\n\nVoice input:\n{raw_text}"
            if command_header
            else f"Voice input:\n{raw_text}"
        )

    elif mode == "meeting_notes":
        user_message = f"Meeting transcript:\n{raw_text}"

    elif mode == "ask_anything" and parameters:
        selected_text = parameters.get("selected_text", "")
        print(
            "[Refiner][ask_anything] selected_text 参数",
            summarize_text_for_log(selected_text),
        )
        if selected_text:
            user_message = f"[Selected text in editor: {selected_text}]\n\nUser's voice command:\n{raw_text}"
    elif mode == "ask_anything":
        print("[Refiner][ask_anything] 未收到 parameters")

    context_blocks = [item for item in (dictionary_context, audio_quality_context) if item]
    if context_blocks:
        if mode == "transcript" and user_message == raw_text:
            user_message = f"Transcription to refine:\n{raw_text}"
        return "\n\n".join([*context_blocks, user_message])
    return user_message


def resolve_completion_options(mode: str, parameters: dict | None) -> dict:
    if mode == "translation" and is_realtime_sentence_translation(parameters):
        return {"temperature": 0.0, "max_tokens": 128}
    return {"temperature": 0.3, "max_tokens": 2048}


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

    system_prompt = resolve_system_prompt(mode, parameters)

    # 词典属于用户偏好上下文，只影响术语纠错，不改变任务边界。
    user_message = build_refiner_user_message(
        raw_text=raw_text,
        mode=mode,
        context=context,
        parameters=parameters,
    )
    completion_options = resolve_completion_options(mode, parameters)

    try:
        llm_config = normalize_request_llm_config(parameters)
        if llm_config:
            if llm_config["auth_type"] == "anthropic":
                return await request_anthropic_completion(llm_config, system_prompt, user_message, **completion_options)
            return await request_openai_compatible_completion(llm_config, system_prompt, user_message, **completion_options)

        client = _get_client()
        response = await client.chat.completions.create(
            model=DEFAULT_LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=completion_options["temperature"],
            max_tokens=completion_options["max_tokens"],
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        provider_id = normalize_request_llm_config(parameters or {}) or {"provider_id": "deepseek"}
        print(f"[Refiner] {provider_id['provider_id']} API 调用失败: {e}")
        if mode == "transcript":
            return raw_text
        raise RefineFailedError(str(e)) from e
