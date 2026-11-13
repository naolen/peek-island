// 读取 Windows 通知中心里的通知（飞书、QQ、钉钉、Outlook 等发出的系统通知）。
// 需要用户在“设置 → 隐私和安全性 → 通知”里允许应用访问通知；第一次会弹出系统授权提示。
// 桌面程序拿不到“通知变化”事件，所以每 2 秒查一次，只把新出现的通知发给主程序。
//
// 推送格式：
//   {"type":"notify-status","status":"allowed|denied|unspecified|unsupported","message":"..."}
//   {"type":"notification","id":123,"app":"飞书","appId":"...","title":"...","body":"...","time":1731490000000}
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace PeekNative;

internal sealed class NotificationWatcher
{
    private readonly Action<object> _send;
    private UserNotificationListener? _listener;
    private readonly HashSet<uint> _seen = new();
    private bool _primed;
    private CancellationTokenSource? _cts;
    private string _status = "";

    public NotificationWatcher(Action<object> send) => _send = send;

    public async Task StartAsync()
    {
        Stop();
        try
        {
            _listener = UserNotificationListener.Current;
        }
        catch (Exception e)
        {
            Report("unsupported", e.Message);
            return;
        }

        UserNotificationListenerAccessStatus access;
        try
        {
            access = _listener.GetAccessStatus();
            if (access == UserNotificationListenerAccessStatus.Unspecified)
                access = await _listener.RequestAccessAsync();
        }
        catch (Exception e)
        {
            Report("unsupported", e.Message);
            return;
        }

        if (access != UserNotificationListenerAccessStatus.Allowed)
        {
            Report(access == UserNotificationListenerAccessStatus.Denied ? "denied" : "unspecified", "");
            return;
        }

        Report("allowed", "");
        _primed = false;
        _seen.Clear();
        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        _ = Task.Run(async () =>
        {
            while (!token.IsCancellationRequested)
            {
                await PollAsync();
                try { await Task.Delay(2000, token); } catch (TaskCanceledException) { break; }
            }
        });
    }

    public void Stop()
    {
        _cts?.Cancel();
        _cts = null;
    }

    private void Report(string status, string message)
    {
        if (status == _status && message == "") return;
        _status = status;
        _send(new { type = "notify-status", status, message });
    }

    private async Task PollAsync()
    {
        if (_listener == null) return;
        IReadOnlyList<UserNotification> list;
        try
        {
            list = await _listener.GetNotificationsAsync(NotificationKinds.Toast);
        }
        catch (Exception e)
        {
            // 用户中途在系统设置里关掉了权限
            Report("denied", e.Message);
            return;
        }

        var current = new HashSet<uint>();
        foreach (var n in list)
        {
            current.Add(n.Id);
            if (_seen.Contains(n.Id)) continue;
            _seen.Add(n.Id);
            // 第一次轮询时通知中心里已有的旧通知不提醒
            if (!_primed) continue;
            try { _send(Describe(n)); }
            catch { /* 个别应用的通知结构不规范，跳过 */ }
        }
        // 已经从通知中心消失的，不再记着
        _seen.IntersectWith(current);
        _primed = true;
    }

    private static object Describe(UserNotification n)
    {
        string app = "", appId = "";
        try
        {
            app = n.AppInfo.DisplayInfo.DisplayName;
            appId = n.AppInfo.AppUserModelId;
        }
        catch { /* 有的应用拿不到 AppInfo */ }

        string title = "", body = "";
        var binding = n.Notification?.Visual?.GetBinding(KnownNotificationBindings.ToastGeneric);
        if (binding != null)
        {
            var texts = binding.GetTextElements().Select(t => t.Text).Where(t => !string.IsNullOrWhiteSpace(t)).ToList();
            if (texts.Count > 0) title = texts[0];
            if (texts.Count > 1) body = string.Join("\n", texts.Skip(1));
        }

        return new
        {
            type = "notification",
            id = n.Id,
            app,
            appId,
            title = Truncate(title, 200),
            body = Truncate(body, 1000),
            time = n.CreationTime.ToUnixTimeMilliseconds()
        };
    }

    private static string Truncate(string s, int max) => s.Length > max ? s[..max] + "…" : s;
}
