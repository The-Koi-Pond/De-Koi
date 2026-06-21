import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assertContains(label, text, expected) {
  if (!text.includes(expected)) {
    throw new Error(`${label} must contain ${JSON.stringify(expected)}`);
  }
}

function assertNotContains(label, text, unexpected) {
  if (text.includes(unexpected)) {
    throw new Error(`${label} must not contain ${JSON.stringify(unexpected)}`);
  }
}

function assertNotMatch(label, text, pattern) {
  if (pattern.test(text)) {
    throw new Error(`${label} must not match ${pattern}`);
  }
}

function assertBefore(label, text, first, second) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
    throw new Error(`${label} must contain ${JSON.stringify(first)} before ${JSON.stringify(second)}`);
  }
}

const serverDockerfile = read("Dockerfile");
const webDockerfile = read("Dockerfile.web");
const nginx = read("docker/nginx/pi-web.conf");
const piImageGuard = read("scripts/pi-image-guard.mjs");
const piUpdateScript = read("scripts/pi-update.sh");
const piDocs = read("docs/pi.md");
const updateService = read("deploy/pi/systemd/de-koi-pi-update.service");
const updateTimer = read("deploy/pi/systemd/de-koi-pi-update.timer");
assertContains("Dockerfile", serverDockerfile, "--no-default-features --features server");
assertContains("Dockerfile", serverDockerfile, "--mount=type=cache,target=/usr/local/cargo/registry");
assertNotContains("Dockerfile", serverDockerfile, "libwebkit2gtk");
assertNotContains("Dockerfile", serverDockerfile, "libgtk-3");
assertNotContains("Dockerfile", serverDockerfile, "libayatana-appindicator");
assertContains("Dockerfile.web", webDockerfile, "pnpm build");
assertContains("Dockerfile.web", webDockerfile, "COPY patches ./patches");
assertContains("Dockerfile.web", webDockerfile, "COPY docker/nginx/pi-web.conf /etc/nginx/conf.d/default.conf");
assertContains("Dockerfile.web", webDockerfile, "COPY --from=builder /app/dist /usr/share/nginx/html");
assertContains("docker/nginx/pi-web.conf", nginx, "proxy_pass http://de-koi-server:8787/health;");
assertContains("docker/nginx/pi-web.conf", nginx, "proxy_pass http://de-koi-server:8787;");
assertContains("docker/nginx/pi-web.conf", nginx, "try_files $uri $uri/ /index.html;");
assertContains("scripts/pi-update.sh", piUpdateScript, "--trusted-lan");
assertContains("scripts/pi-update.sh", piUpdateScript, 'set -- "$@" -f "$trusted_lan_file"');
assertContains("scripts/pi-update.sh", piUpdateScript, "DE_KOI_PI_EXTRA_COMPOSE_FILES");
assertContains("scripts/pi-update.sh", piUpdateScript, "DE_KOI_PI_CHECK_CURRENT_ONLY=1 node scripts/pi-image-guard.mjs");
assertContains("scripts/pi-update.sh", piUpdateScript, "DE_KOI_PI_ALLOW_MISSING_IMAGES=1 node scripts/pi-image-guard.mjs");
assertBefore("scripts/pi-update.sh", piUpdateScript, "DE_KOI_PI_CHECK_CURRENT_ONLY=1 node scripts/pi-image-guard.mjs", 'docker compose "$@" pull');
assertBefore("scripts/pi-update.sh", piUpdateScript, "DE_KOI_PI_ALLOW_MISSING_IMAGES=1 node scripts/pi-image-guard.mjs", 'docker compose "$@" pull');
assertContains("scripts/pi-update.sh", piUpdateScript, 'docker compose "$@" pull');
assertContains("scripts/pi-update.sh", piUpdateScript, "node scripts/pi-image-guard.mjs");
assertContains("scripts/pi-update.sh", piUpdateScript, 'docker compose "$@" up -d');
assertContains("scripts/pi-image-guard.mjs", piImageGuard, "same cooked batch");
assertContains("scripts/pi-image-guard.mjs", piImageGuard, "Refusing to deploy older Pi images");
assertContains("scripts/pi-image-guard.mjs", piImageGuard, "DE_KOI_PI_ALLOW_REVISION");
assertContains("scripts/pi-image-guard.mjs", piImageGuard, "org.opencontainers.image.revision");
assertNotContains("scripts/pi-image-guard.mjs", piImageGuard, "rev-parse", "origin/main");
assertContains("docs/pi.md", piDocs, "newest successful cooked batch");
assertContains("docs/pi.md", piDocs, "DE_KOI_PI_EXTRA_COMPOSE_FILES");
assertContains("docs/pi.md", piDocs, "does not repair mixed running containers");
assertContains("docs/pi.md", piDocs, "/etc/de-koi/pi-update.env");
assertContains("docs/pi.md", piDocs, "sh scripts/pi-update.sh --trusted-lan");
assertContains("docs/pi.md", piDocs, "Do not run `cargo build`, `pnpm build`, or");
assertContains("docs/pi.md", piDocs, "docker compose -f docker-compose.pi.yml -f docker-compose.pi.trusted-lan.yml pull");
assertContains("deploy/pi/systemd/de-koi-pi-update.service", updateService, "EnvironmentFile=-/etc/de-koi/pi-update.env");
assertContains("deploy/pi/systemd/de-koi-pi-update.service", updateService, "StateDirectory=de-koi");
assertContains("deploy/pi/systemd/de-koi-pi-update.service", updateService, "flock %S/de-koi/pi-update.lock");
assertNotContains("deploy/pi/systemd/de-koi-pi-update.service", updateService, "flock -n");
assertNotContains("deploy/pi/systemd/de-koi-pi-update.service", updateService, "/tmp/de-koi-pi-update.lock");
assertNotContains("deploy/pi/systemd/de-koi-pi-update.service", updateService, "/run/de-koi/pi-update.lock");
assertNotContains("deploy/pi/systemd/de-koi-pi-update.service", updateService, "/var/lib/de-koi/pi-update.lock");
assertContains("deploy/pi/systemd/de-koi-pi-update.service", updateService, "sh scripts/pi-update.sh --trusted-lan");
assertContains("deploy/pi/systemd/de-koi-pi-update.timer", updateTimer, "OnUnitActiveSec=6h");
assertContains("deploy/pi/systemd/de-koi-pi-update.timer", updateTimer, "RandomizedDelaySec=30min");

