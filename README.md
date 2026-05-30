# SpeakMore

SpeakMore 是一个 Windows 本地语音输入工具。Electron 负责桌面壳、固定快捷键、托盘、本地数据和自动粘贴；本地 FastAPI 后端负责音频转写和大模型文本处理。

当前正式 ASR 模型只支持 `FunAudioLLM/SenseVoiceSmall`。Windows x64 便携包不内置模型；首次运行进入“初始化”页后，由用户点击下载并加载 SenseVoiceSmall，下载失败时会显示明确错误。

## 功能

- `Right Alt`：听写，把口述内容转成文本并自动粘贴。
- `Right Alt + Space`：自由提问，结果显示在悬浮面板，不自动粘贴。
- `Right Alt + Right Shift`：语音翻译，结果粘贴到当前光标位置。
- `Escape`：取消当前未完成语音会话，或关闭当前悬浮面板。
- 录音时显示悬浮胶囊和麦克风音量。
- 主窗口包含初始化、首页、历史记录、词典和设置。
- 历史、设置、词典和自动学习候选只保存在本机。

自动粘贴必须先确认可信文本输入目标；不满足条件时显示悬浮卡片，不静默写剪贴板和发送 `Ctrl+V`。

## Windows 便携版

发布目标是 Windows x64 解压即用包。便携包包含：

- `SpeakMore.exe`
- Electron 运行文件
- 本地后端可执行文件
- Windows 文本观察 helper
- `ffmpeg`
- Renderer 构建产物

模型不打包。首次运行需要联网下载 SenseVoiceSmall，默认缓存到 `%LOCALAPPDATA%\Typeless\models\funasr`。用户在“初始化”页点击下载后，页面会显示下载/加载状态、耗时、成功或失败结果。离线环境可以提前准备模型目录，并通过 `SENSEVOICE_SMALL_MODEL_DIR` 指向该目录。

## 项目结构

```text
.
├── server/                         # 本地 FastAPI 后端
│   ├── main.py                     # HTTP / WebSocket 接口、就绪状态、音频转码
│   ├── asr.py                      # SenseVoiceSmall 加载与转写
│   ├── refiner.py                  # 大模型文本清洗、提问、翻译
│   ├── runtime_config.py           # .env、HOST、PORT、CORS 配置
│   └── .env.example                # 后端环境变量模板
├── electron-app/                   # Electron 主进程和桌面壳
│   ├── main.js                     # 主进程组合根
│   ├── preload.js                  # Renderer 安全 IPC 桥接
│   ├── right-alt-listener.ps1      # Windows 低级键盘监听器
│   ├── audio-session-control.ps1   # Windows 后台音频会话静音/恢复
│   ├── windows-text-observer/      # UIA 文本观察 helper
│   └── renderer/                   # Vite + React + MUI + TypeScript 前端
├── shared/                         # 前后端共享元数据
├── scripts/                        # 验证和发布脚本
├── packaging/                      # 打包配置
├── package.json                    # 根启动、构建和验证脚本
└── AGENTS.md                       # 项目协作约定
```

## 环境要求

- Windows 10/11 x64。
- Node.js 24 推荐。
- Python 3.10+。
- PowerShell。
- `ffmpeg`。
- 可用麦克风。
- 可用的大模型 API Key；默认不包含任何真实 Key。

## 开发安装

安装根依赖：

```powershell
npm install
```

安装前端依赖：

```powershell
cd electron-app\renderer
npm install
```

安装后端依赖：

```powershell
cd ..\..\server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

复制后端环境变量模板：

```powershell
copy server\.env.example server\.env
```

示例配置：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
SENSEVOICE_SMALL_MODEL_DIR=
HOST=127.0.0.1
PORT=8000
CORS_ALLOWED_ORIGINS=null,http://127.0.0.1:5173,http://localhost:5173
```

`server/.env` 已被忽略，不要提交真实密钥。客户端设置页传入的大模型配置优先；DeepSeek 变量仅作为本地后端回退配置。

LLM provider、API Key 和模型名由设置页保存到本机 Electron `userData/local-data/settings.json`。

未填写当前 provider 的 API Key 时，语音录音会在启动前被拦截，不会打开麦克风或连接语音后端。默认 provider 是 DeepSeek。

## 启动

构建前端：

```powershell
npm run renderer:build
```

启动后端：

```powershell
npm run server
```

