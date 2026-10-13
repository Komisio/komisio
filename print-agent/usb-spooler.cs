using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

// Original, narrow Winspool bridge. No shell, file output, remote queues or
// driver installation. The service uses a machine-installed USB ZPL queue.
namespace KomisioPrint {
    public interface IRawPrinter : IDisposable {
        uint Start();
        void StartPage();
        int Write(byte[] bytes, int offset, int count);
        void EndPage();
        void End();
        void Abort();
    }

    public static class RawJob {
        public static uint Send(IRawPrinter printer, byte[] data, int copies) {
            bool started = false;
            try {
                if (data == null || data.Length == 0 || data.Length > 80000 || copies < 1 || copies > 20)
                    throw new ArgumentException("USB_INVALID_JOB");
                uint id = printer.Start();
                if (id == 0) throw new InvalidOperationException("USB_JOB_NOT_ACCEPTED");
                started = true;
                printer.StartPage();
                for (int copy = 0; copy < copies; copy++) {
                    int offset = 0;
                    while (offset < data.Length) {
                        int written = printer.Write(data, offset, data.Length - offset);
                        if (written <= 0 || written > data.Length - offset)
                            throw new InvalidOperationException("USB_INCOMPLETE_WRITE");
                        offset += written;
                    }
                }
                printer.EndPage();
                printer.End();
                started = false;
                return id;
            } finally {
                if (started) { try { printer.Abort(); } catch { } }
                printer.Dispose();
            }
        }
    }

