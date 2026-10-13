Komisio Print 1.1 - Windows 10/11 x64

NEW INSTALLATION
1. Keep all extracted files together in a permanent folder.
2. Network Zebra/ZPL: enter its network address in Komisio Settings > Printers.
   USB Zebra/ZPL: install the Zebra Windows driver and connect the printer.
   Run list-usb-printers.cmd. Copy the exact Windows printer name into the USB
   printer settings in Komisio. Use a local machine-installed USB queue.
3. Save the printer and create a pairing code in Komisio.
4. Run install.cmd as administrator and enter the code.

UPGRADE FROM 1.0
Extract the complete new package into a NEW permanent folder. Run update.cmd
as administrator from that folder. It moves the Windows service to the new
folder and keeps the existing pairing. Do not overwrite a running executable.
Verify version 1.1.0 in Komisio before changing a paired printer to USB.

USB NOTES
KomisioUsb.exe must stay beside KomisioPrint.exe. It uses the Windows Print
Spooler and .NET Framework 4.x included in supported Windows installations.
The service runs as LocalSystem; install the driver/queue for the computer,
not just a remote/shared queue in one user's session. The printer must support
ZPL. USBxxx and DOT4_xxx ports are accepted; file, network and pooled ports are
not. The service does not install drivers or change printer settings.

Sent to printer means Windows accepted the RAW ZPL job. It does not prove a
physical label printed. If disconnected, Windows may retain the job until the
printer reconnects. Check the Windows queue before reprinting, particularly
after USB_RESULT_UNKNOWN. Do not repeatedly resend a queued job.

USB_WINDOWS_ERROR_1801: check the exact Windows printer name and driver.
USB_WINDOWS_ERROR_5: the service cannot access the queue; check permissions.
USB_LOCAL_QUEUE_REQUIRED: select a local USB queue, not FILE or network.
USB_QUEUE_NOT_READY: check Windows for paused/offline/error/paper status.
USB_HELPER_MISSING: extract the complete package and run update.cmd.

Run KomisioPrint.exe status to check the existing pairing.
Physical label size, DPI, barcode readability and Swedish characters must be
verified on your Zebra. There is no browser print dialog for queued ZPL jobs.
