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

function composeServiceBlock(label, text, serviceName) {
  const pattern = new RegExp("^  " + serviceName + ":\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:|^networks:)", "m");
  const match = text.match(pattern);
  if (!match) {
    throw new Error(label + " must define service " + serviceName);
  }
  return match[1];
}

function assertServiceContains(label, serviceBlock, expected) {
  assertContains(label + " service", serviceBlock, expected);
}

function assertServiceNotContains(label, serviceBlock, unexpected) {
  assertNotContains(label + " service", serviceBlock, unexpected);
}

function assertOnlyServicePublishesHostPort(label, text, publishingService) {
  const servicesEnd = text.search(/^volumes:|^networks:/m);
  const servicesText = servicesEnd === -1 ? text : text.slice(0, servicesEnd);
  const serviceNames = [...servicesText.matchAll(/^  ([a-zA-Z0-9_-]+):$/gm)].map((match) => match[1]);
  for (const serviceName of serviceNames) {
    const serviceBlock = composeServiceBlock(label, text, serviceName);
    const hasPorts = /^    ports:\s*$/m.test(serviceBlock);
    if (serviceName === publishingService) {
      if (!hasPorts) {
        throw new Error(label + " service " + serviceName + " must publish the host-facing port");
      }
      continue;
    }
    if (hasPorts) {
      throw new Error(label + " service " + serviceName + " must not publish host-facing ports");
    }
  }
}

