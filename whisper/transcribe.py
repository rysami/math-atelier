#!/usr/bin/env python
"""
faster-whisper 命令行批量转写。

示例：
    python transcribe.py 录音.mp3
    python transcribe.py D:\\素材 --recursive --format all --language zh
    python transcribe.py 讲座.mp4 --model medium --format srt
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from engine import (
    DEFAULT_MODEL,
    collect_inputs,
    enable_utf8_output,
    fmt_timestamp,
    load_model,
    to_dict,
    to_srt,
    to_text,
    to_vtt,
    transcribe,
)

FORMATS = ("txt", "srt", "vtt", "json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="用 faster-whisper 批量转写音频/视频为文本与字幕。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("inputs", nargs="+", help="音频/视频文件，或包含它们的目录")
    parser.add_argument(
        "-m", "--model", default=DEFAULT_MODEL,
        help=f"模型名或本地路径（默认 {DEFAULT_MODEL}）。"
             "可选 tiny/base/small/medium/large-v3/large-v3-turbo，"
             "或用 HuggingFace 上的 CTranslate2 模型 ID",
    )
    parser.add_argument("-l", "--language", default=None,
                        help="语言代码，如 zh / en / fr；默认自动检测")
    parser.add_argument("--task", choices=("transcribe", "translate"), default="transcribe",
                        help="transcribe=原语言转写；translate=翻译成英文")
    parser.add_argument("-o", "--output-dir", default=None,
                        help="输出目录，默认与源文件同目录")
    parser.add_argument("-f", "--format", default="txt", choices=(*FORMATS, "all"),
                        help="输出格式，all 表示全部生成")
    parser.add_argument("-r", "--recursive", action="store_true",
                        help="递归遍历子目录")
    parser.add_argument("--device", default="cuda", choices=("cuda", "cpu"),
                        help="推理设备，默认 cuda")
    parser.add_argument("--compute-type", default=None,
                        help="量化类型。默认 CUDA=float16 / CPU=int8。"
                             "RTX 50 系务必保持 float16")
    parser.add_argument("--beam-size", type=int, default=5, help="beam search 宽度")
    parser.add_argument("--no-vad", action="store_true",
                        help="关闭 VAD 静音过滤（默认开启）")
    parser.add_argument("--initial-prompt", default=None,
                        help="提示词，可用于指定专有名词或引导标点风格")
    parser.add_argument("--overwrite", action="store_true",
                        help="覆盖已存在的输出文件（默认跳过）")
    parser.add_argument("-q", "--quiet", action="store_true", help="只输出警告和错误")
    return parser.parse_args()


def log(message: str, quiet: bool = False) -> None:
    if not quiet:
        print(message, flush=True)


def write_outputs(
    base: Path,
    out_dir: Path,
    formats: list[str],
    segments: list,
    info,
    text: str,
    overwrite: bool,
) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    writers = {
        "txt": lambda: (out_dir / f"{base.stem}.txt", to_text(segments)),
        "srt": lambda: (out_dir / f"{base.stem}.srt", to_srt(segments)),
        "vtt": lambda: (out_dir / f"{base.stem}.vtt", to_vtt(segments)),
        "json": lambda: (
            out_dir / f"{base.stem}.json",
            json.dumps(to_dict(segments, info, text), ensure_ascii=False, indent=2),
        ),
    }

    written: list[Path] = []
    for fmt in formats:
        path, content = writers[fmt]()
        if path.exists() and not overwrite:
            log(f"    跳过（已存在）：{path.name}", quiet=False)
            continue
        path.write_text(content, encoding="utf-8")
        written.append(path)
    return written


def main() -> int:
    enable_utf8_output()
    args = parse_args()

    try:
        files = collect_inputs(args.inputs, recursive=args.recursive)
    except FileNotFoundError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    if not files:
        print("错误：没有找到可转写的音频/视频文件。", file=sys.stderr)
        return 1

    formats = list(FORMATS) if args.format == "all" else [args.format]

    log(f"共 {len(files)} 个文件，模型 {args.model}，设备 {args.device}，输出 {'/'.join(formats)}")
    log("正在加载模型...")
    try:
        model = load_model(
            model_name=args.model,
            device=args.device,
            compute_type=args.compute_type,
        )
    except RuntimeError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    log("模型就绪。\n")

    failures = 0
    started = time.perf_counter()

    for idx, src in enumerate(files, start=1):
        log(f"[{idx}/{len(files)}] {src.name}")
        t0 = time.perf_counter()
        try:
            segments, info = transcribe(
                model,
                src,
                language=args.language,
                task=args.task,
                vad_filter=not args.no_vad,
                beam_size=args.beam_size,
                initial_prompt=args.initial_prompt,
            )
        except Exception as exc:  # noqa: BLE001 - 单个文件失败不应中断批量任务
            failures += 1
            print(f"    失败：{exc}", file=sys.stderr)
            continue

        text = to_text(segments)
        out_dir = Path(args.output_dir).expanduser() if args.output_dir else src.parent
        written = write_outputs(src, out_dir, formats, segments, info, text, args.overwrite)

        elapsed = time.perf_counter() - t0
        duration = getattr(info, "duration", 0) or 0
        speed = f"{duration / elapsed:.1f}x" if elapsed > 0 and duration else "n/a"
        log(f"    语言={info.language} (置信度 {info.language_probability:.2f}) "
            f"时长={fmt_timestamp(duration, '.')} 耗时={elapsed:.1f}s ({speed} 实时倍速)")
        for path in written:
            log(f"    -> {path}")

    total = time.perf_counter() - started
    log(f"\n完成：成功 {len(files) - failures}/{len(files)}，总耗时 {total:.1f}s")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
