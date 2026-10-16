'use strict';

const SECRET_PATTERNS = [
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    name: 'API key / token',
    pattern: /(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"]?[\w-]{12,}/gi,
  },
  { name: 'Bearer token', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: 'Password assignment',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{4,}/gi,
  },
  {
    name: '.env secret',
    pattern: /^[A-Z][A-Z0-9_]*=(?:['"]?[^\s'"]{8,}['"]?)$/gm,
  },
  {
    name: 'Authorization header',
    pattern: /Authorization\s*:\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{12,}/gi,
  },
];

function scanSecrets(content) {
  const warnings = [];
  const text = String(content ?? '');
  for (const { name, pattern } of SECRET_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(text)) warnings.push(name);
  }
  return warnings;
}

module.exports = { SECRET_PATTERNS, scanSecrets };
