// 读取 Windows 媒体会话（就是按键盘多媒体键、或音量弹窗里显示“正在播放”的那套）。
// QQ 音乐、网易云音乐、Spotify、浏览器里的视频等，只要接入了系统媒体控制都能读到。
//
// 推送格式：
//   {"type":"media","active":false}
//   {"type":"media","active":true,"app":"QQMusic.exe","title":"...","artist":"...","album":"...",
//    "status":"playing|paused|stopped|changing|opened|closed","position":12.3,"duration":214.0,
//    "updatedAt":1731490000000,"canPrev":true,"canNext":true,"canToggle":true,
//    "thumb":null | "" | "data:image/png;base64,..."}
//   thumb 为 null 表示封面没变（沿用上一次）；"" 表示这首歌没有封面。
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace PeekNative;

internal sealed class MediaWatcher
{
    private readonly Action<object> _send;
    private GlobalSystemMediaTransportControlsSessionManager? _manager;
    private GlobalSystemMediaTransportControlsSession? _session;
    private string _trackKey = "";
    private readonly SemaphoreSlim _pushLock = new(1, 1);

    public MediaWatcher(Action<object> send) => _send = send;

    public async Task StartAsync()
    {
        _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        _manager.CurrentSessionChanged += (_, _) => Attach();
        _manager.SessionsChanged += (_, _) => Attach();
        Attach();

        // 进度条需要定时刷新；媒体会话本身只在状态变化时通知
        _ = Task.Run(async () =>
        {
            while (true)
            {
                await Task.Delay(1000);
                await PushAsync();
            }
        });
    }

    private void Attach()
    {
        var next = _manager?.GetCurrentSession();
        if (ReferenceEquals(next, _session) && next != null) return;
        if (_session != null)
        {
            _session.MediaPropertiesChanged -= OnProps;
            _session.PlaybackInfoChanged -= OnPlayback;
            _session.TimelinePropertiesChanged -= OnTimeline;
        }
        _session = next;
        if (_session != null)
        {
            _session.MediaPropertiesChanged += OnProps;
            _session.PlaybackInfoChanged += OnPlayback;
            _session.TimelinePropertiesChanged += OnTimeline;
        }
        _trackKey = "";
        _ = PushAsync();
    }

    private void OnProps(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args) => _ = PushAsync();
    private void OnPlayback(GlobalSystemMediaTransportControlsSession sender, PlaybackInfoChangedEventArgs args) => _ = PushAsync();
    private void OnTimeline(GlobalSystemMediaTransportControlsSession sender, TimelinePropertiesChangedEventArgs args) => _ = PushAsync();

    private async Task PushAsync()
    {
        if (!await _pushLock.WaitAsync(0)) return;
        try
        {
            var s = _session;
            if (s == null)
            {
                if (_trackKey != "none") _send(new { type = "media", active = false });
                _trackKey = "none";
                return;
            }

            var info = s.GetPlaybackInfo();
            var timeline = s.GetTimelineProperties();
            GlobalSystemMediaTransportControlsSessionMediaProperties? props = null;
            try { props = await s.TryGetMediaPropertiesAsync(); } catch { /* 有的播放器切歌瞬间会抛错，忽略 */ }

            string title = props?.Title ?? "";
            string artist = props?.Artist ?? "";
            string album = props?.AlbumTitle ?? "";
            string key = s.SourceAppUserModelId + "|" + title + "|" + artist + "|" + album;
            string? thumb = null;
            if (key != _trackKey)
            {
                thumb = props?.Thumbnail != null ? await ReadThumbAsync(props.Thumbnail) ?? "" : "";
                _trackKey = key;
            }

            var duration = timeline.EndTime - timeline.StartTime;
            _send(new
            {
                type = "media",
                active = true,
                app = s.SourceAppUserModelId,
                title,
                artist,
                album,
                status = info.PlaybackStatus.ToString().ToLowerInvariant(),
                position = Math.Max(0, timeline.Position.TotalSeconds),
                duration = Math.Max(0, duration.TotalSeconds),
                updatedAt = timeline.LastUpdatedTime.ToUnixTimeMilliseconds(),
                canPrev = info.Controls.IsPreviousEnabled,
                canNext = info.Controls.IsNextEnabled,
                canToggle = info.Controls.IsPlayPauseToggleEnabled || info.Controls.IsPlayEnabled || info.Controls.IsPauseEnabled,
                thumb
            });
        }
        catch (Exception e)
        {
            _send(new { type = "error", message = "media push: " + e.Message });
        }
        finally
        {
            _pushLock.Release();
        }
    }

    private static async Task<string?> ReadThumbAsync(IRandomAccessStreamReference reference)
    {
        try
        {
            using var stream = await reference.OpenReadAsync();
            uint size = (uint)Math.Min(stream.Size, 3_000_000UL);
            if (size == 0) return null;
            var buffer = new Windows.Storage.Streams.Buffer(size);
            var result = await stream.ReadAsync(buffer, size, InputStreamOptions.None);
            var bytes = new byte[result.Length];
            using (var reader = DataReader.FromBuffer(result)) reader.ReadBytes(bytes);
            string mime = string.IsNullOrEmpty(stream.ContentType) ? Sniff(bytes) : stream.ContentType;
            return "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
        }
        catch
        {
            return null;
        }
    }

    private static string Sniff(byte[] b)
    {
        if (b.Length > 3 && b[0] == 0x89 && b[1] == 0x50) return "image/png";
        if (b.Length > 3 && b[0] == 0x47 && b[1] == 0x49) return "image/gif";
        if (b.Length > 11 && b[8] == 0x57 && b[9] == 0x45) return "image/webp";
        return "image/jpeg";
    }

    public async Task CommandAsync(string cmd)
    {
        var s = _session;
        if (s == null) return;
        switch (cmd)
        {
            case "toggle": await s.TryTogglePlayPauseAsync(); break;
            case "play": await s.TryPlayAsync(); break;
            case "pause": await s.TryPauseAsync(); break;
            case "next": await s.TrySkipNextAsync(); break;
            case "prev": await s.TrySkipPreviousAsync(); break;
        }
        await PushAsync();
    }
}
