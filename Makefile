.DEFAULT_GOAL := help

.PHONY: help start setup token init ui check ping public public-report public-10 public-50 public-100 public-300 auth auth-report auth-dashboard auth-status auth-debug auth-1 auth-5 auth-50 auth-100 route profile flight-once browser browser-dashboard grafana-check public-grafana auth-grafana dist dist-public dist-auth dist-flight k6-check k6-public k6-public-report k6-auth k6-auth-dashboard k6-auth-report k6-auth-status k6-custom-route-report k6-load-profile-report k6-flight-once k6-browser-flight-smoke k6-browser-flight-dashboard k6-grafana k6-distributed

K6_DIR := load-testing/k6
K6_SCENARIOS := $(K6_DIR)/scenarios
K6_RESULTS := $(K6_DIR)/results
K6_ENV := $(K6_DIR)/.env
TOKENS_FILE ?= $(K6_DIR)/tokens.txt
CUSTOM_ROUTE_FILE ?=
CUSTOM_LOAD_PROFILE_FILE ?=
REPORT_TS := $(shell date +%Y%m%d-%H%M%S)
TEST_ID ?= $(REPORT_TS)

BASE_URL ?= https://entreporgneur-big-journey-7b03.twc1.net
FRONTEND_URL ?= https://entreprorgneur-big-journey-2ebf.twc1.net
API_COOKIE_DOMAIN ?= entreporgneur-big-journey-7b03.twc1.net
VUS ?= 50
AUTH_VUS ?= 1
USERS ?=
COMMAND_LINE_USERS := $(shell printf '%s\n' $(MAKECMDGOALS) | awk '/^[0-9]+$$/ { print; exit }')
REQUESTED_USERS := $(or $(USERS),$(COMMAND_LINE_USERS))
RAMP_UP ?= 1m
HOLD ?= 3m
RAMP_DOWN ?= 30s
THINK_TIME_SECONDS ?= 1
FLIGHT_VUS ?= 1
FLIGHT_ITERATIONS ?= 1
ROUTE_ID ?= kazan-moscow
BROWSER_VUS ?= 1
BROWSER_ITERATIONS ?= 1
FLIGHT_OBSERVE_SECONDS ?= 20
K6_BROWSER_HEADLESS ?= false
OPEN_REPORT ?= true
UI_PORT ?= 8787
GRAFANA_GATEWAY_URL ?=
GRAFANA_PUSH_TOKEN ?=
MODE ?= auth
TOTAL_VUS ?= 100
MACHINE_TOTAL ?= 1
MACHINE_INDEX ?= 1

$(K6_ENV): ;

-include $(K6_ENV)

# Optional shortcut for local/private repositories.
# Paste one session token here if you accept the risk of storing it in Makefile:
MAKEFILE_SESSION_TOKEN ?=

# Or paste many tokens separated by commas:
MAKEFILE_SESSION_TOKENS ?=

SESSION_TOKEN_FOR_K6 := $(or $(SESSION_TOKEN),$(MAKEFILE_SESSION_TOKEN))
SESSION_TOKENS_FOR_K6 := $(or $(SESSION_TOKENS),$(MAKEFILE_SESSION_TOKENS))
PUBLIC_VUS_FOR_K6 := $(or $(REQUESTED_USERS),$(VUS))
AUTH_VUS_FOR_K6 := $(or $(REQUESTED_USERS),$(AUTH_VUS))
TOKENS_FILE_ABS := $(abspath $(TOKENS_FILE))
CUSTOM_ROUTE_FILE_ABS := $(abspath $(CUSTOM_ROUTE_FILE))
CUSTOM_LOAD_PROFILE_FILE_ABS := $(abspath $(CUSTOM_LOAD_PROFILE_FILE))

