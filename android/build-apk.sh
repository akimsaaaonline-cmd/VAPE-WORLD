#!/usr/bin/env bash
# VAPE WORLD — builds a signed, installable APK without Gradle.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
JAVA_HOME="${JAVA_HOME:-$HOME/jdk17}"
OUT="$HERE/build"
KEYSTORE="$HERE/vapeworld.keystore"
KS_PASS="vapeworld2026"
APK_NAME="VAPE-WORLD.apk"

rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/gen" "$OUT/dex"

echo "==> compiling resources"
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip"

echo "==> linking resources"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM" \
  --manifest "$HERE/AndroidManifest.xml" \
  -R "$OUT/res.zip" \
  --java "$OUT/gen" \
  --auto-add-overlay

echo "==> compiling java"
"$JAVA_HOME/bin/javac" -source 17 -target 17 -nowarn -encoding UTF-8 \
  -classpath "$PLATFORM" -d "$OUT/classes" \
  $(find "$HERE/java" "$OUT/gen" -name '*.java')

echo "==> dexing"
"$BT/d8" --release --lib "$PLATFORM" --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

echo "==> packaging"
cd "$OUT/dex" && zip -q -X "$OUT/base.apk" classes.dex && cd "$HERE"

if [ ! -f "$KEYSTORE" ]; then
  echo "==> creating signing key"
  "$JAVA_HOME/bin/keytool" -genkeypair -v -keystore "$KEYSTORE" \
    -alias vapeworld -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=VAPE WORLD, OU=Shop, O=VAPE WORLD, L=Peshawar, C=PK" >/dev/null 2>&1
fi

echo "==> aligning + signing"
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias vapeworld \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$OUT/$APK_NAME" "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs "$OUT/$APK_NAME" | head -4

rm -f "$OUT/aligned.apk" "$OUT/base.apk" "$OUT/res.zip"
echo "==> done: $OUT/$APK_NAME"
ls -lh "$OUT/$APK_NAME"
