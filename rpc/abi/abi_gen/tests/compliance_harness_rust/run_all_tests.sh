#!/bin/bash
# Run all compliance tests
# Usage: ./run_all_tests.sh [--verbose] [--language LANG] [--no-cleanup] [--jobs N]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_CASES_DIR="${SCRIPT_DIR}/../compliance_tests/test_cases"

# Internal mode: run one case and record its outcome. The main loop below
# starts one of these per case through xargs -P, so that cases run in
# parallel while their output is still printed in order afterwards.
# Its inputs come from the environment the main loop exports.
if [ "${1:-}" = "--run-one" ]; then
  INDEX="$2"
  TEST_FILE="$3"
  CASE_DIR="$(basename "$(dirname "$TEST_FILE")")__$(basename "$TEST_FILE" .yaml)"
  CASE_TEMP="${TEMP_BASE}/${CASE_DIR}"
  mkdir -p "$CASE_TEMP"
  # Word splitting of $HARNESS_ARGS is intended: it holds the flags below.
  # shellcheck disable=SC2086
  if "$HARNESS_BIN" "$TEST_FILE" $HARNESS_ARGS --temp-dir "$CASE_TEMP" > "${RESULTS_DIR}/${INDEX}.out" 2>&1; then
    echo pass > "${RESULTS_DIR}/${INDEX}.status"
  else
    echo fail > "${RESULTS_DIR}/${INDEX}.status"
  fi
  exit 0
fi

# Parse arguments
VERBOSE=""
LANGUAGE=""
NO_CLEANUP=""
FAILED_ONLY=""
JOBS="${ABI_COMPLIANCE_JOBS:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    -v|--verbose)
      VERBOSE="--verbose"
      shift
      ;;
    -l|--language)
      if [ $# -lt 2 ]; then
        echo "$1 needs a language"
        exit 1
      fi
      LANGUAGE="--language $2"
      shift 2
      ;;
    --no-cleanup)
      NO_CLEANUP="--no-cleanup"
      shift
      ;;
    --failed-only)
      FAILED_ONLY="true"
      shift
      ;;
    -j|--jobs)
      if [ $# -lt 2 ]; then
        echo "$1 needs a job count"
        exit 1
      fi
      JOBS="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  -v, --verbose       Show verbose output for each test"
      echo "  -l, --language LANG Run tests for specific language (rust, c, typescript, go, all)"
      echo "  --no-cleanup        Preserve temporary directories after tests"
      echo "  --failed-only       Only show failed tests"
      echo "  -j, --jobs N        Cases to run at once (default: CPU count, or ABI_COMPLIANCE_JOBS)"
      echo "  -h, --help          Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

if [ -z "$JOBS" ]; then
  JOBS=$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)
fi
if ! [[ "$JOBS" =~ ^[1-9][0-9]*$ ]]; then
  echo "--jobs must be a positive integer, got '$JOBS'"
  exit 1
fi

# Find all test case YAML files
echo "=== Discovering Test Cases ==="
TEST_FILES=$(find "$TEST_CASES_DIR" -name "*.yaml" | sort)
TOTAL_TESTS=$(echo "$TEST_FILES" | wc -l | tr -d ' ')

echo "Found $TOTAL_TESTS test cases"
echo ""

# Build the compliance harness
echo "=== Building Compliance Harness ==="
cd "$SCRIPT_DIR"
if ! cargo build --release --quiet --locked; then
  echo "Compliance harness build failed"
  exit 1
fi
HARNESS_BIN="${SCRIPT_DIR}/target/release/compliance_harness"
if [ ! -x "$HARNESS_BIN" ]; then
  echo "Compliance harness binary not found at $HARNESS_BIN"
  exit 1
fi

echo "Build complete"
echo ""

# Create a unique temporary directory for this test run, or use the fixed one
# CI names. The generated crates are built through the vcache rustc wrapper,
# and their target paths (-L dependency=<dir>/...) are part of its key: a new
# mktemp path every run made each of them a miss that was stored and never hit.
# Each case gets its own fixed subdirectory, so parallel cases never share one.
if [ -n "${ABI_COMPLIANCE_TEMP_BASE:-}" ]; then
  TEMP_BASE="$ABI_COMPLIANCE_TEMP_BASE"
  rm -rf "$TEMP_BASE"
  mkdir -p "$TEMP_BASE"
else
  TEMP_BASE=$(mktemp -d)
fi
echo "Using temporary directory: $TEMP_BASE"
echo ""

RESULTS_DIR=$(mktemp -d)
trap 'rm -rf "$RESULTS_DIR"' EXIT

echo "=== Running Tests ($JOBS at a time) ==="
echo ""

# Run each test, $JOBS at a time.
HARNESS_ARGS="$LANGUAGE $VERBOSE $NO_CLEANUP"
export HARNESS_BIN TEMP_BASE RESULTS_DIR HARNESS_ARGS
INDEX=0
for TEST_FILE in $TEST_FILES; do
  INDEX=$((INDEX + 1))
  printf '%s\0%s\0' "$INDEX" "$TEST_FILE"
done | xargs -0 -n 2 -P "$JOBS" "${SCRIPT_DIR}/$(basename "$0")" --run-one

# Report in discovery order, as the sequential loop did.
PASSED=0
FAILED=0
FAILED_TESTS=()
INDEX=0
for TEST_FILE in $TEST_FILES; do
  INDEX=$((INDEX + 1))
  TEST_NAME=$(basename "$TEST_FILE" .yaml)
  TEST_CATEGORY=$(basename "$(dirname "$TEST_FILE")")
  STATUS=$(cat "${RESULTS_DIR}/${INDEX}.status" 2>/dev/null || echo fail)

  if [ "$STATUS" = "pass" ]; then
    ((PASSED++))
    if [ -z "$FAILED_ONLY" ]; then
      echo "[$TEST_CATEGORY/$TEST_NAME] ✓ PASSED"
    fi
  else
    ((FAILED++))
    FAILED_TESTS+=("$TEST_CATEGORY/$TEST_NAME")
    echo "[$TEST_CATEGORY/$TEST_NAME] ✗ FAILED"
    if [ -n "$VERBOSE" ] && [ -f "${RESULTS_DIR}/${INDEX}.out" ]; then
      sed 's/^/  /' "${RESULTS_DIR}/${INDEX}.out"
      echo ""
    fi
  fi
done

echo ""
echo "=== Test Summary ==="
echo "Total:  $TOTAL_TESTS"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

# Clean up temp directory unless --no-cleanup was specified
if [ -z "$NO_CLEANUP" ] && [ -d "$TEMP_BASE" ]; then
  rm -rf "$TEMP_BASE"
  echo "Cleaned up temporary directory"
else
  echo "Temporary directory preserved at: $TEMP_BASE"
fi
echo ""

if [ $FAILED -gt 0 ]; then
  echo "Failed tests:"
  for FAILED_TEST in "${FAILED_TESTS[@]}"; do
    echo "  - $FAILED_TEST"
  done
  echo ""
  exit 1
else
  echo "All tests passed! 🎉"
  exit 0
fi
