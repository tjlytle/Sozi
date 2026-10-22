# The factory stage image. Build from the repo root:
#   docker build -t sozi-factory -f docker/factory/Dockerfile --build-context ghp=<gh-personas dir> .
FROM node:24-bookworm

# Tools the stage runner and the agents use, plus Electron's shared libraries.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git jq python3 curl xvfb ca-certificates \
      libasound2 libgbm1 libgtk-3-0 libnss3 libxss1 libatk-bridge2.0-0 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libcups2 \
      libpango-1.0-0 libcairo2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# gh is not in Debian's repo: install it from GitHub's apt repository.
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
         > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# The factory user, created before anything is written to /cache so no layer
# re-owns files. The uid must match the host user for bind-mounted files
# (docker build --build-arg FACTORY_UID=$(id -u)); the base image's node user
# holds 1000, so it goes.
ARG FACTORY_UID=1000
RUN userdel -r node \
    && useradd -m -u ${FACTORY_UID} -s /bin/bash factory \
    && mkdir -p /work /outbox /mirror /cache \
    && chown factory:factory /work /outbox /mirror /cache

# The agent harness CLIs, unpinned: a rebuild picks the newest.
RUN npm install -g @anthropic-ai/claude-code @openai/codex opencode-ai \
    && npm cache clean --force

# Chromium's system libraries (needs apt, so root), at the lockfile's version.
COPY --chown=factory:factory package.json package-lock.json /cache/
RUN npx --yes playwright@"$(node -p "require('/cache/package-lock.json').packages['node_modules/playwright'].version")" \
      install-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Dependency cache as factory: node_modules for the lockfile, and its hash.
USER factory
RUN cd /cache && npm ci --no-audit --no-fund \
    && sha256sum package-lock.json | cut -d' ' -f1 > lock-sha

# Playwright's Chromium at the pinned version (libraries are already in).
ENV PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright
RUN cd /cache && npx playwright install chromium

# The gh-personas plugin (build context "ghp"): hooks and skill, bin on PATH.
USER root
COPY --from=ghp / /opt/gh-personas
ENV PATH="/opt/gh-personas/bin:${PATH}"

# The runner and the harness adapters, executable; last, as it changes most.
COPY --chown=factory:factory --chmod=755 pipeline /pipeline

USER factory
WORKDIR /work
# The loop passes "/pipeline/stage.sh <issue> <stage>" as the command.
ENTRYPOINT ["bash"]
