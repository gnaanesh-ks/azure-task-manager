# Azure Task Manager — Full Stack Reference Project

A team task-board application built to demonstrate a realistic Azure-native
delivery pipeline: React frontend, two Node/Express microservices (Auth,
Task), Postgres persistence, containers on Azure Container Registry (ACR),
deployment to AKS via Helm, GitOps delivery with Argo CD triggered by Azure
Pipelines, and observability with Prometheus / Grafana / Alertmanager.

This is an Azure port of an AWS reference project. The application code
(frontend + both Node services) is cloud-agnostic and unchanged; only the
infrastructure, Helm values, ingress, secrets story, and CI pipeline were
adapted for Azure + Azure DevOps.

```
azure-task-manager/
├── README.md                     <- this file (architecture, schema, plan)
├── azure-pipelines.yml            <- Azure DevOps pipeline (build/push/tag-bump)
├── frontend/                     <- React SPA (login, register, board)
├── backend/
│   ├── auth-service/              <- Express + JWT + Postgres (users)
│   └── task-service/              <- Express + JWT verify + Postgres (tasks)
├── db/schema.sql                  <- Postgres schema for both services
├── helm/task-manager/             <- Helm chart deployed to AKS
├── argocd/application.yaml        <- Argo CD Application (GitOps entrypoint)
├── monitoring/                    <- Prometheus/Grafana/Alertmanager config
└── scripts/build-push.sh          <- Docker build + ACR push helper
```

---

## 1. Architecture Overview

```
                                   ┌─────────────────────────────┐
                                   │   Azure DNS / Ingress-NGINX  │
                                   │ (Ingress, TLS via cert-manager│
                                   │  + Let's Encrypt, or AGIC)   │
                                   └──────────────┬──────────────┘
                                                  │
                     ┌────────────────────────────┼────────────────────────────┐
                     │                            │                            │
             ┌───────▼───────┐           ┌────────▼────────┐          ┌────────▼────────┐
             │   Frontend     │  /api/auth│   Auth Service   │/api/task │  Task Service   │
             │  (React SPA,   │──────────▶│ (Express + JWT)  │◀────────▶│ (Express + JWT  │
             │  served via    │           │  Deployment x2   │  verify  │   verify)       │
             │  nginx pod)    │           └────────┬─────────┘          │  Deployment x2  │
             └────────────────┘                    │                    └────────┬────────┘
                                                    │                             │
                                                    ▼                             ▼
                                          ┌────────────────────────────────────────┐
                                          │  Azure Database for PostgreSQL Flexible │
                                          │   Server (or in-cluster StatefulSet     │
                                          │   for demo) — users | tasks |           │
                                          │   task_history tables                   │
                                          └────────────────────────────────────────┘

  Build/Deploy plane:
  Azure Repos (Git) ──push──▶ Azure Pipelines (build+test) ──docker build/push──▶ ACR
                                                                     │
                                                                     ▼
                                                         Argo CD watches Git repo
                                                         (helm values / image tags)
                                                                     │
                                                                     ▼
                                                              Azure Kubernetes Service (AKS)
                                                       (namespaces: app, monitoring)

  Observability plane (in-cluster):
  kube-prometheus-stack → Prometheus scrapes /metrics from auth-svc, task-svc, nginx
                         → Grafana dashboards
                         → Alertmanager → Slack/Email/PagerDuty
                         (Optionally also mirror key metrics into Azure Monitor /
                          Managed Prometheus if you want Azure-native dashboards too.)
```

**Key design decisions**

- **Two independent services** (Auth, Task) so they can scale, deploy, and fail
  independently. Task Service never sees passwords — it only verifies JWTs
  issued by Auth Service (shared `JWT_SECRET` via a K8s Secret, or JWKS if you
  later split further).
- **Stateless services** — all state lives in Postgres, so pods can be
  scaled horizontally and rolled without session loss.
- **Azure Database for PostgreSQL Flexible Server in production**; the Helm
  chart also ships a `postgresql` StatefulSet for local/dev clusters (toggle
  via `values.yaml`).
