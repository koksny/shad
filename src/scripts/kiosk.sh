#!/bin/bash

# Start chromium
chromium-browser \
  --start-fullscreen \
  --no-first-run \
  --disable-infobars \
  --noerrdialogs \
  --no-default-browser-check \
  --enable-features=UseOzonePlatform,VaapiVideoDecoder,WebContentsForceDark \
  --ozone-platform=wayland \
  --enable-wayland-ime \
  --ignore-gpu-blacklist \
  http://your-dashboard-address &

# Wait for chromium to be fully loaded
sleep 30

# Send F5 key with sudo
wtype -k 1
