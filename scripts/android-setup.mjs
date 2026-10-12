#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "src-tauri/gen/android";
const manifest = join(root, "app/src/main/AndroidManifest.xml");

function patchManifest() {
  let xml = readFileSync(manifest, "utf8");
  const perms = [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.ACCESS_WIFI_STATE",
    "android.permission.CHANGE_WIFI_MULTICAST_STATE",
  ];
  for (const p of perms) {
    if (!xml.includes(`"${p}"`)) {
      xml = xml.replace(/<application/, `<uses-permission android:name="${p}" />\n    <application`);
    }
  }
  writeFileSync(manifest, xml);
  console.log("patched", manifest);
}

function findMainActivity(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findMainActivity(p);
      if (found) return found;
    } else if (name === "MainActivity.kt") return p;
  }
  return null;
}

function patchActivity() {
  const file = findMainActivity(join(root, "app/src/main/java"));
  if (!file) throw new Error("MainActivity.kt not found – run `pnpm tauri android init` first");
  const src = readFileSync(file, "utf8");
  if (src.includes("MulticastLock")) return console.log("already patched", file);
  const lockField = `  private var multicastLock: WifiManager.MulticastLock? = null\n`;
  const acquire = `    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock = wifi.createMulticastLock("zcashflow-sync").apply {
      setReferenceCounted(true)
      acquire()
    }
`;
  const destroy = `
  override fun onDestroy() {
    multicastLock?.let { if (it.isHeld) it.release() }
    super.onDestroy()
  }
`;
  let out = src;
  const missing = ["android.content.Context", "android.net.wifi.WifiManager", "android.os.Bundle"].filter(
    (imp) => !out.includes(`import ${imp}`),
  );
  out = out.replace(/^package[^\n]*\n/m, (line) => `${line}\n${missing.map((i) => `import ${i}\n`).join("")}`);
  if (/override fun onCreate/.test(out)) {
    out = out.replace(/(class MainActivity\s*:\s*TauriActivity\(\)\s*\{\n)/, `$1${lockField}\n`);
    out = out.replace(/(super\.onCreate\(savedInstanceState\)\s*\n)/, `$1${acquire}`);
    out = out.replace(/\}\s*$/, `${destroy}}\n`);
  } else {
    out = out.replace(
      /class MainActivity\s*:\s*TauriActivity\(\)\s*(\{\s*\})?/,
      `class MainActivity : TauriActivity() {\n${lockField}\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n${acquire}  }\n${destroy}}`,
    );
  }
  writeFileSync(file, out);
  console.log("patched", file);
}

function patchSigning() {
  const gradle = join(root, "app/build.gradle.kts");
  if (!existsSync(join(root, "keystore.properties"))) return console.log("no keystore.properties, release stays unsigned");
  let src = readFileSync(gradle, "utf8");
  if (src.includes('signingConfigs.getByName("release")')) return console.log("already patched", gradle);
  const config = `    signingConfigs {
        create("release") {
            val props = Properties().apply {
                rootProject.file("keystore.properties").inputStream().use { load(it) }
            }
            keyAlias = props.getProperty("keyAlias")
            keyPassword = props.getProperty("password")
            storePassword = props.getProperty("password")
            storeFile = rootProject.file(props.getProperty("storeFile"))
        }
    }
    buildTypes {`;
  src = src.replace(/^    buildTypes \{/m, config);
  src = src.replace(/(getByName\("release"\) \{\n)/, `$1            signingConfig = signingConfigs.getByName("release")\n`);
  writeFileSync(gradle, src);
  console.log("patched", gradle);
}

patchManifest();
patchActivity();
patchSigning();
