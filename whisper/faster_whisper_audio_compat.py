"""FFmpeg audio decoder used when Windows blocks PyAV's unsigned extensions."""

from __future__ import annotations

import shutil
import subprocess
import sys
import types
from pathlib import Path
from typing import BinaryIO

import numpy as np


def _ffmpeg_executable() -> str:
    executable = shutil.which("ffmpeg")
    if not executable:
        raise RuntimeError(
            "找不到 FFmpeg。请运行 winget install --id Gyan.FFmpeg，"
            "安装后重新打开 Whisper。"
        )
    return executable


def decode_audio(
    input_file: str | Path | BinaryIO,
    sampling_rate: int = 16000,
    split_stereo: bool = False,
):
    """Decode media to float32 PCM using the system FFmpeg executable."""
    channels = 2 if split_stereo else 1
    command = [
        _ffmpeg_executable(),
        "-hide_banner",
        "-loglevel", "error",
        "-i", "pipe:0" if hasattr(input_file, "read") else str(input_file),
        "-vn", "-sn", "-dn",
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ac", str(channels),
        "-ar", str(sampling_rate),
        "pipe:1",
    ]

    payload = None
    if hasattr(input_file, "read"):
        payload = input_file.read()
        if isinstance(payload, str):
            payload = payload.encode()

    startupinfo = None
    if sys.platform == "win32":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

    result = subprocess.run(
        command,
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        startupinfo=startupinfo,
        check=False,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg 无法解码该音频：{detail or '未知错误'}")

    audio = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if split_stereo:
        return audio[0::2], audio[1::2]
    return audio


def pad_or_trim(array, length: int = 3000, *, axis: int = -1):
    """Pad or trim an array exactly as faster-whisper expects."""
    if array.shape[axis] > length:
        array = array.take(indices=range(length), axis=axis)
    if array.shape[axis] < length:
        pad_widths = [(0, 0)] * array.ndim
        pad_widths[axis] = (0, length - array.shape[axis])
        array = np.pad(array, pad_widths)
    return array


def install() -> None:
    """Provide faster_whisper.audio without importing the blocked PyAV module."""
    if "faster_whisper.audio" in sys.modules:
        return
    module = types.ModuleType("faster_whisper.audio")
    module.__file__ = __file__
    module.__package__ = "faster_whisper"
    module.decode_audio = decode_audio
    module.pad_or_trim = pad_or_trim
    sys.modules["faster_whisper.audio"] = module
