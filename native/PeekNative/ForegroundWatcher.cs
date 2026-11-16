using System.Runtime.InteropServices;
using System.Text;

namespace PeekNative;

/// <summary>
/// 每秒看一次前台窗口是不是占满了整块屏幕（全屏视频、游戏、幻灯片放映）。
/// 状态变化时输出一行：
///   {"type":"fullscreen","on":true,"primary":true}
/// primary = 这个全屏窗口是否在主显示器上。主程序据此决定要不要把岛藏起来。
/// </summary>
internal static class ForegroundWatcher
{
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    private const uint MONITOR_DEFAULTTONEAREST = 2;
    private const uint MONITORINFOF_PRIMARY = 1;
    private const int GWL_STYLE = -16;
    private const int WS_CAPTION = 0x00C00000;
    private const int WS_MAXIMIZE = 0x01000000;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hWnd, int index);

    /// <summary>前台窗口是否全屏；primary 返回它是否在主显示器上。</summary>
    private static bool Check(out bool primary)
    {
        primary = true;
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero || hwnd == GetShellWindow() || hwnd == GetDesktopWindow()) return false;
        if (!IsWindowVisible(hwnd)) return false;

        // 桌面本身（点一下桌面空白处时前台就是它）不算
        var cls = new StringBuilder(64);
        GetClassName(hwnd, cls, cls.Capacity);
        string name = cls.ToString();
        if (name == "Progman" || name == "WorkerW" || name == "Shell_TrayWnd") return false;

        if (!GetWindowRect(hwnd, out RECT r)) return false;
        IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return false;
        primary = (info.dwFlags & MONITORINFOF_PRIMARY) != 0;

        // 普通的最大化窗口（有标题栏）不算：任务栏设成自动隐藏时，它也会盖满整块屏幕
        int style = GetWindowLong(hwnd, GWL_STYLE);
        if ((style & WS_MAXIMIZE) != 0 && (style & WS_CAPTION) == WS_CAPTION) return false;

        RECT m = info.rcMonitor;
        return r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom;
    }

    public static async Task Loop(Action<object> send, CancellationToken token)
    {
        bool lastOn = false, lastPrimary = true;
        int streak = 0;
        while (!token.IsCancellationRequested)
        {
            try { await Task.Delay(1000, token); } catch (TaskCanceledException) { break; }
            bool on, primary;
            try { on = Check(out primary); }
            catch { continue; }
            if (on == lastOn && primary == lastPrimary) { streak = 0; continue; }
            // 连续两次结果一样才算数，避免切换窗口的瞬间误判
            if (++streak < 2) continue;
            streak = 0;
            lastOn = on;
            lastPrimary = primary;
            send(new { type = "fullscreen", on, primary });
        }
    }
}
