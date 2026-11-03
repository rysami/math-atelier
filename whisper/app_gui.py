#!/usr/bin/env python
"""
本地 Whisper 图形界面（浏览器打开）。

启动：
    .\\venv\\Scripts\\python app_gui.py
    或双击 start_gui.bat

与 transcribe.py / server.py 共用 engine.py 和同一份模型缓存，
所以模型只需下载一次，三处通用。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import webbrowser
from pathlib import Path

import gradio as gr

import engine

MODELS = [
    "large-v3",
    "large-v3-turbo",
    "medium",
    "small",
    "base",
    "tiny",
]

DOMAIN_PROFILES = [
    ("法语数学 · 通用", "french_math"),
    ("法语数学 · 代数与线性代数", "algebra"),
    ("法语数学 · 分析与微积分", "analysis"),
    ("法语数学 · 拓扑与几何", "topology"),
    ("法语数学 · 概率与统计", "probability"),
    ("法语数学 · 数论与逻辑", "number_theory"),
    ("通用听写", "general"),
]

COMMON_MATH_TERMS = [
    "mathématiques", "théorème", "proposition", "lemme", "corollaire",
    "démonstration", "hypothèse", "conclusion", "définition", "propriété",
    "ensemble", "sous-ensemble", "application", "fonction", "image",
    "antécédent", "injection", "surjection", "bijection", "équivalence",
    "si et seulement si", "pour tout", "il existe", "raisonnement par récurrence",
    "raisonnement par l'absurde", "réciproque", "contraposée",
]

SUBJECT_TERMS = {
    "french_math": [
        "algèbre", "analyse", "géométrie", "topologie", "arithmétique",
        "espace vectoriel", "matrice", "déterminant", "suite", "série",
        "limite", "continuité", "dérivée", "intégrale", "convergence",
        "espace métrique", "compact", "connexe", "probabilité", "espérance",
        "variance", "nombre premier", "divisibilité", "quantificateur",
    ],
    "algebra": [
        "groupe", "sous-groupe", "groupe abélien", "groupe cyclique",
        "morphisme", "homomorphisme", "isomorphisme", "automorphisme",
        "noyau", "image", "quotient", "groupe quotient", "classe latérale",
        "anneau", "sous-anneau", "idéal", "idéal maximal", "idéal premier",
        "corps", "polynôme", "irréductible", "extension de corps",
        "espace vectoriel", "sous-espace vectoriel", "famille libre",
        "famille génératrice", "base", "dimension", "rang", "matrice",
        "déterminant", "trace", "valeur propre", "vecteur propre",
        "polynôme caractéristique", "diagonalisation", "endomorphisme",
    ],
    "analysis": [
        "suite", "série", "limite", "continuité", "uniformément continue",
        "dérivée", "différentielle", "primitive", "intégrale", "mesurable",
        "convergence simple", "convergence uniforme", "convergence dominée",
        "convergence monotone", "série entière", "rayon de convergence",
        "développement limité", "fonction convexe", "inégalité de Cauchy-Schwarz",
        "espace normé", "espace de Banach", "espace de Hilbert",
        "produit scalaire", "norme", "complétude", "continuité séquentielle",
        "théorème des accroissements finis", "théorème de Rolle",
    ],
    "topology": [
        "topologie", "espace topologique", "ouvert", "fermé", "voisinage",
        "adhérence", "intérieur", "frontière", "point d'accumulation",
        "base de voisinages", "topologie induite", "topologie produit",
        "continuité", "homéomorphisme", "compact", "connexe", "séparé",
        "espace métrique", "distance", "boule ouverte", "boule fermée",
        "variété", "homotopie", "groupe fondamental", "revêtement",
        "géodésique", "courbure", "espace euclidien",
    ],
    "probability": [
        "probabilité", "événement", "tribu", "espace probabilisé",
        "variable aléatoire", "loi de probabilité", "fonction de répartition",
        "espérance", "variance", "écart-type", "covariance", "indépendance",
        "probabilité conditionnelle", "formule de Bayes", "loi normale",
        "loi binomiale", "loi de Poisson", "loi des grands nombres",
        "théorème central limite", "presque sûrement", "en probabilité",
        "convergence en loi", "estimateur", "intervalle de confiance",
        "test d'hypothèse", "vraisemblance",
    ],
    "number_theory": [
        "nombre premier", "divisibilité", "diviseur", "multiple", "congruence",
        "modulo", "plus grand commun diviseur", "algorithme d'Euclide",
        "identité de Bézout", "lemme de Gauss", "fonction arithmétique",
        "résidu quadratique", "théorème chinois des restes", "indicatrice d'Euler",
        "quantificateur", "prédicat", "implication", "négation",
        "conjonction", "disjonction", "table de vérité", "cardinal",
        "dénombrable", "indécidable", "axiome", "contradiction",
    ],
}

HOTWORD_TOKEN_BUDGET = 223
GLOSSARY_PATH = Path(__file__).with_name("course_glossaries.json")
OUTPUT_ROOT = Path(tempfile.gettempdir()) / "whisper_gui_outputs"
OLLAMA_API = "http://127.0.0.1:11434"
DEFAULT_GLOSSARY_MODEL = "qwen3:4b-instruct"
AI_PROVIDERS = [
    ("本地 Ollama · 免费且不上传", "local"),
    ("OpenAI GPT-5.6 Terra · 推荐", "gpt-5.6-terra"),
    ("OpenAI GPT-6 Astra · 最高质量", "gpt-6-astra"),
    ("OpenAI GPT-5.6 Luna · 最低费用", "gpt-5.6-luna"),
]
_GLOSSARY_LOCK = threading.RLock()
_TOKENIZER = None

FRENCH_MATH_PROMPT = (
    "Transcription fidèle d'un cours universitaire de mathématiques en français. "
    "Respecter le vocabulaire mathématique, les accents, les noms de théorèmes, "
    "les symboles dictés et la ponctuation. Ne pas traduire."
)

LANGUAGES = [
    ("自动检测", ""),
    ("中文", "zh"),
    ("英语", "en"),
    ("法语", "fr"),
    ("德语", "de"),
    ("日语", "ja"),
    ("韩语", "ko"),
    ("西班牙语", "es"),
    ("俄语", "ru"),
    ("意大利语", "it"),
    ("葡萄牙语", "pt"),
    ("阿拉伯语", "ar"),
]

DEVICE = "cuda"
COMPUTE_TYPE = None

UI_CSS = """
.gradio-container { max-width: 1180px !important; margin: 0 auto !important; padding-top: 24px !important; }
.whisper-hero { position: relative; overflow: hidden; padding: 25px 28px; border: 1px solid rgba(255,255,255,.14); border-radius: 20px; background: linear-gradient(125deg, #111c4e 0%, #3730a3 58%, #6d28d9 100%); box-shadow: 0 18px 48px rgba(49,46,129,.20); color: #fff !important; }
.whisper-hero::after { content: ""; position: absolute; width: 260px; height: 260px; right: -90px; top: -150px; border-radius: 50%; background: rgba(255,255,255,.12); }
.whisper-hero h1 { position: relative; margin: 0 0 7px 0 !important; font-size: 1.75rem !important; line-height: 1.2; color: #fff !important; }
.whisper-hero p { position: relative; margin: 0 !important; color: rgba(255,255,255,.83) !important; font-size: .95rem; }
.hero-pills { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 15px; }
.hero-pill { padding: 5px 10px; border: 1px solid rgba(255,255,255,.22); border-radius: 999px; background: rgba(255,255,255,.10); color: #fff; font-size: .78rem; }
.workflow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0 2px; }
.workflow-step { padding: 10px 13px; border: 1px solid var(--border-color-primary); border-radius: 12px; background: var(--block-background-fill); color: var(--body-text-color-subdued); font-size: .88rem; }
.workflow-step b { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 7px; border-radius: 50%; background: #4f46e5; color: #fff; }
.mode-card { border: 1px solid var(--border-color-primary) !important; border-radius: 14px !important; box-shadow: 0 4px 16px rgba(15,23,42,.05); }
.status-card { min-height: 56px; padding: 11px 15px; border: 1px solid var(--border-color-primary); border-left: 4px solid #6366f1; border-radius: 10px; background: var(--block-background-fill); }
.primary-action { min-height: 48px; font-weight: 700; letter-spacing: .01em; }
.result-box textarea { font-size: 15px !important; line-height: 1.7 !important; }
.section-note { margin-top: 4px; padding: 11px 14px; border-radius: 10px; background: rgba(79,70,229,.07); color: var(--body-text-color-subdued); font-size: .88rem; }
@media (max-width: 700px) { .workflow { grid-template-columns: 1fr; } .gradio-container { padding-top: 10px !important; } }
"""

UI_THEME = gr.themes.Soft(
    primary_hue="indigo",
    secondary_hue="violet",
    neutral_hue="slate",
    radius_size="lg",
).set(
    body_background_fill="#f8fafc",
    body_background_fill_dark="#0f172a",
    button_primary_background_fill="#4f46e5",
    button_primary_background_fill_hover="#4338ca",
    button_primary_border_color="#4f46e5",
    button_primary_text_color="#ffffff",
    block_radius="14px",
    input_radius="12px",
)


def _split_terms(text: str) -> list[str]:
    """按常见中西文分隔符拆词并去重，保留原顺序。"""
    seen: set[str] = set()
    result: list[str] = []
    for raw in re.split(r"[,，;；\n]+", text or ""):
        term = " ".join(raw.split()).strip()
        key = term.casefold()
        if term and key not in seen:
            seen.add(key)
            result.append(term)
    return result


def _get_tokenizer():
    """从已下载的 large-v3 快照加载轻量 tokenizer，不加载 GPU 模型。"""
    global _TOKENIZER
    if _TOKENIZER is not None:
        return _TOKENIZER
    try:
        from huggingface_hub import snapshot_download
        from tokenizers import Tokenizer

        model_dir = snapshot_download(
            "Systran/faster-whisper-large-v3",
            allow_patterns=["tokenizer.json"],
            local_files_only=True,
        )
        _TOKENIZER = Tokenizer.from_file(str(Path(model_dir) / "tokenizer.json"))
    except Exception:  # noqa: BLE001 - 模型尚未下载时用保守估算；下次调用会重试
        return None
    return _TOKENIZER


def _token_count(text: str) -> int:
    tokenizer = _get_tokenizer()
    if tokenizer:
        return len(tokenizer.encode(" " + text.strip()).ids)
    # 法语 Whisper BPE 通常约 3 个字符/token；向上取整避免预算溢出
    return max(1, (len(text.strip()) + 2) // 3)


def _build_hotwords(profile: str, custom_terms: str) -> tuple[str | None, int, list[str]]:
    """优先装入用户术语，再装学科和通用术语；只加入完整词条。"""
    custom = _split_terms(custom_terms)
    built_in = SUBJECT_TERMS.get(profile, []) + COMMON_MATH_TERMS
    candidates = custom + built_in if profile != "general" else custom

    selected: list[str] = []
    omitted: list[str] = []
    seen: set[str] = set()
    used = 0
    for term in candidates:
        key = term.casefold()
        if key in seen:
            continue
        seen.add(key)
        candidate = ", ".join(selected + [term])
        count = _token_count(candidate)
        if count <= HOTWORD_TOKEN_BUDGET:
            selected.append(term)
            used = count
        else:
            omitted.append(term)
    return (", ".join(selected) or None), used, omitted


def glossary_budget(profile: str, custom_terms: str) -> str:
    _, used, omitted = _build_hotwords(profile, custom_terms)
    custom_count = len(_split_terms(custom_terms))
    color = "🟢" if used <= 180 else "🟠"
    omitted_text = f" · 已省略 {len(omitted)} 个低优先级内置词" if omitted else ""
    return f"{color} **术语预算 {used}/{HOTWORD_TOKEN_BUDGET} tokens** · 自定义 {custom_count} 词{omitted_text}"


def _domain_options(profile: str, custom_terms: str) -> tuple[str | None, str | None, str | None]:
    """返回 (强制语言, initial_prompt, hotwords)。"""
    hotwords, _, _ = _build_hotwords(profile, custom_terms)
    if profile in SUBJECT_TERMS:
        return "fr", FRENCH_MATH_PROMPT, hotwords
    return None, None, hotwords


def _read_courses() -> dict[str, dict[str, str]]:
    with _GLOSSARY_LOCK:
        try:
            data = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
            courses = data.get("courses", {})
            return courses if isinstance(courses, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}


def _course_choices() -> list[str]:
    return sorted(_read_courses(), key=str.casefold)


def _write_courses(courses: dict[str, dict[str, str]]) -> None:
    """原子写入课程库，避免程序中断留下半个 JSON 文件。"""
    with _GLOSSARY_LOCK:
        temp_path = GLOSSARY_PATH.with_suffix(".tmp")
        temp_path.write_text(
            json.dumps({"version": 2, "courses": courses}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temp_path.replace(GLOSSARY_PATH)


def _store_course(course_name: str, profile: str, custom_terms: str,
                  description: str = "", ai_model: str | None = None):
    name = " ".join((course_name or "").split()).strip()
    if not name:
        raise gr.Error("请先填写课程名称，例如 Analyse 1。")
    courses = _read_courses()
    previous = courses.get(name, {})
    record = {
        "profile": profile,
        "terms": custom_terms or "",
        "description": (description or "").strip(),
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    model = ai_model or previous.get("ai_model")
    if model:
        record["ai_model"] = model
    courses[name] = record
    _write_courses(courses)
    choices = sorted(courses, key=str.casefold)
    return name, choices


def save_course(course_name: str, profile: str, custom_terms: str, description: str = ""):
    name, choices = _store_course(course_name, profile, custom_terms, description)
    return gr.Dropdown(choices=choices, value=name), f"✅ 已保存课程词库：**{name}**"


def load_course(course_name: str):
    courses = _read_courses()
    item = courses.get(course_name or "")
    if not item:
        raise gr.Error("请选择一个已保存的课程词库。")
    profile = item.get("profile", "french_math")
    terms = item.get("terms", "")
    description = item.get("description", "")
    ai_note = f" · AI: `{item['ai_model']}`" if item.get("ai_model") else ""
    return (
        profile, terms, glossary_budget(profile, terms),
        f"✅ 已选择课程：**{course_name}**{ai_note}", course_name, description,
    )


def delete_course(course_name: str):
    name = course_name or ""
    courses = _read_courses()
    if name not in courses:
        raise gr.Error("请先选择要删除的课程词库。")
    del courses[name]
    _write_courses(courses)
    return gr.Dropdown(choices=sorted(courses, key=str.casefold), value=None), f"已删除课程词库：**{name}**"


def _ollama_json(path: str, payload: dict | None = None, timeout: int = 10) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{OLLAMA_API}{path}", data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _ollama_models() -> list[str]:
    try:
        data = _ollama_json("/api/tags", timeout=2)
        return [item.get("name", "") for item in data.get("models", []) if item.get("name")]
    except Exception:  # noqa: BLE001 - 状态检查不能影响 GUI 启动
        pass

    # Ollama 安装后通常会随用户登录启动；若被手动关闭，GUI 尝试静默恢复一次。
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    bundled_path = Path(local_app_data) / "Programs" / "Ollama" / "ollama.exe"
    executable = shutil.which("ollama") or (str(bundled_path) if bundled_path.is_file() else None)
    if not executable:
        return []
    try:
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.Popen(
            [executable, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
        for _ in range(10):
            time.sleep(0.3)
            try:
                data = _ollama_json("/api/tags", timeout=1)
                return [item.get("name", "") for item in data.get("models", []) if item.get("name")]
            except Exception:  # noqa: BLE001
                continue
    except OSError:
        pass
    return []


def _select_glossary_model() -> str | None:
    models = _ollama_models()
    if DEFAULT_GLOSSARY_MODEL in models:
        return DEFAULT_GLOSSARY_MODEL
    for model in models:
        if model.startswith(("qwen3", "qwen2.5", "mistral", "llama3")):
            return model
    return models[0] if models else None


def ollama_status() -> str:
    model = _select_glossary_model()
    if model:
        return f"🟢 本地 AI 已就绪：`{model}`"
    return "🟠 未检测到本地 AI 模型；转写仍可使用，AI 词表生成需启动 Ollama 并下载模型。"


def ai_provider_info(provider: str) -> str:
    if provider == "local":
        return f"{ollama_status()} · 适合词表、提纲和普通笔记；复杂证明建议使用联网高质量模式。"
    details = {
        "gpt-5.6-terra": "🟢 推荐：高质量数学笔记与合理费用的平衡。输入 $2/M tokens，输出 $12/M tokens。",
        "gpt-6-astra": "🟣 最高质量：适合证明密集、长课程整合和疑难纠错。输入 $10/M tokens，输出 $50/M tokens。",
        "gpt-5.6-luna": "🔵 经济模式：适合批量提纲和词表。输入 $0.20/M tokens，输出 $1.20/M tokens。",
    }
    return details.get(provider, "请选择 AI 模型。") + " 联网时课程文字会发送到 OpenAI；API Key 不会写入课程文件。"


def _extract_openai_text(response: dict) -> str:
    direct = response.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    parts: list[str] = []
    for item in response.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") == "output_text":
                text = content.get("text", "")
                if text:
                    parts.append(str(text))
    return "\n".join(parts).strip()


def _generate_with_openai(model: str, prompt: str, api_key: str,
                          max_output_tokens: int = 5000, timeout: int = 300) -> str:
    key = (api_key or "").strip() or os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise gr.Error("联网模式需要 OpenAI API Key。可在界面中临时填写，或设置 OPENAI_API_KEY 环境变量。")
    effort = "medium" if model == "gpt-5.6-luna" else "high"
    payload = {
        "model": model,
        "input": prompt,
        "reasoning": {"effort": effort},
        "max_output_tokens": max_output_tokens,
        "store": False,
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:500]
        raise gr.Error(f"OpenAI 请求失败（HTTP {exc.code}）：{body}") from exc
    except OSError as exc:
        raise gr.Error(f"无法连接 OpenAI：{exc}") from exc
    text = _extract_openai_text(result)
    if not text:
        raise gr.Error("OpenAI 返回了空内容。")
    return text


def _generate_with_provider(provider: str, api_key: str, cloud_consent: bool,
                            prompt: str, local_num_predict: int = 1800,
                            online_max_tokens: int = 5000) -> tuple[str, str]:
    if provider == "local":
        model = _select_glossary_model()
        if not model:
            raise gr.Error("本地 AI 尚未就绪。请确认 Ollama 正在运行且已有可用模型。")
        return _generate_with_ollama(model, prompt, num_predict=local_num_predict), model
    if not cloud_consent:
        raise gr.Error("使用联网模型前，请勾选“允许发送当前课程文字到 OpenAI”。")
    return _generate_with_openai(provider, prompt, api_key, online_max_tokens), provider


def generate_course_glossary(course_name: str, description: str, profile: str,
                             existing_terms: str, provider: str, api_key: str,
                             cloud_consent: bool, progress=gr.Progress()):
    """用所选 AI 生成法语课程词汇表，并保存为可重复使用的课程。"""
    name = " ".join((course_name or "").split()).strip()
    if not name:
        raise gr.Error("请填写课程名称。")
    profile_labels = {value: label for label, value in DOMAIN_PROFILES}
    subject = profile_labels.get(profile, profile)
    progress(0.05, desc="AI 正在分析课程…")
    prompt = f"""你是一名法国大学数学课程助教。请为 Whisper 法语课堂听写生成专有词汇表。

课程名称：{name}
学科方向：{subject}
课程说明、教学大纲或当前章节：{(description or '未提供，请根据课程名称合理推断').strip()}

要求：
1. 生成 35 到 55 个最可能在该课程中出现、且容易被语音识别误听的法语术语。
2. 优先包含定理名称、数学家姓名、专业多词短语和带重音符号的词；不要写定义或解释。
3. 使用标准法语拼写，不要翻译成中文，不要加入普通数学词或重复词。
4. 只返回 JSON，格式为 {{"terms":["terme 1","terme 2"]}}。
"""
    try:
        if provider == "local":
            model = _select_glossary_model()
            if not model:
                raise gr.Error("本地 AI 尚未就绪。请确认 Ollama 正在运行且已有可用模型。")
            response = _ollama_json(
                "/api/generate",
                {
                    "model": model, "prompt": prompt, "stream": False, "format": "json",
                    "options": {"temperature": 0.2, "num_predict": 900},
                },
                timeout=180,
            )
            raw_response = response.get("response", "{}")
        else:
            raw_response, model = _generate_with_provider(
                provider, api_key, cloud_consent, prompt,
                online_max_tokens=3000,
            )
        candidate = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_response.strip(), flags=re.IGNORECASE)
        parsed = json.loads(candidate)
        raw_terms = parsed.get("terms", []) if isinstance(parsed, dict) else []
    except gr.Error:
        raise
    except Exception as exc:  # noqa: BLE001 - 给用户可操作的 AI 错误
        raise gr.Error(f"AI 词表生成失败：{exc}") from exc

    if not isinstance(raw_terms, list):
        raise gr.Error("AI 返回的词表格式不正确，请再试一次。")
    generated = _split_terms(",".join(str(term) for term in raw_terms if isinstance(term, str)))
    generated = [term for term in generated if 1 < len(term) <= 100][:60]
    merged = _split_terms(",".join(_split_terms(existing_terms) + generated))
    if not merged:
        raise gr.Error("AI 没有生成有效词汇，请补充课程说明后重试。")
    terms = ", ".join(merged)
    stored_name, choices = _store_course(name, profile, terms, description, ai_model=model)
    progress(1.0, desc="课程词库已生成并保存")
    status = (
        f"✅ AI 已生成并保存课程 **{stored_name}** · 共 {len(merged)} 个专有词 · "
        f"模型 `{model}`。以后只需在“当前课程”中选择它。"
    )
    return terms, glossary_budget(profile, terms), gr.Dropdown(choices=choices, value=stored_name), status


def _clean_ai_text(text: str) -> str:
    """去掉部分推理模型可能返回的思考区，只保留给用户的成品。"""
    cleaned = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL | re.IGNORECASE)
    return cleaned.strip()


def _generate_with_ollama(model: str, prompt: str, timeout: int = 240,
                          num_predict: int = 1800) -> str:
    response = _ollama_json(
        "/api/generate",
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.15, "num_predict": num_predict},
            "keep_alive": "10m",
        },
        timeout=timeout,
    )
    result = _clean_ai_text(response.get("response", ""))
    if not result:
        raise RuntimeError("本地 AI 返回了空内容")
    return result


def _chunk_transcript(text: str, max_chars: int = 12000) -> list[str]:
    """按段落和句号附近切分长转写，避免单次提示超过本地模型上下文。"""
    source = (text or "").strip()
    if not source:
        return []
    chunks: list[str] = []
    while len(source) > max_chars:
        cut = max(
            source.rfind("\n", 0, max_chars),
            source.rfind("。", 0, max_chars),
            source.rfind(". ", 0, max_chars),
            source.rfind("? ", 0, max_chars),
        )
        if cut < max_chars // 2:
            cut = max_chars
        else:
            cut += 1
        chunks.append(source[:cut].strip())
        source = source[cut:].strip()
    if source:
        chunks.append(source)
    return chunks


def generate_study_notes(transcript: str, selected_course: str, course_name: str,
                         description: str, output_language: str, provider: str,
                         api_key: str, cloud_consent: bool,
                         progress=gr.Progress()):
    """仅依据课堂转写生成结构化课后笔记；长文本先分块提炼再合并。"""
    # 联网模型上下文更大，通常整堂课只需一段；本地 4B 模型采用小段分治。
    chunks = _chunk_transcript(transcript, max_chars=180000 if provider != "local" else 12000)
    if not chunks:
        raise gr.Error("请先完成一次转写，或在结果框中粘贴课堂文字。")
    course = selected_course or course_name or "未命名课程"
    language_instruction = {
        "中文": "使用中文撰写，但保留所有法语数学术语并在首次出现时给出中文解释",
        "Français": "rédiger entièrement en français académique",
        "中法双语": "以中文为主，每个核心定义、定理和专业术语同时给出法语原文",
    }.get(output_language, "使用中文撰写，并保留法语数学术语")

    summaries: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        progress((index - 1) / (len(chunks) + 1), desc=f"AI 阅读课堂文字 {index}/{len(chunks)}")
        prompt = f"""你是严谨的大学数学学习助教。下面是法语数学课转写的第 {index}/{len(chunks)} 部分。
课程：{course}
课程范围：{(description or '未提供').strip()}

只根据转写内容提炼：关键定义、定理与条件、证明思路、公式的口述表达、例题、教师强调点，以及疑似转写错误。
禁止补写课堂中没有出现的结论；不确定处明确标注“待核对”。{language_instruction}。

课堂转写：
---
{chunk}
---
        输出紧凑的 Markdown 分段摘要。"""
        try:
            summary, model = _generate_with_provider(
                provider, api_key, cloud_consent, prompt,
                local_num_predict=900, online_max_tokens=4500,
            )
            summaries.append(summary)
        except gr.Error:
            raise
        except Exception as exc:  # noqa: BLE001
            raise gr.Error(f"生成第 {index} 段笔记失败：{exc}") from exc

    progress(len(chunks) / (len(chunks) + 1), desc="AI 正在整理最终笔记…")
    material = "\n\n".join(
        f"## 分段提炼 {i}\n{summary}" for i, summary in enumerate(summaries, start=1)
    )
    final_prompt = f"""你是大学数学课程的课后笔记编辑。请把下面的分段提炼合并为一份可复习的 Markdown 笔记。
课程：{course}
课程范围：{(description or '未提供').strip()}
语言：{language_instruction}。

必须包含：
1. 本课概要
2. 核心定义与法语术语
3. 定理、成立条件与结论
4. 证明或推导思路
5. 课堂例子
6. 容易混淆或需要核对的内容

删除重复内容。只整理笔记，不另编问题或答案。只能依据材料，不得自行补充课堂未提及的事实；信息不足时标记“待核对”。

分段提炼：
    {material}
    """
    try:
        notes, model = _generate_with_provider(
            provider, api_key, cloud_consent, final_prompt,
            local_num_predict=2400, online_max_tokens=9000,
        )
    except gr.Error:
        raise
    except Exception as exc:  # noqa: BLE001
        raise gr.Error(f"合并课后笔记失败：{exc}") from exc

    _cleanup_output_dirs()
    safe_course = re.sub(r"[^\w.-]+", "_", course, flags=re.UNICODE).strip("._") or "course"
    out_dir = OUTPUT_ROOT / f"{time.strftime('%Y%m%d-%H%M%S')}_{uuid.uuid4().hex[:8]}_notes"
    out_dir.mkdir(parents=True, exist_ok=False)
    path = out_dir / f"{safe_course}_study_notes.md"
    path.write_text(notes + "\n", encoding="utf-8")
    progress(1.0, desc="课后笔记已完成")
    return f"✅ 已生成课后笔记 · {len(chunks)} 个文本分段 · 模型 `{model}`", notes, str(path)


def _cleanup_output_dirs(max_age_hours: int = 24, keep_latest: int = 20) -> None:
    """只清理本程序专用临时根目录，保留最近任务和 24 小时内结果。"""
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    now = time.time()
    dirs = sorted(
        (p for p in OUTPUT_ROOT.iterdir() if p.is_dir()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for index, directory in enumerate(dirs):
        age_hours = (now - directory.stat().st_mtime) / 3600
        if index >= keep_latest or age_hours > max_age_hours:
            shutil.rmtree(directory, ignore_errors=True)


def _run(path: str, model_name: str, language: str, task: str, vad: bool, beam: int,
         profile: str = "general", custom_terms: str = "", robust_audio: bool = True,
         on_progress=None):
    """跑一次转写，返回 (segments, info)。"""
    model = engine.load_model(model_name, DEVICE, COMPUTE_TYPE)
    forced_language, initial_prompt, hotwords = _domain_options(profile, custom_terms)
    return engine.transcribe(
        model,
        path,
        language=forced_language or language or None,
        task=task,
        vad_filter=vad,
        beam_size=beam,
        initial_prompt=initial_prompt,
        hotwords=hotwords,
        on_progress=on_progress,
        # 长课堂录音容易在噪声、停顿处陷入 le/on/et 一类重复循环。
        # 关闭跨片段上下文传播并启用词级幻觉检测，可把错误限制在当前片段。
        condition_on_previous_text=not robust_audio,
        repetition_penalty=1.15 if robust_audio else 1.0,
        no_repeat_ngram_size=3 if robust_audio else 0,
        vad_parameters={
            "threshold": 0.45,
            "min_speech_duration_ms": 250,
            "min_silence_duration_ms": 700,
            "speech_pad_ms": 500,
        } if robust_audio and vad else None,
        compression_ratio_threshold=2.0 if robust_audio else 2.4,
        log_prob_threshold=-0.8 if robust_audio else -1.0,
        no_speech_threshold=0.5 if robust_audio else 0.6,
        word_timestamps=robust_audio,
        hallucination_silence_threshold=2.0 if robust_audio else None,
    )


def _segments_table(segments) -> list[list]:
    return [
        [
            i,
            engine.fmt_timestamp(s.start, "."),
            engine.fmt_timestamp(s.end, "."),
            _segment_quality(s)[0],
            s.text.strip(),
        ]
        for i, s in enumerate(segments, start=1)
    ]


def _segment_quality(segment) -> tuple[str, bool]:
    """把 Whisper 的平均对数概率转换为便于人工复核的近似质量分。"""
    avg_logprob = getattr(segment, "avg_logprob", None)
    no_speech = getattr(segment, "no_speech_prob", 0.0) or 0.0
    if avg_logprob is None:
        return "—", False
    score = max(0, min(100, round(math.exp(float(avg_logprob)) * 100)))
    word_count = len((getattr(segment, "text", "") or "").strip().split())
    duration = max(0.0, float(getattr(segment, "end", 0) or 0) - float(getattr(segment, "start", 0) or 0))
    suspicious_single_word = word_count <= 1 and duration >= 5.0
    needs_review = float(avg_logprob) < -0.8 or float(no_speech) > 0.6 or suspicious_single_word
    return f"{'⚠️' if needs_review else '✓'} {score}%", needs_review


def _quality_summary(segments) -> tuple[int, int]:
    total = len(segments)
    review = sum(1 for segment in segments if _segment_quality(segment)[1])
    return review, total


def _write_files(stem: str, segments, info, text: str) -> list[str]:
    _cleanup_output_dirs()
    safe_stem = re.sub(r"[^\w.-]+", "_", stem, flags=re.UNICODE).strip("._") or "transcript"
    job_id = f"{time.strftime('%Y%m%d-%H%M%S')}_{uuid.uuid4().hex[:8]}_{safe_stem}"
    out_dir = OUTPUT_ROOT / job_id
    out_dir.mkdir(parents=True, exist_ok=False)
    paths = []
    for name, content in (
        (f"{stem}.txt", engine.to_text(segments)),
        (f"{stem}.srt", engine.to_srt(segments)),
        (f"{stem}.vtt", engine.to_vtt(segments)),
        (f"{stem}.json", json.dumps(engine.to_dict(segments, info, text), ensure_ascii=False, indent=2)),
    ):
        p = out_dir / name
        p.write_text(content, encoding="utf-8")
        paths.append(str(p))
    return paths


def export_revised_text(text: str, stem: str) -> str:
    """把用户在结果框里人工修订后的全文另存为 TXT。"""
    revised = (text or "").strip()
    if not revised:
        raise gr.Error("当前没有可导出的修订文本。")
    _cleanup_output_dirs()
    safe_stem = re.sub(r"[^\w.-]+", "_", stem or "transcript", flags=re.UNICODE).strip("._")
    safe_stem = safe_stem or "transcript"
    out_dir = OUTPUT_ROOT / f"{time.strftime('%Y%m%d-%H%M%S')}_{uuid.uuid4().hex[:8]}_revised"
    out_dir.mkdir(parents=True, exist_ok=False)
    path = out_dir / f"{safe_stem}_revised.txt"
    path.write_text(revised + "\n", encoding="utf-8")
    return str(path)


def transcribe_single(audio_path, model_name, language, task, vad, beam, robust_audio, profile, custom_terms,
                      progress=gr.Progress()):
    if not audio_path:
        raise gr.Error("请先上传音频/视频，或点击麦克风录音。")

    stem = Path(audio_path).stem

    # 模型加载（含首次下载）没有可靠的百分比，单独用文字提示，进度条留给转写本身
    progress(0.0, desc="加载模型…")
    yield "⏳ 正在加载模型并准备术语词库…首次使用模型时需要等待下载。", "", [], None, stem

    t0 = time.perf_counter()
    def cb(frac, desc):
        elapsed_now = time.perf_counter() - t0
        eta = elapsed_now * (1 - frac) / frac if frac > 0 else 0
        eta_text = f" · 约剩 {eta:.0f}s" if 0 < frac < 1 else ""
        progress(frac, desc=f"转写中 {frac:.0%} · {desc}{eta_text}")

    segments, info = _run(
        audio_path, model_name, language, task, vad, int(beam),
        profile=profile, custom_terms=custom_terms, robust_audio=robust_audio, on_progress=cb,
    )
    elapsed = time.perf_counter() - t0

    text = engine.to_text(segments)
    duration = getattr(info, "duration", 0) or 0
    speed = f"{duration / elapsed:.1f}x" if elapsed > 0 and duration else "n/a"
    review_count, segment_count = _quality_summary(segments)
    review_note = (
        f" · ⚠️ 建议复核 {review_count}/{segment_count} 段"
        if review_count else f" · 质量检查 {segment_count} 段均正常"
    )
    status = (
        f"✅ 完成 · 语言 {info.language}（置信度 {info.language_probability:.2f}）· "
        f"音频时长 {engine.fmt_timestamp(duration, '.')} · 耗时 {elapsed:.1f}s（{speed} 实时倍速）"
        f"{review_note}"
    )

    yield status, text, _segments_table(segments), _write_files(stem, segments, info, text), stem


def transcribe_batch(files, model_name, language, task, vad, beam, robust_audio, profile, custom_terms,
                     progress=gr.Progress()):
    if not files:
        raise gr.Error("请先选择要批量转写的文件（可多选）。")

    paths = [f if isinstance(f, str) else f.name for f in files]
    total_files = len(paths)
    rows, combined, all_files = [], [], []
    started = time.perf_counter()

    def snapshot(status):
        """把当前累积的结果打包成一份输出快照。"""
        return status, "\n".join(combined).strip(), [list(r) for r in rows], list(all_files)

    yield snapshot(f"⏳ 共 {total_files} 个文件，开始处理…")

    for idx, path in enumerate(paths):
        name = Path(path).name
        progress(idx / total_files, desc=f"[{idx + 1}/{total_files}] {name}")

        # 默认参数固化当前值，避免闭包在后续迭代里取到错的 idx/name
        file_started = time.perf_counter()

        def cb(frac, desc, _idx=idx, _name=name, _started=file_started):
            elapsed_now = time.perf_counter() - _started
            eta = elapsed_now * (1 - frac) / frac if frac > 0 else 0
            eta_text = f" · 本文件约剩 {eta:.0f}s" if 0 < frac < 1 else ""
            progress((_idx + frac) / total_files,
                     desc=f"[{_idx + 1}/{total_files}] {_name} · {frac:.0%} · {desc}{eta_text}")

        try:
            segments, info = _run(
                path, model_name, language, task, vad, int(beam),
                profile=profile, custom_terms=custom_terms, robust_audio=robust_audio,
                on_progress=cb,
            )
        except Exception as exc:  # noqa: BLE001 - 单个失败不该中断整批
            rows.append([name, "失败", "-", str(exc)[:80]])
            combined.append(f"===== {name}（失败）=====\n{exc}\n")
            yield snapshot(f"⚠️ [{idx + 1}/{total_files}] {name} 失败：{str(exc)[:120]}")
            continue

        text = engine.to_text(segments)
        duration = getattr(info, "duration", 0) or 0
        review_count, _ = _quality_summary(segments)
        rows.append([
            name,
            "完成",
            f"{len(segments)} 段 / {engine.fmt_timestamp(duration, '.')} / 复核 {review_count}",
            text.strip()[:80] + ("…" if len(text.strip()) > 80 else ""),
        ])
        combined.append(f"===== {name} =====\n{text.strip()}\n")
        all_files.extend(_write_files(Path(path).stem, segments, info, text))

        yield snapshot(f"⏳ [{idx + 1}/{total_files}] {name} 完成")

    elapsed = time.perf_counter() - started
    ok = sum(1 for r in rows if r[1] == "完成")
    progress(1.0, desc="完成")
    yield snapshot(f"✅ 处理 {ok}/{total_files} 个文件，总耗时 {elapsed:.1f}s")


def build_ui() -> gr.Blocks:
    with gr.Blocks(title="本地 Whisper 语音转文字") as demo:
        gr.HTML(
            '<div class="whisper-hero"><h1>🎙️ 本地 Whisper 语音转文字</h1>'
            f'<p>面向法语数学课程的高精度离线听写</p>'
            '<div class="hero-pills">'
            '<span class="hero-pill">large-v3</span>'
            f'<span class="hero-pill">{DEVICE.upper()} 加速</span>'
            '<span class="hero-pill">法语术语增强</span>'
            '<span class="hero-pill">音频不出本机</span>'
            '</div></div>'
            '<div class="workflow">'
            '<div class="workflow-step"><b>1</b>选择课程</div>'
            '<div class="workflow-step"><b>2</b>上传或录制音频</div>'
            '<div class="workflow-step"><b>3</b>精确转写并复习</div>'
            '</div>'
        )

        with gr.Row(equal_height=True):
            saved_course = gr.Dropdown(
                choices=_course_choices(),
                label="当前课程",
                info="选择后自动加载这门课固定的学科和专有词汇表",
                scale=2,
                elem_classes="mode-card",
            )
            course_status = gr.Markdown(
                "尚未选择课程。首次使用可在下方让本地 AI 创建课程词库。",
                elem_classes="status-card",
            )

        with gr.Row(equal_height=True):
            with gr.Column(scale=2, min_width=320):
                profile_dd = gr.Dropdown(
                    DOMAIN_PROFILES,
                    value="french_math",
                    label="数学学科词库",
                    info="固定法语并注入大学数学术语与上下文",
                    elem_classes="mode-card",
                )
            with gr.Column(scale=3, min_width=420):
                custom_terms = gr.Textbox(
                    label="本节课的专有词汇（可选，但很有用）",
                    placeholder="例如：théorème de Cayley-Hamilton, espace de Sobolev…",
                    info="填写定理、人名或章节术语的正确法语拼写；用逗号分隔",
                    lines=1,
                )
                budget_md = gr.Markdown(glossary_budget("french_math", ""))

        with gr.Accordion("AI 模型设置 · 本地或联网", open=False):
            with gr.Row():
                ai_provider = gr.Dropdown(
                    AI_PROVIDERS, value="local", label="AI 模型",
                    info="本地模式免费；联网模式更适合高级数学笔记",
                )
                openai_key = gr.Textbox(
                    label="OpenAI API Key（仅联网模式）",
                    type="password",
                    placeholder="sk-…；仅在当前程序内存中使用，不写入课程文件",
                )
            cloud_consent = gr.Checkbox(
                value=False,
                label="允许将当前课程名称、说明、词表或转写文字发送到 OpenAI",
            )
            provider_info = gr.Markdown(ai_provider_info("local"))

        with gr.Accordion("新建或管理课程词库 · AI", open=False):
            with gr.Row():
                course_name = gr.Textbox(
                    label="课程名称", placeholder="例如 Analyse 1 · M. Dupont",
                )
                course_description = gr.Textbox(
                    label="课程说明 / 教学大纲 / 当前章节",
                    placeholder="例如：espaces de Banach, séries de Fourier, distributions…",
                    info="信息越具体，AI 生成的专有词汇越贴合课程",
                    lines=3,
                )
            with gr.Row():
                ai_course_btn = gr.Button("✨ AI 生成词汇表并保存", variant="primary", size="lg", scale=2)
                save_course_btn = gr.Button("保存手动修改", size="lg")
                delete_course_btn = gr.Button("删除所选课程", variant="stop", size="sm")
            gr.Markdown(
                "生成一次后，以后只需从“当前课程”选择。联网模式会发送本次输入内容；API Key 不保存。"
            )

        with gr.Accordion("高级识别设置 · 默认无需修改", open=False):
            with gr.Row():
                model_dd = gr.Dropdown(MODELS, value="large-v3", label="模型",
                                       info="large-v3 精度最高，建议保持默认")
                lang_dd = gr.Dropdown(LANGUAGES, value="fr", label="语言",
                                      info="法语数学模式下固定为法语")
                task_radio = gr.Radio(["transcribe", "translate"], value="transcribe",
                                      label="任务", info="transcribe=原语言；translate=译成英文")
            with gr.Row():
                vad_cb = gr.Checkbox(value=True, label="静音过滤 (VAD)",
                                     info="跳过纯静音片段，通常更快更准")
                robust_audio_cb = gr.Checkbox(
                    value=True,
                    label="课堂录音抗重复增强",
                    info="阻止 le / on / et 等长时间循环；长课和较差录音建议始终开启",
                )
                beam_sl = gr.Slider(1, 10, value=8, step=1, label="搜索精度",
                                    info="法语数学默认 8；更准确，但比 5 稍慢")
            gr.Markdown(
                "**课堂录音抗重复增强**会隔离各语音片段的错误上下文、过滤可疑静音，"
                "并标记持续过久的单词片段。它会稍微降低速度，但能显著减少长录音中的重复幻觉。"
            )
        with gr.Tab("单个文件 / 麦克风"):
            with gr.Row():
                with gr.Column():
                    audio_in = gr.Audio(
                        sources=["upload", "microphone"],
                        type="filepath",
                        label="把音频拖到这里，或点击麦克风录音",
                    )
                    with gr.Row():
                        single_btn = gr.Button(
                            "开始精确转写", variant="primary", size="lg", scale=4,
                            elem_classes="primary-action",
                        )
                        single_stop = gr.Button("停止", variant="stop", size="lg", scale=1)

                with gr.Column():
                    single_status = gr.Markdown("等待上传文件", elem_classes="status-card")
                    single_text = gr.Textbox(
                        label="转写结果（可编辑、可复制）", lines=12,
                        interactive=True, elem_classes="result-box",
                    )
                    single_stem = gr.State("")

            with gr.Accordion("时间轴与下载", open=False):
                single_segs = gr.Dataframe(
                    headers=["#", "开始", "结束", "质量", "内容"],
                    label="逐句时间轴 · ⚠️ 表示建议优先复核",
                    wrap=True,
                    interactive=False,
                )
                single_files = gr.Files(label="下载 TXT / SRT / VTT / JSON")
                gr.Markdown("编辑上方全文后，可单独导出人工修订稿；原始字幕和时间轴保持不变。")
                with gr.Row():
                    revised_btn = gr.Button("导出修订后的 TXT", variant="secondary")
                    revised_file = gr.File(label="修订稿下载")

            with gr.Accordion("📚 AI 课后学习 · 生成笔记", open=False):
                gr.Markdown(
                    "所选 AI 只依据当前转写整理笔记；长课程会自动分段处理。"
                    "请先人工复核带 ⚠️ 的句子，再生成最终笔记。"
                )
                with gr.Row():
                    notes_language = gr.Dropdown(
                        ["中文", "Français", "中法双语"], value="中法双语",
                        label="笔记语言",
                    )
                    notes_btn = gr.Button("生成课后笔记", variant="primary", size="lg", scale=3)
                    notes_stop = gr.Button("停止", variant="stop", size="lg")
                notes_status = gr.Markdown("等待生成", elem_classes="status-card")
                notes_output = gr.Markdown()
                notes_file = gr.File(label="下载 Markdown 笔记")

            single_event = single_btn.click(
                transcribe_single,
                inputs=[audio_in, model_dd, lang_dd, task_radio, vad_cb, beam_sl,
                        robust_audio_cb, profile_dd, custom_terms],
                outputs=[single_status, single_text, single_segs, single_files, single_stem],
            )
            single_stop.click(fn=None, cancels=[single_event])
            revised_btn.click(
                export_revised_text,
                inputs=[single_text, single_stem],
                outputs=[revised_file],
            )
            notes_event = notes_btn.click(
                generate_study_notes,
                inputs=[single_text, saved_course, course_name, course_description, notes_language,
                        ai_provider, openai_key, cloud_consent],
                outputs=[notes_status, notes_output, notes_file],
            )
            notes_stop.click(fn=None, cancels=[notes_event])

        with gr.Tab("批量转写"):
            batch_in = gr.File(
                file_count="multiple",
                type="filepath",
                label="选择多个音频/视频（可框选或 Ctrl+点击）",
            )
            with gr.Row():
                batch_btn = gr.Button(
                    "开始批量精确转写", variant="primary", size="lg", scale=4,
                    elem_classes="primary-action",
                )
                batch_stop = gr.Button("停止", variant="stop", size="lg", scale=1)
            batch_status = gr.Markdown("等待选择文件", elem_classes="status-card")
            batch_table = gr.Dataframe(
                headers=["文件", "状态", "分段/时长", "预览"],
                label="处理结果",
                wrap=True,
                interactive=False,
            )
            batch_text = gr.Textbox(
                label="全部文本（可编辑、可复制）", lines=12,
                interactive=True, elem_classes="result-box",
            )
            batch_files = gr.Files(label="下载全部字幕文件")

            batch_event = batch_btn.click(
                transcribe_batch,
                inputs=[batch_in, model_dd, lang_dd, task_radio, vad_cb, beam_sl,
                        robust_audio_cb, profile_dd, custom_terms],
                outputs=[batch_status, batch_text, batch_table, batch_files],
            )
            batch_stop.click(fn=None, cancels=[batch_event])

        profile_dd.change(
            glossary_budget,
            inputs=[profile_dd, custom_terms],
            outputs=[budget_md],
        )
        custom_terms.change(
            glossary_budget,
            inputs=[profile_dd, custom_terms],
            outputs=[budget_md],
        )
        save_course_btn.click(
            save_course,
            inputs=[course_name, profile_dd, custom_terms, course_description],
            outputs=[saved_course, course_status],
        )
        saved_course.input(
            load_course,
            inputs=[saved_course],
            outputs=[profile_dd, custom_terms, budget_md, course_status,
                     course_name, course_description],
        )
        ai_course_btn.click(
            generate_course_glossary,
            inputs=[course_name, course_description, profile_dd, custom_terms,
                    ai_provider, openai_key, cloud_consent],
            outputs=[custom_terms, budget_md, saved_course, course_status],
        )
        ai_provider.change(
            ai_provider_info,
            inputs=[ai_provider],
            outputs=[provider_info],
        )
        delete_course_btn.click(
            delete_course,
            inputs=[saved_course],
            outputs=[saved_course, course_status],
        )

        gr.Markdown(
            "---\n"
            '<div class="section-note">💡 默认已经启用法语数学术语增强、large-v3、搜索精度 8、静音过滤和课堂录音抗重复增强。'
            '若某个定理或人名经常听错，请把正确法语拼写填入“本节课的专有词汇”。</div>'
        )

    # 进度条依赖队列才能实时推送，显式开启
    # 单张 GPU 明确限制为一个转写任务，避免重复点击造成显存争抢或 OOM。
    demo.queue(default_concurrency_limit=1, max_size=8)
    return demo


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="启动本地 Whisper 图形界面")
    parser.add_argument("--device", default="cuda", choices=("cuda", "cpu"))
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--share", action="store_true",
                        help="生成公网临时链接（谨慎使用）")
    return parser.parse_args()


def _existing_gui_running(host: str, port: int) -> bool:
    """端口被占时，判断占用者是不是另一个本程序的实例。"""
    probe = "127.0.0.1" if host in ("0.0.0.0", "") else host
    try:
        with urllib.request.urlopen(f"http://{probe}:{port}/config", timeout=3) as resp:
            return resp.status == 200 and "gradio" in resp.read(8192).decode("utf-8", "replace").lower()
    except Exception:  # noqa: BLE001 - 探活失败就当它不是我们的实例
        return False


def main() -> int:
    global DEVICE, COMPUTE_TYPE

    engine.enable_utf8_output()
    args = parse_args()
    DEVICE = args.device
    COMPUTE_TYPE = engine.resolve_compute_type(args.device, None)

    print(f"设备：{DEVICE}（compute_type={COMPUTE_TYPE}）")
    print(f"界面地址：http://{args.host}:{args.port}")

    try:
        build_ui().launch(
            server_name=args.host,
            server_port=args.port,
            share=args.share,
            inbrowser=True,
            css=UI_CSS,
            theme=UI_THEME,
        )
    except OSError as exc:
        if "empty port" not in str(exc):
            raise
        # 双击 start_gui.bat 时很常见：已经有一个实例在跑。
        # 这时不该甩一段 traceback，而要直接把人送到已经开着的界面上。
        url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '') else args.host}:{args.port}"
        print()
        if _existing_gui_running(args.host, args.port):
            print("=" * 60)
            print("  界面已经在运行了，无需重复启动。")
            print(f"  地址：{url}")
            print()
            print("  已为你再打开一次浏览器窗口。")
            print("  要关闭 GUI，请关掉那个正在运行的窗口（不是这个）。")
            print("=" * 60)
            webbrowser.open(url)
        else:
            print("=" * 60)
            print(f"  端口 {args.port} 被其他程序占用了，没能启动。")
            print(f"  换个端口再试：python app_gui.py --port {args.port + 1}")
            print("=" * 60)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