help:
	@echo "Short k6 commands:"
	@echo "  make start            Install dependencies and open local web UI"
	@echo "  make setup            Install k6/Node.js on macOS and prepare local files"
	@echo "  make token            Replace local session token safely"
	@echo "  make init             Prepare local .env and tokens.txt"
	@echo "  make ui               Open local web UI"
	@echo "  make check            Check k6 installation"
	@echo "  make ping             Check API host and /health response"
	@echo "  make public 200       Public read-only with 200 VUs, Russian report"
	@echo "  make auth 5           Auth read-only with 5 VUs"
	@echo "  make route USERS=5 CUSTOM_ROUTE_FILE=load-testing/routes/local/name.route.json"
	@echo "  make profile CUSTOM_LOAD_PROFILE_FILE=load-testing/load-profiles/local/name.load.json"
	@echo "  make public USERS=50  Public read-only with any VUs, Russian report"
	@echo "  make auth USERS=5     Auth read-only with any VUs"
	@echo "  make public-10        Public read-only, 10 VUs, Russian report"
	@echo "  make public-50        Public read-only, 50 VUs, Russian report"
	@echo "  make public-100       Public read-only, 100 VUs, Russian report"
	@echo "  make public-300       Public read-only, 300 VUs, Russian report"
	@echo "  make auth-1           Auth read-only, 1 VU, Russian report"
	@echo "  make auth-5           Auth read-only, 5 VUs, Russian report"
	@echo "  make auth-50          Auth read-only, 50 VUs, Russian report"
	@echo "  make auth-100         Auth read-only, 100 VUs, Russian report"
	@echo "  make auth-dashboard   Auth read-only with live dashboard"
	@echo "  make auth-status      One auth pass with endpoint statuses, no thresholds"
	@echo "  make auth-debug       Tiny auth run with failed endpoint statuses"
	@echo "  make flight-once      One guarded state-changing flight"
	@echo "  make browser          Mobile browser smoke flight"
	@echo "  make grafana-check    Check Grafana gateway settings"
	@echo "  make public-grafana USERS=50  Send public test metrics/logs to Grafana"
	@echo "  make auth-grafana USERS=5     Send auth test metrics/logs to Grafana"
	@echo "  make dist             Distributed run from load-testing/k6/.env"
	@echo "  make dist-public      Distributed public mode"
	@echo "  make dist-auth        Distributed auth mode"
	@echo "  make dist-flight      Distributed flight mode, state-changing"
	@echo ""
	@echo "Config:"
	@echo "  Save the local session token in the web UI or by running make token."
	@echo "  Override users inline: make public 50 or make public USERS=50"
	@echo "  Override timing inline: USERS=50 HOLD=1m make public"
	@echo "  Load-test commands create and open an HTML report by default."
	@echo "  Disable report auto-open: OPEN_REPORT=false make auth-1"

%:
	@if printf '%s\n' "$@" | grep -Eq '^[0-9]+$$'; then \
		:; \
	else \
		echo "Unknown target: $@"; \
		echo "Run make help"; \
		exit 2; \
	fi

start:
	@SKIP_TOKEN_PROMPT=true load-testing/k6/scripts/bootstrap-macos.sh
	@$(MAKE) --no-print-directory ui

setup:
	@load-testing/k6/scripts/bootstrap-macos.sh

token:
	@FORCE_TOKEN_PROMPT=true load-testing/k6/scripts/bootstrap-macos.sh

ui:
	@PORT="$(UI_PORT)" node ui/server.mjs

init:
	@test -f $(K6_ENV) || cp $(K6_DIR)/.env.example $(K6_ENV)
	@test -f $(TOKENS_FILE) || cp $(K6_DIR)/tokens.example.txt $(TOKENS_FILE)
	@mkdir -p $(K6_RESULTS)
	@echo "Prepared $(K6_ENV) and $(TOKENS_FILE)"

check: k6-check

k6-check:
	@k6 version

ping:
	@curl -sS -o /dev/null -w "HTTP %{http_code} | DNS/connect/TLS/start/total: %{time_namelookup}s / %{time_connect}s / %{time_appconnect}s / %{time_starttransfer}s / %{time_total}s\n" "$(BASE_URL)/health"

public: k6-public-report

public-report: k6-public-report

public-10:
	@$(MAKE) --no-print-directory k6-public-report VUS=10 RAMP_UP=10s HOLD=30s RAMP_DOWN=10s

public-50:
	@$(MAKE) --no-print-directory k6-public-report VUS=50 RAMP_UP=15s HOLD=30s RAMP_DOWN=10s

public-100:
	@$(MAKE) --no-print-directory k6-public-report VUS=100 RAMP_UP=30s HOLD=1m RAMP_DOWN=20s

public-300:
	@$(MAKE) --no-print-directory k6-public-report VUS=300 RAMP_UP=1m HOLD=2m RAMP_DOWN=30s

k6-public: k6-public-report

k6-public-report:
	@mkdir -p $(K6_RESULTS)
	@report="$(K6_RESULTS)/public-readonly-ru-$(REPORT_TS).html"; \
	RU_REPORT="$$report" k6 run \
		-e BASE_URL="$(BASE_URL)" \
		-e VUS="$(PUBLIC_VUS_FOR_K6)" \
		-e RAMP_UP="$(RAMP_UP)" \
		-e HOLD="$(HOLD)" \
		-e RAMP_DOWN="$(RAMP_DOWN)" \
		-e THINK_TIME_SECONDS="$(THINK_TIME_SECONDS)" \
		$(K6_SCENARIOS)/public-readonly.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

