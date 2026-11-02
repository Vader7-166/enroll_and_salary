# pg_dump must match the server major version (PostgreSQL 18); openssl encrypts the dump.
FROM postgres:18.3-alpine
RUN apk add --no-cache openssl
COPY deploy/backup/backup.sh /usr/local/bin/hrtp-backup
RUN chmod 0755 /usr/local/bin/hrtp-backup
ENTRYPOINT ["/usr/local/bin/hrtp-backup"]