const compose = read("docker-compose.pi.yml");
const trustedLanCompose = read("docker-compose.pi.trusted-lan.yml");
assertContains("docker-compose.pi.yml", compose, "ghcr.io/the-koi-pond/de-koi-server:prealpha");
assertContains("docker-compose.pi.yml", compose, "ghcr.io/the-koi-pond/de-koi-web:prealpha");
assertContains("docker-compose.pi.yml", compose, '"7860:80"');
assertNotContains("docker-compose.pi.yml", compose, '"8787:8787"');
assertNotMatch("docker-compose.pi.yml", compose, /ADMIN_SECRET:\s*["'][^$]/);
assertNotContains("docker-compose.pi.yml", compose, 'ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true"');
assertNotContains("docker-compose.pi.yml", compose, 'BYPASS_AUTH_DOCKER: "true"');
assertContains(
  "docker-compose.pi.trusted-lan.yml",
  trustedLanCompose,
  'ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true"',
);
assertContains("docker-compose.pi.trusted-lan.yml", trustedLanCompose, 'BYPASS_AUTH_DOCKER: "true"');

const workflow = read(".github/workflows/pi-container-images.yml");
assertContains(".github/workflows/pi-container-images.yml", workflow, "packages: write");
assertContains(".github/workflows/pi-container-images.yml", workflow, "platforms: linux/arm64");
assertContains(".github/workflows/pi-container-images.yml", workflow, "cache-from: type=gha,scope=pi-${{ matrix.name }}");
assertContains(".github/workflows/pi-container-images.yml", workflow, "cache-to: type=gha,mode=max,scope=pi-${{ matrix.name }}");
assertContains(".github/workflows/pi-container-images.yml", workflow, "ghcr.io/the-koi-pond/de-koi-server");
assertContains(".github/workflows/pi-container-images.yml", workflow, "ghcr.io/the-koi-pond/de-koi-web");
assertContains(".github/workflows/pi-container-images.yml", workflow, "cancel-in-progress: true");
assertContains(".github/workflows/pi-container-images.yml", workflow, "Confirm this run is current main HEAD before building");
assertContains(".github/workflows/pi-container-images.yml", workflow, "Promote matched server and web images");
assertContains(".github/workflows/pi-container-images.yml", workflow, "docker buildx imagetools create");
assertNotMatch(
  ".github/workflows/pi-container-images.yml",
  workflow,
  /Docker metadata[\s\S]*type=raw,value=prealpha[\s\S]*Build and push ARM64 image/,
);
assertContains(".github/workflows/pi-container-images.yml", workflow, "type=raw,value=sha-");
assertNotMatch(".github/workflows/pi-container-images.yml", workflow, /type=raw,value=latest/);

console.log("Pi container distribution config looks valid.");
