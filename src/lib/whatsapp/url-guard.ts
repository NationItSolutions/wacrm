// ============================================================
// SSRF guard for user-supplied outbound base URLs (Evolution API).
//
// The Evolution connect route lets an admin paste the URL of *their*
// Evolution server, which the server then calls. Without a guard, that
// URL could point at loopback / link-local / RFC1918 addresses (cloud
// metadata at 169.254.169.254, other containers on the same Docker
// host, internal admin panels) and turn wacrm into an SSRF proxy.
//
// `assertPublicHttpUrl` parses + DNS-resolves the host and rejects any
// non-public address (checking EVERY resolved address, not just the
// first). Enforces https in production.
// ============================================================

import dns from 'dns'
import net from 'net'

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const b = Number(p)
    if (!Number.isInteger(b) || b < 0 || b > 255) return null
    n = n * 256 + b
  }
  return n >>> 0
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  if (n === null) return true // unparseable → treat as unsafe
  const inRange = (start: string, bits: number) => {
    const s = ipv4ToInt(start)!
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (s & mask)
  }
  return (
    inRange('0.0.0.0', 8) || // "this" network / 0.0.0.0
    inRange('10.0.0.0', 8) || // RFC1918
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. cloud metadata)
    inRange('172.16.0.0', 12) || // RFC1918
    inRange('192.0.0.0', 24) ||
    inRange('192.168.0.0', 16) || // RFC1918
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved
  )
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === '::1' || lower === '::' || lower === '::0') return true // loopback / unspecified
  if (lower.startsWith('fe80')) return true // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])
  return false
}

function isPrivateAddress(ip: string): boolean {
  const fam = net.isIP(ip)
  if (fam === 4) return isPrivateIpv4(ip)
  if (fam === 6) return isPrivateIpv6(ip)
  return true // not a recognizable IP → unsafe
}

export class UrlNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlNotAllowedError'
  }
}

/**
 * Throw `UrlNotAllowedError` unless `raw` is an http(s) URL whose host
 * resolves entirely to public IP addresses. In production, https is
 * required.
 */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UrlNotAllowedError('Invalid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlNotAllowedError('Only http(s) URLs are allowed')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new UrlNotAllowedError('An https URL is required')
  }

  const host = url.hostname

  // Literal IP — validate directly (no DNS).
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new UrlNotAllowedError('URL host is not a public address')
    }
    return
  }

  // Reject obvious internal names outright.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new UrlNotAllowedError('URL host is not allowed')
  }

  let addrs: { address: string }[]
  try {
    addrs = await dns.promises.lookup(host, { all: true })
  } catch {
    throw new UrlNotAllowedError('Could not resolve URL host')
  }
  if (!addrs.length) throw new UrlNotAllowedError('Could not resolve URL host')
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      throw new UrlNotAllowedError('URL host resolves to a non-public address')
    }
  }
}
