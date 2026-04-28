#!/bin/bash
# ============================================================================
# Mac Mini Tutorial — Sketchfab Asset Downloader
# ============================================================================
# Downloads all 26 free 3D models from Sketchfab for the Mac Mini setup tutorial.
#
# USAGE:
#   1. Get your Sketchfab API token from: https://sketchfab.com/settings/password
#   2. Run:  SKETCHFAB_TOKEN="your-token-here" bash tools/download_mac_mini_assets.sh
#
# All models are downloaded as GLTF/GLB into public/models/mac_mini_tutorial/
# ============================================================================

set -euo pipefail

if [ -z "${SKETCHFAB_TOKEN:-}" ]; then
  echo "ERROR: SKETCHFAB_TOKEN not set."
  echo ""
  echo "Get your API token from: https://sketchfab.com/settings/password"
  echo "Then run:  SKETCHFAB_TOKEN=\"your-token\" bash tools/download_mac_mini_assets.sh"
  exit 1
fi

OUTDIR="$(cd "$(dirname "$0")/.." && pwd)/public/models/mac_mini_tutorial"
mkdir -p "$OUTDIR"

API="https://api.sketchfab.com/v3/models"
AUTH="Token ${SKETCHFAB_TOKEN}"

download_model() {
  local uid="$1"
  local name="$2"
  local outfile="${OUTDIR}/${name}"

  if [ -f "$outfile" ]; then
    echo "  [SKIP] ${name} already exists"
    return 0
  fi

  echo "  [GET]  ${name} (${uid})..."

  local resp
  resp=$(curl -s -H "Authorization: ${AUTH}" "${API}/${uid}/download" 2>/dev/null)

  local url
  url=$(echo "$resp" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    # prefer glb, fallback to gltf
    if 'glb' in d:
        print(d['glb']['url'])
    elif 'gltf' in d:
        print(d['gltf']['url'])
    else:
        print('')
except:
    print('')
" 2>/dev/null)

  if [ -z "$url" ]; then
    echo "  [FAIL] Could not get download URL for ${name}. Response:"
    echo "         $(echo "$resp" | head -c 200)"
    return 1
  fi

  curl -L -s -o "$outfile" "$url"
  local size
  size=$(ls -lh "$outfile" | awk '{print $5}')
  echo "  [OK]   ${name} (${size})"
}

echo "============================================"
echo " Mac Mini Tutorial — Asset Download"
echo " Target: ${OUTDIR}"
echo "============================================"
echo ""

TOTAL=0
FAIL=0

# ---------------------------------------------------------------------------
# CORE HARDWARE
# ---------------------------------------------------------------------------
echo "--- Core Hardware ---"
download_model "8f878c3ffad74cd5a6b7219a19a7e553" "mac_mini.glb" || ((FAIL++))
((TOTAL++))
download_model "c0f11a5cfc05448bbefa8c721e5fb0fd" "mac_mini_hq.glb" || ((FAIL++))
((TOTAL++))

# ---------------------------------------------------------------------------
# CABLES & CONNECTORS
# ---------------------------------------------------------------------------
echo ""
echo "--- Cables & Connectors ---"
download_model "39cb1374a9c24cfa815f8efe86a14f61" "usb_c_cable.glb" || ((FAIL++))
((TOTAL++))
download_model "dbd7f035428d474cb4f104dc7fa751b5" "hdmi_cable.glb" || ((FAIL++))
((TOTAL++))
download_model "649d86ad2c624aa0ab5b01f34d467aec" "displayport_cable.glb" || ((FAIL++))
((TOTAL++))
download_model "167ef9e9ef7c45e89b083e946885d194" "ethernet_cable.glb" || ((FAIL++))
((TOTAL++))
download_model "382afa58df434e8db16e97d75f9f2587" "usb_c_to_a.glb" || ((FAIL++))
((TOTAL++))
download_model "8fe1f5635eb64d28b2452690da6f7c85" "aux_cable.glb" || ((FAIL++))
((TOTAL++))

# ---------------------------------------------------------------------------
# PERIPHERALS & DISPLAYS
# ---------------------------------------------------------------------------
echo ""
echo "--- Peripherals & Displays ---"
download_model "119319e803164f0b8b911bbf904c33a4" "magic_keyboard.glb" || ((FAIL++))
((TOTAL++))
download_model "daeb7e227e7f4a77b39ac8a99f7a9e93" "magic_mouse.glb" || ((FAIL++))
((TOTAL++))
download_model "f56b9892c6b941168f64bc8323c98875" "studio_display.glb" || ((FAIL++))
((TOTAL++))
download_model "06fb18eec19245d4811c4c3c8c7ea567" "monitor_27inch.glb" || ((FAIL++))
((TOTAL++))
download_model "a6f024575e904a31b44b25a29d52e718" "airpods.glb" || ((FAIL++))
((TOTAL++))
download_model "acc6b4073d7640508ea03ccbaf199c13" "external_ssd.glb" || ((FAIL++))
((TOTAL++))
download_model "bbae9a8542e24ef5b1f0520c4e44478c" "external_hdd.glb" || ((FAIL++))
((TOTAL++))

# ---------------------------------------------------------------------------
# ENVIRONMENT & SCENE
# ---------------------------------------------------------------------------
echo ""
echo "--- Environment & Scene ---"
download_model "9262f311271c4c4390341e526d3fe103" "desk.glb" || ((FAIL++))
((TOTAL++))
download_model "2cd8b1fa627245e7bf319347c00c4cd7" "office_workspace.glb" || ((FAIL++))
((TOTAL++))
download_model "9dc7bcf0a6d448bd8487e613e5bb455e" "power_strip.glb" || ((FAIL++))
((TOTAL++))
download_model "0f64029b0d594e07b4a70871a6a9c5a3" "wall_outlet.glb" || ((FAIL++))
((TOTAL++))
download_model "3fb6ece87b21462585173c69cb7421a9" "wifi_router.glb" || ((FAIL++))
((TOTAL++))
download_model "fb9958f7f2c74095a25589837e62aa9d" "cardboard_box.glb" || ((FAIL++))
((TOTAL++))
download_model "48b1d0bfec8149f3a341573f7dd47d80" "product_box.glb" || ((FAIL++))
((TOTAL++))

# ---------------------------------------------------------------------------
# INNOVATIVE ASSETS (Rigged Hands, USB Ports)
# ---------------------------------------------------------------------------
echo ""
echo "--- Innovative Assets ---"
download_model "6fa0664093b5489da73cfc6c2dd6e4f3" "rigged_hand.glb" || ((FAIL++))
((TOTAL++))
download_model "86f37207468b427ead21e2eef820c06c" "rigged_hand_xr.glb" || ((FAIL++))
((TOTAL++))
download_model "f881fba9b3ce4f66858911d48594027b" "usb_ports.glb" || ((FAIL++))
((TOTAL++))
download_model "86cb85ad0c87428b8b1a230911db2b2f" "earphones.glb" || ((FAIL++))
((TOTAL++))

echo ""
echo "============================================"
echo " Done: ${TOTAL} attempted, ${FAIL} failed"
echo " Files saved to: ${OUTDIR}"
echo "============================================"
echo ""
ls -lhS "$OUTDIR" 2>/dev/null || true