检查后端状态：

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:8000/model/status | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:8000/ready | Select-Object StatusCode
```

含义：

- `/health` 返回 200：后端进程存活。
- `/model/status` 返回 200：模型初始化状态可查询。
- `/ready` 返回 200：ASR 模型已预热，语音链路可用。
- `/ready` 返回 503：模型未开始下载、正在下载/加载，或下载/加载失败。

启动 Electron：

```powershell
npm start
```

## SenseVoiceSmall 模型

模型查找顺序为：

1. `SENSEVOICE_SMALL_MODEL_DIR`
2. `%LOCALAPPDATA%\Typeless\models\funasr`
3. `%USERPROFILE%\.cache\huggingface\hub`
4. 都未命中时，初始化页点击下载后保存到 `%LOCALAPPDATA%\Typeless\models\funasr`

如果手动配置 `SENSEVOICE_SMALL_MODEL_DIR`，目录内必须包含 SenseVoiceSmall 所需文件。

## 本地数据

Electron 主进程把业务数据写到：

```text
Electron userData/local-data/
```

主要文件和目录：

- `settings.json`：本地设置。
- `history.json`：最近历史列表。
- `history-stats.json`：累计统计。
- `dictionary.json`：正式词典词条。
- `dictionary-candidates.json`：自动学习候选词条。
- `recording.log`：本地排查日志。
- `recordings/`：录音相关本地产物目录。

这些内容不进入仓库，也不进入便携发布包。

### 词典与自动学习隐私

词典正式词条和自动学习候选只保存在本机 `userData/local-data/`。每轮请求只会把启用词条中按动态分数裁剪后的部分传给本地后端，默认 24 条，后端硬上限 40 条。

自动学习只围绕本轮 SpeakMore 自动粘贴结果做短时观察，只接受短词或短语级纠错，不采集无关全局文本，不学习整句改写、摘要结果、问答命令或无上下文大段替换。

## 后端接口

- `GET /health`：后端进程存活检查。
- `GET /model/status`：查询 SenseVoiceSmall 初始化状态。
- `POST /model/download`：启动 SenseVoiceSmall 下载/加载任务。
- `GET /ready`：语音链路就绪检查。
- `POST /config/reload`：刷新后端回退配置。
- `POST /ai/voice_flow`：上传完整音频并返回处理结果。
- `WebSocket /ws/rt_voice_flow`：实时录音流接口。

WebSocket 语音流固定输入来自 `16kHz`、单声道、`pcm_s16le` 二进制 chunk，并在 `start_audio.parameters.audio_format` 声明音频格式。兼容上传入口会先把音频转成 PCM16 再交给 ASR。

## 开发验证

前端测试：

```powershell
cd electron-app\renderer
npm test
```

前端构建：

```powershell
npm run renderer:build
```

主进程语法检查：

```powershell
node --check electron-app\main.js
```

快捷键转发测试：

```powershell
node --test electron-app\right-alt-relay.test.js
```

历史统计测试：

```powershell
node --test electron-app\history-stats-store.test.mjs
```

后端核心语音协议验证：

```powershell
npm run verify:voice
```

开源边界验证：

```powershell
npm run verify:open-source
```

后端全部测试：

```powershell
cd server
python -m pytest -q
```

## 常见问题

### 语音后端未就绪

先检查：

```powershell
Invoke-WebRequest http://127.0.0.1:8000/ready | Select-Object StatusCode
```

如果 `/ready` 是 503，先打开初始化页查看模型状态；常见原因是还没点击下载、模型还在下载/加载、下载失败，或 `SENSEVOICE_SMALL_MODEL_DIR` 配置错误。

### 首次启动很慢

第一次没有本地 SenseVoiceSmall 模型时，需要在初始化页点击下载并等待加载完成。网络慢或无法访问模型源时，语音功能会暂时不可用，页面会保留失败原因。

### 提示未填写 DeepSeek API Key

到设置页的大模型区域填写自己的 API Key 并保存。未填写 API Key 时，录音启动会被拦截。

### 转写时报 ffmpeg 错误

确认 `ffmpeg` 可用：

```powershell
ffmpeg -version
```

主录音链路固定发送 PCM16；兼容入口上传的其他音频仍需要 `ffmpeg` 转码。

### 大模型没有生效

优先检查设置页里的 provider、API Key 和模型名。保存后，Electron 会把配置写入本机 `settings.json`，并随语音或文本请求传给本地后端。

## 开源边界

仓库不会提交以下内容：

- `node_modules/`
- 构建产物
- `server/.env`
- 日志文件
- Python 缓存
- 本地 AI 工作上下文 `docs/ai/context/`
- Electron `userData/local-data/`