- **GitOps**: Argo CD is the only thing that talks to the AKS API server for
  application changes — Azure Pipelines never runs `kubectl apply`, it only
  builds/pushes images to ACR and bumps the image tag in Git (or an
  image-updater watches ACR).

---

## 2. Frontend + Backend Components

### Frontend (`/frontend`)
- React (Vite) SPA, 3 views: `Login`, `Register`, `Board`.
- `src/api/client.js` centralizes calls to two base URLs:
  - `VITE_AUTH_API_URL` → `/api/auth/*` (register, login, refresh, me)
  - `VITE_TASK_API_URL` → `/api/tasks/*` (CRUD + board state)
- JWT stored in memory + httpOnly-cookie fallback pattern (see code); Board
  view renders columns **To Do / In Progress / Done**, drag-drop reorder
  calls `PATCH /tasks/:id`.
- Built into a static bundle, served by an nginx container in-cluster.

### Auth Service (`/backend/auth-service`)
- `POST /api/auth/register` — creates user (bcrypt password hash).
- `POST /api/auth/login` — verifies credentials, issues short-lived JWT
  (access, 15m) + refresh token (7d, stored hashed in DB).
- `POST /api/auth/refresh`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `GET /metrics` — Prometheus client metrics (request count/latency).
- `GET /healthz`, `GET /readyz` — liveness/readiness probes.

### Task Service (`/backend/task-service`)
- Middleware verifies the JWT (same secret/public key as Auth Service) —
  never talks to the users table directly.
- `GET /api/tasks` (filter by team/board), `POST /api/tasks`,
  `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`, `GET /api/tasks/:id/history`.
- `GET /metrics`, `/healthz`, `/readyz`.

None of the above changed from the AWS version — these services have no
cloud-provider SDK calls, so nothing here is Azure- or AWS-specific.

---

## 3. Database Schema & API Flow

See [`db/schema.sql`](db/schema.sql) for the full DDL (unchanged). Summary:

```
users
├── id            uuid PK
├── email         citext unique
├── password_hash text
├── display_name  text
├── created_at    timestamptz
└── refresh_tokens (1:N) — hashed token, expires_at, revoked

teams
├── id            uuid PK
├── name          text
└── owner_id      uuid FK -> users.id

team_members (join table: team_id, user_id, role)

tasks
├── id            uuid PK
├── team_id       uuid FK -> teams.id
├── title         text
├── description   text
├── status        enum('todo','in_progress','done')
├── assignee_id   uuid FK -> users.id (nullable)
├── due_date      date
├── created_at / updated_at timestamptz
└── position      int   (ordering within a column)

task_history
├── id            uuid PK
├── task_id       uuid FK -> tasks.id
├── change        jsonb   (what changed)
└── changed_at    timestamptz
```

**Typical API flow (login → view board → create task)**

1. `POST /api/auth/register` → Auth Service hashes password, inserts into
   `users`, returns 201.
2. `POST /api/auth/login` → Auth Service validates, returns
   `{ accessToken, refreshToken, user }`. Frontend stores `accessToken` in
   memory and sets it as `Authorization: Bearer` on future calls.
3. `GET /api/tasks?team_id=...` (Task Service) → middleware verifies JWT
   signature/expiry → queries Postgres → returns tasks grouped by status.
4. `POST /api/tasks` → Task Service validates payload, inserts into `tasks`,
   writes a `task_history` row, returns the new task; frontend appends it to
   the board state.
5. Access token expiry → frontend calls `POST /api/auth/refresh` with the
   refresh token to mint a new access token transparently.

---

## 4. Docker / ACR Build Flow

Each service has its own multi-stage `Dockerfile` (unchanged). Build/push is
scripted in [`scripts/build-push.sh`](scripts/build-push.sh):

```bash
./scripts/build-push.sh <acr_name> <image_tag>
# e.g. ./scripts/build-push.sh taskmanageracr $(git rev-parse --short HEAD)
```