const serverDockerfile = read("Dockerfile");
const webDockerfile = read("Dockerfile.web");
const nginx = read("docker/nginx/pi-web.conf");
const serverEntry = read("src-tauri/src/bin/de-koi-server.rs");
const appState = read("src-tauri/src/state.rs");
const piImageGuard = read("scripts/pi-image-guard.mjs");
const piUpdateScript = read("scripts/pi-update.sh");
const piBareMetalPackageScript = read("scripts/pi-bare-metal-package.sh");
const piBareMetalUpdateScript = read("scripts/pi-bare-metal-update.sh");
const piDocs = read("docs/pi.md");
const piBareMetalDocs = read("docs/pi-bare-metal.md");
const vdsDocs = read("docs/vds.md");
const piBareMetalCaddy = read("deploy/pi/bare-metal/Caddyfile.example");
const updateService = read("deploy/pi/systemd/de-koi-pi-update.service");
const updateTimer = read("deploy/pi/systemd/de-koi-pi-update.timer");
const readme = read("README.md");
assertContains("src-tauri/src/bin/de-koi-server.rs", serverEntry, "from_data_dir_with_resource_dir");
assertContains("src-tauri/src/bin/de-koi-server.rs", serverEntry, "AppState::server_resource_dir()");
assertContains("src-tauri/src/state.rs", appState, "DE_KOI_RESOURCE_DIR");
assertContains("src-tauri/src/state.rs", appState, "MARINARA_RESOURCE_DIR");
assertContains("src-tauri/src/state.rs", appState, "std::env::current_exe()");
assertContains("Dockerfile", serverDockerfile, "--no-default-features --features server");
assertContains("Dockerfile", serverDockerfile, "--mount=type=cache,target=/usr/local/cargo/registry");
assertContains("Dockerfile", serverDockerfile, "COPY AGENTS.md package.json");
assertContains("Dockerfile", serverDockerfile, "COPY src ./src");
assertContains("Dockerfile", serverDockerfile, "ENV DE_KOI_REPO_ROOT=/app");
assertNotContains("Dockerfile", serverDockerfile, "libwebkit2gtk");
assertNotContains("Dockerfile", serverDockerfile, "libgtk-3");
assertNotContains("Dockerfile", serverDockerfile, "libayatana-appindicator");
assertContains("Dockerfile.web", webDockerfile, "pnpm build");
assertContains("Dockerfile.web", webDockerfile, "COPY patches ./patches");
assertContains("Dockerfile.web", webDockerfile, "COPY docker/nginx/pi-web.conf /etc/nginx/conf.d/default.conf");
assertContains("Dockerfile.web", webDockerfile, "COPY --from=builder /app/dist /usr/share/nginx/html");
assertContains("docker/nginx/pi-web.conf", nginx, "proxy_pass http://de-koi-server:8787/health;");
assertContains("docker/nginx/pi-web.conf", nginx, "proxy_pass http://de-koi-server:8787;");
assertContains("docker/nginx/pi-web.conf", nginx, "proxy_set_header Authorization $http_authorization;");
assertContains("docker/nginx/pi-web.conf", nginx, "try_files $uri $uri/ /index.html;");
assertContains("scripts/pi-update.sh", piUpdateScript, "--trusted-lan");
assertContains("scripts/pi-update.sh", piUpdateScript, 'set -- "$@" -f "$trusted_lan_file"');
assertContains("scripts/pi-update.sh", piUpdateScript, "DE_KOI_PI_EXTRA_COMPOSE_FILES");
assertContains(
  "scripts/pi-update.sh",
  piUpdateScript,
  "DE_KOI_PI_CHECK_CURRENT_ONLY=1 node scripts/pi-image-guard.mjs",
);
assertContains(
  "scripts/pi-update.sh",
  piUpdateScript,
  "DE_KOI_PI_ALLOW_MISSING_IMAGES=1 node scripts/pi-image-guard.mjs",
);
assertBefore(
  "scripts/pi-update.sh",
  piUpdateScript,
  "DE_KOI_PI_CHECK_CURRENT_ONLY=1 node scripts/pi-image-guard.mjs",
  'docker compose "$@" pull',
);
assertBefore(
  "scripts/pi-update.sh",
  piUpdateScript,
  "DE_KOI_PI_ALLOW_MISSING_IMAGES=1 node scripts/pi-image-guard.mjs",
  'docker compose "$@" pull',
);
assertContains("scripts/pi-update.sh", piUpdateScript, 'docker compose "$@" pull');
assertContains("scripts/pi-update.sh", piUpdateScript, "node scripts/pi-image-guard.mjs");
assertContains("scripts/pi-update.sh", piUpdateScript, 'docker compose "$@" up -d');
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "bin/de-koi-server");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "$web_dir/index.html");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "$package_root/app");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "src-tauri");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "#!/usr/bin/env bash");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "required_package_paths");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "require_manifest_path");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, 'git archive --format=tar HEAD -- "${snapshot_entries[@]}"');
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "tar-members.txt");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "Package manifest does not match final tarball members.");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "PACKAGE-MANIFEST.txt");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "package_schema=1");
assertContains("scripts/pi-bare-metal-package.sh", piBareMetalPackageScript, "package_root=%s");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "DE_KOI_PUBLIC_ORIGIN");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "#!/usr/bin/env bash");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "--refresh-env");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "--validate-only");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "top_level_count");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "listing_file");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "tar -xOzf");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "required_manifest_entries");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "Package manifest does not match archive members.");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "extracted_top_levels");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "Extracted package root contract mismatch.");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "Package root contract mismatch.");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "PACKAGE-MANIFEST.txt");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "DE_KOI_MANAGED_PUBLIC_ORIGIN");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "Run again with --refresh-env to backfill the managed origin contract");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "set_env_value");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "DE_KOI_RESOURCE_DIR=$install_root/current/app/src-tauri");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "preserving secrets");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "ExecStart=$install_root/current/bin/de-koi-server");
assertContains("scripts/pi-bare-metal-update.sh", piBareMetalUpdateScript, "ReadWritePaths=$data_dir");
assertContains("scripts/pi-image-guard.mjs", piImageGuard, "same cooked batch");
assertContains("scripts/pi-image-guard.mjs", piImageGuard, "Refusing to deploy older Pi images");
assertContains("scripts/pi-image-guard.mjs", piImageGuard, "DE_KOI_PI_ALLOW_REVISION");
assertContains("scripts/pi-image-guard.mjs", piImageGuard, "org.opencontainers.image.revision");
assertNotContains("scripts/pi-image-guard.mjs", piImageGuard, "rev-parse", "origin/main");
assertContains("docs/pi.md", piDocs, "newest successful cooked batch");
assertContains("docs/pi.md", piDocs, "DE_KOI_PI_EXTRA_COMPOSE_FILES");
assertContains("docs/pi.md", piDocs, "does not repair mixed running containers");
assertContains("docs/pi.md", piDocs, "/etc/de-koi/pi-update.env");
assertContains("docs/pi.md", piDocs, "ChatGPT Through Local Codex Login");
assertContains("docs/pi.md", piDocs, "codex login");
assertContains("docs/pi.md", piDocs, "CODEX_HOME: /root/.codex");
assertContains("docs/pi.md", piDocs, "/home/chai/.codex:/root/.codex");
assertContains("docs/pi.md", piDocs, "Test Connection");
assertContains("docs/pi.md", piDocs, "Fetch ChatGPT Models");
assertContains("docs/pi.md", piDocs, "Send Test Message");
assertContains("docs/pi.md", piDocs, "sh scripts/pi-update.sh --trusted-lan");
assertContains("docs/pi.md", piDocs, "Do not run `cargo build`, `pnpm build`, or");
assertContains("docs/pi.md", piDocs, "bare-metal Pi guide");
assertContains(
  "docs/pi.md",
  piDocs,
  "docker compose -f docker-compose.pi.yml -f docker-compose.pi.trusted-lan.yml pull",
);
assertContains("docs/pi-bare-metal.md", piBareMetalDocs, "De-Koi-PreAlpha-pi-bare-metal-arm64");
assertContains("docs/pi-bare-metal.md", piBareMetalDocs, "asset=De-Koi-PreAlpha-pi-bare-metal-arm64-v<version>-<sha>.tar.gz");
assertContains("docs/pi-bare-metal.md", piBareMetalDocs, "DE_KOI_PUBLIC_ORIGIN");
assertContains("docs/pi-bare-metal.md", piBareMetalDocs, "--refresh-env");
assertContains("docs/pi-bare-metal.md", piBareMetalDocs, "--validate-only");
assertContains("docs/pi-bare-metal.md", piBareMetalDocs, "provide the same `DE_KOI_PUBLIC_ORIGIN`");
assertContains("docs/pi-bare-metal.md", piBareMetalDocs, "/opt/de-koi/current/web");
assertContains("docs/pi-bare-metal.md", piBareMetalDocs, "127.0.0.1:8787");
assertContains("deploy/pi/bare-metal/Caddyfile.example", piBareMetalCaddy, "root * /opt/de-koi/current/web");
assertContains("deploy/pi/bare-metal/Caddyfile.example", piBareMetalCaddy, "reverse_proxy 127.0.0.1:8787");
assertContains("deploy/pi/bare-metal/Caddyfile.example", piBareMetalCaddy, "header_up Authorization");
assertContains(
  "deploy/pi/systemd/de-koi-pi-update.service",
  updateService,
  "EnvironmentFile=-/etc/de-koi/pi-update.env",
);
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
const vdsCompose = read("docker-compose.vds.yml");
assertContains("docker-compose.pi.yml", compose, "ghcr.io/the-koi-pond/de-koi-server:prealpha");
assertContains("docker-compose.pi.yml", compose, "ghcr.io/the-koi-pond/de-koi-web:prealpha");
assertContains("docker-compose.pi.yml", compose, "DE_KOI_REPO_ROOT: /app");
assertContains("docker-compose.pi.yml", compose, '"7860:80"');
assertNotContains("docker-compose.pi.yml", compose, '"8787:8787"');
assertNotMatch("docker-compose.pi.yml", compose, /ADMIN_SECRET:\s*["'][^$]/);
assertNotContains("docker-compose.pi.yml", compose, 'ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true"');
assertNotContains("docker-compose.pi.yml", compose, 'BYPASS_AUTH_DOCKER: "true"');
assertContains("docker-compose.pi.trusted-lan.yml", trustedLanCompose, 'ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true"');
assertContains("docker-compose.pi.trusted-lan.yml", trustedLanCompose, 'BYPASS_AUTH_DOCKER: "true"');
const vdsServer = composeServiceBlock("docker-compose.vds.yml", vdsCompose, "de-koi-server");
const vdsWeb = composeServiceBlock("docker-compose.vds.yml", vdsCompose, "de-koi-web");
assertOnlyServicePublishesHostPort("docker-compose.vds.yml", vdsCompose, "de-koi-web");
assertServiceContains("docker-compose.vds.yml de-koi-server", vdsServer, "ghcr.io/the-koi-pond/de-koi-server:prealpha");
assertServiceContains("docker-compose.vds.yml de-koi-server", vdsServer, "DE_KOI_SERVER_ADDR: 0.0.0.0:8787");
assertServiceContains("docker-compose.vds.yml de-koi-server", vdsServer, "DE_KOI_REPO_ROOT: /app");
assertServiceContains("docker-compose.vds.yml de-koi-server", vdsServer, "BASIC_AUTH_USER: ${BASIC_AUTH_USER:-}");
assertServiceContains("docker-compose.vds.yml de-koi-server", vdsServer, "BASIC_AUTH_PASS: ${BASIC_AUTH_PASS:-}");
assertServiceContains("docker-compose.vds.yml de-koi-server", vdsServer, "IP_ALLOWLIST: ${IP_ALLOWLIST:-}");
assertServiceContains("docker-compose.vds.yml de-koi-server", vdsServer, "ADMIN_SECRET: ${ADMIN_SECRET:-}");
assertServiceContains("docker-compose.vds.yml de-koi-server", vdsServer, 'expose:\n      - "8787"');
assertServiceNotContains("docker-compose.vds.yml de-koi-server", vdsServer, "ports:");
assertServiceNotContains("docker-compose.vds.yml de-koi-server", vdsServer, "CLAUDE_CODE_OAUTH_TOKEN");
assertServiceNotContains(
  "docker-compose.vds.yml de-koi-server",
  vdsServer,
  'ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true"',
);
assertServiceNotContains("docker-compose.vds.yml de-koi-server", vdsServer, 'BYPASS_AUTH_DOCKER: "true"');
assertServiceContains("docker-compose.vds.yml de-koi-web", vdsWeb, "ghcr.io/the-koi-pond/de-koi-web:prealpha");
assertServiceContains(
  "docker-compose.vds.yml de-koi-web",
  vdsWeb,
  'ports:\n      - "${DE_KOI_WEB_BIND:-127.0.0.1:7860}:80"',
);
assertServiceNotContains("docker-compose.vds.yml de-koi-web", vdsWeb, "8787:8787");

assertContains("README.md", readme, "VDS / VPS Pre-Alpha Web Shell");
assertContains("README.md", readme, "docs/vds.md");
assertContains("README.md", readme, "docs/pi-bare-metal.md");
assertContains("docs/vds.md", vdsDocs, "linux/amd64");
assertContains("docs/vds.md", vdsDocs, "linux/arm64");
assertContains("docs/vds.md", vdsDocs, "docker compose -f docker-compose.vds.yml pull");
assertContains("docs/vds.md", vdsDocs, "http://127.0.0.1:7860/");
assertContains("docs/vds.md", vdsDocs, "Do not expose port `8787`");
assertContains("docs/vds.md", vdsDocs, "phone and PC");
assertContains("docs/vds.md", vdsDocs, "BASIC_AUTH_USER");
assertContains("docs/vds.md", vdsDocs, "IP_ALLOWLIST");

const workflow = read(".github/workflows/pi-container-images.yml");
const prealphaWorkflow = read(".github/workflows/prealpha-platform-builds.yml");
assertContains(".github/workflows/pi-container-images.yml", workflow, "packages: write");
assertContains(".github/workflows/pi-container-images.yml", workflow, "runs-on: ${{ matrix.runner }}");
assertContains(".github/workflows/pi-container-images.yml", workflow, "runner: ubuntu-24.04-arm");
assertContains(".github/workflows/pi-container-images.yml", workflow, "platform: linux/amd64");
assertContains(".github/workflows/pi-container-images.yml", workflow, "platform: linux/arm64");
assertContains(".github/workflows/pi-container-images.yml", workflow, "platforms: ${{ matrix.platform }}");
assertContains(
  ".github/workflows/pi-container-images.yml",
  workflow,
  "type=raw,value=sha-${{ steps.version.outputs.short_sha }}-${{ matrix.arch }}",
);
assertContains(
  ".github/workflows/pi-container-images.yml",
  workflow,
  "type=raw,value=v${{ steps.version.outputs.version }}-${{ steps.version.outputs.short_sha }}-${{ matrix.arch }}",
);
assertContains(
  ".github/workflows/pi-container-images.yml",
  workflow,
  "cache-from: type=gha,scope=pi-${{ matrix.name }}-${{ matrix.arch }}",
);
assertContains(
  ".github/workflows/pi-container-images.yml",
  workflow,
  "cache-to: type=gha,mode=max,scope=pi-${{ matrix.name }}-${{ matrix.arch }}",
);
assertContains(".github/workflows/pi-container-images.yml", workflow, "Build and push native platform image");
assertContains(".github/workflows/pi-container-images.yml", workflow, "id: build");
assertContains(".github/workflows/pi-container-images.yml", workflow, "Record pushed image digest");
assertContains(".github/workflows/pi-container-images.yml", workflow, "steps.build.outputs.digest");
assertContains(".github/workflows/pi-container-images.yml", workflow, "printf '%s@%s\\n'");
assertContains(".github/workflows/pi-container-images.yml", workflow, "Upload pushed image digest");
assertContains(".github/workflows/pi-container-images.yml", workflow, "actions/upload-artifact@v4");
assertContains(
  ".github/workflows/pi-container-images.yml",
  workflow,
  "name: image-digest-${{ matrix.name }}-${{ matrix.arch }}",
);
assertContains(".github/workflows/pi-container-images.yml", workflow, "Publish multi-arch manifests");
assertContains(".github/workflows/pi-container-images.yml", workflow, "Download pushed image digests");
assertContains(".github/workflows/pi-container-images.yml", workflow, "actions/download-artifact@v4");
assertContains(".github/workflows/pi-container-images.yml", workflow, "pattern: image-digest-*");
assertContains(".github/workflows/pi-container-images.yml", workflow, "Missing pushed digest artifact");
assertContains(
  ".github/workflows/pi-container-images.yml",
  workflow,
  'docker buildx imagetools inspect "${amd64_ref}"',
);
assertContains(
  ".github/workflows/pi-container-images.yml",
  workflow,
  'docker buildx imagetools inspect "${arm64_ref}"',
);
assertContains(".github/workflows/pi-container-images.yml", workflow, "Publish server and web multi-arch tags");
assertContains(".github/workflows/pi-container-images.yml", workflow, "ghcr.io/the-koi-pond/de-koi-server");
assertContains(".github/workflows/pi-container-images.yml", workflow, "ghcr.io/the-koi-pond/de-koi-web");
assertContains(".github/workflows/pi-container-images.yml", workflow, "cancel-in-progress: true");
assertContains(
  ".github/workflows/pi-container-images.yml",
  workflow,
  "Confirm this run is current main HEAD before building",
);
assertContains(".github/workflows/pi-container-images.yml", workflow, "Promote matched server and web images");
assertContains(".github/workflows/pi-container-images.yml", workflow, "needs: publish-manifests");
assertContains(".github/workflows/pi-container-images.yml", workflow, "docker buildx imagetools create");
assertNotContains(".github/workflows/pi-container-images.yml", workflow, "docker/setup-qemu-action@v3");
assertNotContains(".github/workflows/pi-container-images.yml", workflow, "platforms: linux/amd64,linux/arm64");
assertNotContains(".github/workflows/pi-container-images.yml", workflow, "${image}:sha-${short_sha}-amd64");
assertNotContains(".github/workflows/pi-container-images.yml", workflow, "${image}:sha-${short_sha}-arm64");
assertNotMatch(
  ".github/workflows/pi-container-images.yml",
  workflow,
  /Docker metadata[\s\S]*type=raw,value=prealpha[\s\S]*Build and push native platform image/,
);
assertNotMatch(".github/workflows/pi-container-images.yml", workflow, /type=raw,value=latest/);
assertContains(".github/workflows/prealpha-platform-builds.yml", prealphaWorkflow, "build-pi-bare-metal");
assertContains(".github/workflows/prealpha-platform-builds.yml", prealphaWorkflow, "ubuntu-24.04-arm");
assertContains(
  ".github/workflows/prealpha-platform-builds.yml",
  prealphaWorkflow,
  "cargo build --manifest-path src-tauri/Cargo.toml --release --bin de-koi-server --no-default-features --features server",
);
assertContains(".github/workflows/prealpha-platform-builds.yml", prealphaWorkflow, "scripts/pi-bare-metal-package.sh");
assertContains(".github/workflows/prealpha-platform-builds.yml", prealphaWorkflow, "bash scripts/pi-bare-metal-package.sh");
assertContains(".github/workflows/prealpha-platform-builds.yml", prealphaWorkflow, "De-Koi-PreAlpha-pi-bare-metal-arm64");
assertContains(".github/workflows/prealpha-platform-builds.yml", prealphaWorkflow, "gh release upload");

console.log("Pi distribution config looks valid.");
