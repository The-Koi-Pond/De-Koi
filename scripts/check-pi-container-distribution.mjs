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

const webDockerfile = read("Dockerfile.web");
const nginx = read("docker/nginx/pi-web.conf");
const piUpdateScript = read("scripts/pi-update.sh");
const piDocs = read("docs/pi.md");
assertContains("Dockerfile.web", webDockerfile, "pnpm build");
assertContains("Dockerfile.web", webDockerfile, "COPY patches ./patches");
assertContains("Dockerfile.web", webDockerfile, "COPY docker/nginx/pi-web.conf /etc/nginx/conf.d/default.conf");
assertContains("Dockerfile.web", webDockerfile, "COPY --from=builder /app/dist /usr/share/nginx/html");
assertContains("docker/nginx/pi-web.conf", nginx, "proxy_pass http://de-koi-server:8787/health;");
assertContains("docker/nginx/pi-web.conf", nginx, "proxy_pass http://de-koi-server:8787;");
assertContains("docker/nginx/pi-web.conf", nginx, "try_files $uri $uri/ /index.html;");
assertContains("scripts/pi-update.sh", piUpdateScript, "--trusted-lan");
assertContains("scripts/pi-update.sh", piUpdateScript, 'set -- "$@" -f "$trusted_lan_file"');
assertContains("scripts/pi-update.sh", piUpdateScript, 'docker compose "$@" pull');
assertContains("scripts/pi-update.sh", piUpdateScript, 'docker compose "$@" up -d');
assertContains("docs/pi.md", piDocs, "sh scripts/pi-update.sh --trusted-lan");
assertContains("docs/pi.md", piDocs, "Do not run `cargo build`, `pnpm build`, or");
assertContains("docs/pi.md", piDocs, "docker compose -f docker-compose.pi.yml -f docker-compose.pi.trusted-lan.yml pull");

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
assertContains(".github/workflows/pi-container-images.yml", workflow, "ghcr.io/the-koi-pond/de-koi-server");
assertContains(".github/workflows/pi-container-images.yml", workflow, "ghcr.io/the-koi-pond/de-koi-web");
assertContains(".github/workflows/pi-container-images.yml", workflow, "type=raw,value=prealpha");
assertContains(".github/workflows/pi-container-images.yml", workflow, "type=raw,value=sha-");
assertNotMatch(".github/workflows/pi-container-images.yml", workflow, /type=raw,value=latest/);

console.log("Pi container distribution config looks valid.");