    public sealed class UsbPrinter : IRawPrinter {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DocInfo { public string name, output, datatype; }
        [StructLayout(LayoutKind.Sequential)]
        struct PrinterInfo {
            public IntPtr server, name, share, port, driver, comment, location, devmode;
            public IntPtr separator, processor, datatype, parameters, security;
            public uint attributes, priority, defaultPriority, start, until, status, jobs, average;
        }
        [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
        [DllImport("winspool.drv", EntryPoint="GetPrinterW", SetLastError=true)]
        static extern bool GetPrinter(IntPtr handle, uint level, IntPtr buffer, uint size, out uint needed);
        [DllImport("winspool.drv", EntryPoint="EnumPrintersW", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern bool EnumPrinters(uint flags, string name, uint level, IntPtr buffer, uint size, out uint needed, out uint count);
        [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern uint StartDocPrinter(IntPtr handle, uint level, ref DocInfo doc);
        [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr handle);
        [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr handle, IntPtr data, int count, out int written);
        [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr handle);
        [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
        [DllImport("winspool.drv", SetLastError=true)] static extern bool AbortPrinter(IntPtr handle);
        [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
        IntPtr handle;
        static void Check(bool ok) {
            if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        public static bool ValidQueueName(string name) {
            return !String.IsNullOrWhiteSpace(name) && name.Length <= 200 &&
                name.IndexOf('\\') < 0 && !Regex.IsMatch(name, @"[\x00-\x1f\x7f]");
        }
        static bool IsUsb(PrinterInfo p) {
            string port = Marshal.PtrToStringUni(p.port) ?? "";
            return IsUsbQueue(p.attributes, port);
        }
        public static bool IsUsbQueue(uint attributes, string port) {
            return (attributes & 0x40) != 0 && (attributes & 0x10) == 0 &&
                Regex.IsMatch(port, @"\A(?:USB\d+|DOT4_\d+)\z", RegexOptions.IgnoreCase);
        }
        public UsbPrinter(string name) {
            if (!ValidQueueName(name)) throw new ArgumentException("USB_INVALID_QUEUE_NAME");
            Check(OpenPrinter(name, out handle, IntPtr.Zero));
            try {
                uint needed;
                GetPrinter(handle, 2, IntPtr.Zero, 0, out needed);
                if (needed == 0 || needed > 1048576) throw new InvalidOperationException("USB_QUEUE_UNAVAILABLE");
                IntPtr buffer = Marshal.AllocHGlobal((int)needed);
                try {
                    Check(GetPrinter(handle, 2, buffer, needed, out needed));
                    PrinterInfo p = (PrinterInfo)Marshal.PtrToStructure(buffer, typeof(PrinterInfo));
                    if (!IsUsb(p)) throw new InvalidOperationException("USB_LOCAL_QUEUE_REQUIRED");
                    // Driver status is advisory; zero does not prove hardware connectivity.
                    if ((p.status & (0x1 | 0x2 | 0x8 | 0x10 | 0x80 | 0x1000 | 0x40000)) != 0)
                        throw new InvalidOperationException("USB_QUEUE_NOT_READY");
                } finally { Marshal.FreeHGlobal(buffer); }
            } catch { Dispose(); throw; }
        }
        public static string[] List() {
            uint needed, count;
            bool ok = EnumPrinters(2, null, 2, IntPtr.Zero, 0, out needed, out count);
            int error = Marshal.GetLastWin32Error();
            if (needed == 0) {
                if (!ok && error != 122) throw new Win32Exception(error);
                return new string[0];
            }
            if (needed > 16777216) throw new InvalidOperationException("USB_PRINTER_LIST_TOO_LARGE");
            IntPtr buffer = Marshal.AllocHGlobal((int)needed);
            try {
                Check(EnumPrinters(2, null, 2, buffer, needed, out needed, out count));
                var names = new List<string>();
                int size = Marshal.SizeOf(typeof(PrinterInfo));
                for (int i = 0; i < count; i++) {
                    PrinterInfo p = (PrinterInfo)Marshal.PtrToStructure(IntPtr.Add(buffer, i * size), typeof(PrinterInfo));
                    if (IsUsb(p)) names.Add(Marshal.PtrToStringUni(p.name));
                }
                return names.ToArray();
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        public uint Start() {
            var doc = new DocInfo { name = "Komisio label", output = null, datatype = "RAW" };
            uint id = StartDocPrinter(handle, 1, ref doc);
            Check(id != 0);
            return id;
        }
        public void StartPage() { Check(StartPagePrinter(handle)); }
        public int Write(byte[] data, int offset, int count) {
            GCHandle pin = GCHandle.Alloc(data, GCHandleType.Pinned);
            try {
                int written;
                Check(WritePrinter(handle, IntPtr.Add(pin.AddrOfPinnedObject(), offset), count, out written));
                return written;
            } finally { pin.Free(); }
        }
        public void EndPage() { Check(EndPagePrinter(handle)); }
        public void End() { Check(EndDocPrinter(handle)); }
        public void Abort() { Check(AbortPrinter(handle)); }
        public void Dispose() {
            if (handle != IntPtr.Zero) { ClosePrinter(handle); handle = IntPtr.Zero; }
        }
    }

    public static class Program {
        public static int Main() {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            var json = new JavaScriptSerializer { MaxJsonLength = 120000 };
            try {
                var input = new StringBuilder();
                int ch;
                while ((ch = Console.Read()) != -1) {
                    if (input.Length >= 120000) throw new ArgumentException("USB_INVALID_REQUEST");
                    input.Append((char)ch);
                }
                var request = json.Deserialize<Dictionary<string, object>>(input.ToString());
                string operation = (string)request["operation"];
                if (operation == "list") {
                    Console.WriteLine(json.Serialize(new { ok = true, printers = UsbPrinter.List() }));
                } else if (operation == "probe") {
                    using (var printer = new UsbPrinter((string)request["printer"])) { }
                    Console.WriteLine("{\"ok\":true}");
                } else if (operation == "print") {
                    byte[] data = Convert.FromBase64String((string)request["data"]);
                    int copies = (int)request["copies"];
                    // Validate before opening the spooler. Each payload is one existing ZPL job.
                    if (data.Length == 0 || data.Length > 80000 || copies < 1 || copies > 20)
                        throw new ArgumentException("USB_INVALID_JOB");
                    uint id = RawJob.Send(new UsbPrinter((string)request["printer"]), data, copies);
                    Console.WriteLine(json.Serialize(new { ok = true, jobId = id }));
                } else throw new ArgumentException("USB_INVALID_OPERATION");
                return 0;
            } catch (Exception error) {
                var windows = error as Win32Exception;
                string message = windows != null ? "USB_WINDOWS_ERROR_" + windows.NativeErrorCode :
                    error.Message.StartsWith("USB_", StringComparison.Ordinal) ? error.Message : "USB_INVALID_REQUEST";
                Console.WriteLine(json.Serialize(new { ok = false, error = message }));
                return 1;
            }
        }
    }
}
