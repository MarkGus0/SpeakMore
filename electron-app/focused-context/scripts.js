const FOCUSED_WINDOW_SCRIPT = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32Focus]::GetForegroundWindow()
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][Win32Focus]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
$processId = 0
[void][Win32Focus]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$process = $null
try { $process = Get-Process -Id $processId -ErrorAction Stop } catch {}
[PSCustomObject]@{
  hwnd = $hwnd.ToInt64().ToString()
  process_id = [int]$processId
  process_name = if ($process) { $process.ProcessName } else { "" }
  window_title = $titleBuilder.ToString()
} | ConvertTo-Json -Compress
`;

const UIA_SELECTION_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$element = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $element) {
  [PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = "no_focused_element" } | ConvertTo-Json -Compress
  exit 0
}

$textPattern = $null
try {
  $textPattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
} catch {}

if ($null -eq $textPattern) {
  [PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = "text_pattern_unavailable" } | ConvertTo-Json -Compress
  exit 0
}

$ranges = $null
try {
  $ranges = $textPattern.GetSelection()
} catch {}

if ($null -eq $ranges -or $ranges.Length -eq 0) {
  [PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = "empty" } | ConvertTo-Json -Compress
  exit 0
}

$parts = New-Object System.Collections.Generic.List[string]
foreach ($range in $ranges) {
  try {
    $text = $range.GetText(-1)
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      [void]$parts.Add($text.Trim())
    }
  } catch {}
}

$selectedText = ($parts -join "\\n").Trim()
if ([string]::IsNullOrWhiteSpace($selectedText)) {
  [PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = "empty" } | ConvertTo-Json -Compress
  exit 0
}

[PSCustomObject]@{ success = $true; text = $selectedText; source = "uia"; confidence = "confirmed" } | ConvertTo-Json -Compress
`;

const FOCUSED_TEXT_TARGET_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$element = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $element) {
  [PSCustomObject]@{
    success = $false
    source = "none"
    confidence = "none"
    reason = "no_focused_element"
    value_pattern = $false
    text_pattern = $false
    is_read_only = $false
    control_type = ""
  } | ConvertTo-Json -Compress
  exit 0
}

$controlType = ""
try { $controlType = $element.Current.ControlType.ProgrammaticName } catch {}

$valuePattern = $null
try { $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
if ($null -ne $valuePattern) {
  if ($valuePattern.Current.IsReadOnly) {
    [PSCustomObject]@{
      success = $false
      source = "none"
      confidence = "none"
      reason = "read_only"
      value_pattern = $true
      text_pattern = $false
      is_read_only = $true
      control_type = $controlType
    } | ConvertTo-Json -Compress
    exit 0
  }

  [PSCustomObject]@{
    success = $true
    source = "uia"
    confidence = "confirmed"
    reason = "value_pattern"
    value_pattern = $true
    text_pattern = $false
    is_read_only = $false
    control_type = $controlType
  } | ConvertTo-Json -Compress
  exit 0
}

$textPattern = $null
try { $textPattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern) } catch {}
if ($null -ne $textPattern -and ($controlType -eq "ControlType.Edit" -or $controlType -eq "ControlType.ComboBox")) {
  [PSCustomObject]@{
    success = $true
    source = "uia"
    confidence = "confirmed"
    reason = "text_pattern"
    value_pattern = $false
    text_pattern = $true
    is_read_only = $false
    control_type = $controlType
  } | ConvertTo-Json -Compress
  exit 0
}

