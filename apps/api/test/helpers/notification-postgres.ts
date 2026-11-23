import { Client, defaults, types } from 'pg';

/**
 * Minimal SQL fixtures must use the same UTC timestamp convention as Prisma.
 * pg otherwise serializes/parses timestamp-without-time-zone using the host TZ.
 * This helper is test-only; it does not alter application driver configuration.
 */
export function notificationTestClient(connectionString: string): Client {
  defaults.parseInputDatesAsUTC = true;
  return new Client({
    connectionString,
    options: '-c timezone=UTC',
    types: {
      getTypeParser: (oid, format) =>
        oid === 1114 && format !== 'binary'
          ? (value: string) => new Date(value.replace(' ', 'T') + 'Z')
          : types.getTypeParser(oid, format),
    },
  });
}
