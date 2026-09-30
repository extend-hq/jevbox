FROM authzed/spicedb:v1.48.0 AS upstream
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=upstream /usr/local/bin/spicedb /usr/local/bin/spicedb
COPY infra/render/start-spicedb.sh /usr/local/bin/start-spicedb
USER 65532:65532
EXPOSE 8443
CMD ["/bin/sh", "/usr/local/bin/start-spicedb"]