High-level flow:
1. `az acr login --name <acr_name>`
2. `docker build -t <repo>:<tag> ./frontend` (and same for both backends).
3. `docker tag` + `docker push` to each ACR repository
   (`task-manager/frontend`, `task-manager/auth-service`, `task-manager/task-service`).
4. **Azure Pipelines** ([`azure-pipelines.yml`](azure-pipelines.yml)) does this
   on every push to `main` using the `Docker@2` task and a Docker Registry
   service connection, then commits an updated image tag into
   `helm/task-manager/values.yaml` inside the **GitOps repo** (this repo, or
   a dedicated one), which Argo CD is already watching — so that commit is
   the actual deploy trigger, not the pipeline run itself.

You can also skip the local Docker build entirely and let ACR build in the
cloud (handy for lightweight CI agents):

```bash
az acr build --registry taskmanageracr --image task-manager/frontend:v1 ./frontend
```

---

## 5. Kubernetes / Helm

Chart at `helm/task-manager/`. One chart, one values file per environment
(`values-dev.yaml`, `values-prod.yaml` — create as needed). Renders:
- `Deployment` + `Service` for frontend, auth-service, task-service
- `HorizontalPodAutoscaler` for both backend services
- `Ingress` (ingress-nginx annotations by default) routing:
  - `/` → frontend
  - `/api/auth` → auth-service
  - `/api/tasks` → task-service
  - TLS via `cert-manager` + a `ClusterIssuer` (Let's Encrypt). If you'd
    rather use the **Azure Application Gateway Ingress Controller (AGIC)**
    instead of ingress-nginx, swap `ingress.className` to
    `azure-application-gateway` and the annotations as noted in
    `values.yaml` — everything else in the chart stays the same.
- `Secret` (auth DB creds, JWT secret) — in real deployments, prefer the
  **Azure Key Vault Provider for Secrets Store CSI Driver** (or the
  **External Secrets Operator** with its Azure Key Vault provider) pulling
  from Key Vault rather than raw K8s Secrets checked into Git.
- Optional in-cluster `postgresql` StatefulSet (`postgresql.enabled` in
  values, using the AKS default `managed-csi` storage class backed by Azure
  Disk) for dev; disable and point `DATABASE_URL` at Azure Database for
  PostgreSQL for prod.
- `ServiceMonitor` objects so Prometheus Operator auto-discovers `/metrics`
  (unchanged — this is plain Kubernetes/Prometheus, not cloud-specific).

---

## 6. Argo CD

`argocd/application.yaml` defines a single `Application` pointing at this
repo's `helm/task-manager` path (hosted in **Azure Repos** in this example)
with automated sync + self-heal + pruning. Argo CD itself is
cloud-agnostic — running it on AKS instead of EKS requires no changes to
how it works, only to what it's pointed at (Azure Repos instead of GitHub,
ACR image references instead of ECR).

In a real setup you'd typically split into an **App-of-Apps** (one root
Application that manages child Applications for `task-manager` and
`kube-prometheus-stack`), which is noted in the file's comments.

Because Argo CD needs to authenticate to Azure Repos, add the repo with a
Personal Access Token (PAT) or a Service Principal, e.g.:

```bash
argocd repo add https://dev.azure.com/your-org/task-manager/_git/task-manager-app \
  --username <any-value> --password <azure-devops-pat>
```

---

## 7. Monitoring & Alerting

- **kube-prometheus-stack** (Helm chart from prometheus-community) installed
  in a `monitoring` namespace — bundles Prometheus Operator, Grafana,
  Alertmanager, node-exporter, kube-state-metrics. This is plain
  Kubernetes tooling and needed **no changes** for AKS.
- `helm/task-manager/templates/servicemonitor.yaml` — scrape config for
  auth-service and task-service `/metrics` endpoints (via `prom-client` in
  Node).
- `monitoring/alertmanager-config.yaml` — routes: critical alerts → Slack
  webhook + PagerDuty, warnings → Slack only.
