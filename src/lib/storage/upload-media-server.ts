// ============================================================
// Server-side (service-role) media upload.
//
// Kept in its own file — separate from `upload-media.ts`, which is
// imported by client components — so the service-role admin client is
// never pulled into a browser bundle.
//
// Used by the Evolution inbound webhook: unlike Meta (which we proxy
// on demand), Evolution delivers media as base64 / a fetch endpoint, so
// we persist the bytes to the public `chat-media` bucket and store the
// resulting URL on the message. The webhook has no `auth.uid()`, so the
// RLS-bound client-side helper can't be used — the service role writes
// under the account-scoped path the bucket policy expects.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { buildMediaPath, MEDIA_MAX_BYTES, type UploadAccountMediaResult } from './upload-media'

export interface UploadServerMediaArgs {
  bucket: string
  accountId: string
  bytes: Buffer | Uint8Array
  fileName: string
  contentType?: string
}

/**
 * Upload raw bytes to an account-scoped bucket via the service role and
 * return the public URL. Throws on oversize (> bucket cap) or on a
 * storage error.
 */
export async function uploadAccountMediaServer(
  args: UploadServerMediaArgs,
): Promise<UploadAccountMediaResult> {
  if (args.bytes.byteLength > MEDIA_MAX_BYTES) {
    throw new Error(
      `media exceeds ${MEDIA_MAX_BYTES} bytes (got ${args.bytes.byteLength})`,
    )
  }
  const admin = supabaseAdmin()
  const path = buildMediaPath(args.accountId, args.fileName)
  const { error } = await admin.storage.from(args.bucket).upload(path, args.bytes, {
    cacheControl: '86400',
    upsert: false,
    contentType: args.contentType,
  })
  if (error) throw new Error(error.message)
  const {
    data: { publicUrl },
  } = admin.storage.from(args.bucket).getPublicUrl(path)
  return { publicUrl, path }
}
