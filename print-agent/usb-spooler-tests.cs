using System;
using System.Collections.Generic;
using System.Text;
using KomisioPrint;

// Tests never submit a Windows print job. The real bridge is exercised by the
// separate CLI probes; this fake verifies the RAW write/cleanup protocol.
public static class UsbSpoolerTests {
    sealed class Fake : IRawPrinter {
        public List<byte> output = new List<byte>();
        public List<string> calls = new List<string>();
        public string fail = "";
        void Call(string value) {
            calls.Add(value);
            if (value == fail) throw new Exception("synthetic failure");
        }
        public uint Start() { Call("start"); return 42; }
        public void StartPage() { Call("page"); }
        public int Write(byte[] data, int offset, int count) {
            Call("write");
            if (fail == "zero") return 0;
            int n = Math.Min(3, count);
            for (int i = 0; i < n; i++) output.Add(data[offset+i]);
            return n;
        }
        public void EndPage() { Call("endpage"); }
        public void End() { Call("end"); }
        public void Abort() { Call("abort"); }
        public void Dispose() { calls.Add("dispose"); }
    }
    static void Assert(bool condition) { if (!condition) throw new Exception("USB assertion failed"); }
    public static int Main() {
        byte[] data = Encoding.UTF8.GetBytes("^XA^CI28^FDRöd tröja åäö^FS^XZ");
        var printer = new Fake();
        Assert(RawJob.Send(printer, data, 2) == 42);
        Assert(Encoding.UTF8.GetString(printer.output.ToArray()) == Encoding.UTF8.GetString(data) + Encoding.UTF8.GetString(data));
        Assert(!printer.calls.Contains("abort") && printer.calls[printer.calls.Count-1] == "dispose");
        foreach (string fail in new [] { "start", "page", "write", "zero", "endpage", "end" }) {
            printer = new Fake { fail = fail };
            bool threw = false;
            try { RawJob.Send(printer, data, 1); } catch { threw = true; }
            Assert(threw && printer.calls[printer.calls.Count-1] == "dispose");
            Assert(printer.calls.Contains("abort") == (fail != "start"));
        }
        printer = new Fake();
        try { RawJob.Send(printer, data, 0); } catch (ArgumentException) { }
        Assert(printer.calls.Count == 1 && printer.calls[0] == "dispose");
        Assert(UsbPrinter.ValidQueueName("ZDesigner USB (åäö) & 'name'"));
        Assert(!UsbPrinter.ValidQueueName("\\\\server\\printer"));
        Assert(!UsbPrinter.ValidQueueName("queue\ncommand"));
        Assert(!UsbPrinter.ValidQueueName(" "));
        Assert(UsbPrinter.IsUsbQueue(0x40, "USB001"));
        Assert(UsbPrinter.IsUsbQueue(0x40, "DOT4_001"));
        foreach (string port in new [] { "FILE:", "PORTPROMPT:", "LPT1:", "IP_192.0.2.1", "USB001,FILE:", "C:\\file" })
            Assert(!UsbPrinter.IsUsbQueue(0x40, port));
        Assert(!UsbPrinter.IsUsbQueue(0x50, "USB001"));
        Console.WriteLine("USB RAW protocol, UTF-8, partial writes, failures and queue boundary passed");
        return 0;
    }
}