auth: k6-auth-report

auth-report: k6-auth-report

auth-dashboard: k6-auth-dashboard

auth-status: k6-auth-status

auth-debug:
	@$(MAKE) --no-print-directory k6-auth-report AUTH_VUS=1 RAMP_UP=1s HOLD=5s RAMP_DOWN=1s DEBUG_AUTH=true

auth-1:
	@$(MAKE) --no-print-directory k6-auth-report AUTH_VUS=1 RAMP_UP=10s HOLD=30s RAMP_DOWN=10s

auth-5:
	@$(MAKE) --no-print-directory k6-auth-report AUTH_VUS=5 RAMP_UP=15s HOLD=1m RAMP_DOWN=10s

auth-50:
	@$(MAKE) --no-print-directory k6-auth-report AUTH_VUS=50 RAMP_UP=30s HOLD=1m RAMP_DOWN=20s

auth-100:
	@$(MAKE) --no-print-directory k6-auth-report AUTH_VUS=100 RAMP_UP=1m HOLD=2m RAMP_DOWN=30s

k6-auth: k6-auth-report

k6-auth-dashboard:
	@[ -n "$(SESSION_TOKEN_FOR_K6)$(SESSION_TOKENS_FOR_K6)" ] || [ -f "$(TOKENS_FILE)" ] || (echo "Run make start or make token first"; exit 1)
	@mkdir -p $(K6_RESULTS)
	@report="$(K6_RESULTS)/auth-game-open-dashboard-ru-$(REPORT_TS).html"; \
	K6_WEB_DASHBOARD=true \
	K6_WEB_DASHBOARD_OPEN=true \
	RU_REPORT="$$report" \
	k6 run \
		-e BASE_URL="$(BASE_URL)" \
		-e SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
		-e SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
		-e TOKENS_FILE="$(TOKENS_FILE_ABS)" \
		-e AUTH_VUS="$(AUTH_VUS_FOR_K6)" \
		-e RAMP_UP="$(RAMP_UP)" \
		-e HOLD="$(HOLD)" \
		-e RAMP_DOWN="$(RAMP_DOWN)" \
		-e THINK_TIME_SECONDS="$(THINK_TIME_SECONDS)" \
		-e DEBUG_AUTH="$(DEBUG_AUTH)" \
		$(K6_SCENARIOS)/auth-game-open.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

k6-auth-report:
	@[ -n "$(SESSION_TOKEN_FOR_K6)$(SESSION_TOKENS_FOR_K6)" ] || [ -f "$(TOKENS_FILE)" ] || (echo "Run make start or make token first"; exit 1)
	@mkdir -p $(K6_RESULTS)
	@report="$(K6_RESULTS)/auth-game-open-ru-$(REPORT_TS).html"; \
	RU_REPORT="$$report" k6 run \
		-e BASE_URL="$(BASE_URL)" \
		-e SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
		-e SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
		-e TOKENS_FILE="$(TOKENS_FILE_ABS)" \
		-e AUTH_VUS="$(AUTH_VUS_FOR_K6)" \
		-e RAMP_UP="$(RAMP_UP)" \
		-e HOLD="$(HOLD)" \
		-e RAMP_DOWN="$(RAMP_DOWN)" \
		-e THINK_TIME_SECONDS="$(THINK_TIME_SECONDS)" \
		-e DEBUG_AUTH="$(DEBUG_AUTH)" \
		$(K6_SCENARIOS)/auth-game-open.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

k6-auth-status:
	@[ -n "$(SESSION_TOKEN_FOR_K6)$(SESSION_TOKENS_FOR_K6)" ] || [ -f "$(TOKENS_FILE)" ] || (echo "Run make start or make token first"; exit 1)
	@mkdir -p $(K6_RESULTS)
	@report="$(K6_RESULTS)/auth-status-ru-$(REPORT_TS).html"; \
	RU_REPORT="$$report" k6 run \
		-e BASE_URL="$(BASE_URL)" \
		-e SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
		-e SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
		-e TOKENS_FILE="$(TOKENS_FILE_ABS)" \
		$(K6_SCENARIOS)/auth-status.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

route: k6-custom-route-report

