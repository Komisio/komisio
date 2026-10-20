---
title: Comprobar un problema de envío
summary: Distingue un envío detenido de una respuesta ausente. El asiento podría
  existir aunque falte la respuesta.
routes:
  - path: /intake/accounting
    view: reconciliation
taskLinks:
  - href: /intake/accounting?view=settings
    label: Cuentas e integraciones
  - href: /intake/accounting
    label: Cierres diarios y exportaciones
  - href: /intake/accounting?view=reconciliation
    label: Conciliación
externalLinks: []
lastReviewed: 2026-10-20
machineTranslated: false
---

Distingue un envío detenido de una respuesta ausente\. El asiento podría existir aunque falte la respuesta\.

1. Si Komisio indica expresamente que el envío se detuvo antes del registro, corrige la causa y utiliza la acción de reintento ofrecida\.
2. Si el envío está pendiente o el resultado es incierto, no vuelvas a enviar\. Pide al propietario que compare el documento con los asientos de la base de datos de empresa de Fortnox vinculada al envío\.
3. Compara fecha, importes y todas las líneas\. Si existe un asiento coincidente, el propietario puede registrar serie, número, ejercicio y pruebas mediante la confirmación de la fila de exportación\.
4. Si no se encuentra el asiento, pide ayuda al responsable de la instalación para investigarlo\. La ausencia no permite otro envío\. No borres ni recrees documentos para eludir el bloqueo\.

> La conciliación registra la comprobación del propietario, no una verificación automática de Fortnox\. Personal y administradores pueden leer la ayuda; solo el propietario puede registrar esta confirmación\.
