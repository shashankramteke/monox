"""
One-command deploy of the MonoXAI dashboard to a free Hugging Face Space.

Usage:
    py deploy/deploy_hf.py --token hf_xxx            # first + every deploy
    py deploy/deploy_hf.py --token hf_xxx --skip-build

The token needs WRITE permission (create at https://huggingface.co/settings/tokens).
The Gemini key is read from dashboard/backend/.env (if present) and stored as a
private Space secret — it is never uploaded as a file.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEPLOY = ROOT / "deploy"
BACKEND = ROOT / "dashboard" / "backend"
FRONTEND = ROOT / "dashboard" / "frontend"
STAGING = DEPLOY / "_space_build"


def run(cmd, cwd=None):
    print(f"  $ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, check=True, shell=(os.name == "nt"))


def read_env_value(key):
    env_file = BACKEND / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(f"{key}=") and not line.startswith("#"):
            val = line.split("=", 1)[1].strip()
            return val or None
    return None


def read_gemini_key():
    return read_env_value("GEMINI_API_KEY")


# Secrets pushed to the Space if present in dashboard/backend/.env
SPACE_SECRET_KEYS = [
    "GEMINI_API_KEY", "RAZORPAY_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET", "INGEST_API_KEY",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default=os.getenv("HF_TOKEN"), help="HF write token (or set HF_TOKEN)")
    ap.add_argument("--space", default=None, help="Space id, e.g. username/monoxai (default: <you>/monoxai)")
    ap.add_argument("--skip-build", action="store_true", help="Reuse existing frontend build")
    args = ap.parse_args()

    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("Installing huggingface_hub ...")
        run([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub"])
        from huggingface_hub import HfApi

    token = (args.token or "").strip().strip('"').strip("'")
    if not token:
        # Fall back to the token saved by a previous interactive login
        try:
            from huggingface_hub import get_token
            token = (get_token() or "").strip()
        except Exception:
            token = ""
        if token:
            print("Using saved Hugging Face login.")
    if not token:
        sys.exit(
            "ERROR: no Hugging Face token. Easiest fix — log in once (token gets saved):\n"
            '    py -c "from huggingface_hub import login; login()"\n'
            "then re-run:  py deploy/deploy_hf.py\n"
            "(or pass it directly:  py deploy/deploy_hf.py --token hf_xxx)"
        )
    if token.startswith("hf_XXX"):
        sys.exit(
            "ERROR: you ran the example placeholder literally.\n"
            "Replace hf_XXXXXXXXXXXX with YOUR own token from https://huggingface.co/settings/tokens"
        )
    if not token.startswith("hf_"):
        sys.exit(
            "ERROR: that does not look like a Hugging Face token (should start with hf_).\n"
            "Create one at https://huggingface.co/settings/tokens and copy the WHOLE value."
        )

    api = HfApi(token=token)
    try:
        me = api.whoami()
    except Exception as e:
        sys.exit(
            "\nERROR: Hugging Face rejected the token (401 Unauthorized).\n"
            "Fix it like this:\n"
            "  1. Go to https://huggingface.co/settings/tokens\n"
            "  2. Click 'Create new token'\n"
            "  3. Choose token type 'Write' (NOT 'Read', NOT fine-grained)\n"
            "  4. Copy the full token (starts with hf_) and re-run:\n"
            "       py deploy/deploy_hf.py --token hf_XXXXXXXXXXXX\n"
            f"\nDetails: {type(e).__name__}: {e}"
        )
    user = me["name"]
    # Warn early if the token cannot write
    role = (me.get("auth", {}) or {}).get("accessToken", {}).get("role", "")
    if role and role != "write":
        sys.exit(
            f"\nERROR: this token has '{role}' permission but deploying needs 'write'.\n"
            "Create a new token at https://huggingface.co/settings/tokens with type 'Write' and re-run."
        )
    space_id = args.space or f"{user}/monoxai"
    print(f"\n== Deploying to https://huggingface.co/spaces/{space_id} (as {user}) ==\n")

    # 1. Build frontend
    if not args.skip_build:
        print("[1/4] Building React dashboard ...")
        run(["npm", "run", "build"], cwd=FRONTEND)
    else:
        print("[1/4] Skipping frontend build (--skip-build)")

    # 2. Assemble staging folder
    print("[2/4] Assembling Space files ...")
    if STAGING.exists():
        shutil.rmtree(STAGING)
    STAGING.mkdir(parents=True)
    shutil.copy(BACKEND / "main.py", STAGING / "main.py")
    shutil.copy(BACKEND / "requirements.txt", STAGING / "requirements.txt")
    shutil.copy(DEPLOY / "Dockerfile", STAGING / "Dockerfile")
    shutil.copy(DEPLOY / "SPACE_README.md", STAGING / "README.md")
    shutil.copytree(FRONTEND / "dist", STAGING / "static")

    # 3. Create Space + secret
    print("[3/4] Creating/updating Space ...")
    try:
        api.create_repo(repo_id=space_id, repo_type="space", space_sdk="docker", exist_ok=True)
    except Exception as e:
        sys.exit(
            f"\nERROR: could not create/access the Space '{space_id}'.\n"
            "Usual causes: the token is read-only, or the Space belongs to another account.\n"
            "Create a 'Write' token at https://huggingface.co/settings/tokens and re-run.\n"
            f"\nDetails: {type(e).__name__}: {e}"
        )
    any_secret = False
    for key in SPACE_SECRET_KEYS:
        val = read_env_value(key)
        if not val:
            continue
        any_secret = True
        try:
            api.add_space_secret(repo_id=space_id, key=key, value=val)
            print(f"      {key} set as private Space secret")
        except Exception as e:
            print(f"      WARNING: could not set {key} automatically ({type(e).__name__}).")
            print(f"      Set it manually: https://huggingface.co/spaces/{space_id}/settings -> Variables and secrets")
    if not any_secret:
        print("      No secrets found in dashboard/backend/.env (heuristic RCA fallback; simulated payments)")

    # 4. Upload
    print("[4/4] Uploading files ...")
    try:
        api.upload_folder(repo_id=space_id, repo_type="space", folder_path=str(STAGING),
                          commit_message="Deploy MonoXAI dashboard")
    except Exception as e:
        sys.exit(
            f"\nERROR: upload failed.\n"
            "If this mentions 401/403, recreate the token with type 'Write'. Otherwise re-run —\n"
            "transient network errors are common and the upload resumes safely.\n"
            f"\nDetails: {type(e).__name__}: {e}"
        )

    print(f"\nDone! The Space is building now (takes ~2-4 min):")
    print(f"   https://huggingface.co/spaces/{space_id}")


if __name__ == "__main__":
    main()
