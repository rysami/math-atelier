# 本地 Whisper 转写

使用 faster-whisper 转写音频和视频，可导出 TXT、JSON、SRT、VTT。JSON 保留每段的起止时间，适合和讲义一起交给数学精读扩展。

## Windows 安装

在本目录打开 PowerShell，使用 64 位 Python 3.11 或 3.12 创建环境。

```powershell
py -3.12 -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

另需安装 FFmpeg 并将其加入 PATH，可运行 `winget install --id Gyan.FFmpeg`，然后重新打开终端。Windows 批处理脚本会使用本目录的 `venv`。模型初次使用时通常需要联网下载。NVIDIA GPU 模式需要兼容的显卡驱动，安装清单包括 CUDA 运行时组件。CPU 模式可先用较小模型验证。

## 转写

```powershell
.\venv\Scripts\python.exe transcribe.py "lecture.m4a" --device cpu --model small --language fr --format all
.\venv\Scripts\python.exe transcribe.py "lecture.m4a" --device cuda --model large-v3 --language fr --format json
```

将 `fr` 换成课堂语言，如 `zh` 或 `en`。省略 `--language` 可自动识别。默认输出到源文件旁，也可用 `-o` 指定目录。把音视频拖到 `transcribe_drag_drop.bat` 可用默认 GPU 配置生成四种格式。

图形界面可双击 `start_gui.bat`。CPU 启动方式如下。

```powershell
.\venv\Scripts\python.exe app_gui.py --device cpu
```

## 本地 API

```powershell
.\venv\Scripts\python.exe server.py --device cpu --model small
```

默认监听 `127.0.0.1:8000`，转写端点为 `POST /v1/audio/transcriptions`。默认仅供本机访问。需要启用令牌校验时，启动前设置 `WHISPER_API_KEY`。图形界面的可选笔记和术语生成功能可以使用本地 Ollama，或经你确认后调用云端服务。音频转写本身由 faster-whisper 在本机执行。
