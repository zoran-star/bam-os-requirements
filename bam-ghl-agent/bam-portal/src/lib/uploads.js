import * as tus from "tus-js-client";
import { supabase, supabaseUrl } from "./supabase";

// ── Resumable storage uploads (TUS) ─────────────────────────────────────────
// Plain browser uploads push one HTTP stream and restart from zero on any
// interruption - a 20-minute white-knuckle wait for big video finals. TUS
// uploads in 6MB chunks (Supabase requires exactly 6MB), reports real
// progress, retries transient failures, and RESUMES a re-attempted file from
// where it left off (fingerprint kept in localStorage until success).
//
// Small files skip TUS - the handshake overhead isn't worth it under ~6MB.

const CHUNK = 6 * 1024 * 1024;

function tusUpload({ accessToken, bucket, path, file, onProgress }) {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${accessToken}`, "x-upsert": "true" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: reject,
      onProgress: (sent, total) => { if (onProgress) onProgress(sent, total); },
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads()
      .then((prev) => {
        if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}

// Upload one file to `bucket/path`, resumable when it matters, and return the
// public URL. onProgress(sentBytes, totalBytes) fires as chunks land.
export async function uploadFileResumable({ accessToken, bucket, path, file, onProgress }) {
  if (file.size > CHUNK && accessToken) {
    await tusUpload({ accessToken, bucket, path, file, onProgress });
  } else {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
    });
    if (error) throw new Error(`Storage upload failed (${file.name}): ${error.message}`);
    if (onProgress) onProgress(file.size, file.size);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
