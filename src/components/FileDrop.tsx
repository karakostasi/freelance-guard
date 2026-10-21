import { useState } from "react";
import { Paperclip, X } from "lucide-react";
import { formatBytes } from "../lib/documents";
import { MAX_FILES, MAX_FILE_BYTES } from "../lib/files";
import styles from "../App.module.css";

/** Picks files to attach. They are uploaded later, when the form is submitted. */
export function FileDrop({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const [problem, setProblem] = useState("");

  const add = (list: FileList | null) => {
    setProblem("");
    const next = [...files];
    for (const file of Array.from(list ?? [])) {
      if (file.size === 0) setProblem(`${file.name} is empty`);
      else if (file.size > MAX_FILE_BYTES) setProblem(`${file.name} is over ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      else if (next.length >= MAX_FILES) setProblem(`At most ${MAX_FILES} files`);
      else if (!next.some((f) => f.name === file.name && f.size === file.size)) next.push(file);
    }
    onChange(next);
  };

  return (
    <div className={styles.fileDrop}>
      <label className={`${styles.chipButton} ${disabled ? styles.chipDisabled : ""}`}>
        <Paperclip size={14} /> Attach files
        <input type="file" multiple hidden disabled={disabled} onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      </label>
      <span className={styles.muted}>Up to {MAX_FILES} files, {MAX_FILE_BYTES / 1024 / 1024} MB each</span>
      {files.map((file) => (
        <div key={`${file.name}-${file.size}`} className={styles.fileRow}>
          <Paperclip size={13} />
          <span className={styles.fileName}>{file.name}</span>
          <span className={styles.muted}>{formatBytes(file.size)}</span>
          <button type="button" className={styles.iconButton} disabled={disabled} onClick={() => onChange(files.filter((f) => f !== file))} aria-label={`Remove ${file.name}`}>
            <X size={14} />
          </button>
        </div>
      ))}
      {problem && <span className={styles.error}>{problem}</span>}
    </div>
  );
}
