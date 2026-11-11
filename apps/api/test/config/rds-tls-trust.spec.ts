import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:tls';

import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../Dockerfile'),
  'utf8',
);

describe('RDS TLS trust configuration', () => {
  it('keeps certificate verification enabled and completes a real TLS handshake with the configured CA mechanism', async () => {
    const caPath = dockerfile.match(/^ENV NODE_EXTRA_CA_CERTS=(\S+)$/m)?.[1];

    expect(caPath).toBe('/usr/local/share/rds/rds-global-bundle.pem');
    expect(dockerfile).toContain(
      'https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem',
    );
    expect(dockerfile).toContain('update-ca-certificates');
    expect(dockerfile).toMatch(/sha256sum\s+-c/);
    expect(dockerfile).not.toContain('rejectUnauthorized=false');

    const fixtureDir = mkdtempSync(join(tmpdir(), 'evseye-rds-tls-'));
    const caKey = join(fixtureDir, 'ca.key');
    const caCert = join(fixtureDir, 'ca.crt');
    const serverKey = join(fixtureDir, 'server.key');
    const serverCsr = join(fixtureDir, 'server.csr');
    const serverCert = join(fixtureDir, 'server.crt');
    const serverExtensions = join(fixtureDir, 'server.ext');

    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-keyout',
          caKey,
          '-out',
          caCert,
          '-subj',
          '/CN=EVsEye test RDS CA',
          '-addext',
          'basicConstraints=critical,CA:TRUE,pathlen:1',
          '-addext',
          'keyUsage=critical,keyCertSign,cRLSign',
        ],
        { stdio: 'ignore' },
      );
      execFileSync(
        'openssl',
        [
          'req',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          serverKey,
          '-out',
          serverCsr,
          '-subj',
          '/CN=localhost',
        ],
        { stdio: 'ignore' },
      );
      writeFileSync(
        serverExtensions,
        [
          'subjectAltName=DNS:localhost',
          'basicConstraints=critical,CA:FALSE',
          'keyUsage=critical,digitalSignature,keyEncipherment',
          'extendedKeyUsage=serverAuth',
        ].join('\n'),
      );
      execFileSync(
        'openssl',
        [
          'x509',
          '-req',
          '-in',
          serverCsr,
          '-CA',
          caCert,
          '-CAkey',
          caKey,
          '-CAcreateserial',
          '-out',
          serverCert,
          '-days',
          '1',
          '-sha256',
          '-extfile',
          serverExtensions,
        ],
        { stdio: 'ignore' },
      );

      const server = createServer({
        key: readFileSync(serverKey),
        cert: readFileSync(serverCert),
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );

      try {
        const address = server.address();
        expect(address).not.toBeNull();
        if (!address || typeof address === 'string')
          throw new Error('TLS fixture did not bind a TCP port.');

        const client = spawn(
          process.execPath,
          [
            '-e',
            `const tls = require('node:tls');
const socket = tls.connect({ host: 'localhost', port: ${address.port}, servername: 'localhost', rejectUnauthorized: true }, () => {
  if (!socket.authorized) process.exit(2);
  socket.end();
});
socket.on('error', (error) => { console.error(error.code || error.message); process.exit(1); });`,
          ],
          {
            env: { ...process.env, NODE_EXTRA_CA_CERTS: caCert },
          },
        );
        let stderr = '';
        client.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        const status = await new Promise<number>((resolve, reject) => {
          client.once('error', reject);
          client.once('close', (code) => resolve(code ?? -1));
        });

        expect(status, stderr).toBe(0);
      } finally {
        server.close();
      }
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
