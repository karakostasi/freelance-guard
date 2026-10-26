import { Fragment, useState } from "react";
import { Download, Paperclip, ShieldAlert, ShieldCheck } from "lucide-react";
import { useDoc } from "../hooks/useDoc";
import { deliverableUrl, formatBytes, parseDeliverable, parseDescription, type DocFile } from "../lib/documents";
import { fileUrl, verifyFile } from "../lib/files";
import styles from "../App.module.css";

/** Text with its web and IPFS links made clickable. Nothing else is ever turned into a link or markup. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((part, i) => {
        const href = deliverableUrl(part);
        return href ? (
          <a key={i} href={href} target="_blank" rel="noreferrer noopener">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}

function FileLine({ file }: { file: DocFile }) {
  const [state, setState] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  const check = async () => {
    setState("checking");
    setState((await verifyFile(file).catch(() => false)) ? "ok" : "bad");
  };
  return (
    <li className={styles.fileRow}>
      <Paperclip size={13} />
      <a className={styles.fileName} href={fileUrl(file.sha256, file.name)} target="_blank" rel="noreferrer noopener" download={file.name}>
        {file.name}
      </a>
      <span className={styles.muted}>{formatBytes(file.size)}</span>
      <a className={styles.chipButton} href={fileUrl(file.sha256, file.name)} target="_blank" rel="noreferrer noopener" download={file.name}>
        <Download size={12} /> Download
      </a>
      <button className={styles.chipButton} onClick={check} disabled={state === "checking"} title={`SHA-256 ${file.sha256}`}>
        {state === "ok" ? <ShieldCheck size={12} /> : state === "bad" ? <ShieldAlert size={12} /> : null}
        {state === "checking" ? "Checking…" : state === "ok" ? "Matches the recorded hash" : state === "bad" ? "Does not match!" : "Verify"}
      </button>
    </li>
  );
}

/** A stored document: its note, and its files with download and integrity-check buttons. */
export function DocView({ reference }: { reference: string }) {
  const { data: doc, isLoading, error } = useDoc(reference);
  if (isLoading) return <span className={styles.muted}>Loading attachments…</span>;
  if (error || !doc) {
    return (
      <span className={styles.muted} title={`SHA-256 ${reference}`}>
        Attachments unavailable{error ? ` (${(error as Error).message})` : ""}.
      </span>
    );
  }
  return (
    <div className={styles.doc}>
      {doc.text && (
        <p className={styles.docText}>
          <Linkified text={doc.text} />
        </p>
      )}
      {doc.files.length > 0 && (
        <ul className={styles.docFiles}>
          {doc.files.map((file) => (
            <FileLine key={file.sha256} file={file} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A milestone's deliverable: a stored document with files, or the plain link or note the payee typed. */
export function DeliverableView({ value }: { value: string }) {
  const { ref, text } = parseDeliverable(value);
  if (ref) return <DocView reference={ref} />;
  return (
    <span className={styles.specText}>
      <Linkified text={text} />
    </span>
  );
}

/** A job's spec: a stored document with files, or the text written on-chain. Nothing when there is none. */
export function SpecView({ description }: { description: string }) {
  const { spec, ref } = parseDescription(description);
  if (ref) return <DocView reference={ref} />;
  return spec ? (
    <p className={styles.specText}>
      <Linkified text={spec} />
    </p>
  ) : null;
}