[PSCustomObject]@{
  success = $false
  source = "none"
  confidence = "none"
  reason = "text_target_unavailable"
  value_pattern = $false
  text_pattern = $false
  is_read_only = $false
  control_type = $controlType
} | ConvertTo-Json -Compress
`;

const WIN32_CARET_TARGET_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32CaretTarget {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int left;
    public int top;
    public int right;
    public int bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public int cbSize;
    public int flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd);
}
"@

$foreground = [Win32CaretTarget]::GetForegroundWindow()
if ($foreground -eq [IntPtr]::Zero) {
  [PSCustomObject]@{ success = $false; source = "none"; confidence = "none"; reason = "no_foreground_window"; foreground_hwnd = ""; focus_hwnd = ""; caret_hwnd = "" } | ConvertTo-Json -Compress
  exit 0
}

$processId = 0
$threadId = [Win32CaretTarget]::GetWindowThreadProcessId($foreground, [ref]$processId)
$info = New-Object Win32CaretTarget+GUITHREADINFO
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][Win32CaretTarget+GUITHREADINFO])

if (-not [Win32CaretTarget]::GetGUIThreadInfo($threadId, [ref]$info)) {
  [PSCustomObject]@{ success = $false; source = "none"; confidence = "none"; reason = "gui_thread_info_unavailable"; foreground_hwnd = $foreground.ToInt64().ToString(); focus_hwnd = ""; caret_hwnd = "" } | ConvertTo-Json -Compress
  exit 0
}

$caret = $info.hwndCaret
$focus = $info.hwndFocus
$isCaretInForegroundTree = ($caret -ne [IntPtr]::Zero) -and (($caret -eq $foreground) -or [Win32CaretTarget]::IsChild($foreground, $caret))
$isFocusInForegroundTree = ($focus -eq [IntPtr]::Zero) -or ($focus -eq $foreground) -or [Win32CaretTarget]::IsChild($foreground, $focus)

if ($isCaretInForegroundTree -and $isFocusInForegroundTree) {
  [PSCustomObject]@{
    success = $true
    source = "win32_caret"
    confidence = "confirmed"
    reason = "caret"
    foreground_hwnd = $foreground.ToInt64().ToString()
    focus_hwnd = $focus.ToInt64().ToString()
    caret_hwnd = $caret.ToInt64().ToString()
    flags = $info.flags
    caret_rect = @{ left = $info.rcCaret.left; top = $info.rcCaret.top; right = $info.rcCaret.right; bottom = $info.rcCaret.bottom }
  } | ConvertTo-Json -Compress
  exit 0
}

[PSCustomObject]@{
  success = $false
  source = "none"
  confidence = "none"
  reason = "caret_unavailable"
  foreground_hwnd = $foreground.ToInt64().ToString()
  focus_hwnd = $focus.ToInt64().ToString()
  caret_hwnd = $caret.ToInt64().ToString()
  flags = $info.flags
} | ConvertTo-Json -Compress
`;

const FOCUSED_WINDOW_TREE_SCRIPT = `
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class Win32WindowTree {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int count);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
}
"@

$foreground = [Win32WindowTree]::GetForegroundWindow()
if ($foreground -eq [IntPtr]::Zero) {
  [PSCustomObject]@{ success = $false; reason = "no_foreground_window"; foreground_hwnd = ""; process_name = ""; window_title = ""; class_names = @() } | ConvertTo-Json -Compress
  exit 0
}

$processId = 0
[void][Win32WindowTree]::GetWindowThreadProcessId($foreground, [ref]$processId)
$process = $null
try { $process = Get-Process -Id $processId -ErrorAction Stop } catch {}

$titleBuilder = New-Object System.Text.StringBuilder 512
[void][Win32WindowTree]::GetWindowText($foreground, $titleBuilder, $titleBuilder.Capacity)

$classNames = New-Object System.Collections.Generic.List[string]
$foregroundClass = New-Object System.Text.StringBuilder 256
[void][Win32WindowTree]::GetClassName($foreground, $foregroundClass, $foregroundClass.Capacity)
if ($foregroundClass.Length -gt 0) { [void]$classNames.Add($foregroundClass.ToString()) }

$callback = [Win32WindowTree+EnumWindowsProc]{
  param($child, $lparam)
  $builder = New-Object System.Text.StringBuilder 256
  [void][Win32WindowTree]::GetClassName($child, $builder, $builder.Capacity)
  if ($builder.Length -gt 0) { [void]$classNames.Add($builder.ToString()) }
  return $true
}
[void][Win32WindowTree]::EnumChildWindows($foreground, $callback, [IntPtr]::Zero)

[PSCustomObject]@{
  success = $true
  foreground_hwnd = $foreground.ToInt64().ToString()
  process_name = if ($process) { $process.ProcessName } else { "" }
  process_id = [int]$processId
  window_title = $titleBuilder.ToString()
  class_names = @($classNames | Select-Object -Unique)
} | ConvertTo-Json -Compress
`;

module.exports = {
  FOCUSED_WINDOW_TREE_SCRIPT,
  FOCUSED_TEXT_TARGET_SCRIPT,
  FOCUSED_WINDOW_SCRIPT,
  UIA_SELECTION_SCRIPT,
  WIN32_CARET_TARGET_SCRIPT,
};
