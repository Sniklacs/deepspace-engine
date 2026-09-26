// StorageNote — the on-device storage line in Settings.
//
// It reports what the browser actually says (`navigator.storage.estimate()`), and
// asks once per device to keep what we store. This is the groundwork the local
// translation engine lands on: it is the measurement a model download has to
// pass before anyone spends a phone's data on one. Nothing is downloaded here.
//
// A device with no StorageManager API shows nothing at all — an invented number
// would be worse than a silence.
import { useEffect, useState } from "react";
import {
  formatBytes,
  markPersistAsked,
  persistAlreadyAsked,
  requestPersistentStorage,
  storageReport,
} from "../../game/pwa/storage";
import type { StorageReport } from "../../game/pwa/storage";
import { useT } from "../i18n/I18n";

export default function StorageNote() {
  const t = useT();
  const [report, setReport] = useState<StorageReport | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const first = await storageReport();
      if (!alive) return;
      setReport(first);
      // Ask once per device, and only when we have not already been promised it.
      if (first.supported && first.persisted !== true && !persistAlreadyAsked()) {
        markPersistAsked();
        await requestPersistentStorage();
        if (!alive) return;
        setReport(await storageReport());
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!report || !report.supported) return null;

  return (
    <p className="text-[11px] leading-snug text-text-3" data-testid="storage-note">
      {t("storage.line", { used: formatBytes(report.usage), quota: formatBytes(report.quota) })}
    </p>
  );
}
