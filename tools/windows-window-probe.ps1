[CmdletBinding()]
param(
  [ValidateSet('Snapshot', 'Move', 'Minimize', 'Restore', 'Show', 'FocusExternalWindow', 'Capture')]
  [string]$Action = 'Snapshot',
  [Parameter(Mandatory = $true)]
  [int]$TranslatorProcessId,
  [Parameter(Mandatory = $true)]
  [int]$SignalProcessId,
  [long]$Handle = 0,
  [int]$X = 0,
  [int]$Y = 0,
  [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace Maoyi.SignalSourceUiProbe {
  public sealed class RectRecord {
    public int left;
    public int top;
    public int right;
    public int bottom;
    public int width;
    public int height;
  }

  public sealed class WindowRecord {
    public string handle = "0";
    public uint processId;
    public uint sessionId;
    public string ownerHandle = "0";
    public uint ownerProcessId;
    public string rootHandle = "0";
    public string rootOwnerHandle = "0";
    public bool visible;
    public bool iconic;
    public string className = "";
    public string title = "";
    public string style = "0";
    public string extendedStyle = "0";
    public RectRecord rect = new RectRecord();
  }

  public static class Native {
    private const uint GW_OWNER = 4;
    private const uint GA_ROOT = 2;
    private const uint GA_ROOTOWNER = 3;
    private const int GWL_STYLE = -16;
    private const int GWL_EXSTYLE = -20;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect {
      public int Left;
      public int Top;
      public int Right;
      public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr window, StringBuilder title, int maximumCount);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong32(IntPtr window, int index);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(
      IntPtr window,
      IntPtr insertAfter,
      int x,
      int y,
      int width,
      int height,
      uint flags
    );

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("kernel32.dll")]
    private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageNameW(
      IntPtr process,
      uint flags,
      StringBuilder executableName,
      ref uint size
    );

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static string HandleText(IntPtr handle) {
      return handle.ToInt64().ToString(CultureInfo.InvariantCulture);
    }

    private static long WindowLong(IntPtr window, int index) {
      return IntPtr.Size == 8
        ? GetWindowLongPtr64(window, index).ToInt64()
        : GetWindowLong32(window, index);
    }

    private static RectRecord ReadRect(IntPtr window) {
      NativeRect native;
      if (!GetWindowRect(window, out native)) {
        return new RectRecord();
      }
      return new RectRecord {
        left = native.Left,
        top = native.Top,
        right = native.Right,
        bottom = native.Bottom,
        width = Math.Max(0, native.Right - native.Left),
        height = Math.Max(0, native.Bottom - native.Top),
      };
    }

    public static RectRecord GetRect(long handle) {
      return ReadRect(new IntPtr(handle));
    }

    public static WindowRecord[] Snapshot(uint translatorProcessId, uint signalProcessId) {
      var records = new List<WindowRecord>();
      EnumWindowsProc callback = delegate(IntPtr window, IntPtr parameter) {
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        if (processId != translatorProcessId && processId != signalProcessId) {
          return true;
        }

        var owner = GetWindow(window, GW_OWNER);
        uint ownerProcessId = 0;
        if (owner != IntPtr.Zero) {
          GetWindowThreadProcessId(owner, out ownerProcessId);
        }
        uint sessionId = 0;
        ProcessIdToSessionId(processId, out sessionId);
        var className = new StringBuilder(512);
        var title = new StringBuilder(2048);
        GetClassNameW(window, className, className.Capacity);
        GetWindowTextW(window, title, title.Capacity);
        records.Add(new WindowRecord {
          handle = HandleText(window),
          processId = processId,
          sessionId = sessionId,
          ownerHandle = HandleText(owner),
          ownerProcessId = ownerProcessId,
          rootHandle = HandleText(GetAncestor(window, GA_ROOT)),
          rootOwnerHandle = HandleText(GetAncestor(window, GA_ROOTOWNER)),
          visible = IsWindowVisible(window),
          iconic = IsIconic(window),
          className = className.ToString(),
          title = title.ToString(),
          style = WindowLong(window, GWL_STYLE).ToString(CultureInfo.InvariantCulture),
          extendedStyle = WindowLong(window, GWL_EXSTYLE).ToString(CultureInfo.InvariantCulture),
          rect = ReadRect(window),
        });
        return true;
      };
      EnumWindows(callback, IntPtr.Zero);
      return records.ToArray();
    }

    public static string ProcessImagePath(uint processId) {
      var process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
      if (process == IntPtr.Zero) {
        return "";
      }
      try {
        var path = new StringBuilder(32768);
        uint size = (uint)path.Capacity;
        return QueryFullProcessImageNameW(process, 0, path, ref size)
          ? path.ToString()
          : "";
      } finally {
        CloseHandle(process);
      }
    }

    public static bool Move(long handle, int x, int y) {
      return SetWindowPos(
        new IntPtr(handle),
        IntPtr.Zero,
        x,
        y,
        0,
        0,
        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
      );
    }

    public static bool ChangeShowState(long handle, int command) {
      return ShowWindow(new IntPtr(handle), command);
    }

    public static bool Focus(long handle) {
      return SetForegroundWindow(new IntPtr(handle));
    }

  }
}
'@

Add-Type -TypeDefinition $nativeSource -Language CSharp

if ($TranslatorProcessId -le 0 -or $SignalProcessId -le 0) {
  throw 'TranslatorProcessId and SignalProcessId must be positive.'
}

$externalWindow = $null

switch ($Action) {
  'Move' {
    if ($Handle -le 0 -or -not [Maoyi.SignalSourceUiProbe.Native]::Move($Handle, $X, $Y)) {
      throw 'Failed to move the requested window.'
    }
  }
  'Minimize' {
    if ($Handle -le 0) { throw 'Minimize requires Handle.' }
    [void][Maoyi.SignalSourceUiProbe.Native]::ChangeShowState($Handle, 6)
  }
  'Restore' {
    if ($Handle -le 0) { throw 'Restore requires Handle.' }
    [void][Maoyi.SignalSourceUiProbe.Native]::ChangeShowState($Handle, 9)
    [void][Maoyi.SignalSourceUiProbe.Native]::Focus($Handle)
  }
  'Show' {
    if ($Handle -le 0) { throw 'Show requires Handle.' }
    [void][Maoyi.SignalSourceUiProbe.Native]::ChangeShowState($Handle, 5)
  }
  'FocusExternalWindow' {
    Add-Type -AssemblyName System.Windows.Forms
    $externalWindow = New-Object System.Windows.Forms.Form
    $externalWindow.Text = 'Maoyi external focus probe'
    $externalWindow.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $externalWindow.SetBounds(40, 40, 320, 180)
    $externalWindow.Show()
    $externalWindow.Activate()
    Start-Sleep -Milliseconds 350
  }
  'Capture' {
    if ($Handle -le 0) { throw 'Capture requires Handle.' }
    if ([string]::IsNullOrWhiteSpace($OutputPath)) { throw 'Capture requires OutputPath.' }
    $rect = [Maoyi.SignalSourceUiProbe.Native]::GetRect($Handle)
    if ($rect.width -le 0 -or $rect.height -le 0) { throw 'Capture window bounds are empty.' }
    Add-Type -AssemblyName System.Drawing
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolvedOutput)) | Out-Null
    $bitmap = New-Object System.Drawing.Bitmap($rect.width, $rect.height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($rect.left, $rect.top, 0, 0, $bitmap.Size)
      $bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
}

Start-Sleep -Milliseconds 75
$windows = @([Maoyi.SignalSourceUiProbe.Native]::Snapshot(
  [uint32]$TranslatorProcessId,
  [uint32]$SignalProcessId
))

if ($null -ne $externalWindow) {
  $externalWindow.Close()
  $externalWindow.Dispose()
}

[ordered]@{
  action = $Action
  translatorProcessId = $TranslatorProcessId
  signalProcessId = $SignalProcessId
  translatorImagePath = [Maoyi.SignalSourceUiProbe.Native]::ProcessImagePath([uint32]$TranslatorProcessId)
  signalImagePath = [Maoyi.SignalSourceUiProbe.Native]::ProcessImagePath([uint32]$SignalProcessId)
  windows = $windows
} | ConvertTo-Json -Depth 6 -Compress
