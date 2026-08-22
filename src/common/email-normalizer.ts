export interface ParsedAddress {
  name: string | null;
  address: string;
}

export function parseEmailAddress(raw: string): ParsedAddress | null {
  const input = raw.trim();
  if (!input) {
    return null;
  }
  const angleMatch = /^(.*?)<([^<>]+)>$/.exec(input);
  if (angleMatch) {
    const name = angleMatch[1].trim().replace(/^["']|["']$/g, '') || null;
    const addr = angleMatch[2].trim();
    if (isValidEmail(addr)) {
      return { name, address: addr };
    }
    return null;
  }
  const bare = input.replace(/^["']|["']$/g, '').trim();
  if (isValidEmail(bare)) {
    return { name: null, address: bare };
  }
  return null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function splitAddressHeader(
  header: string | undefined | null,
): ParsedAddress[] {
  if (!header) {
    return [];
  }
  const out: ParsedAddress[] = [];
  const pairRe = /([^,]*?)\s*<([^>]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(header)) !== null) {
    const name = match[1].trim().replace(/^["']|["']$/g, '') || null;
    const address = match[2].trim();
    if (address && !out.some((x) => x.address === address)) {
      out.push({ name, address });
    }
  }
  const bareRe = /(?:^|,)\s*([^\s<>,"]+@[^\s<>,"]+)\s*(?=,|$)/g;
  while ((match = bareRe.exec(header)) !== null) {
    const address = match[1].trim();
    if (address && !out.some((x) => x.address === address)) {
      out.push({ name: null, address });
    }
  }
  return out;
}

export function normalizeEmail(raw: string): string {
  const parsed = parseEmailAddress(raw);
  const source = parsed ? parsed.address : raw;
  const lower = source.toLowerCase().trim();
  const at = lower.lastIndexOf('@');
  if (at <= 0) {
    return lower;
  }
  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '');
    return `${local}@gmail.com`;
  }
  local = local.split('+')[0];
  return `${local}@${domain}`;
}
