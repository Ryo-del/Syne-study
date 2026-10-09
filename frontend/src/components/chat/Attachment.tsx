import { useEffect, useRef, useState } from "react";
import { downloadToDownloads } from "../../files/actions";
import type { FileAttachment } from "../../files/attachment";
import { loadImageUrl } from "../../files/blob";
import { describeFileError } from "../../files/errors";
import { formatBytes } from "../../files/format";
import { iconUrl } from "../../files/icons";
import { sameUser } from "../../files/perm";
import { getSessionLogin } from "../../lib/session";
import Lightbox from "./Lightbox";

interface Props {
  att: FileAttachment;
  outgoing: boolean;
  onNotify: (msg: string) => void;
}

export default function Attachment({ att, outgoing, onNotify }: Props) {
  // Откуда брать байты. Входящее читаем только из своей папки: путь в сообщении задаёт отправитель.
  const source = outgoing
    ? (att.src ?? null)
    : sameUser(att.to, getSessionLogin()) && att.path
      ? { owner: "", path: att.path }
      : null;

  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const isPhoto = att.kind === "photo" && !!source;

  // Фото грузится, когда сообщение приблизилось к экрану.
  useEffect(() => {
    if (!isPhoto || visible) return;
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isPhoto, visible]);

  useEffect(() => {
    if (!isPhoto || !visible || !source) return;
    let off = false;
    loadImageUrl(source.owner, source.path)
      .then((u) => {
        if (!off) setUrl(u);
      })
      .catch(() => {
        if (!off) setFailed(true);
      });
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhoto, visible, source?.owner, source?.path]);

  async function download() {
    if (!source || busy) return;
    setBusy(true);
    setNote("");
    try {
      const r = await downloadToDownloads({
        name: att.name,
        path: source.path,
        is_dir: false,
        size: att.size,
        mod_time: 0,
        owner: source.owner,
        owner_name: "",
      });
      setNote("скачано");
      onNotify(`Скачано: ${r.path}`);
    } catch (err) {
      setNote(describeFileError(err));
    } finally {
      setBusy(false);
    }
  }

  if (isPhoto && !failed) {
    return (
      <>
        <div ref={hostRef}>
          {url ? (
            <img
              className="chat-photo"
              src={url}
              alt={att.name}
              draggable={false}
              onClick={() => setZoom(true)}
              onError={() => setFailed(true)}
            />
          ) : (
            <div className="chat-photo-skeleton" />
          )}
        </div>
        {zoom && url && (
          <Lightbox src={url} name={att.name} onClose={() => setZoom(false)} onDownload={() => void download()} />
        )}
      </>
    );
  }

  const meta = busy ? "скачивание…" : note || (source ? "" : "недоступно");
  return (
    <button
      type="button"
      className="file-card"
      disabled={!source || busy}
      title={source ? "Скачать в «Загрузки»" : "Файл недоступен"}
      onClick={() => void download()}
    >
      <img className="file-card-icon" src={iconUrl(att.name, false)} alt="" draggable={false} />
      <div className="file-card-main">
        <div className="file-card-name">{att.name}</div>
        <div className="file-card-meta">
          {formatBytes(att.size)}
          {meta ? ` · ${meta}` : ""}
        </div>
      </div>
    </button>
  );
}