k6-custom-route-report:
	@test -n "$(CUSTOM_ROUTE_FILE)" || (echo "Select a saved route in the web UI or run CUSTOM_ROUTE_FILE=load-testing/routes/local/name.route.json make route 5"; exit 1)
	@mkdir -p $(K6_RESULTS)
	@report="$(K6_RESULTS)/custom-route-ru-$(REPORT_TS).html"; \
	RU_REPORT="$$report" k6 run \
		-e BASE_URL="$(BASE_URL)" \
		-e SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
		-e SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
		-e TOKENS_FILE="$(TOKENS_FILE_ABS)" \
		-e CUSTOM_ROUTE_FILE="$(CUSTOM_ROUTE_FILE_ABS)" \
		-e VUS="$(PUBLIC_VUS_FOR_K6)" \
		-e RAMP_UP="$(RAMP_UP)" \
		-e HOLD="$(HOLD)" \
		-e RAMP_DOWN="$(RAMP_DOWN)" \
		-e THINK_TIME_SECONDS="$(THINK_TIME_SECONDS)" \
		$(K6_SCENARIOS)/custom-route.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

profile: k6-load-profile-report

k6-load-profile-report:
	@test -n "$(CUSTOM_LOAD_PROFILE_FILE)" || (echo "Select a load profile in the web UI or run CUSTOM_LOAD_PROFILE_FILE=load-testing/load-profiles/local/name.load.json make profile"; exit 1)
	@mkdir -p $(K6_RESULTS)
	@report="$(K6_RESULTS)/load-profile-ru-$(REPORT_TS).html"; \
	RU_REPORT="$$report" k6 run \
		-e BASE_URL="$(BASE_URL)" \
		-e SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
		-e SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
		-e TOKENS_FILE="$(TOKENS_FILE_ABS)" \
		-e CUSTOM_LOAD_PROFILE_FILE="$(CUSTOM_LOAD_PROFILE_FILE_ABS)" \
		-e RAMP_UP="$(RAMP_UP)" \
		-e HOLD="$(HOLD)" \
		-e RAMP_DOWN="$(RAMP_DOWN)" \
		-e THINK_TIME_SECONDS="$(THINK_TIME_SECONDS)" \
		$(K6_SCENARIOS)/load-profile.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

flight-once: k6-flight-once

k6-flight-once:
	@[ -n "$(SESSION_TOKEN_FOR_K6)$(SESSION_TOKENS_FOR_K6)" ] || [ -f "$(TOKENS_FILE)" ] || (echo "Run make start or make token first"; exit 1)
	@mkdir -p $(K6_RESULTS)
	@report="$(K6_RESULTS)/flight-critical-ru-$(REPORT_TS).html"; \
	ENABLE_STATE_CHANGING=true \
	RU_REPORT="$$report" \
	k6 run \
		-e BASE_URL="$(BASE_URL)" \
		-e SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
		-e SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
		-e TOKENS_FILE="$(TOKENS_FILE_ABS)" \
		-e FLIGHT_VUS="$(FLIGHT_VUS)" \
		-e FLIGHT_ITERATIONS="$(FLIGHT_ITERATIONS)" \
		-e ROUTE_ID="$(ROUTE_ID)" \
		$(K6_SCENARIOS)/flight-critical.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

browser: k6-browser-flight-smoke

browser-dashboard: k6-browser-flight-dashboard

grafana-check:
	@test -n "$(GRAFANA_GATEWAY_URL)" || (echo "Set GRAFANA_GATEWAY_URL in $(K6_ENV)"; exit 1)
	@test -n "$(GRAFANA_PUSH_TOKEN)" || (echo "Set GRAFANA_PUSH_TOKEN in $(K6_ENV)"; exit 1)
	@curl -sS -o /dev/null -w "Grafana gateway health: HTTP %{http_code}\n" "$(GRAFANA_GATEWAY_URL)/health"

public-grafana:
	@$(MAKE) --no-print-directory k6-grafana MODE=public

auth-grafana:
	@$(MAKE) --no-print-directory k6-grafana MODE=auth

k6-grafana:
	@test -n "$(GRAFANA_GATEWAY_URL)" || (echo "Set GRAFANA_GATEWAY_URL in $(K6_ENV)"; exit 1)
	@test -n "$(GRAFANA_PUSH_TOKEN)" || (echo "Set GRAFANA_PUSH_TOKEN in $(K6_ENV)"; exit 1)
	@MODE="$(MODE)" \
	GRAFANA_GATEWAY_URL="$(GRAFANA_GATEWAY_URL)" \
	GRAFANA_PUSH_TOKEN="$(GRAFANA_PUSH_TOKEN)" \
	TEST_ID="$(TEST_ID)" \
	BASE_URL="$(BASE_URL)" \
	SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
	SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
	TOKENS_FILE="$(TOKENS_FILE_ABS)" \
	VUS="$(PUBLIC_VUS_FOR_K6)" \
	AUTH_VUS="$(AUTH_VUS_FOR_K6)" \
	RAMP_UP="$(RAMP_UP)" \
	HOLD="$(HOLD)" \
	RAMP_DOWN="$(RAMP_DOWN)" \
	THINK_TIME_SECONDS="$(THINK_TIME_SECONDS)" \
	load-testing/k6/scripts/run-grafana.sh

