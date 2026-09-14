#!/usr/bin/env bash
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
K6_DIR="$ROOT_DIR/load-testing/k6"
ENV_FILE="$K6_DIR/.env"
TOKENS_FILE="$K6_DIR/tokens.txt"

has_real_tokens() {
  [ -f "$TOKENS_FILE" ] && grep -Eqv '^[[:space:]]*($|#|example-token-)' "$TOKENS_FILE"
}

save_local_token() {
  local token="$1"

  {
    echo "# Local session tokens. Do not commit this file."
    echo "# One token per line."
    printf '%s\n' "$token"
  } > "$TOKENS_FILE"

  chmod 600 "$TOKENS_FILE" || true
  echo "Saved token to $TOKENS_FILE"
}

prompt_for_token() {
  if [ "${FORCE_TOKEN_PROMPT:-false}" != "true" ] && has_real_tokens; then
    echo "Token file already has local tokens: $TOKENS_FILE"
    return
  fi

  if [ -n "${SESSION_TOKEN:-}" ]; then
    save_local_token "$SESSION_TOKEN"
    return
  fi

  if [ ! -t 0 ]; then
    echo "No interactive terminal detected. Skipping token prompt."
    return
  fi

  echo ""
  echo "Paste one session token for local runs."
  echo "Input is hidden. Press Enter without a token to skip."
  printf "SESSION_TOKEN: "

  local old_stty
  local input_token
  old_stty="$(stty -g)"
  stty -echo
  IFS= read -r input_token || input_token=""
  stty "$old_stty"
  echo ""

  if [ -n "$input_token" ]; then
    save_local_token "$input_token"
  else
    echo "Skipped token setup. You can add tokens later to $TOKENS_FILE"
  fi
}

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This bootstrap script is for macOS. Install k6 manually on this OS." >&2
  exit 1
fi

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Apple Command Line Tools are required."
  echo "A system installer window may open now. After it finishes, run this command again."
  xcode-select --install || true
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not installed. Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew was installed, but brew is not available in this shell."
  echo "Open a new terminal window and run this command again."
  exit 1
fi

if ! command -v k6 >/dev/null 2>&1; then
  echo "Installing k6..."
  brew install k6
else
  echo "k6 is already installed: $(k6 version)"
fi

if [ "${INSTALL_BROWSER:-false}" = "true" ]; then
  if [ ! -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    echo "Installing Google Chrome for k6 browser tests..."
    brew install --cask google-chrome
  else
    echo "Google Chrome is already installed."
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$K6_DIR/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE"
fi

if [ ! -f "$TOKENS_FILE" ]; then
  cp "$K6_DIR/tokens.example.txt" "$TOKENS_FILE"
  echo "Created $TOKENS_FILE"
fi

prompt_for_token

mkdir -p "$K6_DIR/results"

echo ""
echo "Bootstrap complete."
echo ""
echo "Next:"
echo "  Run a test, for example: make auth-1"
echo ""
echo "Useful checks:"
echo "  make check"
echo "  make help"