- `monitoring/prometheus-rules.yaml` — example `PrometheusRule` CRs:
  high error rate, high p95 latency, pod crash-looping, DB connection pool
  exhaustion.
- Grafana dashboard JSON can be provisioned via a `ConfigMap` labeled
  `grafana_dashboard: "1"` (see comment in the values file for the pattern).
- Optional: if you also want Azure-native visibility, enable **Azure
  Monitor managed service for Prometheus** and/or **Container Insights** on
  the AKS cluster (`az aks update --enable-azure-monitor-metrics`) alongside
  kube-prometheus-stack; they can coexist.

---

## 8. Step-by-Step Implementation Plan

1. **Repo & tooling**: create your Azure DevOps project with two repos —
   `task-manager-app` (this code) and optionally `task-manager-gitops`
   (Helm values only, watched by Argo CD). Install `azure-cli`, `kubectl`,
   `helm`, `argocd` CLI locally.
2. **Azure foundations**: create a Resource Group, an AKS cluster, an ACR,
   and (optionally) an Azure Database for PostgreSQL Flexible Server
   instance. Register the ACR with AKS with `az aks update
   --attach-acr` so nodes can pull images without extra credentials.
3. **AKS cluster**: `az aks create ...` (see DEPLOYMENT.md for exact flags —
   managed node pool, OIDC issuer + workload identity enabled for
   Key Vault access). Install core add-ons: ingress-nginx (or AGIC),
   cert-manager, metrics-server (built in), cluster-autoscaler (`az aks
   update --enable-cluster-autoscaler`).
4. **Database**: apply `db/schema.sql` against Azure Database for
   PostgreSQL (or let the app run migrations on startup — see
   `backend/*/src/db.js`).
5. **Build & push images**: run `scripts/build-push.sh` to push v1 images of
   all three services to ACR.
6. **Install Argo CD**: `kubectl create namespace argocd && kubectl apply
   -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml`.
   Expose via port-forward or Ingress; log in; `argocd repo add` the Azure
   Repos GitOps repo (with a PAT).
7. **Deploy the app**: `kubectl apply -f argocd/application.yaml` (or via UI)
   → Argo CD syncs the Helm chart → pods come up in the `app` namespace →
   verify with `kubectl get pods -n app` and hitting the ingress URL.
8. **Install monitoring stack**: `helm install kube-prometheus-stack
   prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
   -f monitoring/kube-prometheus-values.yaml`, then apply the
   `ServiceMonitor` and `PrometheusRule` manifests from `monitoring/`.
9. **Wire alerting**: add Slack webhook / PagerDuty keys to
   `monitoring/alertmanager-config.yaml`, apply it as an `AlertmanagerConfig`
   or as the `alertmanager.yaml` secret depending on your Alertmanager
   install mode.
10. **Validate end-to-end**: register a user via the UI, create a team and
    tasks, confirm rows in Postgres, watch Grafana dashboards populate,
    trigger a synthetic failure (scale a deployment to 0) and confirm an
    Alertmanager notification fires.
11. **Harden for production**: move secrets to Azure Key Vault + the
    Secrets Store CSI Driver (or External Secrets Operator), confirm TLS is
    issued correctly by cert-manager (or configured on AGIC/App Gateway),
    add PodDisruptionBudgets, NetworkPolicies, and confirm the
    `azure-pipelines.yml` GitOps tag-bump flow works end to end on every
    merge to `main`.

---

### Notes / things intentionally simplified for a reference project
- JWT secret is a shared symmetric key for simplicity; in production prefer
  asymmetric signing (RS256) so Task Service only holds a public key.
- The in-cluster Postgres StatefulSet has no automated backups — use Azure
  Database for PostgreSQL Flexible Server (with automated backups/PITR) for
  anything beyond local dev.
- This port keeps ingress-nginx as the default Ingress controller because it
  behaves identically across clouds and keeps the chart portable; AGIC is
  offered as a documented alternative for teams standardizing on
  Azure-native networking.
