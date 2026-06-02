#!/bin/bash
# SHAD kiosk launcher

PREF="$HOME/.config/chromium/Default/Preferences"

# After a hard power-off chromium thinks it "crashed" and shows a
# "Restore pages? / didn't shut down correctly" bubble that nobody clicks away.
# Mark the previous session as clean BEFORE launching so the bubble never appears.
if [ -f "$PREF" ]; then
  python3 - "$PREF" <<'PY' 2>/dev/null
import json,sys
p=sys.argv[1]
try:
    d=json.load(open(p))
    d.setdefault("profile",{})["exit_type"]="Normal"
    d["profile"]["exited_cleanly"]=True
    json.dump(d,open(p,"w"))
except Exception:
    pass
PY
fi

# Start chromium kiosk
chromium-browser \
  --start-fullscreen \
  --no-first-run \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --no-restore-session-state \
  --noerrdialogs \
  --no-default-browser-check \
  --enable-features=UseOzonePlatform,VaapiVideoDecoder,WebContentsForceDark \
  --ozone-platform=wayland \
  --enable-wayland-ime \
  --ignore-gpu-blacklist \
  http://your-dashboard-address &

# Wait for chromium to be fully loaded, then refresh once (legacy workaround)
sleep 30
wtype -k 1
