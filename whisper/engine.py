"""
faster-whisper 共享封装：模型加载 + 转写 + 字幕格式化。

这里集中处理 RTX 50 系 (Blackwell, sm_120) 的已知问题：
CTranslate2 的 int8 GEMM 在 sm_120 上不受支持，而 device="cuda" 时
compute_type="auto" 恰好会选到 int8，导致首次推理抛 CUBLAS_STATUS_NOT_SUPPORTED。
因此 CUDA 上强制 float16（需 ctranslate2>=4.7.0）。
"""

from __future__ import annotations

import os
import gc
import site
import sys
import sysconfig
import threading
from pathlib import Path
from typing import Any, Callable

DEFAULT_MODEL = "large-v3"

# Windows 默认不允许普通用户创建符号链接，HF 会为此刷一大段警告，实际不影响使用
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

AUDIO_EXTS = {
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".amr",
    ".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".ts", ".mpg", ".mpeg",
}

# 模型缓存，避免 API 服务里每次请求都重新加载
_MODEL_CACHE: dict[tuple[str, str, str], Any] = {}
_MODEL_CACHE_LOCK = threading.RLock()


def enable_utf8_output() -> None:
    """Windows 控制台默认 GBK，输出中文/特殊字符会炸，这里强制 UTF-8。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass


def ensure_cuda_dlls() -> list[str]:
    """
    把 pip 装的 CUDA 运行时 DLL 目录挂进 Windows 的 DLL 搜索路径。

    nvidia-cublas-cu12 / nvidia-cudnn-cu12 会把 DLL 放在
    site-packages\\nvidia\\<lib>\\bin 下，而这个目录不在默认搜索路径中，
    CTranslate2 内部用 LoadLibrary("cublas64_12.dll") 就会报
    "Library cublas64_12.dll is not found or cannot be loaded"。

    必须在 import ctranslate2 / faster_whisper 之前调用。
    PATH 和 add_dll_directory 都设上，双保险。
    """
    if os.name != "nt":
        return []

    roots: set[str] = set()
    try:
        roots.update(site.getsitepackages())
    except AttributeError:
        pass
    for key in ("purelib", "platlib"):
        path = sysconfig.get_paths().get(key)
        if path:
            roots.add(path)

    dll_dirs: list[str] = []
    for root in roots:
        nvidia = Path(root) / "nvidia"
        if nvidia.is_dir():
            dll_dirs.extend(str(p) for p in sorted(nvidia.glob("*/bin")) if p.is_dir())

    if not dll_dirs:
        return []

    current = os.environ.get("PATH", "")
    for dll_dir in dll_dirs:
        try:
            os.add_dll_directory(dll_dir)
        except (AttributeError, OSError):
            pass
        if dll_dir not in current.split(os.pathsep):
            current = dll_dir + os.pathsep + current
    os.environ["PATH"] = current
    return dll_dirs


# 导入 CTranslate2 之前先修好 DLL 路径
CUDA_DLL_DIRS = ensure_cuda_dlls()


def resolve_compute_type(device: str, requested: str | None = None) -> str:
    """决定 compute_type。显式传入优先，否则 CUDA 用 float16、CPU 用 int8。"""
    if requested:
        return requested
    return "float16" if device == "cuda" else "int8"


def load_model(
    model_name: str = DEFAULT_MODEL,
    device: str = "cuda",
    compute_type: str | None = None,
    download_root: str | Path | None = None,
) -> Any:
    """加载（并缓存）WhisperModel。"""
    # Windows 应用控制策略可能阻止 PyAV 未签名的 stream.pyd。
    # 使用系统 FFmpeg 提供同等的 16 kHz PCM 解码，保留系统安全策略。
    from faster_whisper_audio_compat import install as install_audio_compat

    install_audio_compat()
    from faster_whisper import WhisperModel

    ct = resolve_compute_type(device, compute_type)
    key = (model_name, device, ct)
    with _MODEL_CACHE_LOCK:
        if key in _MODEL_CACHE:
            return _MODEL_CACHE[key]

        # 单张 GPU 同时常驻多个 Whisper 大模型很容易耗尽显存。
        # 切换模型时只保留即将使用的实例；正在执行的请求仍持有自己的局部引用，不受影响。
        stale_keys = [cached_key for cached_key in _MODEL_CACHE if cached_key != key]
        for stale_key in stale_keys:
            del _MODEL_CACHE[stale_key]
        if stale_keys:
            gc.collect()

    kwargs: dict[str, Any] = {"device": device, "compute_type": ct}
    if download_root:
        kwargs["download_root"] = str(download_root)

    try:
        model = WhisperModel(model_name, **kwargs)
    except Exception as exc:  # noqa: BLE001 - 需要给出可操作的提示
        raise RuntimeError(
            f"加载模型 {model_name!r} 失败 (device={device}, compute_type={ct}): {exc}\n"
            f"提示：RTX 50 系请确认 ctranslate2>=4.7.0 且 compute_type='float16'；"
            f"显存不足时换用更小的模型（--model medium）或 --device cpu。"
        ) from exc

    with _MODEL_CACHE_LOCK:
        _MODEL_CACHE[key] = model
    return model


def clear_model_cache() -> None:
    """释放缓存模型；用于切换设备、关闭服务或显存不足后的恢复。"""
    with _MODEL_CACHE_LOCK:
        _MODEL_CACHE.clear()
    gc.collect()


def cached_models() -> list[tuple[str, str, str]]:
    """返回当前缓存模型键，便于状态显示和诊断。"""
    with _MODEL_CACHE_LOCK:
        return list(_MODEL_CACHE)


def transcribe(
    model: Any,
    audio: str | Path,
    language: str | None = None,
    task: str = "transcribe",
    vad_filter: bool = True,
    beam_size: int = 5,
    initial_prompt: str | None = None,
    hotwords: str | None = None,
    on_progress: Callable[[float, str], None] | None = None,
    condition_on_previous_text: bool = True,
    repetition_penalty: float = 1.0,
    no_repeat_ngram_size: int = 0,
    vad_parameters: dict[str, Any] | None = None,
    compression_ratio_threshold: float | None = 2.4,
    log_prob_threshold: float | None = -1.0,
    no_speech_threshold: float | None = 0.6,
    word_timestamps: bool = False,
    hallucination_silence_threshold: float | None = None,
) -> tuple[list[Any], Any]:
    """
    转写单个文件，返回 (segments 列表, info)。

    faster-whisper 返回的是生成器，这里物化成 list，方便调用方重复遍历。
    on_progress 可选，签名 (fraction, desc)，fraction 为 0~1，用于 GUI 进度条。

    进度按「已转写到第几秒 / 音频总长」估算：info.duration 是原始音频总长，
    而 segment 的时间戳同样是原始时间轴（VAD 过滤不会改变时间戳），所以两者直接相除即可。
    """
    segments, info = model.transcribe(
        str(audio),
        language=language,
        task=task,
        vad_filter=vad_filter,
        beam_size=beam_size,
        initial_prompt=initial_prompt,
        hotwords=hotwords,
        condition_on_previous_text=condition_on_previous_text,
        repetition_penalty=repetition_penalty,
        no_repeat_ngram_size=no_repeat_ngram_size,
        vad_parameters=vad_parameters,
        compression_ratio_threshold=compression_ratio_threshold,
        log_prob_threshold=log_prob_threshold,
        no_speech_threshold=no_speech_threshold,
        word_timestamps=word_timestamps,
        hallucination_silence_threshold=hallucination_silence_threshold,
    )

    # 注意：生成器要真正开始迭代才会触发推理，所以第一个 segment 之前的耗时
    # （首次运行约 60s 的 GPU 内核初始化）进度条会停在 0 不动，属正常现象。
    total = getattr(info, "duration", 0) or 0
    collected: list[Any] = []
    for seg in segments:
        collected.append(seg)
        if on_progress is not None and total > 0:
            on_progress(min(seg.end / total, 1.0), f"{seg.end:.0f}s / {total:.0f}s")

    # 末尾常有一段静音不含 segment，补一次 1.0 保证进度条走满
    if on_progress is not None and total > 0:
        on_progress(1.0, f"{total:.0f}s / {total:.0f}s")

    return collected, info


def fmt_timestamp(seconds: float, sep: str = ",") -> str:
    """秒 -> HH:MM:SS,mmm (SRT) 或 HH:MM:SS.mmm (VTT)。"""
    total_ms = max(0, int(round(float(seconds) * 1000)))
    hours, total_ms = divmod(total_ms, 3_600_000)
    minutes, total_ms = divmod(total_ms, 60_000)
    secs, millis = divmod(total_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{sep}{millis:03d}"


def to_text(segments: list[Any]) -> str:
    return "".join(seg.text for seg in segments).strip() + "\n"


def to_srt(segments: list[Any]) -> str:
    blocks = []
    for i, seg in enumerate(segments, start=1):
        text = seg.text.strip()
        blocks.append(
            f"{i}\n"
            f"{fmt_timestamp(seg.start, ',')} --> {fmt_timestamp(seg.end, ',')}\n"
            f"{text}\n"
        )
    return "\n".join(blocks)


def to_vtt(segments: list[Any]) -> str:
    blocks = ["WEBVTT\n"]
    for seg in segments:
        text = seg.text.strip()
        blocks.append(
            f"{fmt_timestamp(seg.start, '.')} --> {fmt_timestamp(seg.end, '.')}\n"
            f"{text}\n"
        )
    return "\n".join(blocks)


def to_dict(segments: list[Any], info: Any, text: str) -> dict[str, Any]:
    """OpenAI verbose_json 风格的字典。"""
    return {
        "task": getattr(info, "task", "transcribe"),
        "language": getattr(info, "language", None),
        "duration": getattr(info, "duration", None),
        "text": text.strip(),
        "segments": [
            {
                "id": i,
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip(),
                "avg_logprob": getattr(seg, "avg_logprob", None),
                "no_speech_prob": getattr(seg, "no_speech_prob", None),
            }
            for i, seg in enumerate(segments)
        ],
    }


def collect_inputs(paths: list[str], recursive: bool = False) -> list[Path]:
    """把文件/目录参数展开成待转写的音频文件列表。"""
    found: list[Path] = []
    for raw in paths:
        p = Path(raw).expanduser()
        if p.is_dir():
            it = p.rglob("*") if recursive else p.glob("*")
            found.extend(sorted(f for f in it if f.is_file() and f.suffix.lower() in AUDIO_EXTS))
        elif p.is_file():
            found.append(p)
        else:
            raise FileNotFoundError(f"路径不存在：{p}")
    # 去重并保持顺序
    seen: set[Path] = set()
    unique: list[Path] = []
    for f in found:
        key = f.resolve()
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return unique
