import { useEffect, useState } from "react";
import type { TransferProgress } from "../types";

export const TRANSFER_EVENT = "syne:file-transfer";

/** Прогресс загрузок и скачиваний: события file_transfer пересылает App.tsx. */
export function useTransfers() {
  const [items, setItems] = useState<TransferProgress[]>([]);

  useEffect(() => {
    const onEvent = (e: Event) => {
      const t = (e as CustomEvent<TransferProgress>).detail;
      if (!t) return;
      setItems((cur) => {
        const i = cur.findIndex((x) => x.id === t.id);
        if (i < 0) return [...cur, t];
        const next = [...cur];
        next[i] = t;
        return next;
      });
      if (t.state !== "running") {
        window.setTimeout(
          () => setItems((cur) => cur.filter((x) => x.id !== t.id)),
          t.state === "error" ? 6000 : 1500,
        );
      }
    };
    window.addEventListener(TRANSFER_EVENT, onEvent);
    return () => window.removeEventListener(TRANSFER_EVENT, onEvent);
  }, []);

  return items;
}