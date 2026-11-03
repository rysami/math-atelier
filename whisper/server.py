#!/usr/bin/env python
"""
OpenAI 兼容的本地语音转文字 API 服务。

启动：
    .\\venv\\Scripts\\python server.py                  # 默认 large-v3, 127.0.0.1:8000
    .\\venv\\Scripts\\python server.py --model medium --port 8001

客户端配置：
    Base URL: http://127.0.0.1:8000/v1
    API Key : 任意非空字符串（本服务默认不校验）

接口：
    GET  /health
    GET  /v1/models
    POST /v1/audio/transcriptions   (OpenAI 兼容)
    POST /v1/audio/translations     (OpenAI 兼容，翻译成英文)
"""

from __future__ import annotations

import argparse
import os
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

from engine import (
    DEFAULT_MODEL,
    enable_utf8_output,
    load_model,
    to_dict,
    to_srt,
    to_text,
    to_vtt,
    transcribe,
)

app = FastAPI(title="Local Whisper API", version="1.0.0")

# 由 main() 填充
CONFIG: dict = {
    "model": DEFAULT_MODEL,
    "device": "cuda",
    "compute_type": None,
    "api_key": os.environ.get("WHISPER_API_KEY") or None,
}


def check_auth(authorization: str | None) -> None:
    """设置了 WHISPER_API_KEY 时才校验，否则放行（本地服务默认无需鉴权）。"""
    expected = CONFIG["api_key"]
    if not expected:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")


def get_model(requested: str | None):
    """按请求里的 model 字段取模型，未指定则用默认。load_model 内部有缓存。"""
    return load_model(
        model_name=requested or CONFIG["model"],
        device=CONFIG["device"],
        compute_type=CONFIG["compute_type"],
    )


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model": CONFIG["model"],
        "device": CONFIG["device"],
    }


@app.get("/v1/models")
def list_models() -> dict:
    return {
        "object": "list",
        "data": [
            {"id": CONFIG["model"], "object": "model", "owned_by": "local"},
        ],
    }


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(default=""),
    language: str | None = Form(default=None),
    prompt: str | None = Form(default=None),
    response_format: str = Form(default="json"),
    temperature: float = Form(default=0.0),  # OpenAI 兼容占位，faster-whisper 不直接暴露
    authorization: str | None = Header(default=None),
):
    return await _run(
        file=file,
        model=model,
        language=language or None,
        prompt=prompt or None,
        response_format=response_format,
        task="transcribe",
        authorization=authorization,
    )


@app.post("/v1/audio/translations")
async def translations(
    file: UploadFile = File(...),
    model: str = Form(default=""),
    prompt: str | None = Form(default=None),
    response_format: str = Form(default="json"),
    temperature: float = Form(default=0.0),
    authorization: str | None = Header(default=None),
):
    return await _run(
        file=file,
        model=model,
        language=None,
        prompt=prompt or None,
        response_format=response_format,
        task="translate",
        authorization=authorization,
    )


async def _run(
    *,
    file: UploadFile,
    model: str,
    language: str | None,
    prompt: str | None,
    response_format: str,
    task: str,
    authorization: str | None,
):
    check_auth(authorization)

    suffix = Path(file.filename or "audio").suffix or ".bin"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        while chunk := await file.read(1024 * 1024):
            tmp.write(chunk)
        tmp.close()

        started = time.perf_counter()
        try:
            asr = get_model(model)
            segments, info = transcribe(
                asr,
                tmp.name,
                language=language,
                task=task,
                initial_prompt=prompt,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        text = to_text(segments)
        elapsed = time.perf_counter() - started

        if response_format == "text":
            return PlainTextResponse(text)
        if response_format == "srt":
            return PlainTextResponse(to_srt(segments), media_type="application/x-subrip")
        if response_format == "vtt":
            return PlainTextResponse(to_vtt(segments), media_type="text/vtt")
        if response_format == "verbose_json":
            payload = to_dict(segments, info, text)
            payload["processing_seconds"] = round(elapsed, 2)
            return JSONResponse(payload)
        if response_format == "json":
            return JSONResponse({"text": text.strip()})

        raise HTTPException(status_code=400, detail=f"不支持的 response_format: {response_format}")
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="启动本地 OpenAI 兼容 Whisper API 服务")
    parser.add_argument("-m", "--model", default=DEFAULT_MODEL, help=f"默认模型（默认 {DEFAULT_MODEL}）")
    parser.add_argument("--device", default="cuda", choices=("cuda", "cpu"))
    parser.add_argument("--compute-type", default=None,
                        help="默认 CUDA=float16 / CPU=int8，RTX 50 系请勿改成 int8")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--preload", action="store_true",
                        help="启动时即加载模型，避免首次请求等待")
    return parser.parse_args()


def main() -> None:
    import uvicorn

    enable_utf8_output()
    args = parse_args()
    CONFIG.update(
        model=args.model,
        device=args.device,
        compute_type=args.compute_type,
    )

    if args.preload:
        print(f"预加载模型 {args.model} ...", flush=True)
        get_model(args.model)
        print("模型就绪。", flush=True)

    print(f"Whisper API 已启动：http://{args.host}:{args.port}/v1", flush=True)
    print(f"默认模型：{args.model}（设备 {args.device}）", flush=True)
    if CONFIG["api_key"]:
        print("已启用 API Key 校验（HTTP Bearer）", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
