# Windows Text Observer

该 helper 只用于 SpeakMore 本轮粘贴后的短时文本观察。

边界：

- 只监听启动观察时的当前焦点控件。
- 只返回该控件通过 UIA TextPattern 或 ValuePattern 暴露的文本。
- 不监听键盘输入。
- 不做全局文本采集。
- 不支持 UIA TextPattern / ValuePattern 的应用会返回 `text_pattern_unavailable`。

本地构建：

```powershell
dotnet build electron-app/windows-text-observer/WindowsTextObserver.csproj
```
