// 协议：
//   stdout 每行一条 JSON（UTF-8）：
//     {"type":"ready","version":"0.2.0"}
//     {"type":"media", ...}        见 MediaWatcher
//     {"type":"level","peak":0.42} 默认输出设备的实时峰值 0..1
//     {"type":"error","message":"..."}
//   stdin 每行一条 JSON 命令：
//     {"cmd":"toggle"} / {"cmd":"play"} / {"cmd":"pause"} / {"cmd":"next"} / {"cmd":"prev"}
//     {"cmd":"level","on":true}    打开 / 关闭峰值推送（没放歌时关掉，省电）
// stdin 关闭（主程序退出）时自动退出。
using System.Text;
using System.Text.Json;

namespace PeekNative;

internal static class Program
{
    private static readonly object OutLock = new();
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static volatile bool _levelOn = true;

    public static void Send(object message)
    {
        string line;
        try { line = JsonSerializer.Serialize(message, Json); }
        catch (Exception e) { line = JsonSerializer.Serialize(new { type = "error", message = e.Message }, Json); }
        lock (OutLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    private static async Task<int> Main()
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        Send(new { type = "ready", version = "0.2.0" });

        var media = new MediaWatcher(Send);
        try { await media.StartAsync(); }
        catch (Exception e) { Send(new { type = "error", message = "media: " + e.Message }); }

        var cts = new CancellationTokenSource();
        _ = Task.Run(() => LevelLoop(cts.Token));

        string? line;
        while ((line = await Console.In.ReadLineAsync()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var cmd = root.TryGetProperty("cmd", out var c) ? c.GetString() : null;
                if (cmd == "level")
                {
                    _levelOn = root.TryGetProperty("on", out var on) && on.GetBoolean();
                    continue;
                }
                if (cmd != null) await media.CommandAsync(cmd);
            }
            catch (Exception e)
            {
                Send(new { type = "error", message = e.Message });
            }
        }

        cts.Cancel();
        return 0;
    }

    // 约 20 次 / 秒读取峰值；只有变化明显时才发，静音时每秒发一次心跳
    private static async Task LevelLoop(CancellationToken token)
    {
        var meter = new PeakMeter();
        float last = -1;
        var lastSent = DateTime.MinValue;
        while (!token.IsCancellationRequested)
        {
            if (_levelOn)
            {
                float peak = meter.GetPeak();
                var now = DateTime.UtcNow;
                if (Math.Abs(peak - last) > 0.02f || (now - lastSent).TotalMilliseconds > 1000)
                {
                    Send(new { type = "level", peak = Math.Round(peak, 3) });
                    last = peak;
                    lastSent = now;
                }
            }
            try { await Task.Delay(50, token); } catch (TaskCanceledException) { break; }
        }
    }
}
