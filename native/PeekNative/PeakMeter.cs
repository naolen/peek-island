// 读取默认输出设备（扬声器 / 耳机）的实时峰值，用来驱动岛上的音律条。
// 只读一个 0..1 的数，不录音、不保存任何声音内容。
using System.Runtime.InteropServices;

namespace PeekNative;

internal sealed class PeakMeter
{
    private IAudioMeterInformation? _meter;
    private DateTime _acquiredAt = DateTime.MinValue;

    public float GetPeak()
    {
        // 默认设备可能被切换（插拔耳机），每 5 秒重新获取一次
        if (_meter == null || (DateTime.UtcNow - _acquiredAt).TotalSeconds > 5) Acquire();
        if (_meter == null) return 0;
        try
        {
            return _meter.GetPeakValue(out float peak) == 0 ? Math.Clamp(peak, 0f, 1f) : 0;
        }
        catch
        {
            _meter = null;
            return 0;
        }
    }

    private void Acquire()
    {
        _acquiredAt = DateTime.UtcNow;
        try
        {
            if (_meter != null) Marshal.ReleaseComObject(_meter);
        }
        catch { /* ignore */ }
        _meter = null;
        try
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            if (enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out var device) != 0 || device == null) return;
            var iid = typeof(IAudioMeterInformation).GUID;
            if (device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out var obj) != 0) return;
            _meter = obj as IAudioMeterInformation;
        }
        catch
        {
            _meter = null;
        }
    }

    private const int CLSCTX_ALL = 0x17;

    private enum EDataFlow { Render = 0, Capture = 1, All = 2 }
    private enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice? device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object? iface);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
    }
}