k6-browser-flight-smoke:
	@[ -n "$(SESSION_TOKEN_FOR_K6)$(SESSION_TOKENS_FOR_K6)" ] || [ -f "$(TOKENS_FILE)" ] || (echo "Run make start or make token first"; exit 1)
	@mkdir -p $(K6_RESULTS)/screenshots
	@report="$(K6_RESULTS)/browser-simple-flight-ru-$(REPORT_TS).html"; \
	K6_BROWSER_HEADLESS="$(K6_BROWSER_HEADLESS)" \
	RU_REPORT="$$report" \
	k6 run \
		-e FRONTEND_URL="$(FRONTEND_URL)" \
		-e API_COOKIE_DOMAIN="$(API_COOKIE_DOMAIN)" \
		-e SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
		-e SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
		-e TOKENS_FILE="$(TOKENS_FILE_ABS)" \
		-e BROWSER_VUS="$(BROWSER_VUS)" \
		-e BROWSER_ITERATIONS="$(BROWSER_ITERATIONS)" \
		-e FLIGHT_OBSERVE_SECONDS="$(FLIGHT_OBSERVE_SECONDS)" \
		-e SCREENSHOT_DIR="$(K6_RESULTS)/screenshots" \
		$(K6_SCENARIOS)/browser-simple-flight.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

k6-browser-flight-dashboard:
	@[ -n "$(SESSION_TOKEN_FOR_K6)$(SESSION_TOKENS_FOR_K6)" ] || [ -f "$(TOKENS_FILE)" ] || (echo "Run make start or make token first"; exit 1)
	@mkdir -p $(K6_RESULTS)/screenshots
	@report="$(K6_RESULTS)/browser-simple-flight-dashboard-ru-$(REPORT_TS).html"; \
	K6_WEB_DASHBOARD=true \
	K6_WEB_DASHBOARD_OPEN=true \
	K6_BROWSER_HEADLESS="$(K6_BROWSER_HEADLESS)" \
	RU_REPORT="$$report" \
	k6 run \
		-e FRONTEND_URL="$(FRONTEND_URL)" \
		-e API_COOKIE_DOMAIN="$(API_COOKIE_DOMAIN)" \
		-e SESSION_TOKEN="$(SESSION_TOKEN_FOR_K6)" \
		-e SESSION_TOKENS="$(SESSION_TOKENS_FOR_K6)" \
		-e TOKENS_FILE="$(TOKENS_FILE_ABS)" \
		-e BROWSER_VUS="$(BROWSER_VUS)" \
		-e BROWSER_ITERATIONS="$(BROWSER_ITERATIONS)" \
		-e FLIGHT_OBSERVE_SECONDS="$(FLIGHT_OBSERVE_SECONDS)" \
		-e SCREENSHOT_DIR="$(K6_RESULTS)/screenshots" \
		$(K6_SCENARIOS)/browser-simple-flight.js; \
	status=$$?; \
	if [ "$(OPEN_REPORT)" = "true" ] && [ -f "$$report" ]; then \
		echo "Opening report: $$report"; \
		open "$$report" >/dev/null 2>&1 || true; \
	fi; \
	exit $$status

dist: k6-distributed

dist-public:
	@$(MAKE) --no-print-directory k6-distributed MODE=public

dist-auth:
	@$(MAKE) --no-print-directory k6-distributed MODE=auth

dist-flight:
	@$(MAKE) --no-print-directory k6-distributed MODE=flight

k6-distributed:
	@MODE="$(MODE)" \
	TOTAL_VUS="$(TOTAL_VUS)" \
	MACHINE_TOTAL="$(MACHINE_TOTAL)" \
	MACHINE_INDEX="$(MACHINE_INDEX)" \
	RAMP_UP="$(RAMP_UP)" \
	HOLD="$(HOLD)" \
	RAMP_DOWN="$(RAMP_DOWN)" \
	THINK_TIME_SECONDS="$(THINK_TIME_SECONDS)" \
	load-testing/k6/scripts/run-distributed.sh
