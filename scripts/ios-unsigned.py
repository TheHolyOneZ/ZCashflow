import glob
import re

KEYS = {
    "CODE_SIGNING_ALLOWED": "NO",
    "CODE_SIGNING_REQUIRED": "NO",
    "CODE_SIGN_IDENTITY": '""',
    "CODE_SIGN_STYLE": "Manual",
    "DEVELOPMENT_TEAM": '""',
    "PROVISIONING_PROFILE_SPECIFIER": '""',
}

for path in glob.glob("src-tauri/gen/apple/**/project.yml", recursive=True):
    lines = open(path).read().split("\n")
    out = []
    for line in lines:
        key = line.strip().split(":")[0]
        if key in KEYS:
            continue
        out.append(line)
        m = re.match(r"^(\s*)base:\s*$", line)
        if m:
            indent = m.group(1) + "  "
            out += [f"{indent}{k}: {v}" for k, v in KEYS.items()]
    open(path, "w").write("\n".join(out))
    print("patched", path)

for path in glob.glob("src-tauri/gen/apple/**/project.pbxproj", recursive=True):
    src = open(path).read()
    src = re.sub(r"\n\s*(" + "|".join(KEYS) + r")(\[[^\]]*\])? = [^;]*;", "", src)
    settings = "".join(f"\n\t\t\t\t{k} = {v};" for k, v in KEYS.items())
    src = src.replace("buildSettings = {", "buildSettings = {" + settings)
    open(path, "w").write(src)
    print("patched", path)
