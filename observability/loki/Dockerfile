FROM grafana/loki:latest

COPY observability/loki/loki-config.yml /etc/loki/local-config.yaml

CMD ["-config.file=/etc/loki/local-config.yaml", "-config.expand-env=true"]
