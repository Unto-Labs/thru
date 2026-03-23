#!/bin/bash
# Run all compliance tests
# Usage: ./run_all_tests.sh [--verbose] [--language LANG] [--no-cleanup]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_CASES_DIR="${SCRIPT_DIR}/../compliance_tests/test_cases"

# Parse arguments
VERBOSE=""
LANGUAGE=""
NO_CLEANUP=""
FAILED_ONLY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -v|--verbose)
      VERBOSE="--verbose"
      shift
      ;;
    -l|--language)
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
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  -v, --verbose       Show verbose output for each test"
      echo "  -l, --language LANG Run tests for specific language (rust, c, typescript, all)"
      echo "  --no-cleanup        Preserve temporary directories after tests"
      echo "  --failed-only       Only show failed tests"
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

# Find all test case YAML files
echo "=== Discovering Test Cases ==="
TEST_FILES=$(find "$TEST_CASES_DIR" -name "*.yaml" | sort)
TOTAL_TESTS=$(echo "$TEST_FILES" | wc -l | tr -d ' ')

echo "Found $TOTAL_TESTS test cases"
echo ""

# Build the compliance harness
echo "=== Building Compliance Harness ==="
cd "$SCRIPT_DIR"
cargo build --release --quiet
echo "Build complete"
echo ""

# Create a unique temporary directory for this test run
TEMP_BASE=$(mktemp -d)
echo "Using temporary directory: $TEMP_BASE"
echo ""

# Run each test
PASSED=0
FAILED=0
FAILED_TESTS=()

echo "=== Running Tests ==="
echo ""

for TEST_FILE in $TEST_FILES; do
  # Get test name from file path
  TEST_NAME=$(basename "$TEST_FILE" .yaml)
  TEST_CATEGORY=$(basename "$(dirname "$TEST_FILE")")

  # Run the test
  if [ -z "$FAILED_ONLY" ]; then
    echo -n "[$TEST_CATEGORY/$TEST_NAME] "
  fi

  if OUTPUT=$(cargo run --release --quiet -- "$TEST_FILE" $LANGUAGE $VERBOSE $NO_CLEANUP --temp-dir "$TEMP_BASE" 2>&1); then
    # Test passed
    ((PASSED++))
    if [ -z "$FAILED_ONLY" ]; then
      echo "✓ PASSED"
    fi
  else
    # Test failed
    ((FAILED++))
    FAILED_TESTS+=("$TEST_CATEGORY/$TEST_NAME")
    echo "✗ FAILED"
    if [ -n "$VERBOSE" ]; then
      echo "$OUTPUT" | sed 's/^/  /'
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
