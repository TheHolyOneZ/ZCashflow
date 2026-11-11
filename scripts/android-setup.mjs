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
    "android.permission.ACCESS_LOCAL_NETWORK",
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

function activitySource(pkg, edgeToEdge) {
  return `package ${pkg}

import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
${edgeToEdge ? "import androidx.activity.enableEdgeToEdge\n" : ""}
class MainActivity : TauriActivity() {
  private val localNetwork = "android.permission.ACCESS_LOCAL_NETWORK"
  private var multicastLock: WifiManager.MulticastLock? = null

  external fun setLocalNetworkPermission(granted: Boolean)

  private fun localNetworkAllowed(): Boolean =
    Build.VERSION.SDK_INT < 37 ||
      applicationInfo.targetSdkVersion < 37 ||
      checkSelfPermission(localNetwork) == PackageManager.PERMISSION_GRANTED

  private fun publishLocalNetwork() {
    val allowed = localNetworkAllowed()
    if (allowed && multicastLock == null) {
      val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      multicastLock = wifi.createMulticastLock("zcashflow-sync").apply {
        setReferenceCounted(true)
        acquire()
      }
    }
    setLocalNetworkPermission(allowed)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
${edgeToEdge ? "    enableEdgeToEdge()\n" : ""}    super.onCreate(savedInstanceState)
    publishLocalNetwork()
    if (!localNetworkAllowed()) requestPermissions(arrayOf(localNetwork), 4781)
  }

  override fun onResume() {
    super.onResume()
    publishLocalNetwork()
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    publishLocalNetwork()
  }

  override fun onDestroy() {
    multicastLock?.let { if (it.isHeld) it.release() }
    multicastLock = null
    super.onDestroy()
  }
}
`;
}

function patchActivity() {
  const file = findMainActivity(join(root, "app/src/main/java"));
  if (!file) throw new Error("MainActivity.kt not found – run `pnpm tauri android init` first");
  const src = readFileSync(file, "utf8");
  if (src.includes("setLocalNetworkPermission")) return console.log("already patched", file);
  const pkg = /^package\s+([\w.]+)\s*$/m.exec(src)?.[1];
  if (pkg !== "dev.zcashflow.app") {
    throw new Error(`MainActivity package is ${pkg}, but the Rust bridge expects dev.zcashflow.app`);
  }
  const unknown = [...src.matchAll(/override fun (\w+)/g)].map((m) => m[1]).filter((name) => !["onCreate", "onDestroy"].includes(name));
  if (unknown.length > 0) throw new Error(`MainActivity overrides ${unknown.join(", ")}; patch it by hand`);
  writeFileSync(file, activitySource(pkg, src.includes("enableEdgeToEdge")));
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
