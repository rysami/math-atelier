# Math Atelier · 数学精读

把课堂录音转成带时间戳的文字，再在 ChatGPT 网页逐讲阅读、定位知识点和提问。两个工具可以独立使用。

| 目录 | 用途 |
| --- | --- |
| [extension](extension/) | Chrome 和 Edge 侧栏扩展，管理课程、讲次、知识点和统一问答 |
| [whisper](whisper/) | 基于 faster-whisper 的本地转写工具，提供网页界面、命令行和本地 API |

## 从课堂录音开始

1. 用 Whisper 转写自己的录音，导出 JSON 或 TXT。JSON 会保留分段起止时间。可同时导出 SRT 或 VTT 供回听。
2. 在扩展中选择「创建新课程」，填写课程名及学习要求。扩展通过 ChatGPT 网页关联项目和统一问答区。
3. 选择「创建新一讲」，附上本讲的转写、讲义或板书。按学习规则对照资料讲解，用时间戳回听可疑段落。
4. 在 ChatGPT 网页阅读正文。侧栏的「知识点」和「AI 回复」用于定位。选中一段文字后，可在「问答」里提问、追问，再用「返回正文」回到阅读位置。

## 安装侧栏扩展

1. 下载本仓库 ZIP 并解压，或克隆仓库。
2. 打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`，开启开发者模式。
3. 选择「加载已解压的扩展程序」，选中包含 `manifest.json` 的 `extension` 目录。
4. 登录 ChatGPT，在扩展菜单点击「数学精读」打开侧栏。浏览器需要支持扩展侧栏，建议使用近期版本。

扩展会读取 ChatGPT 网页内容，并在你通过侧栏提交时操作网页。网页布局变化可能影响自动化。课程记录和采集的正文保存在当前浏览器配置。需要迁移时，在侧栏设置中导出备份。完整备份可能包含课程正文和个人资料，请私下保存。

项目规则随扩展提供。也可查看 [学习规则](extension/Universal-Math-SKILL.md)。

## 本地 Whisper

Windows 启动方式、CPU/GPU 示例、输出格式和 API 用法见 [Whisper 使用说明](whisper/README.md)。首次加载模型通常需要下载模型权重。录音转写在本机执行。把转写上传到 ChatGPT，或在 Whisper 界面明确启用云端笔记功能时，相应内容会发往所选服务。

第三方组件适用各自许可。扩展内的 pdf-lib 许可随组件提供。 [pdf-lib 许可](extension/vendor/LICENSE.pdf-lib.md)
