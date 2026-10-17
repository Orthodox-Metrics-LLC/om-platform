#!/usr/bin/env bash
# Desktop smoke test on Ubuntu; install xvfb and xauth on the test machine.
set -euo pipefail
test_data_dir=$(mktemp -d /tmp/om-desktop-smoke.XXXXXX)
xvfb-run -a env OM_DESKTOP_SMOKE=1 OM_DESKTOP_DATA_DIR="$test_data_dir" "${1:-/usr/bin/om-book-reader}" --ozone-platform=x11 --disable-gpu
