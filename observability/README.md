# Grafana Observability

This setup connects local k6 runs with Grafana on Render.

## Data Flow

```text
k6 on a laptop
  -> public gateway with bearer token
  -> private Prometheus for k6 metrics
  -> private Loki for run logs
  -> Grafana dashboard
```

Prometheus and Loki are private Render services. The only public ingest endpoint is
the gateway, and it requires `GRAFANA_PUSH_TOKEN`.

## Render

Create a Render Blueprint from `render.yaml`.

During the first sync, Render asks for:

```text
GF_SECURITY_ADMIN_PASSWORD
```

After deploy, open the gateway service in Render and copy its generated
`GATEWAY_TOKEN`. Put it locally into `load-testing/k6/.env`:

```bash
GRAFANA_GATEWAY_URL=https://your-gateway-url.onrender.com
GRAFANA_PUSH_TOKEN=paste_gateway_token_here
```

Do not commit `.env`.

## Run

```bash
make public-grafana 10
make auth-grafana 1
```

Each run gets a `TEST_ID`. Use it in the Grafana dashboard filter.
