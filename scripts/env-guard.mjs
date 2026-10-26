// Detects real-looking secrets in an env template such as .env.example.
// It reports variable names and line numbers only, never the values.

const SENSITIVE_KEY =
  /(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|ACCESS_?KEY|API_?KEY|SERVICE_?ROLE)/i;

// Values that are obviously not real: empty, <angle>, ***, xxx, or a known placeholder word.
const PLACEHOLDER =
  /^(<.*>|\*+|x{3,}|(change[-_]?me|replace[-_]?me|your|dev[-_]only|example|placeholder|fake|test|todo|none)([-_ ].*)?)$/i;

/** Shannon entropy in bits per character. */
export function entropy(text) {
  const counts = new Map();
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * @param {string} text contents of the env template
 * @returns {{ line: number, key: string, reason: string }[]}
 */
export function findProblems(text) {
  const problems = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      return;
    }
    const key = match[1];
    const value = match[2]
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (value === '' || PLACEHOLDER.test(value)) {
      return;
    }
    const lineNumber = index + 1;
    if (SENSITIVE_KEY.test(key)) {
      problems.push({
        line: lineNumber,
        key,
        reason: 'sensitive name with a non-placeholder value',
      });
    } else if (value.startsWith('-----BEGIN ') || /^eyJ[A-Za-z0-9_-]{10,}\./.test(value)) {
      problems.push({ line: lineNumber, key, reason: 'looks like a private key or a JWT' });
    } else if (value.length >= 24 && /^[A-Za-z0-9+/=_-]+$/.test(value) && entropy(value) >= 3.5) {
      problems.push({
        line: lineNumber,
        key,
        reason: 'looks like a generated secret or account identifier',
      });
    }
  });
  return problems;
}
