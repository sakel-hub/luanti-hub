# =============================================================================
# LuantiHub Real Luanti Sandbox Container (Mode B1 / Official Container Pattern)
# Based on https://docs.luanti.org/for-server-hosts/setup/containers/
# Runs upstream Luanti (with LuaJIT + minetest_game) inside a lightweight Alpine
# container with Xvfb + x11vnc + noVNC/websockify and an HTTP session agent.
# =============================================================================
FROM alpine:3.21

# Install official Luanti/Minetest engine + headless X11/OpenGL + VNC/WebSocket bridge + Node.js
RUN (apk add --no-cache luanti luanti-server || apk add --no-cache minetest minetest-server) && \
    apk add --no-cache \
    xvfb \
    mesa-dri-gallium \
    mesa-gl \
    x11vnc \
    novnc \
    websockify \
    xdotool \
    nodejs \
    unzip \
    curl \
    ca-certificates \
    git \
    procps

# Standard Luanti container paths (/etc/minetest & /var/lib/minetest/.minetest)
RUN mkdir -p /etc/minetest \
             /var/lib/minetest/.minetest/games \
             /var/lib/minetest/.minetest/mods \
             /var/lib/minetest/.minetest/textures \
             /var/lib/minetest/.minetest/worlds/sandbox/worldmods

# Pre-install minetest_game so mods depending on default, player_api, farming, wool, etc. work immediately
RUN git clone --depth 1 https://github.com/luanti-org/minetest_game.git \
    /var/lib/minetest/.minetest/games/minetest_game \
    && rm -rf /var/lib/minetest/.minetest/games/minetest_game/.git

WORKDIR /app
COPY ./container-agent /app/container-agent

ENV DISPLAY=:99
ENV HOME=/var/lib/minetest
ENV MINETEST_USER_PATH=/var/lib/minetest/.minetest
ENV PORT=8089

EXPOSE 8089 6080 30000/udp

CMD ["node", "/app/container-agent/server.mjs"]

